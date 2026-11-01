// Uçtan uca test: eklentiyi gerçek Chromium'a yükler, farklı alan adından (CORS) ve
// Referer kontrolü yapan (hotlink korumalı) bir sunucudan gelen manga sayfalarını çevirir.
// Yazı okuma (OCR) gerçekten çalışır. Chrome'un Türkçe çeviri paketi bu test tarayıcısına
// inemediği için çeviri adımında sahte çevirmen kullanılır (okunan metni «…» içinde döndürür).
//
// Kullanım:  node test/uctan-uca-test.js [cikti-klasoru]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'eklenti');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'mtc-test'));
fs.mkdirSync(OUT, { recursive: true });

// --- Sahte sunucular ---
// Sayfa sunucusu (localhost:8701) ve görsel sunucusu (127.0.0.1:8702, farklı köken + Referer şartı)
const imageRequests = [];
const imgServer = http.createServer((req, res) => {
  const ref = req.headers.referer || '';
  imageRequests.push({ url: req.url, referer: ref });
  const file = path.join(__dirname, 'ornek', path.basename(req.url.split('?')[0]));
  if (!ref.startsWith('http://localhost:8701')) { res.writeHead(403); return res.end('hotlink yasak'); }
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg' }); // CORS başlığı YOK
  fs.createReadStream(file).pipe(res);
});
const pageServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (req.url.startsWith('/webtoon')) {
    return res.end(`<!doctype html><html><head><title>Webtoon</title>
      <style>body{background:#222;margin:0} img{display:block;margin:0 auto;max-width:700px;width:100%}</style></head>
      <body><img src="http://127.0.0.1:8702/webtoon.jpg" alt="w"></body></html>`);
  }
  res.end(`<!doctype html><html><head><title>Test Manga Okuyucu</title>
    <style>body{background:#222;margin:0;text-align:center} img{display:block;margin:10px auto;max-width:700px;width:100%}</style></head>
    <body><h3 style="color:#ddd;font-family:sans-serif">Bölüm 1</h3>
    <img src="http://127.0.0.1:8702/sayfa1.png" alt="s1">
    <img src="http://127.0.0.1:8702/sayfa2.jpg" alt="s2">
    <img src="http://127.0.0.1:8702/logo.png" width="40" alt="küçük">
    </body></html>`);
});

function assert(cond, msg) {
  if (!cond) throw new Error('Doğrulama hatası: ' + msg);
}

(async () => {
  if (!fs.existsSync(path.join(__dirname, 'ornek', 'webtoon.jpg'))) {
    require('child_process').execFileSync('python3', [path.join(__dirname, 'ornek-sayfa-uret.py')], { stdio: 'inherit' });
  }
  await new Promise((r) => imgServer.listen(8702, '127.0.0.1', r));
  await new Promise((r) => pageServer.listen(8701, 'localhost', r));
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-profile-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1000, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  // Eklenti hiçbir yapay zekâ servisine istek atmamalı
  const externalCalls = [];
  await ctx.route(/anthropic|openai|googleapis\.com\/language/, (r) => { externalCalls.push(r.request().url()); r.abort(); });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('Eklenti yüklendi:', extId);
  await sw.evaluate(() => chrome.storage.local.set({ settings: { minFontPx: 13 }, testMockTranslator: true }));

  const page = await ctx.newPage();
  page.on('console', (m) => { if (/MangaÇeviri/.test(m.text())) console.log('[sayfa]', m.text()); });
  await page.goto('http://localhost:8701/');
  await page.waitForFunction(() => [...document.images].slice(0, 2).every((i) => i.complete && i.naturalWidth > 0));

  const tabMsg = (msg) => sw.evaluate(async (msg) => {
    const [t] = await chrome.tabs.query({ url: 'http://localhost:8701/*' });
    await ensureInjected(t.id);
    return chrome.tabs.sendMessage(t.id, msg, { frameId: 0 });
  }, msg);
  const waitDone = async (limit = 150) => {
    let scan;
    for (let i = 0; i < limit; i++) {
      scan = await tabMsg({ type: 'scan' });
      if (scan.images.length && scan.images.every((im) => ['done', 'none', 'error'].includes(im.status))) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return scan;
  };
  const saveImg = async (idx, file) => {
    const b64 = await page.evaluate(async (idx) => {
      const b = await (await fetch(document.images[idx].src)).blob();
      const buf = new Uint8Array(await b.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, idx);
    fs.writeFileSync(path.join(OUT, file), Buffer.from(b64, 'base64'));
  };

  // Aşama 1: görselleri listele
  const scan1 = await tabMsg({ type: 'scan' });
  console.log('Aşama 1 — bulunan manga görselleri:', scan1.images.map((i) => `${i.src.split('/').pop()} ${i.w}x${i.h}`));
  assert(scan1.images.length === 2, 'iki manga görseli bulunmalı (küçük logo hariç)');

  // Çevir
  let t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  let scan = await waitDone();
  console.log(`Çeviri bitti (${Date.now() - t0} ms):`, scan.images.map((i) => `${i.status} ${i.count} balon ${i.error}`));
  assert(scan.images.every((i) => i.status === 'done'), 'iki sayfa da çevrilmeli');
  assert(scan.images[0].count === 6 && scan.images[1].count === 2, 'sayfa1: 6, sayfa2: 2 konuşma balonu');
  const refOk = imageRequests.filter((r) => r.url !== '/logo.png').every((r) => r.referer === 'http://localhost:8701/');
  console.log('Görsel istekleri (Referer):', imageRequests.map((r) => `${r.url} ← ${r.referer || '(yok)'}`).join(', '));
  assert(refOk, 'eklentinin görsel isteklerinde Referer okunan sayfa olmalı (hotlink koruması)');
  for (let i = 0; i < 2; i++) {
    assert((await page.evaluate((i) => document.images[i].src, i)).startsWith('blob:'), 'görsel kaynağı çeviriyle değişmeli');
    await saveImg(i, `cevrilmis-${i + 1}.png`);
  }
  await page.screenshot({ path: path.join(OUT, 'ekran-cevrilmis.png') });

  // Orijinale dön / tekrar çeviriye geç
  await tabMsg({ type: 'toggleAll' });
  assert((await page.evaluate(() => document.images[0].src)) === 'http://127.0.0.1:8702/sayfa1.png', 'orijinale dönmeli');
  await tabMsg({ type: 'toggleAll' });
  assert((await page.evaluate(() => document.images[0].src)).startsWith('blob:'), 'tekrar çeviriye geçmeli');
  console.log('Orijinal ↔ çeviri geçişi çalışıyor.');

  // Önbellek: sayfayı yenileyip tekrar çevir → anında gelmeli
  await page.reload();
  await page.waitForFunction(() => [...document.images].slice(0, 2).every((i) => i.complete && i.naturalWidth > 0));
  t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  scan = await waitDone();
  console.log(`Yenileme sonrası (${Date.now() - t0} ms):`, scan.images.map((i) => `${i.status} önbellek=${i.fromCache}`));
  assert(scan.images.every((i) => i.status === 'done' && i.fromCache), 'önbellekten gelmeli');

  // Webtoon: çok uzun tek görsel dilimlere bölünmeli; her konuşma balonu tam bir kez yazılmalı
  await page.goto('http://localhost:8701/webtoon');
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  scan = await waitDone(400);
  console.log(`Webtoon (800×11780, ${Date.now() - t0} ms): ${scan.images[0].status} ${scan.images[0].count} balon ${scan.images[0].error}`);
  // sayfa1'de 6, sayfa2'de 2 konuşma balonu; 5 tekrar → 40
  assert(scan.images[0].status === 'done' && scan.images[0].count === 40, 'webtoonda 40 konuşma balonu çevrilmeli');
  await saveImg(0, 'cevrilmis-webtoon.png');

  assert(externalCalls.length === 0, 'hiçbir dış yapay zekâ servisine istek gitmemeli');
  console.log('Dış servise giden istek: 0');

  // Popup ve ayarlar ekran görüntüsü
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForTimeout(300);
  await opt.screenshot({ path: path.join(OUT, 'ayarlar.png'), fullPage: true });
  await page.goto('http://localhost:8701/');
  await page.bringToFront();
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 340, height: 560 });
  await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: 'http://localhost:8701/*' });
    await chrome.tabs.update(t.id, { active: true });
  });
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.waitForTimeout(800);
  await pop.screenshot({ path: path.join(OUT, 'popup.png') });

  console.log('\nTÜM TESTLER GEÇTİ ✓  Çıktılar:', OUT);
  await ctx.close();
  imgServer.close(); pageServer.close();
})().catch((e) => { console.error('TEST BAŞARISIZ:', e); process.exit(1); });
