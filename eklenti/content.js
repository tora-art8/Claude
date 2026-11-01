// =====================================================================
// content.js — Manga sayfasında çalışan betik
//
// Akış (her görsel için):
//   1) Görseli arka plan servisinden indir (CORS sorunu olmasın diye)
//   2) Tuvale (canvas) çiz, küçültülmüş kopyada balonları bul (detector.js)
//   3) Yazı bölgelerini kırpıp gizli motor sayfasına gönder:
//      orada OCR ile okunur ve Chrome'un çevirmeniyle Türkçeye çevrilir
//   4) İngilizce yazıyı kapat, Türkçeyi balona sığdırıp yaz (layout.js)
//   5) <img> etiketinin kaynağını çevrilmiş görselle değiştir
//      (orijinal saklanır; tek tıkla geri dönülebilir)
// =====================================================================
(() => {
  // Aynı sayfaya iki kez yüklenmeyi önle (eklenti yeniden yüklendiyse eskisi "ölü" olur)
  if (globalThis.__mtc && globalThis.__mtc.alive()) return;
  globalThis.__mtc = { alive: () => { try { return !!chrome.runtime?.id; } catch (_) { return false; } } };

  const MTC = globalThis.MTC;
  const DEFAULTS = { minFontPx: 13, uppercase: false };
  // Aynı anda işlenen sayfa sayısı (iş bilgisayarın işlemcisinde yapılıyor)
  const maxParallel = 2;

  const entries = new Map(); // id -> kayıt
  let nextId = 1;
  let autoMode = false;
  const queue = [];
  let running = 0;
  let lastError = '';

  // -------------------------------------------------------------------
  // Yardımcılar
  // -------------------------------------------------------------------
  async function bg(type, payload = {}) {
    const r = await chrome.runtime.sendMessage({ type, ...payload });
    if (!r) throw new Error('Arka plan servisi yanıt vermedi');
    if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
    return r.data;
  }

  async function getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULTS, ...(settings || {}) };
  }

  function entryFor(img) {
    let id = Number(img.dataset.mtcId);
    if (!id || !entries.has(id)) {
      id = nextId++;
      img.dataset.mtcId = String(id);
      entries.set(id, { id, img, status: 'idle', showing: 'orig' });
    }
    return entries.get(id);
  }

  // Manga sayfası olabilecek görseller: yeterince büyük ve yüklenmiş olanlar
  function isCandidate(img) {
    if (!img.complete || !img.naturalWidth) return false;
    if (img.naturalWidth < 300 || img.naturalHeight < 300) return false;
    const r = img.getBoundingClientRect();
    if (r.width < 150 || r.height < 150) return false;
    const st = getComputedStyle(img);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }

  function scanImages() {
    const found = [];
    let pending = 0;
    for (const img of document.images) {
      const ent = img.dataset.mtcId && entries.get(Number(img.dataset.mtcId));
      if (ent && ent.status !== 'idle') { found.push(ent); continue; }
      if (isCandidate(img)) found.push(entryFor(img));
      else if (!img.complete && (img.width >= 150 || img.getAttribute('data-src') || img.loading === 'lazy')) pending++;
    }
    return { found, pending };
  }

  function findBySrc(srcUrl) {
    for (const img of document.images) {
      const ent = img.dataset.mtcId && entries.get(Number(img.dataset.mtcId));
      if (img.currentSrc === srcUrl || img.src === srcUrl || (ent && (ent.blobUrl === srcUrl || ent.origSrc === srcUrl))) return img;
    }
    return null;
  }

  // Görüntü için hızlı parmak izi (önbellek anahtarı). crypto.subtle her sayfada yok, o yüzden basit FNV/Murmur karışımı.
  function hashImage(id) {
    let h1 = 0x811c9dc5, h2 = 0x9747b28c;
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] | (d[i + 1] << 8) | (d[i + 2] << 16);
      h1 = Math.imul(h1 ^ v, 16777619);
      h2 = Math.imul(h2 ^ v, 0x5bd1e995);
      h2 ^= h2 >>> 13;
    }
    return `${id.width}x${id.height}-${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
  }

  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }


  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // -------------------------------------------------------------------
  // Yazı tipi (Türkçe karakterleri destekleyen çizgi roman fontu)
  // -------------------------------------------------------------------
  let fontReady = null;
  function ensureFont() {
    if (!fontReady) {
      fontReady = (async () => {
        const defs = [
          ['comic-relief-latin-700-normal.woff2', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD'],
          ['comic-relief-latin-ext-700-normal.woff2', 'U+0100-0130,U+0132-0151,U+0154-02AF,U+1E00-1EFF,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF'],
        ];
        for (const [file, range] of defs) {
          try {
            const buf = await (await fetch(chrome.runtime.getURL('fonts/' + file))).arrayBuffer();
            const face = new FontFace('MTC Comic', buf, { weight: '700', unicodeRange: range });
            await face.load();
            document.fonts.add(face);
          } catch (e) {
            console.warn('[MangaÇeviri] Yazı tipi yüklenemedi, sistem fontu kullanılacak', e);
          }
        }
      })();
    }
    return fontReady;
  }

  // -------------------------------------------------------------------
  // Görseli piksellerine erişilebilir şekilde yükleme (CORS çözümü)
  // -------------------------------------------------------------------
  async function loadBitmap(img, src) {
    // blob:/data: adresleri sayfanın kendisine aittir, doğrudan okunabilir
    if (/^(blob|data):/.test(src)) {
      const blob = await (await fetch(src)).blob();
      return createImageBitmap(blob);
    }
    try {
      const r = await bg('fetchImage', { url: src, pageUrl: location.href });
      return await createImageBitmap(b64ToBlob(r.b64, r.mime));
    } catch (err) {
      // Yedek yol: görsel aynı alan adındaysa veya CORS izni varsa doğrudan çiz
      try {
        const c = makeCanvas(1, 1);
        c.getContext('2d').drawImage(img, 0, 0, 1, 1);
        c.getContext('2d').getImageData(0, 0, 1, 1); // CORS engeli varsa burada hata verir
        return await createImageBitmap(img);
      } catch (_) {
        throw err;
      }
    }
  }

  /**
   * Görseli dikey dilimlere böler. Normal sayfalar tek dilimdir.
   * core0..core1: dilimin "sahip olduğu" bölge (balon merkezi burada olmalı).
   * y0..y1: işlenen pencere (üst/alt komşu dilimlerle örtüşür, böylece kesilen balon kalmaz).
   */
  function makeSegments(W, H) {
    if (H / W <= 3) return [{ y0: 0, y1: H, core0: 0, core1: H }];
    const step = Math.round(W * 1.6);
    const overlap = Math.round(W * 0.7);
    const segs = [];
    for (let c0 = 0; c0 < H; c0 += step) {
      const c1 = Math.min(H, c0 + step);
      segs.push({ core0: c0, core1: c1, y0: Math.max(0, c0 - overlap), y1: Math.min(H, c1 + overlap) });
    }
    return segs;
  }

  // -------------------------------------------------------------------
  // Ana işlem: tek bir görseli çevir
  // -------------------------------------------------------------------
  async function processEntry(ent) {
    const img = ent.img;
    ent.status = 'working';
    ent.error = '';
    ent.step = 'Görsel indiriliyor';
    updatePanel();

    const settings = await getSettings();
    await ensureFont();

    const src = ent.origSrc || img.currentSrc || img.src;
    const bitmap = await loadBitmap(img, src);
    const W = bitmap.width, H = bitmap.height;

    // Tam çözünürlüklü tuval (sonuç buraya çizilecek)
    const full = makeCanvas(W, H);
    const fctx = full.getContext('2d');
    fctx.drawImage(bitmap, 0, 0);

    // Webtoon gibi çok uzun görseller üst üste binen dilimlere bölünür; böylece
    // görüntü fazla küçültülmez ve her dilim ayrı bir çeviri isteğiyle gönderilir.
    const segments = makeSegments(W, H);
    const dispW = img.getBoundingClientRect().width || img.width || W;
    const screenScale = W / dispW; // 1 CSS piksel = kaç görüntü pikseli
    const minF = Math.max(7, settings.minFontPx * screenScale); // ekranda en az minFontPx görünsün
    const caseFix = (t) => (settings.uppercase ? t.toLocaleUpperCase('tr-TR') : t);
    const todo = [];
    let anyCache = true;

    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const part = segments.length > 1 ? ` (bölüm ${si + 1}/${segments.length})` : '';
      ent.step = 'Balonlar aranıyor' + part;
      updatePanel();

      // Hız için küçültülmüş kopyada balon ara
      const segH = seg.y1 - seg.y0;
      const ps = Math.min(1, 1100 / W, Math.sqrt(4e6 / (W * segH)));
      const pw = Math.max(1, Math.round(W * ps)), ph = Math.max(1, Math.round(segH * ps));
      const proc = makeCanvas(pw, ph);
      const pctx = proc.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(full, 0, seg.y0, W, segH, 0, 0, pw, ph);
      const data = pctx.getImageData(0, 0, pw, ph);
      const k = W / pw;
      const hash = hashImage(data);
      const bubbles = MTC.detectBubbles(data).filter((b) => {
        // Dilim kesim çizgisine değen balonlar komşu dilimde bütün olarak işlenir
        if (seg.y0 > 0 && b.y <= 1) return false;
        if (seg.y1 < H && b.y + b.h >= ph - 2) return false;
        const cy = seg.y0 + (b.y + b.h / 2) * k;
        return cy >= seg.core0 && cy < seg.core1;
      });
      if (!bubbles.length) continue;

      for (const b of bubbles) {
        b.k = k;
        b.offY = seg.y0;
        const orig = b.medianLetterH ? (b.medianLetterH * k) / 0.72 : minF * 1.6;
        b.minF = minF;
        b.maxF = Math.max(minF, Math.min(orig * 1.05, minF * 2.6));
      }

      // Yazının temizlenmiş kırpıntısı OCR'a gider (bilgisayarda okunur ve çevrilir)
      const ocr = {};
      for (const b of bubbles) ocr[b.id] = makeOcrCrop(full, b, k, seg.y0);

      ent.step = `${bubbles.length} balon okunuyor` + part;
      updatePanel();
      const boxes = bubbles.map((b) => [b.x, b.y, b.w, b.h]);
      const resp = await bg('translate', {
        hash,
        ocr,
        bubbles: bubbles.map((b, i) => ({ id: b.id, box: boxes[i] })),
      });
      const { results, fromCache } = resp;
      if (!fromCache) anyCache = false;
      if (resp.needTranslate) {
        // Eklentinin gizli sayfasında çevirmen yoksa/indirilmemişse çeviriyi bu sayfada yap
        ent.step = 'Çevriliyor' + part;
        updatePanel();
        await translateInPage(results, () => {
          ent.step = 'İlk kullanım: paneldeki "Türkçe çeviri paketini hazırla" düğmesine basın';
          updatePanel();
        });
        bg('saveCache', { hash, boxes, results }).catch(() => {});
      }

      // 1. tur: yazı boyutunu küçülterek sığdırmayı dene
      const byId = new Map(results.map((r) => [r.id, r]));
      const segTodo = [];
      for (const b of bubbles) {
        const r = byId.get(b.id);
        if (!r || !r.speech || !r.tr) continue;
        b.result = r;
        b.layout = MTC.fitText(fctx, caseFix(r.tr), b, k, b.minF, b.maxF);
        segTodo.push(b);
      }

      // 2. tur: hâlâ sığmıyorsa yazıyı minimumun biraz altına küçült, gerekirse kelime böl
      for (const b of segTodo) if (!b.layout.fits) b.layout = MTC.forceFit(fctx, caseFix(b.result.tr), b, k, b.minF);
      todo.push(...segTodo);
    }
    bitmap.close?.();
    ent.fromCache = anyCache;

    if (!todo.length) {
      ent.status = 'none';
      ent.step = '';
      return;
    }

    // Çizim: önce İngilizceyi kapat, sonra Türkçeyi yaz
    for (const b of todo) MTC.coverBubble(fctx, b, b.k);
    for (const b of todo) MTC.drawLines(fctx, b.layout, b);

    const mime = /png/i.test(src) ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => full.toBlob(res, mime, 0.93));
    if (ent.blobUrl) URL.revokeObjectURL(ent.blobUrl);
    ent.blobUrl = URL.createObjectURL(blob);
    ent.blob = blob;
    ent.count = todo.length;
    ent.texts = todo.map((b) => ({ en: b.result.en, tr: b.result.tr }));
    showTranslated(ent);
    ent.status = 'done';
    ent.step = '';
  }


  // -------------------------------------------------------------------
  // Ücretsiz motor yardımcıları
  // -------------------------------------------------------------------

  /**
   * OCR için yazı bölgesini hazırlar: balonun çizgisi/kuyruğu beyaza boyanır,
   * harfler OCR'ın sevdiği boyuta (≈34 px) büyütülür, gri tonlamaya çevrilir.
   */
  function makeOcrCrop(full, b, k, offY) {
    const pad = Math.max(3, (b.medianLetterH || 10) * 0.6);
    const tx0 = Math.max(b.x, b.text.x - pad), ty0 = Math.max(b.y, b.text.y - pad);
    const tx1 = Math.min(b.x + b.w, b.text.x + b.text.w + pad), ty1 = Math.min(b.y + b.h, b.text.y + b.text.h + pad);
    const X0 = tx0 * k, Y0 = offY + ty0 * k, CW = (tx1 - tx0) * k, CH = (ty1 - ty0) * k;
    const letterFull = Math.max(4, (b.medianLetterH || 12) * k);
    let s = Math.min(4, Math.max(0.5, 34 / letterFull));
    s = Math.min(s, 2400 / Math.max(CW, CH));
    const w = Math.max(8, Math.round(CW * s)), h = Math.max(8, Math.round(CH * s));
    const c = makeCanvas(w + 20, h + 20); // kenarda beyaz boşluk OCR'a yardımcı olur
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(full, X0, Y0, CW, CH, 10, 10, w, h);
    const id = ctx.getImageData(10, 10, w, h);
    const d = id.data;
    for (let y = 0; y < h; y++) {
      const ly = Math.floor((Y0 + (y + 0.5) / s - offY) / k) - b.oy;
      for (let x = 0; x < w; x++) {
        const lx = Math.floor((X0 + (x + 0.5) / s) / k) - b.ox;
        const p = (y * w + x) * 4;
        const inside = lx >= 0 && ly >= 0 && lx < b.bw && ly < b.bh && b.mask[ly * b.bw + lx];
        let g = inside ? (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8 : 255;
        if (g > 175) g = 255; // açık gri kenar izlerini temizle (OCR paraziti azalır)
        d[p] = d[p + 1] = d[p + 2] = g;
      }
    }
    ctx.putImageData(id, 10, 10);
    return c.toDataURL('image/png');
  }

  /** Manga yazıları çoğunlukla BÜYÜK HARF; çevirmen normal cümle düzeninde daha iyi çalışır. */
  function sentenceCase(t) {
    const letters = t.match(/[A-Za-z]/g) || [];
    const upper = letters.filter((c) => c === c.toUpperCase()).length;
    if (letters.length < 3 || upper / letters.length < 0.8) return t;
    let r = t.toLowerCase();
    r = r.replace(/(^|[.!?…]\s+|["“(]\s*)([a-z])/g, (m, a, c) => a + c.toUpperCase());
    return r.replace(/\bi\b/g, 'I').replace(/\bi'(m|ll|ve|d)\b/g, "I'$1");
  }

  let pageTranslatorPromise = null;
  /**
   * Chrome'un yerleşik çevirmeniyle manga sayfasının içinde çeviri.
   * Türkçe paket bu site için ilk kez kullanılıyorsa tarayıcı bir tıklama ister:
   * panelde "Türkçe çeviri paketini hazırla" düğmesi çıkar.
   */
  async function translateInPage(results, onNeedClick) {
    if (!('Translator' in self)) {
      const e = new Error('Ücretsiz çeviri motoru bu tarayıcıda yok. Güncel Google Chrome kullanın ' +
        '(Edge/Opera/Brave\'de bulunmayabilir) (Chrome menüsü → Yardım → Google Chrome hakkında ile güncelleyin).');
      e.code = 'NO_TRANSLATOR';
      throw e;
    }
    if (!pageTranslatorPromise) {
      pageTranslatorPromise = (async () => {
        const opts = { sourceLanguage: 'en', targetLanguage: 'tr' };
        const av = await Translator.availability(opts);
        if (av === 'unavailable') {
          const e = new Error('Chrome bu bilgisayarda İngilizce→Türkçe çeviri paketini desteklemiyor.');
          e.code = 'NO_TRANSLATOR';
          throw e;
        }
        if (av === 'available') return Translator.create(opts);
        return waitForDownloadClick(opts); // indirme bir kullanıcı tıklaması gerektirir
      })();
      pageTranslatorPromise.catch(() => { pageTranslatorPromise = null; });
    }
    if (onNeedClick && !(await Promise.race([pageTranslatorPromise.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 300))]))) {
      onNeedClick();
    }
    const translator = await pageTranslatorPromise;
    for (const r of results) {
      if (r.speech && r.en && !r.tr) r.tr = (await translator.translate(sentenceCase(r.en))).trim();
    }
  }

  function waitForDownloadClick(opts) {
    showPanel();
    return new Promise((resolve, reject) => {
      const btn = panel.root.getElementById('dl');
      btn.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Türkçe çeviri paketini hazırla (bir kez)';
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'İndiriliyor…';
        try {
          const t = await Translator.create({
            ...opts,
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                btn.textContent = `İndiriliyor… %${Math.round((e.loaded || 0) * 100)}`;
              });
            },
          });
          btn.style.display = 'none';
          resolve(t);
        } catch (e) {
          btn.style.display = 'none';
          reject(new Error('Türkçe çeviri paketi indirilemedi: ' + (e.message || e)));
        }
      };
    });
  }

  // -------------------------------------------------------------------
  // Orijinal ↔ çeviri geçişi
  // -------------------------------------------------------------------
  function saveOriginal(ent) {
    if (ent.saved) return;
    const img = ent.img;
    ent.origSrc = img.currentSrc || img.src;
    ent.origSrcAttr = img.getAttribute('src');
    ent.origSrcset = img.getAttribute('srcset');
    ent.sources = img.parentElement?.tagName === 'PICTURE'
      ? [...img.parentElement.querySelectorAll('source')].map((s) => [s, s.getAttribute('srcset')])
      : [];
    ent.saved = true;
  }

  function showTranslated(ent) {
    if (!ent.blobUrl) return;
    saveOriginal(ent);
    const img = ent.img;
    img.removeAttribute('srcset');
    for (const [s] of ent.sources) s.removeAttribute('srcset');
    ent.showing = 'tr';
    ent.triedDataUrl = false;
    img.src = ent.blobUrl;
    img.title = img.title || 'Alt + tık: orijinal / çeviri';
  }

  function showOriginal(ent) {
    if (!ent.saved) return;
    const img = ent.img;
    ent.showing = 'orig';
    if (ent.origSrcset != null) img.setAttribute('srcset', ent.origSrcset);
    for (const [s, v] of ent.sources) if (v != null) s.setAttribute('srcset', v);
    img.src = ent.origSrcAttr || ent.origSrc;
  }

  function toggleEntry(ent) {
    if (ent.status !== 'done') return;
    ent.showing === 'tr' ? showOriginal(ent) : showTranslated(ent);
    updatePanel();
  }

  function toggleAll(force) {
    const done = [...entries.values()].filter((e) => e.status === 'done');
    const anyTr = done.some((e) => e.showing === 'tr');
    const target = force || (anyTr ? 'orig' : 'tr');
    for (const e of done) (target === 'tr' ? showTranslated : showOriginal)(e);
    updatePanel();
    return target;
  }

  // Bazı siteler blob: adreslerini güvenlik politikasıyla engeller → data: adresi dene
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.mtcId) return;
    const ent = entries.get(Number(img.dataset.mtcId));
    if (!ent || ent.showing !== 'tr' || img.src !== ent.blobUrl && !img.src.startsWith('data:')) return;
    if (!ent.triedDataUrl && ent.blob) {
      ent.triedDataUrl = true;
      const fr = new FileReader();
      fr.onload = () => { img.src = fr.result; };
      fr.readAsDataURL(ent.blob);
    } else {
      showOriginal(ent);
      ent.status = 'error';
      ent.error = 'Site güvenlik politikası çevrilmiş görseli göstermeyi engelledi.';
      updatePanel();
    }
  }, true);

  // Alt + tık ile tek görseli aç/kapat
  document.addEventListener('click', (ev) => {
    if (!ev.altKey) return;
    const img = ev.target instanceof HTMLImageElement ? ev.target : null;
    if (!img || !img.dataset.mtcId) return;
    const ent = entries.get(Number(img.dataset.mtcId));
    if (ent && ent.status === 'done') {
      ev.preventDefault();
      ev.stopPropagation();
      toggleEntry(ent);
    }
  }, true);

  // Site görselin kaynağını değiştirirse (okuyucuda sonraki sayfaya geçiş gibi) kaydı sıfırla
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const img = m.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.mtcId) continue;
      const ent = entries.get(Number(img.dataset.mtcId));
      if (!ent || !ent.saved) continue;
      const cur = img.getAttribute('src') || '';
      const ours = cur === ent.blobUrl || cur.startsWith('data:image') && ent.triedDataUrl ||
        cur === ent.origSrcAttr || cur === ent.origSrc;
      if (ours || m.attributeName !== 'src') continue;
      if (ent.blobUrl) URL.revokeObjectURL(ent.blobUrl);
      entries.set(ent.id, { id: ent.id, img, status: 'idle', showing: 'orig' });
      updatePanel();
    }
  });
  mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'] });

  // Otomatik mod: yeni yüklenen görselleri de çevir
  document.addEventListener('load', (ev) => {
    if (!autoMode) return;
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    const ent = img.dataset.mtcId && entries.get(Number(img.dataset.mtcId));
    if (ent && ent.status !== 'idle') return;
    if (isCandidate(img)) enqueue(entryFor(img));
  }, true);

  // -------------------------------------------------------------------
  // Kuyruk (aynı anda en fazla 2 görsel işlenir)
  // -------------------------------------------------------------------
  function enqueue(ent) {
    if (['queued', 'working', 'done'].includes(ent.status)) return false;
    ent.status = 'queued';
    queue.push(ent);
    showPanel();
    pump();
    return true;
  }

  function pump() {
    while (running < maxParallel && queue.length) {
      const ent = queue.shift();
      running++;
      processEntry(ent)
        .catch((err) => {
          console.warn('[MangaÇeviri]', err);
          ent.status = 'error';
          ent.error = err.message || String(err);
          lastError = ent.error;
          // Anahtar/bakiye hatasında kuyruğun kalanını boşuna deneme
          if (['NO_TRANSLATOR'].includes(err.code)) {
            for (const q of queue.splice(0)) { q.status = 'error'; q.error = ent.error; }
          }
        })
        .finally(() => {
          running--;
          updatePanel();
          pump();
        });
    }
    updatePanel();
  }

  function translatePage() {
    lastError = '';
    const { found, pending } = scanImages();
    let n = 0;
    for (const ent of found) {
      if (ent.status === 'error' || ent.status === 'none') ent.status = 'idle';
      if (enqueue(ent)) n++;
    }
    showPanel();
    if (!found.length) setPanelNote(pending ? 'Görseller henüz yüklenmedi. Biraz aşağı kaydırıp tekrar deneyin.' : 'Bu sayfada manga görseli bulunamadı.');
    return { queued: n, total: found.length, pending };
  }

  // -------------------------------------------------------------------
  // Sayfa içi küçük durum paneli (Shadow DOM: sitenin CSS'i karışmasın)
  // -------------------------------------------------------------------
  let panel = null;
  let note = '';
  function showPanel() {
    if (panel) { panel.host.style.display = ''; updatePanel(); return; }
    document.getElementById('mtc-panel-host')?.remove();
    const host = document.createElement('div');
    host.id = 'mtc-panel-host';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;background:#1d1b22;color:#f3f0f7;border-radius:12px;
             box-shadow:0 6px 24px rgba(0,0,0,.35);padding:10px 12px;min-width:220px;max-width:300px}
        .row{display:flex;align-items:center;gap:8px}
        .title{font-weight:700;flex:1}
        .bar{height:5px;background:#3a3644;border-radius:3px;margin:8px 0 6px;overflow:hidden}
        .bar i{display:block;height:100%;width:0;background:#e94e77;transition:width .3s}
        .st{color:#c9c3d4;font-size:12px;min-height:16px}
        .err{color:#ff8a9a;font-size:12px;margin-top:4px;word-break:break-word}
        button{font:inherit;border:0;border-radius:8px;padding:5px 10px;cursor:pointer;background:#3a3644;color:#fff}
        button.p{background:#e94e77}
        button:hover{filter:brightness(1.15)}
        .x{background:transparent;padding:2px 6px;color:#aaa}
        .dl{width:100%;margin-top:8px}
      </style>
      <div class="box">
        <div class="row"><span class="title">Manga Çeviri TR</span>
          <button class="p" id="tg" title="Tüm sayfalarda orijinal ↔ çeviri">Orijinal</button>
          <button class="x" id="cl" title="Paneli gizle">✕</button></div>
        <div class="bar"><i id="br"></i></div>
        <div class="st" id="st"></div>
        <button class="p dl" id="dl" style="display:none"></button>
        <div class="err" id="er"></div>
      </div>`;
    root.getElementById('tg').onclick = () => toggleAll();
    root.getElementById('cl').onclick = () => { host.style.display = 'none'; };
    (document.body || document.documentElement).appendChild(host);
    panel = { host, root };
    updatePanel();
  }

  function setPanelNote(t) { note = t; updatePanel(); }

  function updatePanel() {
    if (!panel) return;
    const list = [...entries.values()].filter((e) => e.status !== 'idle');
    const done = list.filter((e) => ['done', 'none', 'error'].includes(e.status)).length;
    const working = list.find((e) => e.status === 'working');
    const translated = list.filter((e) => e.status === 'done');
    const errs = list.filter((e) => e.status === 'error');
    const $ = (id) => panel.root.getElementById(id);
    $('br').style.width = list.length ? `${Math.round((done / list.length) * 100)}%` : '0';
    let st;
    if (working) st = `${done + 1}/${list.length}: ${working.step || 'işleniyor'}…`;
    else if (list.length) st = `${translated.length} sayfa çevrildi` + (list.length - translated.length - errs.length > 0 ? `, ${list.length - translated.length - errs.length} sayfada balon yok` : '') + (autoMode ? ' · otomatik mod açık' : '');
    else st = note || 'Hazır';
    $('st').textContent = st;
    const err = errs[0]?.error || lastError;
    $('er').textContent = err ? '⚠ ' + err : '';
    const anyTr = translated.some((e) => e.showing === 'tr');
    $('tg').textContent = anyTr ? 'Orijinal' : 'Çeviri';
    $('tg').style.display = translated.length ? '' : 'none';
  }

  // -------------------------------------------------------------------
  // Açılır pencere (popup) ve arka plandan gelen komutlar
  // -------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'ping':
        sendResponse({ pong: true });
        break;
      case 'scan': {
        const { found, pending } = scanImages();
        sendResponse({
          autoMode,
          pending,
          images: found.map((e) => ({
            id: e.id,
            src: (e.origSrc || e.img.currentSrc || e.img.src).slice(0, 300),
            w: e.img.naturalWidth, h: e.img.naturalHeight,
            status: e.status, step: e.step || '', error: e.error || '',
            count: e.count || 0, showing: e.showing, fromCache: !!e.fromCache,
          })),
        });
        break;
      }
      case 'translatePage':
        sendResponse(translatePage());
        break;
      case 'translateImage': {
        const img = msg.id ? entries.get(msg.id)?.img : findBySrc(msg.srcUrl);
        if (!img || !img.complete || !img.naturalWidth) { sendResponse({ ok: false }); break; }
        const ent = entryFor(img);
        if (ent.status === 'error' || ent.status === 'none') ent.status = 'idle';
        if (ent.status === 'done') toggleEntry(ent); else enqueue(ent);
        sendResponse({ ok: true });
        break;
      }
      case 'toggleImage': {
        const img = msg.id ? entries.get(msg.id)?.img : findBySrc(msg.srcUrl);
        const ent = img && entries.get(Number(img.dataset.mtcId));
        if (ent) toggleEntry(ent);
        sendResponse({ ok: !!ent });
        break;
      }
      case 'toggleAll':
        sendResponse({ showing: toggleAll(msg.force) });
        break;
      case 'setAuto':
        autoMode = !!msg.on;
        if (autoMode) translatePage(); else updatePanel();
        sendResponse({ autoMode });
        break;
      default:
        return false;
    }
    return false;
  });
})();
