// Helpers for the real zkSNARKs: the sheet the site uses (public/snarks.png + snarks.json,
// made by scripts/make-sheet.browser.js). Tests on real zkSNARKs run when it is there.
import { existsSync, readFileSync } from 'node:fs';
import type { RGBAImage } from '../src/core/detect';
import { cutSnark, type SheetMeta } from '../src/core/sheet';
import { load } from '../test/img';

export const SHEET_PNG = new URL('../public/snarks.png', import.meta.url).pathname;
export const SHEET_JSON = new URL('../public/snarks.json', import.meta.url).pathname;
export const hasRealSnarks = () => existsSync(SHEET_PNG) && existsSync(SHEET_JSON);
let sheet: { img: RGBAImage; meta: SheetMeta } | null = null;
const getSheet = () => (sheet ??= { img: load(SHEET_PNG), meta: JSON.parse(readFileSync(SHEET_JSON, 'utf8')) });

/** ids present in the sheet, in order */
export const realIds = () => {
  if (!hasRealSnarks()) return [];
  const { meta } = getSheet(), gone = new Set(meta.missing ?? []);
  return Array.from({ length: meta.last - meta.first + 1 }, (_, i) => meta.first + i).filter(n => !gone.has(n));
};

/**
 * zkSNARK #id as 26×26, on its own background (default), on a given
 * background colour, or with the background made transparent (null).
 */
export function realSnark(id: number, bg: [number, number, number] | null | 'own' = 'own'): RGBAImage {
  const { img, meta } = getSheet();
  const src = cutSnark(img, meta, id);
  if (!src) throw new Error(`zkSNARK #${id} is not in the sheet`);
  if (bg === 'own') return src;
  const d = src.data, data = new Uint8ClampedArray(d.length);
  const own = [d[0], d[1], d[2], d[3]];
  for (let o = 0; o < d.length; o += 4) {
    const isBg = own[3] < 128 ? d[o + 3] < 128 : d[o] === own[0] && d[o + 1] === own[1] && d[o + 2] === own[2] && d[o + 3] === own[3];
    if (isBg) { if (bg) data.set([...bg, 255], o); continue; }
    data.set(d.subarray(o, o + 4), o);
  }
  return { width: src.width, height: src.height, data };
}
