// =====================================================================
// layout.js — Türkçe metni balonun şekline göre sığdırma ve çizme
//
// Balon oval olabileceği için her satırın kullanabileceği genişlik farklıdır.
// Tespit aşamasında her piksel satırı için balonun sol/sağ sınırını
// çıkarmıştık (spanL/spanR). Burada:
//  1) Büyük yazı boyutundan başlayıp küçülterek,
//  2) Her boyutta 1, 2, 3... satır deneyerek kelimeleri yerleştiririz.
//  3) Sığan ilk (en büyük) boyutu seçeriz.
// =====================================================================
(() => {
  const MTC = (globalThis.MTC = globalThis.MTC || {});

  MTC.FONT_FAMILY = '"MTC Comic", "Comic Sans MS", "Comic Neue", "Segoe UI", Arial, sans-serif';
  const LINE_H = 1.12; // satır yüksekliği çarpanı
  const fontStr = (f) => `700 ${f.toFixed(2)}px ${MTC.FONT_FAMILY}`;

  /**
   * Balonun işleme koordinatlarındaki geometrisini tam çözünürlüğe çeviren yardımcı.
   * k = tam çözünürlük / işleme çözünürlüğü
   */
  function geometry(b, k) {
    // Bir yatay şerit [yTop, yBot] (tam çözünürlük) için kullanılabilir genişlik
    return function band(yTop, yBot) {
      const off = b.offY || 0; // uzun görsellerde dilimin görüntüdeki dikey başlangıcı
      const r0 = Math.floor((yTop - off) / k) - b.oy;
      const r1 = Math.ceil((yBot - off) / k) - b.oy;
      if (r0 < 0 || r1 >= b.bh) return null;
      let L = -Infinity, R = Infinity;
      for (let r = r0; r <= r1; r++) {
        if (b.spanL[r] < 0) return null;
        if (b.spanL[r] > L) L = b.spanL[r];
        if (b.spanR[r] < R) R = b.spanR[r];
      }
      if (R < L) return null;
      return { left: (L + b.ox) * k, right: (R + 1 + b.ox) * k };
    };
  }

  /** Metni kelimelere ayırır (birden fazla boşluğu tek sayar). */
  const words = (t) => t.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

  /**
   * Belirli bir yazı boyutu ve satır sayısı için yerleşim dener.
   * Başarılıysa satır listesini döndürür, değilse null.
   */
  function tryLayout(ctx, ws, f, n, band, centerY, allowBreak) {
    const lh = f * LINE_H;
    const pad = Math.max(2, f * 0.35);       // yatay iç boşluk
    const padV = f * 0.3;                    // dikey iç boşluk
    const top = centerY - (n * lh) / 2;
    const lines = [];
    let idx = 0;
    const queue = ws.slice();
    for (let i = 0; i < n; i++) {
      const y0 = top + i * lh;
      const bnd = band(y0 - (i === 0 ? padV : 0), y0 + lh + (i === n - 1 ? padV : 0));
      if (!bnd) return null;
      const maxW = bnd.right - bnd.left - 2 * pad;
      if (maxW <= f) return null;
      let line = '';
      while (idx < queue.length) {
        const cand = line ? line + ' ' + queue[idx] : queue[idx];
        if (ctx.measureText(cand).width <= maxW) { line = cand; idx++; continue; }
        // Tek kelime bile sığmıyorsa ve izin varsa kelimeyi tire ile böl
        if (!line && allowBreak) {
          const wd = queue[idx];
          let cut = wd.length - 1;
          while (cut > 1 && ctx.measureText(wd.slice(0, cut) + '-').width > maxW) cut--;
          if (cut <= 1) return null;
          line = wd.slice(0, cut) + '-';
          queue[idx] = wd.slice(cut);
        }
        break;
      }
      if (!line) return null;
      lines.push({ text: line, x: (bnd.left + bnd.right) / 2, y: y0 + lh / 2 });
    }
    if (idx < queue.length) return null;
    return lines;
  }

  /**
   * Metni balona sığdırır.
   * @returns {{fits:boolean, fontSize:number, lines:Array}}
   */
  MTC.fitText = function fitText(ctx, text, b, k, minF, maxF) {
    const ws = words(text);
    if (!ws.length) return { fits: true, fontSize: minF, lines: [] };
    const band = geometry(b, k);
    const centerY = (b.offY || 0) + (b.oy + b.maskCy) * k;
    const maxLines = 12;
    const attempt = (f, allowBreak) => {
      ctx.font = fontStr(f);
      for (let n = 1; n <= maxLines; n++) {
        const lines = tryLayout(ctx, ws, f, n, band, centerY, allowBreak);
        if (lines) return lines;
      }
      return null;
    };
    // Büyükten küçüğe doğru yazı boyutu dene
    for (let f = maxF; f >= minF - 0.01; f -= Math.max(0.5, f * 0.05)) {
      const lines = attempt(f, false);
      if (lines) return { fits: true, fontSize: f, lines };
    }
    return { fits: false, fontSize: minF, lines: null };
  };

  /** Son çare: minimum boyutun da altına inip gerekirse kelime bölerek sığdır. */
  MTC.forceFit = function forceFit(ctx, text, b, k, minF) {
    const ws = words(text);
    const band = geometry(b, k);
    const centerY = (b.offY || 0) + (b.oy + b.maskCy) * k;
    for (let f = minF; f >= Math.max(6, minF * 0.6); f -= Math.max(0.5, f * 0.05)) {
      ctx.font = fontStr(f);
      for (let n = 1; n <= 16; n++) {
        const lines = tryLayout(ctx, ws, f, n, band, centerY, true);
        if (lines) return { fits: true, fontSize: f, lines };
      }
    }
    // Hiçbir şekilde sığmadıysa balon merkezine küçük boyutta sar
    const f = Math.max(6, minF * 0.6);
    ctx.font = fontStr(f);
    const maxW = b.w * k * 0.9;
    const lines = [];
    let line = '';
    for (const w of ws) {
      const cand = line ? line + ' ' + w : w;
      if (ctx.measureText(cand).width > maxW && line) { lines.push(line); line = w; } else line = cand;
    }
    if (line) lines.push(line);
    const lh = f * LINE_H;
    const cx = (b.x + b.w / 2) * k;
    const top = centerY - (lines.length * lh) / 2;
    return { fits: false, fontSize: f, lines: lines.map((t, i) => ({ text: t, x: cx, y: top + i * lh + lh / 2 })) };
  };

  /**
   * Belirli bir yazı boyutunda balona yaklaşık kaç karakter sığar?
   * Bu değer yapay zekâya "en fazla N karakter" sınırı olarak verilir.
   */
  MTC.estimateCapacity = function estimateCapacity(ctx, b, k, f) {
    const band = geometry(b, k);
    ctx.font = fontStr(f);
    const sample = 'Bunu yapmak zorundayız, başka çaremiz yok gibi görünüyor!';
    const avg = ctx.measureText(sample).width / sample.length;
    const lh = f * LINE_H;
    const pad = Math.max(2, f * 0.35);
    const centerY = (b.offY || 0) + (b.oy + b.maskCy) * k;
    let best = 0;
    for (let n = 1; n <= 12; n++) {
      const top = centerY - (n * lh) / 2;
      let total = 0, ok = true;
      for (let i = 0; i < n; i++) {
        const bnd = band(top + i * lh - (i === 0 ? f * 0.3 : 0), top + (i + 1) * lh + (i === n - 1 ? f * 0.3 : 0));
        if (!bnd) { ok = false; break; }
        total += Math.max(0, bnd.right - bnd.left - 2 * pad);
      }
      if (!ok) break;
      best = Math.max(best, total);
    }
    // Kelime kaydırma kayıplarını hesaba katmak için %80'ini al
    return Math.max(3, Math.floor((best / avg) * 0.8));
  };

  /**
   * Orijinal İngilizce yazının üstünü balonun arka plan rengiyle kapatır.
   * Maske işleme çözünürlüğündedir; tam çözünürlüğe yumuşak şekilde büyütülür.
   */
  MTC.coverBubble = function coverBubble(ctx, b, k) {
    const { bw, bh, mask } = b;
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const cx = c.getContext('2d');
    const id = cx.createImageData(bw, bh);
    const [r, g, bl] = b.bg;
    for (let y = 1; y < bh - 1; y++) {
      for (let x = 1; x < bw - 1; x++) {
        const k0 = y * bw + x;
        // 1 piksel içeri çek (kenar çizgisine dokunma)
        if (mask[k0] && mask[k0 - 1] && mask[k0 + 1] && mask[k0 - bw] && mask[k0 + bw]) {
          const p = k0 * 4;
          id.data[p] = r; id.data[p + 1] = g; id.data[p + 2] = bl; id.data[p + 3] = 255;
        }
      }
    }
    cx.putImageData(id, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, bw, bh, b.ox * k, (b.offY || 0) + b.oy * k, bw * k, bh * k);
    // Yumuşatma kenarlarda yarı saydamlık bırakabilir; yazının bulunduğu
    // bölgeyi ikinci kez boyayarak harf izlerinin tamamen kapanmasını sağla.
    ctx.drawImage(c, 0, 0, bw, bh, b.ox * k, (b.offY || 0) + b.oy * k, bw * k, bh * k);
    ctx.restore();
  };

  /** Yerleşmiş satırları çizer. */
  MTC.drawLines = function drawLines(ctx, layout, b) {
    if (!layout || !layout.lines) return;
    const lum = 0.299 * b.bg[0] + 0.587 * b.bg[1] + 0.114 * b.bg[2];
    ctx.save();
    ctx.font = fontStr(layout.fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = lum > 128 ? '#111' : '#f5f5f5';
    for (const ln of layout.lines) ctx.fillText(ln.text, ln.x, ln.y);
    ctx.restore();
  };
})();
