// Build public/snarks.png + public/snarks.json from a folder of downloaded zkSNARKs
// (art/1.png … art/10000.png, the 520×520 images from zilkroad.com/api/art/<n>).
//   npx tsx scripts/sheet-from-folder.ts [folder]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { N } from '../src/core/grid';

const dir = process.argv[2] ?? 'art';
const FIRST = 1, LAST = 10000, COLS = 100, cell = N;
const W = COLS * cell, H = Math.ceil((LAST - FIRST + 1) / COLS) * cell;
const sheet = new PNG({ width: W, height: H });
const missing: number[] = [];
for (let n = FIRST; n <= LAST; n++) {
  const f = `${dir}/${n}.png`;
  let src: PNG;
  try { if (!existsSync(f)) throw new Error('no file'); src = PNG.sync.read(readFileSync(f)); } catch { missing.push(n); continue; }
  // keep the most common colour of each block (520×520 → 26×26, 20 px per pixel)
  const kx = src.width / cell, ky = src.height / cell, i = n - FIRST, X = (i % COLS) * cell, Y = Math.floor(i / COLS) * cell;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const seen = new Map<number, number>();
    let best = 0, bestN = 0;
    for (let yy = Math.floor(y * ky); yy < Math.floor((y + 1) * ky); yy++) for (let xx = Math.floor(x * kx); xx < Math.floor((x + 1) * kx); xx++) {
      const o = (yy * src.width + xx) * 4, key = ((src.data[o] << 24) | (src.data[o + 1] << 16) | (src.data[o + 2] << 8) | src.data[o + 3]) >>> 0;
      const c = (seen.get(key) ?? 0) + 1; seen.set(key, c);
      if (c > bestN) { bestN = c; best = key; }
    }
    const d = ((Y + y) * W + X + x) * 4;
    sheet.data[d] = best >>> 24; sheet.data[d + 1] = (best >>> 16) & 255; sheet.data[d + 2] = (best >>> 8) & 255; sheet.data[d + 3] = best & 255;
  }
  if (n === FIRST) console.log(`#${n} is ${src.width}×${src.height} (${kx} px per pixel)`);
}
writeFileSync('public/snarks.png', PNG.sync.write(sheet));
writeFileSync('public/snarks.json', JSON.stringify({ first: FIRST, last: LAST, cols: COLS, cell, source: 'https://zilkroad.com/api/art/<n>', made: new Date().toISOString().slice(0, 10), missing }));
console.log(`public/snarks.png: ${LAST - FIRST + 1 - missing.length} zkSNARKs${missing.length ? `, missing ${missing.length}: ${missing.slice(0, 30).join(', ')}${missing.length > 30 ? '…' : ''}` : ''}`);
