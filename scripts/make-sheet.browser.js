// Builds public/snarks.png (all 10,000 zkSNARKs in one image) and public/snarks.json.
//
// zilkroad.com only serves its images to its own pages, so this runs in YOUR
// browser, on zilkroad.com:
//   1. open https://zilkroad.com in Chrome, Edge or Firefox
//   2. open the developer console (F12, or Ctrl+Shift+J / Cmd+Option+J)
//   3. paste this whole file, press Enter, keep the tab open (a few minutes)
//   4. two files download: snarks.png and snarks.json. Put both in public/
//
// Layout: 100 columns × 100 rows, zkSNARK #n at column (n-1) % 100,
// row floor((n-1) / 100), each cell 26×26: the art API serves 520×520 PNGs
// (26×26 pixel art, each pixel a 20×20 block); each block's most common colour is kept.
(async () => {
  const FIRST = 1, LAST = 10000, COLS = 100, GRID = 26, PARALLEL = 6;
  const url = n => `/api/art/${n}`;
  const load = async n => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url(n), { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type})`);
        return await createImageBitmap(blob);
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise(res => setTimeout(res, 800 * 2 ** attempt));
      }
    }
  };

  const first = await load(FIRST);
  const cell = GRID;
  console.log(`zkSNARK #${FIRST} is ${first.width}×${first.height} px (${first.width / GRID} px per pixel) → sheet cells of ${cell}×${cell}`);
  if (first.width !== first.height || first.width % GRID) console.warn(`${first.width}×${first.height} is not a square multiple of ${GRID}: check a few cells of the sheet by eye`);

  const rows = Math.ceil((LAST - FIRST + 1) / COLS);
  const W = COLS * cell, H = rows * cell;
  const out = new ImageData(W, H);
  // read each image at full size and keep the most common colour of each block
  const tmp = document.createElement('canvas');
  const tx = tmp.getContext('2d', { willReadFrequently: true });
  const put = (n, bmp) => {
    if (tmp.width !== bmp.width || tmp.height !== bmp.height) { tmp.width = bmp.width; tmp.height = bmp.height; }
    tx.clearRect(0, 0, tmp.width, tmp.height);
    tx.drawImage(bmp, 0, 0);
    const src = tx.getImageData(0, 0, tmp.width, tmp.height).data, kx = bmp.width / cell, ky = bmp.height / cell;
    const i = n - FIRST, X = (i % COLS) * cell, Y = Math.floor(i / COLS) * cell;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const seen = new Map();
      let best = 0, bestN = 0;
      for (let yy = Math.floor(y * ky); yy < Math.floor((y + 1) * ky); yy++) for (let xx = Math.floor(x * kx); xx < Math.floor((x + 1) * kx); xx++) {
        const o = (yy * tmp.width + xx) * 4, key = ((src[o] << 24) | (src[o + 1] << 16) | (src[o + 2] << 8) | src[o + 3]) >>> 0;
        const c = (seen.get(key) || 0) + 1; seen.set(key, c);
        if (c > bestN) { bestN = c; best = key; }
      }
      const d = ((Y + y) * W + X + x) * 4;
      out.data[d] = best >>> 24; out.data[d + 1] = (best >>> 16) & 255; out.data[d + 2] = (best >>> 8) & 255; out.data[d + 3] = best & 255;
    }
    bmp.close?.();
  };
  put(FIRST, first);

  const missing = [];
  let next = FIRST + 1, done = 1;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next <= LAST) {
      const n = next++;
      try { put(n, await load(n)); } catch (e) { missing.push(n); console.warn(`#${n}: ${e.message}`); }
      if (++done % 250 === 0) console.log(`${done}/${LAST - FIRST + 1} · ${Math.round((performance.now() - t0) / 1000)} s`);
    }
  }));

  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); };
  const sheet = document.createElement('canvas');
  sheet.width = W; sheet.height = H;
  sheet.getContext('2d').putImageData(out, 0, 0);
  save(await new Promise(res => sheet.toBlob(res, 'image/png')), 'snarks.png');
  const meta = { first: FIRST, last: LAST, cols: COLS, cell, source: 'https://zilkroad.com/api/art/<n>', made: new Date().toISOString().slice(0, 10), missing: missing.sort((a, b) => a - b) };
  save(new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'snarks.json');
  console.log(`Done: ${LAST - FIRST + 1 - missing.length} zkSNARKs in snarks.png${missing.length ? `, ${missing.length} missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''} (run again later, or fill them by hand)` : ''}. Put snarks.png and snarks.json in public/.`);
})();
