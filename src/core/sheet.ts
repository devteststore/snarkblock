// All 10,000 zkSNARKs in one image (public/snarks.png, described by public/snarks.json),
// made once by scripts/make-sheet.browser.js. The site cuts a zkSNARK out of it by number.
import type { RGBAImage } from './detect';

export interface SheetMeta { first: number; last: number; cols: number; cell: number; missing?: number[] }

/** zkSNARK #n cut from the sheet (cell×cell), or null if that cell is empty. */
export function cutSnark(sheet: RGBAImage, meta: SheetMeta, n: number): RGBAImage | null {
  if (n < meta.first || n > meta.last || meta.missing?.includes(n)) return null;
  const i = n - meta.first, c = meta.cell, X = (i % meta.cols) * c, Y = Math.floor(i / meta.cols) * c;
  if (X + c > sheet.width || Y + c > sheet.height) return null;
  const data = new Uint8ClampedArray(c * c * 4);
  let opaque = 0;
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    const o = ((Y + y) * sheet.width + X + x) * 4, d = (y * c + x) * 4;
    for (let k = 0; k < 4; k++) data[d + k] = sheet.data[o + k];
    if (data[d + 3] >= 128) opaque++;
  }
  return opaque ? { width: c, height: c, data } : null;
}
