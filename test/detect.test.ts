import { describe, expect, it } from 'vitest';
import { detectSnark, DetectError, type SnarkGrid, type RGBAImage } from '../src/core/detect';
import { REFERENCE_SNARK, TEST_SNARKS, type TestSnark } from './fixtures/snarks';
import { blank, edgeConnected, paste, snarkImage, resize, screenshot, toJPEG } from './img';
import jpeg from 'jpeg-js';
import { deltaE, hexToRgb, rgbToLab } from '../src/core/color';
import { N } from '../src/core/grid';

/** The detected grid must split pixels into exactly the same colour classes as the drawing. */
// Background = background-coloured pixels connected to the edge; enclosed ones are
// part of the figure (on a transparent background they stay empty holes).
function expectSameGrid(g: SnarkGrid, p: TestSnark, transparent = false) {
  const map = new Map<string, number>();
  const outside = edgeConnected(N, (r, c) => p.rows[r][c] === '.');
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const ch = p.rows[r][c], v = g.cells[r][c];
    if (ch === '.' && (outside[r][c] || transparent)) { expect(v, `bg at ${r},${c}`).toBe(-1); continue; }
    expect(v, `pixel ${r},${c}`).toBeGreaterThanOrEqual(0);
    if (!map.has(ch)) map.set(ch, v);
    expect(v, `pixel ${r},${c} '${ch}'`).toBe(map.get(ch));
  }
  // distinct drawing colours stay distinct, unless they are near-identical (ΔE < 5)
  const chars = [...map.keys()];
  for (const a of chars) for (const b of chars) {
    if (a >= b || map.get(a) !== map.get(b)) continue;
    expect(deltaE(rgbToLab(hexToRgb(p.palette[a])), rgbToLab(hexToRgb(p.palette[b]))), `'${a}' and '${b}' merged`).toBeLessThan(5);
  }
}
const jpegRoundTrip = (img: RGBAImage, q: number): RGBAImage => {
  const j = jpeg.decode(toJPEG(img, q), { useTArray: true, formatAsRGBA: true });
  return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data) };
};

const ALL = [REFERENCE_SNARK, ...TEST_SNARKS];

describe('grid detection', () => {
  it.each(ALL.map(p => [p.name, p]))('original 26×26 PNG: %s', (_, p) => expectSameGrid(detectSnark(snarkImage(p as TestSnark)), p as TestSnark));
  it.each(ALL.map(p => [p.name, p]))('upscaled ×20: %s', (_, p) => expectSameGrid(detectSnark(snarkImage(p as TestSnark, 20)), p as TestSnark));
  it.each(ALL.map(p => [p.name, p]))('JPEG, blurry non-integer scale: %s', (_, p) => {
    const img = jpegRoundTrip(resize(snarkImage(p as TestSnark, 24), 419, 419), 70);
    expectSameGrid(detectSnark(img), p as TestSnark);
  });
  it.each(ALL.slice(0, 6).map(p => [p.name, p]))('phone screenshot with page around it: %s', (_, p) => {
    const g = detectSnark(jpegRoundTrip(screenshot(p as TestSnark), 80));
    expectSameGrid(g, p as TestSnark);
    expect(Math.abs(g.box.x - 120)).toBeLessThanOrEqual(3);
    expect(Math.abs(g.box.size - 517)).toBeLessThanOrEqual(4);
  });
  it('transparent background PNG', () => {
    const g = detectSnark(snarkImage(REFERENCE_SNARK, 10, true));
    expect(g.background).toBeNull();
    expectSameGrid(g, REFERENCE_SNARK, true);
  });

  it('rejects a picture of several zkSNARKs side by side', () => {
    const k = 11, cell = N * k;
    const sheet = blank(3 * cell + 40, 3 * cell + 40, [99, 132, 151, 255]);
    ALL.slice(0, 9).forEach((p, i) => paste(sheet, snarkImage(p, k), 20 + (i % 3) * cell, 20 + Math.floor(i / 3) * cell));
    expect(() => detectSnark(sheet)).toThrow(DetectError);
  });
  it('rejects noise', () => {
    const img = blank(300, 300);
    let s = 1; for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : (s = (s * 48271) % 2147483647) & 255;
    expect(() => detectSnark(img)).toThrow(DetectError);
  });
  it('rejects a plain image', () => expect(() => detectSnark(blank(400, 400, [200, 30, 30, 255]))).toThrow(DetectError));
  it('rejects a tiny image', () => expect(() => detectSnark(blank(12, 12))).toThrow(DetectError));
  it('rejects a zkSNARK that is cut off', () => {
    const full = snarkImage(REFERENCE_SNARK, 10), W = full.width, crop = blank(160, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < 160; x++) for (let k = 0; k < 4; k++) crop.data[(y * 160 + x) * 4 + k] = full.data[(y * W + x + 90) * 4 + k];
    expect(() => detectSnark(crop)).toThrow(DetectError);
  });
});
