// =====================================================================
// background.js — Eklentinin arka plan servisi (service worker)
//
// Görevleri:
//  • Görselleri indirmek (CORS kısıtlamasını aşmak için burada yapılır)
//  • Yazı okuma + çeviri motorunu (offscreen.html) açık tutmak
//  • Çevirileri önbelleğe almak (aynı sayfa tekrar açılınca anında gelir)
//  • Sağ tık menüsü ve klavye kısayolunu yönetmek
//
// Her şey bilgisayarda çalışır: API anahtarı, hesap veya ücret yoktur.
// =====================================================================

const CACHE_LIMIT = 800;     // en fazla kaç sayfanın çevirisi saklansın
const FREE_VERSION = 'v1';   // motor (OCR + Chrome çevirmeni) önbellek sürümü


// ---------------------------------------------------------------------
// Mesaj yönlendirici
// ---------------------------------------------------------------------
const handlers = {
  fetchImage: (m, sender) => fetchImage(m.url, m.pageUrl || sender.tab?.url),
  translate: (m) => translateFree(m),
  ensureInjected: (m) => ensureInjected(m.tabId),
  saveCache: (m) => saveFreeCache(m),
  warmup: () => warmup(),
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

function apiError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
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

// ---------------------------------------------------------------------
// Motor: OCR + Chrome'un yerleşik çevirmeni (offscreen.html'de çalışır)
// ---------------------------------------------------------------------
let offscreenCreating = null;
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  if (!offscreenCreating) {
    // Otomatik testlerde sahte çevirmenle açılır (gerçek kullanımda bu anahtar hiç yoktur)
    const { testMockTranslator } = await chrome.storage.local.get('testMockTranslator');
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html' + (testMockTranslator ? '?mock=1' : ''),
      reasons: ['WORKERS'],
      justification: 'Manga balonlarındaki yazıyı okumak (OCR) ve bilgisayarda çevirmek için',
    }).finally(() => { offscreenCreating = null; });
  }
  await offscreenCreating;
}

async function warmup() {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'warmup' }).catch(() => {});
  return true;
}

const freeKey = (hash) => `c:${hash}:ucretsiz:${FREE_VERSION}`;

/**
 * m.ocr = {id: dataURL}  (yazının temizlenmiş, büyütülmüş kırpıntısı)
 * Dönüş: {results, fromCache, needTranslate?, translatorState?}
 *  needTranslate=true → eklentinin kendi sayfasında çevirmen kullanılamadı; içerik betiği
 *  çeviriyi manga sayfasının içinde yapmayı deneyecek.
 */
async function translateFree(m) {
  const key = freeKey(m.hash);
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && sameBubbles(cached.boxes, m.bubbles)) {
    touchCache(key);
    return { results: cached.results, fromCache: true };
  }
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'ocrTranslate',
    items: m.bubbles.map((b) => ({ id: b.id, img: m.ocr[b.id] })),
  });
  if (!r?.ok) throw apiError('Yazı okuma (OCR) başarısız: ' + (r?.error || 'bilinmeyen hata'), 'OCR');
  if (r.translator !== 'ok') {
    return { results: r.results, fromCache: false, needTranslate: true, translatorState: r.translator };
  }
  await saveCache(key, { boxes: m.bubbles.map((b) => b.box), results: r.results, t: Date.now() });
  return { results: r.results, fromCache: false };
}

async function saveFreeCache(m) {
  await saveCache(freeKey(m.hash), { boxes: m.boxes, results: m.results, t: Date.now() });
  return true;
}
