// =====================================================================
// background.js — Eklentinin arka plan servisi (service worker)
//
// Görevleri:
//  • Görselleri indirmek (CORS kısıtlamasını aşmak için burada yapılır)
//  • Claude API'ye çeviri isteği göndermek (API anahtarı sayfaya hiç inmez)
//  • Çevirileri önbelleğe almak (aynı sayfa için tekrar ücret ödenmez)
//  • Sağ tık menüsü ve klavye kısayolunu yönetmek
// =====================================================================

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const PROMPT_VERSION = 'v1'; // istem değişirse eski önbellek kullanılmasın diye
const CACHE_LIMIT = 800;     // en fazla kaç sayfanın çevirisi saklansın

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  minFontPx: 13,      // ekranda okunabilir en küçük yazı boyutu (CSS piksel)
  uppercase: false,   // çeviriyi BÜYÜK HARFLE yaz
  effort: 'medium',
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// ---------------------------------------------------------------------
// Mesaj yönlendirici
// ---------------------------------------------------------------------
const handlers = {
  fetchImage: (m, sender) => fetchImage(m.url, m.pageUrl || sender.tab?.url),
  translate: (m) => translateBubbles(m),
  shorten: (m) => shortenTexts(m),
  ensureInjected: (m) => ensureInjected(m.tabId),
  testKey: (m) => testKey(m.apiKey),
  cacheStats: () => cacheStats(),
  clearCache: () => clearCache(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      console.warn('[MangaÇeviri]', err);
      sendResponse({ ok: false, error: err?.message || String(err), code: err?.code });
    });
  return true; // yanıt asenkron gelecek
});

// ---------------------------------------------------------------------
// İçerik betiğini sekmeye yükleme
// ---------------------------------------------------------------------
async function ensureInjected(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
    if (r?.pong) return true;
  } catch (_) { /* henüz yüklenmemiş */ }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/detector.js', 'lib/layout.js', 'content.js'],
  });
  return true;
}

async function sendToTab(tabId, msg) {
  await ensureInjected(tabId);
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
}

// ---------------------------------------------------------------------
// Sağ tık menüsü ve kısayol
// ---------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'mtc-img', title: 'Bu görseli Türkçeye çevir', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'mtc-toggle', title: 'Çeviri ↔ Orijinal (bu görsel)', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'mtc-page', title: 'Bu sayfadaki mangayı çevir', contexts: ['page'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'mtc-img') sendToTab(tab.id, { type: 'translateImage', srcUrl: info.srcUrl });
  if (info.menuItemId === 'mtc-toggle') sendToTab(tab.id, { type: 'toggleImage', srcUrl: info.srcUrl });
  if (info.menuItemId === 'mtc-page') sendToTab(tab.id, { type: 'translatePage' });
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== 'sayfayi-cevir') return;
  const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (t?.id) sendToTab(t.id, { type: 'translatePage' });
});

// ---------------------------------------------------------------------
// CORS çözümü: görseli eklentinin kendisi indirir.
// Eklentiler host izni olan adreslere CORS engeline takılmadan istek atabilir.
// Bazı siteler "hotlink" koruması için Referer başlığına bakar; bu yüzden
// istek sırasında Referer'i okunan sayfanın adresine ayarlıyoruz.
// ---------------------------------------------------------------------
let ruleMap = null; // host -> {id, referer}
async function loadRules() {
  if (ruleMap) return;
  ruleMap = new Map();
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  for (const r of rules) {
    const host = r.condition?.requestDomains?.[0];
    const ref = r.action?.requestHeaders?.find((h) => h.header === 'referer')?.value;
    if (host) ruleMap.set(host, { id: r.id, referer: ref });
  }
}

async function setRefererRule(url, pageUrl) {
  if (!pageUrl) return;
  await loadRules();
  const host = new URL(url).hostname;
  const referer = new URL(pageUrl).origin + '/';
  const old = ruleMap.get(host);
  if (old && old.referer === referer) return;
  const id = old?.id || Math.max(1000, ...[...ruleMap.values()].map((v) => v.id)) + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'referer', operation: 'set', value: referer },
          { header: 'origin', operation: 'remove' },
        ],
      },
      condition: {
        requestDomains: [host],
        tabIds: [chrome.tabs.TAB_ID_NONE], // sadece eklentinin kendi istekleri
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
  ruleMap.set(host, { id, referer });
}

async function fetchImage(url, pageUrl) {
  if (!/^https?:|^data:/.test(url)) throw new Error('Desteklenmeyen görsel adresi');
  if (url.startsWith('http')) {
    try { await setRefererRule(url, pageUrl); } catch (e) { console.warn('Referer kuralı eklenemedi', e); }
  }
  const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
  if (!res.ok) throw new Error(`Görsel indirilemedi (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  return { b64: toBase64(buf), mime: res.headers.get('content-type') || 'image/jpeg' };
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// ---------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------
const SYSTEM_PROMPT = `Sen deneyimli bir manga çevirmeni ve letterer'sın. İngilizce manga konuşma balonlarını doğal, akıcı Türkçeye çevirirsin. Çevirin balonun içine yazılacak, bu yüzden uzunluk sınırı çok önemli.

Sana önce (varsa) sayfanın tamamı bağlam için, ardından numaralı balon kırpıntıları gelir. Her balon için:

1. OKU: Kırpıntının ortasındaki balonun İngilizce yazısını aynen oku. Satır sonlarını boşlukla birleştir, satır sonunda tireyle bölünmüş kelimeleri birleştir. Kırpıntının kenarına taşan başka balonların yazısını alma.
2. ÇEVİR: Birebir değil, anlamı ve duyguyu koruyarak, bir Türk okurun doğal bulacağı konuşma diliyle çevir. Deyimleri Türkçedeki karşılığıyla ver.
3. TON VE HİTAP: Karakterin konuşma tarzını koru. Kaba/argo konuşan kaba, resmi konuşan resmi ("siz"), samimi olan samimi ("sen") konuşsun. Sayfadaki bağlama bakarak kimin kime konuştuğunu tahmin et ve sayfa boyunca tutarlı ol.
4. VURGU: Ünlemleri ve soru işaretlerini (!, ?!, ...), kekelemeyi ("B-ben..."), uzatmaları ("Neee?!"), kalın/vurgulu kelimelerin vurgusunu koru.
5. İSİMLER: Karakter isimlerini, lakapları, saldırı/teknik adlarını ve Japonca hitap eklerini (-san, -kun, -chan, senpai, sensei, onii-chan) olduğu gibi bırak.
6. KARAKTER SINIRI KESİNDİR: "turkce" alanı, o balon için verilen en fazla karakter sayısını (boşluklar dahil) aşmamalı. Sığmıyorsa anlamı koruyarak kısalt: gereksiz dolgu sözcüklerini at, kısa eş anlamlılar seç, cümleyi yeniden kur. Önemli bilgiyi veya duyguyu asla atma.
7. KONUŞMA DEĞİLSE: Kırpıntı bir konuşma/düşünce balonu ya da anlatım kutusu değilse (efekt sesi, tabela, arka plan yazısı, boş alan, yazı içermeyen çizim, okunamayan veya yarısı kesik yazı) "konusma": false ver ve "turkce" boş olsun.
8. Sadece "..." gibi noktalama içeren balonları aynen bırak.
9. Normal Türkçe yazım ve noktalama kullan (cümle başı büyük harf). Tamamı büyük harf yazma.

Her balon numarası için tam olarak bir sonuç döndür.`;

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    balonlar: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer', description: 'Balon numarası' },
          ingilizce: { type: 'string', description: 'Balondaki İngilizce metin (OCR)' },
          konusma: { type: 'boolean', description: 'Konuşma/düşünce balonu veya anlatım kutusu mu?' },
          turkce: { type: 'string', description: 'Karakter sınırına uyan doğal Türkçe çeviri' },
        },
        required: ['no', 'ingilizce', 'konusma', 'turkce'],
        additionalProperties: false,
      },
    },
  },
  required: ['balonlar'],
  additionalProperties: false,
};

const SHORTEN_SCHEMA = {
  type: 'object',
  properties: {
    kisaltmalar: {
      type: 'array',
      items: {
        type: 'object',
        properties: { no: { type: 'integer' }, turkce: { type: 'string' } },
        required: ['no', 'turkce'],
        additionalProperties: false,
      },
    },
  },
  required: ['kisaltmalar'],
  additionalProperties: false,
};

function apiError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** Claude API'ye istek gönderir; geçici hatalarda birkaç kez yeniden dener. */
async function callClaude(settings, { system, content, schema, effort, maxTokens = 16000 }) {
  if (!settings.apiKey) throw apiError('API anahtarı girilmemiş. Eklenti ayarlarından anahtarınızı girin.', 'NO_KEY');
  const body = {
    model: settings.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: effort || settings.effort || 'medium', format: { type: 'json_schema', schema } },
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  // Güvenlik sınıflandırıcısı isteği reddederse sunucu tarafında başka modelle yeniden dene
  if (/^claude-(opus-5-5|sonnet-5-5)$/.test(settings.model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      lastErr = apiError('Ağ hatası: API\'ye ulaşılamadı. İnternet bağlantınızı kontrol edin.', 'NETWORK');
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const msg = await res.json();
      if (msg.stop_reason === 'refusal') throw apiError('Model bu sayfayı çevirmeyi reddetti.', 'REFUSAL');
      if (msg.stop_reason === 'max_tokens') throw apiError('Yanıt yarıda kesildi (çok fazla balon). Tekrar deneyin.', 'MAX_TOKENS');
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        return { data: JSON.parse(text), usage: msg.usage };
      } catch (_) {
        throw apiError('Modelden beklenmeyen yanıt geldi.', 'BAD_JSON');
      }
    }
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
    if (res.status === 401) throw apiError('API anahtarı geçersiz. Ayarlardan kontrol edin.', 'BAD_KEY');
    if (res.status === 403) throw apiError('Bu API anahtarının bu modele erişim izni yok. ' + detail, 'FORBIDDEN');
    if (res.status === 400) {
      if (/credit|balance/i.test(detail)) throw apiError('API bakiyeniz yetersiz. Hesabınıza bakiye yükleyin.', 'NO_CREDIT');
      throw apiError('İstek hatası: ' + detail, 'BAD_REQUEST');
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = apiError(res.status === 429 ? 'Hız sınırına takıldı, bekleniyor…' : `API geçici olarak hata verdi (${res.status}).`, 'RETRY');
      const ra = Number(res.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    throw apiError(`API hatası (${res.status}): ${detail}`, 'API');
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bir sayfadaki balonları çevirir.
 * m = { hash, bubbles:[{id, maxChars, box}], crops:{id: base64jpeg}, page: base64jpeg|null }
 */
async function translateBubbles(m) {
  const settings = await getSettings();
  const cacheKey = `c:${m.hash}:${settings.model}:${PROMPT_VERSION}`;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached && sameBubbles(cached.boxes, m.bubbles)) {
    touchCache(cacheKey);
    return { results: cached.results, fromCache: true };
  }

  const content = [];
  if (m.page) {
    content.push({ type: 'text', text: 'Sayfanın tamamı (sadece bağlam için):' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.page } });
  }
  for (const b of m.bubbles) {
    content.push({ type: 'text', text: `Balon #${b.id} — Türkçe çeviri en fazla ${b.maxChars} karakter olmalı:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.crops[b.id] } });
  }
  content.push({
    type: 'text',
    text: `Toplam ${m.bubbles.length} balon var (numaralar: ${m.bubbles.map((b) => b.id).join(', ')}). Okuma sırası sağdan sola, yukarıdan aşağıdır. Her biri için sonuç döndür.`,
  });

  const { data } = await callClaude(settings, { system: SYSTEM_PROMPT, content, schema: TRANSLATE_SCHEMA });
  const results = (data.balonlar || []).map((r) => ({
    id: r.no, en: r.ingilizce || '', speech: !!r.konusma, tr: (r.turkce || '').trim(),
  }));
  await saveCache(cacheKey, { boxes: m.bubbles.map((b) => b.box), results, t: Date.now() });
  return { results, fromCache: false };
}

/** Balona sığmayan çevirileri, daha sıkı sınırla kısaltır (yalnızca metin, ucuz istek). */
async function shortenTexts(m) {
  const settings = await getSettings();
  const list = m.items.map((it) => `#${it.id} (en fazla ${it.maxChars} karakter, şu an ${it.tr.length}): ${it.tr}` + (it.en ? `\n   İngilizce aslı: ${it.en}` : '')).join('\n');
  const { data } = await callClaude(settings, {
    system: 'Sen bir manga çevirmenisin. Sana verilen Türkçe balon çevirilerini, belirtilen karakter sınırına (boşluklar dahil) KESİNLİKLE uyacak şekilde kısalt. Anlamı, duyguyu, hitabı ve ünlemleri koru; isimleri değiştirme. Dolgu sözcüklerini at, kısa eş anlamlılar kullan, cümleyi yeniden kur.',
    content: [{ type: 'text', text: list }],
    schema: SHORTEN_SCHEMA,
    effort: 'low',
    maxTokens: 8000,
  });
  const out = {};
  for (const r of data.kisaltmalar || []) out[r.no] = (r.turkce || '').trim();

  // Önbellekteki çeviriyi de güncelle ki bir dahaki sefer tekrar kısaltmak gerekmesin
  if (m.hash) {
    const cacheKey = `c:${m.hash}:${settings.model}:${PROMPT_VERSION}`;
    const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
    if (cached) {
      for (const r of cached.results) if (out[r.id]) r.tr = out[r.id];
      await chrome.storage.local.set({ [cacheKey]: cached });
    }
  }
  return out;
}

async function testKey(apiKey) {
  // Model listesini çekmek ücretsizdir; anahtarın geçerli olup olmadığını gösterir.
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' },
  });
  if (res.ok) return true;
  if (res.status === 401) throw apiError('Anahtar geçersiz.', 'BAD_KEY');
  throw apiError(`Doğrulanamadı (HTTP ${res.status}).`, 'API');
}

// ---------------------------------------------------------------------
// Önbellek (chrome.storage.local)
// ---------------------------------------------------------------------
function sameBubbles(a, b) {
  if (!a || a.length !== b.length) return false;
  return a.every((box, i) => {
    const o = b[i].box;
    return Math.abs(box[0] - o[0]) <= 3 && Math.abs(box[1] - o[1]) <= 3 && Math.abs(box[2] - o[2]) <= 3 && Math.abs(box[3] - o[3]) <= 3;
  });
}

async function getIndex() {
  return (await chrome.storage.local.get('cacheIndex')).cacheIndex || {};
}

async function saveCache(key, value) {
  const index = await getIndex();
  index[key] = Date.now();
  const keys = Object.keys(index);
  const remove = [];
  if (keys.length > CACHE_LIMIT) {
    keys.sort((x, y) => index[x] - index[y]);
    for (const k of keys.slice(0, keys.length - CACHE_LIMIT)) { remove.push(k); delete index[k]; }
  }
  if (remove.length) await chrome.storage.local.remove(remove);
  await chrome.storage.local.set({ [key]: value, cacheIndex: index });
}

async function touchCache(key) {
  const index = await getIndex();
  index[key] = Date.now();
  await chrome.storage.local.set({ cacheIndex: index });
}

async function cacheStats() {
  const index = await getIndex();
  const bytes = await chrome.storage.local.getBytesInUse(null);
  return { pages: Object.keys(index).length, bytes };
}

async function clearCache() {
  const index = await getIndex();
  await chrome.storage.local.remove([...Object.keys(index), 'cacheIndex']);
  return true;
}
