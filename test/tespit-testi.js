// Balon tespitini tarayıcıda (Chromium) çalıştırıp bulunan balonları çizer.
// Kullanım: node test/tespit-testi.js test/ornek/sayfa1.png [cikti.png]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const input = path.resolve(process.argv[2] || 'test/ornek/sayfa1.png');
  const output = path.resolve(process.argv[3] || input.replace(/\.\w+$/, '-tespit.png'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const f of ['detector.js', 'layout.js']) {
    await page.addScriptTag({ path: path.join(__dirname, '..', 'eklenti', 'lib', f) });
  }
  const b64 = fs.readFileSync(input).toString('base64');
  const res = await page.evaluate(async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height;
    const ps = Math.min(1, 1100 / W, Math.sqrt(4e6 / (W * H)));
    const pw = Math.round(W * ps), ph = Math.round(H * ps);
    const c = document.createElement('canvas'); c.width = pw; c.height = ph;
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, pw, ph);
    const t0 = performance.now();
    const bubbles = MTC.detectBubbles(ctx.getImageData(0, 0, pw, ph));
    const ms = performance.now() - t0;
    // Sonuçları çiz
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const o = out.getContext('2d'); o.drawImage(bmp, 0, 0);
    const k = W / pw;
    o.lineWidth = 3; o.font = 'bold 26px sans-serif';
    for (const b of bubbles) {
      o.strokeStyle = 'red'; o.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
      o.strokeStyle = 'blue'; o.strokeRect(b.text.x * k, b.text.y * k, b.text.w * k, b.text.h * k);
      o.fillStyle = 'red'; o.fillText('#' + b.id, b.x * k + 4, b.y * k + 26);
    }
    return {
      ms: Math.round(ms),
      png: out.toDataURL('image/png').split(',')[1],
      bubbles: bubbles.map((b) => ({ id: b.id, x: Math.round(b.x * k), y: Math.round(b.y * k), w: Math.round(b.w * k), h: Math.round(b.h * k), harfY: b.medianLetterH, cap: MTC.estimateCapacity(o, b, k, Math.max(12, b.medianLetterH * k / 0.72)) })),
    };
  }, b64);
  fs.writeFileSync(output, Buffer.from(res.png, 'base64'));
  console.log(`${res.bubbles.length} balon bulundu (${res.ms} ms)`);
  console.table(res.bubbles);
  console.log('Çıktı:', output);
  await browser.close();
})();
