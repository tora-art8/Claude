// =====================================================================
// offscreen.js — Ücretsiz motor: yazı okuma (OCR) + bilgisayarda çeviri
//
// Bu sayfa görünmez; eklenti onu bir kez açar ve açık tutar, böylece
// modeller her sayfada yeniden yüklenmez (hız için önemli).
//  • OCR: Tesseract (eklentinin içinde gömülü, internet gerekmez)
//  • Çeviri: Google Chrome'un yerleşik çevirmeni (Translator API) —
//    ücretsiz, bilgisayarda çalışır; Türkçe paket ilk seferde bir kez iner.
// =====================================================================

const BASE = chrome.runtime.getURL('vendor/tesseract/');

// --- Test için sahte çevirmen (sadece otomatik testlerde ?mock=1 ile açılır) ---
if (new URLSearchParams(location.search).get('mock') === '1') {
  self.Translator = {
    availability: async () => 'available',
    create: async () => ({ translate: async (t) => `«${t}»` }),
  };
}

// ---------------------------------------------------------------------
// OCR (Tesseract) — işlemci çekirdeğine göre 1-2 paralel işçi
// ---------------------------------------------------------------------
let schedulerPromise = null;
function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const scheduler = Tesseract.createScheduler();
      const count = (navigator.hardwareConcurrency || 2) >= 4 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const worker = await Tesseract.createWorker('eng', 1 /* LSTM */, {
          workerPath: BASE + 'worker.min.js',
          corePath: BASE,
          langPath: BASE,
          workerBlobURL: false,
          cacheMethod: 'none',
          gzip: true,
        });
        await worker.setParameters({
          tessedit_pageseg_mode: '6',      // tek bir yazı bloğu
          preserve_interword_spaces: '1',
        });
        scheduler.addWorker(worker);
      }
      return scheduler;
    })();
    schedulerPromise.catch(() => { schedulerPromise = null; });
  }
  return schedulerPromise;
}

/** Tesseract çıktısını temizler ve "konuşma mı?" kararını verir. */
function cleanOcr(raw, confidence) {
  let t = (raw || '')
    .replace(/[^\x20-\x7E\n’‘“”…]/g, ' ')   // ©, ®, ■ gibi OCR parazitleri
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')   // satır sonunda bölünmüş kelime
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[_~^{}\[\]<>\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const letters0 = (t.match(/[A-Za-z]/g) || []).length;
  const upper0 = (t.match(/[A-Z]/g) || []).length;
  const caps = letters0 >= 3 && upper0 / letters0 >= 0.8; // manga tarzı tamamen büyük harf

  let tokens = t.split(' ').filter(Boolean).map((w) => {
    // "I" harfi sık sık | veya 1 olarak okunur
    if (/^[|l1]$/.test(w) || (caps && /^[|1l]['’](M|LL|VE|D)\b/i.test(w))) return 'I' + w.slice(1);
    if (/^[|]/.test(w)) w = 'I' + w.slice(1);
    return w.replace(/\|/g, 'I');
  });
  // Balon kenarından gelen tek harflik parazitleri ve tırnakları at
  tokens = tokens
    .map((w) => w.replace(/^["']+(?=\w)/, '').replace(/(?<=[\w.!?…])"+$/, ''))
    .filter((w) => !(caps && /^[B-HJ-Z]$/.test(w)) && !/^["'.,:;-]$/.test(w));
  t = tokens.join(' ').replace(/\s+([,.!?…])/g, '$1').trim();

  // Gerçek kelimeye benziyor mu? (yüz/çizim parçaları "oO Se", "LN" gibi anlamsız harfler verir)
  const isWord = (w) => {
    const core = w.replace(/^[("']+|[.,!?…)"']+$/g, '');
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(core)) return false;
    const L = core.replace(/['-]/g, '');
    const caseOk = L === L.toUpperCase() || L === L.toLowerCase() || /^[A-Z][a-z]+$/.test(L);
    if (!caseOk) return false;
    if (caps && L !== L.toUpperCase()) return false;
    return L.length <= 1 ? /^[IAOiao]$/.test(L) : /[AEIOUYaeiouy]/.test(L);
  };
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const nonSpace = t.replace(/\s/g, '').length;
  const words = tokens.filter(isWord);
  const speech =
    letters >= 2 &&
    confidence >= 45 &&
    words.some((w) => w.replace(/[^A-Za-z]/g, '').length >= 2) &&
    letters / Math.max(1, nonSpace) >= 0.55 &&
    words.length / Math.max(1, tokens.length) >= 0.7;
  return { text: t, speech };
}

/** Manga yazıları çoğunlukla BÜYÜK HARF; çevirmen normal cümle düzeninde daha iyi çalışır. */
function sentenceCase(t) {
  const letters = t.match(/[A-Za-z]/g) || [];
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  if (letters.length < 3 || upper / letters.length < 0.8) return t;
  let s = t.toLowerCase();
  s = s.replace(/(^|[.!?…]\s+|["“(]\s*)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  s = s.replace(/\bi\b/g, 'I').replace(/\bi'(m|ll|ve|d)\b/g, "I'$1");
  return s;
}

// ---------------------------------------------------------------------
// Çeviri (Chrome'un yerleşik çevirmeni)
// ---------------------------------------------------------------------
let translatorPromise = null;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('zaman aşımı')), ms))]);

async function getTranslator() {
  if (!('Translator' in self)) return { state: 'unavailable' };
  if (!translatorPromise) {
    let av;
    try { av = await withTimeout(Translator.availability({ sourceLanguage: 'en', targetLanguage: 'tr' }), 5000); }
    catch (_) { return { state: 'unavailable' }; }
    if (av === 'unavailable') return { state: 'unavailable' };
    // Paket inmemişse burada indirilemez (tarayıcı bir kullanıcı tıklaması ister);
    // beklemeden haber ver, çeviri manga sayfasında tıklamayla başlatılsın.
    if (av !== 'available') return { state: 'needs-download' };
    translatorPromise = withTimeout(Translator.create({ sourceLanguage: 'en', targetLanguage: 'tr' }), 15000);
    translatorPromise.catch(() => { translatorPromise = null; });
  }
  try {
    return { state: 'ok', translator: await translatorPromise };
  } catch (_) {
    return { state: 'needs-download' };
  }
}

// ---------------------------------------------------------------------
// Mesajlar
// ---------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'ocrTranslate') {
    ocrTranslate(msg.items)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg.type === 'warmup') {
    getScheduler().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

/** items = [{id, img(dataURL)}] → {results:[{id,en,speech,tr}], translator:'ok'|'unavailable'|'needs-download'} */
async function ocrTranslate(items) {
  const scheduler = await getScheduler();
  const tr = getTranslator(); // OCR ile paralel hazırlansın

  const results = await Promise.all(items.map(async (it) => {
    const { data } = await scheduler.addJob('recognize', it.img);
    const { text, speech } = cleanOcr(data.text, data.confidence);
    return { id: it.id, en: text, speech, tr: '', conf: Math.round(data.confidence) };
  }));

  const t = await tr;
  if (t.state === 'ok') {
    await Promise.all(results.map(async (r) => {
      if (!r.speech) return;
      try { r.tr = (await t.translator.translate(sentenceCase(r.en))).trim(); }
      catch (e) { console.warn('Çeviri hatası', e); }
    }));
  }
  return { results, translator: t.state };
}
