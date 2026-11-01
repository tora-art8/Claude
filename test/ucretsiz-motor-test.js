// Ücretsiz motor testi: OCR (Tesseract) gerçekten çalışır, çeviri için Chrome'un yerleşik
// çevirmeni bu test tarayıcısında olmadığından sahte çevirmen kullanılır («okunan metin» döndürür).
// Ayrıca çevirmen hiç yokken anlaşılır hata verildiği de denetlenir.
//
// Kullanım: node test/ucretsiz-motor-test.js [cikti-klasoru]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const EXT = path.join(__dirname, '..', 'eklenti');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'mtc-ucretsiz'));
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const name = path.basename(req.url.split('?')[0]);
  const file = path.join(__dirname, 'ornek', name);
  if (/\.(png|jpg)$/.test(name) && fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': name.endsWith('.png') ? 'image/png' : 'image/jpeg' });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const imgs = (new URL(req.url, 'http://x').searchParams.get('s') || 'sayfa1.png,sayfa2.jpg,sayfa3.jpg').split(',');
  res.end(`<!doctype html><html><body style="margin:0;background:#222">${imgs.map((s) => `<img src="/${s}" style="display:block;width:700px;margin:8px auto">`).join('')}</body></html>`);
});

function assert(c, m) { if (!c) throw new Error('Doğrulama hatası: ' + m); }

(async () => {
  await new Promise((r) => server.listen(8711, '127.0.0.1', r));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-p-')), {
    headless: true, channel: 'chromium', viewport: { width: 1000, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let apiCalls = 0;
  await ctx.route('https://api.anthropic.com/**', (r) => { apiCalls++; r.abort(); });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ settings: { engine: 'ucretsiz', minFontPx: 13 }, testMockTranslator: true }));

  const page = await ctx.newPage();
  page.on('console', (m) => { if (/MangaÇeviri/.test(m.text())) console.log('[sayfa]', m.text()); });
  const tabMsg = (msg) => sw.evaluate(async (msg) => {
    const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1:8711/*' });
    await ensureInjected(t.id);
    return chrome.tabs.sendMessage(t.id, msg, { frameId: 0 });
  }, msg);
  const waitDone = async () => {
    let scan;
    for (let i = 0; i < 300; i++) {
      scan = await tabMsg({ type: 'scan' });
      if (scan.images.length && scan.images.every((im) => ['done', 'none', 'error'].includes(im.status))) return scan;
      await new Promise((r) => setTimeout(r, 200));
    }
    return scan;
  };

  // 1) Mutlu yol: OCR + (sahte) çeviri
  await page.goto('http://127.0.0.1:8711/');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  let t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  let scan = await waitDone();
  const ilk = Date.now() - t0;
  console.log(`İlk çalıştırma (OCR motoru yükleme dahil): ${ilk} ms →`, scan.images.map((i) => `${i.status} ${i.count} balon ${i.error}`));
  assert(scan.images.every((i) => i.status === 'done'), 'üç sayfa da çevrilmeli');
  assert(apiCalls === 0, 'ücretsiz motor API çağırmamalı');

  const cache = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all).filter(([k]) => k.includes(':ucretsiz:')).map(([, v]) => v.results);
  });
  for (const results of cache) {
    console.log('---');
    for (const r of results) console.log(`  #${r.id} ${r.speech ? 'KONUŞMA' : 'atla   '} (güven ${r.conf}) | ${r.en}${r.speech ? '  →  ' + r.tr : ''}`);
  }
  const allEn = cache.flat().filter((r) => r.speech).map((r) => r.en.toUpperCase()).join(' | ');
  for (const must of ['WAIT FOR ME', 'COULDN', 'NEXT MORNING', 'WHAT', 'TRUTH TODAY', 'IDIOT', 'SENPA', 'GET OUT', 'PANEL BORDER', 'NEO HARBOR']) {
    assert(allEn.includes(must), `OCR "${must}" ifadesini okumalı`);
  }
  for (const must of ['IF I DON', 'I JUST', 'WORRIED I WAS']) assert(allEn.includes(must), `tek "I" harfi korunmalı: ${must}`);
  const speechCount = cache.flat().filter((r) => r.speech).length;
  console.log('Konuşma sayılan balon:', speechCount, '(beklenen 13: 6 + 2 + 5)');
  assert(speechCount === 13, 'yüzler konuşma sayılmamalı, gerçek balonların hepsi okunmalı');

  // Hız: aynı motor sıcakken yeni bir sayfa
  await sw.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('c:'))); });
  await page.goto('http://127.0.0.1:8711/?s=sayfa1.png');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  scan = await waitDone();
  console.log(`Motor hazırken tek sayfa: ${Date.now() - t0} ms`);

  // Görselleri kaydet
  await page.goto('http://127.0.0.1:8711/');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  scan = await waitDone();
  console.log(`Önbellekten 3 sayfa: ${Date.now() - t0} ms`);
  const imgs = await page.evaluate(async () => Promise.all([...document.images].map(async (img) => {
    const b = await (await fetch(img.src)).blob();
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  })));
  imgs.forEach((b, i) => fs.writeFileSync(path.join(OUT, `ucretsiz-${i + 1}.png`), Buffer.from(b, 'base64')));

  // 2) Türkçe paket henüz inmemişken: panelde indirme düğmesi çıkmalı, tıklayınca indirme başlamalı.
  // (Bu test tarayıcısında Chrome çevirmeni var ama paketi indiremiyor — gerçek ilk kullanımın aynısı.)
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ testMockTranslator: false });
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('c:')));
    await chrome.offscreen.closeDocument().catch(() => {});
  });
  await page.goto('http://127.0.0.1:8711/?s=sayfa2.jpg,sayfa1.png');
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  await tabMsg({ type: 'translatePage' });
  const btn = page.locator('#mtc-panel-host #dl');
  for (let i = 0; i < 60 && !(await btn.isVisible()); i++) {
    if (i % 10 === 0) console.log('  bekleniyor:', JSON.stringify((await tabMsg({ type: 'scan' })).images.map((x) => [x.status, x.step, x.error])));
    await page.waitForTimeout(500);
  }
  scan = await tabMsg({ type: 'scan' });
  console.log('Paket yokken:', scan.images.map((i) => `${i.status}: ${i.step}`), '| düğme:', await btn.textContent());
  assert(/Türkçe çeviri paketini hazırla/.test(await btn.textContent()), 'indirme düğmesi görünmeli');
  await page.screenshot({ path: path.join(OUT, 'paket-dugmesi.png') });
  await btn.click();
  await page.waitForTimeout(500);
  console.log('Tıklama sonrası düğme:', await btn.textContent().catch(() => '(gizlendi)'));
  assert(/İndiriliyor/.test(await btn.textContent()), 'tıklayınca indirme başlamalı');

  console.log('\nÜCRETSİZ MOTOR TESTLERİ GEÇTİ ✓  Çıktılar:', OUT);
  await ctx.close();
  server.close();
})().catch((e) => { console.error('TEST BAŞARISIZ:', e); process.exit(1); });
