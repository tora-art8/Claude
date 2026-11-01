// =====================================================================
// detector.js — Konuşma balonu tespiti (tamamen tarayıcıda, kütüphanesiz)
//
// Fikir: Manga balonlarının içi beyaz (açık renk), yazılar ise koyu.
//  1) Görüntüyü gri tonlamaya çevirip "açık renkli" pikselleri işaretleriz.
//  2) Birbirine değen açık pikselleri gruplarız (bağlı bileşenler).
//  3) Bir grubun içinde "delikler" varsa (koyu yazı harfleri) ve şekli
//     balona benziyorsa (dolu, makul boyutta) bunu aday balon sayarız.
//  4) Son kararı yapay zekâ verir: aday balonun içinde konuşma yoksa
//     (efekt sesi, boş alan vb.) çeviri yapılmaz.
// =====================================================================
(() => {
  const MTC = (globalThis.MTC = globalThis.MTC || {});

  /**
   * Görüntüdeki aday konuşma balonlarını bulur.
   * @param {ImageData} img  İşleme çözünürlüğündeki görüntü verisi
   * @param {object} [opt]   İsteğe bağlı eşik ayarları
   * @returns {Array} balon listesi (koordinatlar işleme çözünürlüğünde)
   */
  MTC.detectBubbles = function detectBubbles(img, opt = {}) {
    const W = img.width;
    const H = img.height;
    const N = W * H;
    const d = img.data;
    const T = opt.brightThreshold ?? 200; // bu değerden açık pikseller "beyaz" sayılır

    // --- 1) Gri tonlama + açık piksel maskesi ---
    const gray = new Uint8Array(N);
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      gray[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    }

    // --- 2) Açık piksellerin bağlı bileşenleri (4-komşuluk, BFS) ---
    const labels = new Int32Array(N); // 0 = etiketsiz
    const queue = new Int32Array(N);
    const comps = []; // {area, minX, maxX, minY, maxY, sumR, sumG, sumB}
    for (let start = 0; start < N; start++) {
      if (labels[start] || gray[start] < T) continue;
      const id = comps.length + 1;
      let head = 0, tail = 0;
      queue[tail++] = start;
      labels[start] = id;
      let area = 0, minX = W, maxX = 0, minY = H, maxY = 0, sr = 0, sg = 0, sb = 0;
      while (head < tail) {
        const i = queue[head++];
        const x = i % W, y = (i / W) | 0;
        area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const p = i * 4; sr += d[p]; sg += d[p + 1]; sb += d[p + 2];
        // komşular: sol, sağ, üst, alt
        if (x > 0) { const j = i - 1; if (!labels[j] && gray[j] >= T) { labels[j] = id; queue[tail++] = j; } }
        if (x < W - 1) { const j = i + 1; if (!labels[j] && gray[j] >= T) { labels[j] = id; queue[tail++] = j; } }
        if (y > 0) { const j = i - W; if (!labels[j] && gray[j] >= T) { labels[j] = id; queue[tail++] = j; } }
        if (y < H - 1) { const j = i + W; if (!labels[j] && gray[j] >= T) { labels[j] = id; queue[tail++] = j; } }
      }
      comps.push({ id, area, minX, maxX, minY, maxY, sr, sg, sb });
    }

    // --- 3) Boyut ön elemesi ---
    const minArea = Math.max(350, N * 0.0005);
    const maxArea = N * 0.25;
    const minDim = Math.max(14, Math.round(Math.min(W, H) * 0.02));

    const bubbles = [];
    for (const c of comps) {
      if (c.area < minArea || c.area > maxArea) continue;
      const cw = c.maxX - c.minX + 1;
      const ch = c.maxY - c.minY + 1;
      if (cw < minDim || ch < minDim) continue;
      if (cw > W * 0.95 && ch > H * 0.5) continue; // sayfa kenar boşluğu gibi dev alanlar
      const b = analyzeComponent(c, labels, gray, d, W, H, T);
      if (b) bubbles.push(b);
    }

    // En büyük 40 adayı tut (aşırı API maliyetini önler)
    bubbles.sort((a, b) => b.filledArea - a.filledArea);
    bubbles.length = Math.min(bubbles.length, opt.maxBubbles ?? 40);

    // Okuma sırası: manga sağdan sola, yukarıdan aşağı okunur.
    const band = Math.max(20, H * 0.04);
    bubbles.sort((a, b) => {
      const ay = Math.round(a.cy / band), by = Math.round(b.cy / band);
      return ay !== by ? ay - by : b.cx - a.cx;
    });
    bubbles.forEach((b, i) => (b.id = i + 1));
    return bubbles;
  };

  // Tek bir açık renkli bileşenin balon olup olmadığını inceler.
  function analyzeComponent(c, labels, gray, d, W, H, T) {
    // 1 piksellik kenar payı ile yerel bir ızgara oluştur
    const ox = c.minX - 1, oy = c.minY - 1;
    const bw = c.maxX - c.minX + 3, bh = c.maxY - c.minY + 3;
    const L = new Uint8Array(bw * bh); // 0=bilinmiyor 1=bileşen 2=dışarı 3=delik(yazı)
    for (let y = 1; y < bh - 1; y++) {
      const gy = oy + y;
      for (let x = 1; x < bw - 1; x++) {
        if (labels[gy * W + ox + x] === c.id) L[y * bw + x] = 1;
      }
    }

    // Kenardan başlayıp bileşen olmayan her yeri "dışarı" olarak doldur.
    const q = new Int32Array(bw * bh);
    let head = 0, tail = 0;
    const pushOut = (k) => { if (L[k] === 0) { L[k] = 2; q[tail++] = k; } };
    for (let x = 0; x < bw; x++) { pushOut(x); pushOut((bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { pushOut(y * bw); pushOut(y * bw + bw - 1); }
    while (head < tail) {
      const k = q[head++];
      const x = k % bw, y = (k / bw) | 0;
      if (x > 0) pushOut(k - 1);
      if (x < bw - 1) pushOut(k + 1);
      if (y > 0) pushOut(k - bw);
      if (y < bh - 1) pushOut(k + bw);
    }

    // Geriye kalan 0'lar = bileşenin içinde kalan delikler (yazı harfleri veya çizim)
    const holes = [];
    let darkR = 0, darkG = 0, darkB = 0, darkN = 0;
    for (let k0 = 0; k0 < L.length; k0++) {
      if (L[k0] !== 0) continue;
      // delik bileşenini BFS ile gez
      head = 0; tail = 0;
      L[k0] = 3; q[tail++] = k0;
      let a = 0, bright = 0, hMinX = bw, hMaxX = -1, hMinY = bh, hMaxY = -1;
      while (head < tail) {
        const k = q[head++];
        const x = k % bw, y = (k / bw) | 0;
        a++;
        if (x < hMinX) hMinX = x; if (x > hMaxX) hMaxX = x;
        if (y < hMinY) hMinY = y; if (y > hMaxY) hMaxY = y;
        const gi = (oy + y) * W + ox + x;
        const g = gray[gi];
        if (g >= T) bright++;
        else if (g < 110) { const p = gi * 4; darkR += d[p]; darkG += d[p + 1]; darkB += d[p + 2]; darkN++; }
        if (x > 0 && L[k - 1] === 0) { L[k - 1] = 3; q[tail++] = k - 1; }
        if (x < bw - 1 && L[k + 1] === 0) { L[k + 1] = 3; q[tail++] = k + 1; }
        if (y > 0 && L[k - bw] === 0) { L[k - bw] = 3; q[tail++] = k - bw; }
        if (y < bh - 1 && L[k + bw] === 0) { L[k + bw] = 3; q[tail++] = k + bw; }
      }
      if (a < 3) continue; // tek piksellik gürültü
      holes.push({ a, bright, hMinX, hMaxX, hMinY, hMaxY });
    }

    // Yazı harflerinin içi (O, A gibi) küçük ve çoğunlukla koyudur.
    // İçi büyük ölçüde açık renkli büyük delikler ise çizimdir (yüz, başka balon, obje).
    let holeArea = 0, largestHole = 0, holeCount = 0, artArea = 0;
    let tMinX = bw, tMaxX = -1, tMinY = bh, tMaxY = -1;
    const holeHeights = [];
    for (const h of holes) {
      holeArea += h.a;
      if (h.a > largestHole) largestHole = h.a;
      if (h.a > 120 && h.bright / h.a > 0.6) { artArea += h.a; continue; }
      holeCount++;
      holeHeights.push(h.hMaxY - h.hMinY + 1);
      if (h.hMinX < tMinX) tMinX = h.hMinX; if (h.hMaxX > tMaxX) tMaxX = h.hMaxX;
      if (h.hMinY < tMinY) tMinY = h.hMinY; if (h.hMaxY > tMaxY) tMaxY = h.hMaxY;
    }

    const filledArea = c.area + holeArea;
    const boxArea = (bw - 2) * (bh - 2);

    // --- Balon olma kriterleri ---
    if (holeCount < 1) return null;                         // içinde yazı yok
    if (artArea > holeArea * 0.25) return null;             // içinde çizim var → panel/arka plan
    if (holeArea < Math.max(15, filledArea * 0.008)) return null;
    if (holeArea > filledArea * 0.6) return null;           // yazıdan çok koyu alan → çizim
    if (largestHole > filledArea * 0.3) return null;        // tek büyük koyu leke → yüz/obje
    if (filledArea / boxArea < 0.4) return null;            // çok dağınık şekil
    const textBoxArea = (tMaxX - tMinX + 1) * (tMaxY - tMinY + 1);
    if (textBoxArea > boxArea * 0.85) return null;          // ekran tonu (raster) gibi her yere yayılmış

    // Balonun "dolu" maskesi (bileşen + delikler) — kenar çizgisi hariç
    const mask = new Uint8Array(bw * bh);
    let sumY = 0, cnt = 0;
    for (let k = 0; k < L.length; k++) {
      if (L[k] === 1 || L[k] === 3) { mask[k] = 1; sumY += (k / bw) | 0; cnt++; }
    }

    // Satır bazlı yatay açıklıklar (yazıyı satır satır yerleştirmek için)
    const textCx = Math.round((tMinX + tMaxX) / 2);
    const spanL = new Int16Array(bh).fill(-1);
    const spanR = new Int16Array(bh).fill(-1);
    for (let y = 0; y < bh; y++) {
      const row = y * bw;
      let bestL = -1, bestR = -1, bestLen = 0, hitL = -1, hitR = -1;
      let x = 0;
      while (x < bw) {
        if (!mask[row + x]) { x++; continue; }
        const s = x;
        while (x < bw && mask[row + x]) x++;
        const e = x - 1;
        if (e - s + 1 > bestLen) { bestLen = e - s + 1; bestL = s; bestR = e; }
        if (s <= textCx && textCx <= e) { hitL = s; hitR = e; }
      }
      if (hitL >= 0) { spanL[y] = hitL; spanR[y] = hitR; }
      else if (bestL >= 0) { spanL[y] = bestL; spanR[y] = bestR; }
    }

    // Arka plan rengi = bileşenin ortalama rengi; yazı rengi = koyu piksellerin ortalaması
    const bg = [Math.round(c.sr / c.area), Math.round(c.sg / c.area), Math.round(c.sb / c.area)];
    const fg = darkN ? [Math.round(darkR / darkN), Math.round(darkG / darkN), Math.round(darkB / darkN)] : [0, 0, 0];

    holeHeights.sort((a, b) => a - b);
    const medianLetterH = holeHeights[Math.floor(holeHeights.length / 2)] || 0;

    return {
      ox, oy, bw, bh, mask, spanL, spanR,
      x: c.minX, y: c.minY, w: bw - 2, h: bh - 2,           // sınır kutusu (işleme çözünürlüğü)
      text: { x: ox + tMinX, y: oy + tMinY, w: tMaxX - tMinX + 1, h: tMaxY - tMinY + 1 },
      cx: ox + textCx, cy: oy + sumY / cnt,
      maskCy: sumY / cnt,                                     // yerel koordinatta dikey merkez
      filledArea, holeArea, holeCount, medianLetterH, bg, fg,
    };
  }
})();
