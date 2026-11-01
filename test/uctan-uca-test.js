// Uçtan uca test: eklentiyi gerçek Chromium'a yükler, farklı alan adından (CORS) ve
// Referer kontrolü yapan (hotlink korumalı) bir sunucudan gelen manga sayfasını çevirir.
// Claude API gerçek anahtar gerektirmesin diye sahte (mock) yanıtla taklit edilir.
//
// Kullanım:  node test/uctan-uca-test.js [cikti-klasoru]
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
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
let imageRequests = [];
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
  if (req.url.startsWith('/hata')) {
    return res.end(`<!doctype html><html><body><img src="http://127.0.0.1:8702/sayfa3.jpg" style="width:700px"></body></html>`);
  }
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

// --- Sahte Claude API ---
const TR = {
  11: { // sayfa1: 11 aday
    1: ['HEY! WAIT FOR ME! YOU PROMISED WE WOULD GO TOGETHER!', 'Hey! Beni bekle! Birlikte gideceğimize söz vermiştin!'],
    2: ["I'M SORRY... I JUST COULDN'T STAY ANY LONGER.", 'Özür dilerim... Daha fazla kalamazdım.'],
    5: ['THE NEXT MORNING, AT THE OLD STATION...', 'Ertesi sabah, eski istasyonda...'],
    8: ['WHAT?!', 'Neee?!'],
    9: ["IF I DON'T TELL HER THE TRUTH TODAY, I MIGHT NEVER GET ANOTHER CHANCE TO DO IT.",
      'Eğer bugün ona bütün gerçeği açık açık ve en ince ayrıntısına kadar anlatmazsam, bunu yapmak için bir daha asla, ama asla başka bir fırsatım olmayabilir, bunu çok iyi biliyorum.'],
    // Küçük balona bilerek çok uzun çeviri → kısaltma turunu test eder
    11: ["OKAY. LET'S DO THIS.", 'Tamam, artık daha fazla beklemeyelim; hadi gidip şu işi hep beraber sonuna kadar yapalım!'],
  },
  3: {
    1: ['YOU IDIOT!! DO YOU HAVE ANY IDEA HOW WORRIED I WAS?!', 'Seni aptal!! Ne kadar endişelendiğimden haberin var mı?!'],
    2: ['S-SORRY, SENPAI...', 'Ö-özür dilerim, senpai...'],
  },
};
let apiCalls = [];
let mockMode = 'tablo';
let fast429Once = true; // ilk hızlı mod isteğine "hız sınırı" döndür → normal hıza geçiş test edilir // 'tablo': yukarıdaki sabit çeviriler, 'webtoon': kırpıntı şekline göre

// JPEG başlığından genişlik/yükseklik oku (sahte API'nin yüz ↔ balon ayrımı için)
function jpegSize(b64) {
  const b = Buffer.from(b64, 'base64');
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { w: 1, h: 1 };
}

async function mockApi(route) {
  const req = route.request();
  const body = JSON.parse(req.postData() || '{}');
  if (body.speed === 'fast' && fast429Once) {
    fast429Once = false;
    apiCalls.push({ url: req.url(), body, headers: req.headers(), status: 429 });
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'fast mode rate limit' } }) });
  }
  apiCalls.push({ url: req.url(), body, headers: req.headers(), status: 200 });
  const content = body.messages[0].content;
  let out;
  if (body.output_config.format.schema.properties.kisaltmalar) {
    // kısaltma isteği
    const text = content[0].text;
    const items = [...text.matchAll(/#(\d+) \(en fazla (\d+) karakter/g)].map((m) => ({ no: +m[1], max: +m[2] }));
    const KISA = { 9: 'Bugün ona gerçeği söylemezsem, bir daha fırsatım olmayabilir.', 11: 'Tamam. Hadi yapalım!' };
    out = { kisaltmalar: items.map((it) => ({ no: it.no, turkce: KISA[it.no] || 'Tamam.' })) };
  } else {
    const ids = content.filter((c) => c.type === 'text' && /^Balon #/.test(c.text)).map((c) => +c.text.match(/#(\d+)/)[1]);
    if (mockMode === 'webtoon') {
      // Kırpıntının hemen ardından gelen görsel o balona aittir; kare olanlar yüzdür
      const shapes = {};
      content.forEach((c, i) => { if (c.type === 'text' && /^Balon #/.test(c.text)) shapes[+c.text.match(/#(\d+)/)[1]] = jpegSize(content[i + 1].source.data); });
      out = { balonlar: ids.map((id) => {
        const { w, h } = shapes[id];
        const speech = w / h > 1.15;
        return { no: id, ingilizce: speech ? 'TEXT' : '', konusma: speech, turkce: speech ? `Webtoon testi, balon ${id}.` : '' };
      }) };
    } else {
    const table = TR[ids.length] || {};
    out = { balonlar: ids.map((id) => table[id] ? { no: id, ingilizce: table[id][0], konusma: true, turkce: table[id][1] } : { no: id, ingilizce: '', konusma: false, turkce: '' }) };
    }
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(out) }],
      usage: { input_tokens: 1000, output_tokens: 200 },
    }),
  });
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
  await ctx.route('https://api.anthropic.com/**', mockApi);
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  console.log('Eklenti yüklendi:', extId);

  // Ayarları kaydet (sahte anahtar)
  await sw.evaluate(() => chrome.storage.local.set({ settings: { engine: 'claude', apiKey: 'sk-ant-test', model: 'claude-opus-5-5', minFontPx: 15, uppercase: false, effort: 'medium' } }));

  const page = await ctx.newPage();
  page.on('console', (m) => { if (/MangaÇeviri|error/i.test(m.text())) console.log('[sayfa]', m.text()); });
  await page.goto('http://localhost:8701/');
  await page.waitForFunction(() => [...document.images].slice(0, 2).every((i) => i.complete && i.naturalWidth > 0));
  // Not: sayfanın kendisi görselleri Referer ile yükler; eklentinin isteği Referer'i DNR ile alır.

  const tabMsg = (msg) => sw.evaluate(async (msg) => {
    const [t] = await chrome.tabs.query({ url: 'http://localhost:8701/*' });
    await ensureInjected(t.id);
    return chrome.tabs.sendMessage(t.id, msg, { frameId: 0 });
  }, msg);

  // Aşama 1: görselleri listele
  const scan1 = await tabMsg({ type: 'scan' });
  console.log('Aşama 1 — bulunan manga görselleri:', scan1.images.map((i) => `${i.src.split('/').pop()} ${i.w}x${i.h}`));
  assert(scan1.images.length === 2, 'iki manga görseli bulunmalı (küçük logo hariç)');

  // Çevir
  const t0 = Date.now();
  await tabMsg({ type: 'translatePage' });
  let scan;
  for (let i = 0; i < 100; i++) {
    scan = await tabMsg({ type: 'scan' });
    if (scan.images.every((im) => ['done', 'none', 'error'].includes(im.status))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`Çeviri bitti (${Date.now() - t0} ms):`, scan.images.map((i) => `${i.status} ${i.count} balon ${i.error}`));
  assert(scan.images.every((i) => i.status === 'done'), 'iki sayfa da çevrilmeli');
  const fastCalls = apiCalls.filter((c) => c.body.speed === 'fast');
  console.log('Hızlı mod:', apiCalls.map((c) => `${c.status} ${c.body.speed || 'normal'}`).join(', '));
  assert(fastCalls.length >= 2 && fastCalls.every((c) => /fast-mode-2026-02-01/.test(c.headers['anthropic-beta'])), 'hızlı mod isteklerde açık olmalı');
  assert(apiCalls[0].status === 429 && !apiCalls[1].body.speed, 'hızlı mod sınırı dolunca aynı istek normal hızda tekrarlanmalı');
  apiCalls = apiCalls.filter((c) => c.status === 200);
  const translateCalls = apiCalls.filter((c) => c.body.output_config.format.schema.properties.balonlar);
  const shortenCalls = apiCalls.filter((c) => c.body.output_config.format.schema.properties.kisaltmalar);
  console.log(`API çağrıları: ${translateCalls.length} çeviri, ${shortenCalls.length} kısaltma`);
  assert(translateCalls.length === 2, 'her sayfa için bir çeviri çağrısı');
  assert(shortenCalls.length >= 1, 'sığmayan çeviri için kısaltma çağrısı yapılmalı');
  const h = translateCalls[0].headers;
  assert(h['x-api-key'] === 'sk-ant-test' && h['anthropic-version'] && h['anthropic-dangerous-direct-browser-access'] === 'true', 'API başlıkları');
  assert(translateCalls[0].body.fallbacks === 'default', 'fallbacks parametresi');
  console.log('Örnek istem (balon 9):', translateCalls.flatMap((c) => c.body.messages[0].content).find((c) => c.type === 'text' && c.text.startsWith('Balon #9')).text);
  const extFetch = imageRequests.filter((r) => r.referer === 'http://localhost:8701/');
  console.log('Görsel sunucusuna gelen istekler (Referer):', imageRequests.map((r) => `${r.url} ← ${r.referer || '(yok)'}`));

  // Çevrilmiş görselleri kaydet
  const imgs = await page.evaluate(async () => Promise.all([...document.images].slice(0, 2).map(async (img) => {
    const b = await (await fetch(img.src)).blob();
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { src: img.src.slice(0, 30), b64: btoa(s), type: b.type };
  })));
  imgs.forEach((im, i) => {
    assert(im.src.startsWith('blob:'), 'görsel kaynağı çeviriyle değişmeli');
    fs.writeFileSync(path.join(OUT, `cevrilmis-${i + 1}.${im.type.includes('png') ? 'png' : 'jpg'}`), Buffer.from(im.b64, 'base64'));
  });
  await page.screenshot({ path: path.join(OUT, 'ekran-cevrilmis.png') });

  // Orijinale dön / tekrar çeviriye geç
  await tabMsg({ type: 'toggleAll' });
  const origSrc = await page.evaluate(() => document.images[0].src);
  assert(origSrc === 'http://127.0.0.1:8702/sayfa1.png', 'orijinale dönmeli');
  await page.screenshot({ path: path.join(OUT, 'ekran-orijinal.png') });
  await tabMsg({ type: 'toggleAll' });
  assert((await page.evaluate(() => document.images[0].src)).startsWith('blob:'), 'tekrar çeviriye geçmeli');
  console.log('Orijinal ↔ çeviri geçişi çalışıyor.');

  // Önbellek: sayfayı yenileyip tekrar çevir → API'ye yeni istek gitmemeli
  const before = apiCalls.length;
  await page.reload();
  await page.waitForFunction(() => [...document.images].slice(0, 2).every((i) => i.complete && i.naturalWidth > 0));
  await tabMsg({ type: 'translatePage' });
  for (let i = 0; i < 100; i++) {
    scan = await tabMsg({ type: 'scan' });
    if (scan.images.every((im) => ['done', 'none', 'error'].includes(im.status))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('Yenileme sonrası:', scan.images.map((i) => `${i.status} önbellek=${i.fromCache}`), 'yeni API çağrısı:', apiCalls.length - before);
  assert(apiCalls.length === before, 'önbellekten gelmeli, API çağrılmamalı');

  // Webtoon: çok uzun tek görsel dilimlere bölünmeli; her balon tam bir kez işlenmeli
  mockMode = 'webtoon';
  const callsBefore = apiCalls.length;
  await page.goto('http://localhost:8701/webtoon');
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  await tabMsg({ type: 'translatePage' });
  for (let i = 0; i < 300; i++) {
    scan = await tabMsg({ type: 'scan' });
    if (scan.images.length && scan.images.every((im) => ['done', 'none', 'error'].includes(im.status))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const wCalls = apiCalls.slice(callsBefore).filter((c) => c.body.output_config.format.schema.properties.balonlar);
  const sent = wCalls.map((c) => c.body.messages[0].content.filter((x) => x.type === 'text' && /^Balon #/.test(x.text)).length);
  const total = sent.reduce((a, b) => a + b, 0);
  console.log(`Webtoon: ${wCalls.length} dilim isteği, dilim başına aday: [${sent}], toplam ${total}; sonuç: ${scan.images[0].status} ${scan.images[0].count} balon ${scan.images[0].error}`);
  // sayfa1'de 11, sayfa2'de 3 aday var; 5 tekrar → 70 aday, bunların 8×5=40'ı konuşma
  assert(total === 70, 'her aday balon tam bir kez gönderilmeli (eksik/mükerrer yok)');
  assert(scan.images[0].status === 'done' && scan.images[0].count === 40, '40 konuşma balonu çevrilmeli');
  const ctxBlock = wCalls[1].body.messages[0].content[0].text;
  assert(/önceki sayfalarında/.test(ctxBlock), 'sonraki isteklerde önceki çeviriler bağlam olarak gitmeli');
  const wimg = await page.evaluate(async () => {
    const b = await (await fetch(document.images[0].src)).blob();
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(OUT, 'cevrilmis-webtoon.jpg'), Buffer.from(wimg, 'base64'));
  console.log('Webtoon dilimleme ve bağlam aktarımı çalışıyor.');

  // Hata yolu: API anahtarı yokken anlaşılır Türkçe hata gösterilmeli
  await sw.evaluate(() => chrome.storage.local.set({ settings: { engine: 'claude', apiKey: '' } }));
  const callsBeforeErr = apiCalls.length;
  await page.goto('http://localhost:8701/hata');
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  await tabMsg({ type: 'translatePage' });
  for (let i = 0; i < 50; i++) {
    scan = await tabMsg({ type: 'scan' });
    if (scan.images.length && scan.images.every((im) => ['done', 'none', 'error'].includes(im.status))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('Anahtarsız deneme:', scan.images.map((i) => `${i.status}: ${i.error}`));
  assert(scan.images[0].status === 'error' && /API anahtarı/.test(scan.images[0].error), 'anahtar yok hatası gösterilmeli');
  assert(apiCalls.length === callsBeforeErr, 'anahtarsız API çağrısı yapılmamalı');
  assert((await page.evaluate(() => document.images[0].src)).endsWith('sayfa3.jpg'), 'hata durumunda görsel değişmemeli');
  await page.screenshot({ path: path.join(OUT, 'ekran-hata.png') });

  // Popup ve ayarlar ekran görüntüsü
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForTimeout(300);
  await opt.screenshot({ path: path.join(OUT, 'ayarlar.png'), fullPage: true });
  await page.bringToFront();
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 340, height: 560 });
  // Popup aktif sekmeyi kullanır; testte manga sekmesini öne getirip popup'ı ayrı pencerede açıyoruz
  await sw.evaluate(async (extId) => {
    const [t] = await chrome.tabs.query({ url: 'http://localhost:8701/*' });
    await chrome.tabs.update(t.id, { active: true });
  }, extId);
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.waitForTimeout(800);
  await pop.screenshot({ path: path.join(OUT, 'popup.png') });

  console.log('\nTÜM TESTLER GEÇTİ ✓  Çıktılar:', OUT);
  await ctx.close();
  imgServer.close(); pageServer.close();
})().catch((e) => { console.error('TEST BAŞARISIZ:', e); process.exit(1); });

function assert(cond, msg) {
  if (!cond) throw new Error('Doğrulama hatası: ' + msg);
}
