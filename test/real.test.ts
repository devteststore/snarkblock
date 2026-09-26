// Real zkSNARKs in the forms visitors upload. Runs only when public/snarks.png + snarks.json are there (scripts/make-sheet.browser.js).
import { describe, expect, it } from 'vitest';
import { deltaE, rgbToLab, type RGB } from '../src/core/color';
import { detectSnark, type SnarkGrid, type RGBAImage } from '../src/core/detect';
import { buildModel } from '../src/core/build';
import { hasRealSnarks, realIds, realSnark } from '../scripts/real';
import { blank, edgeConnected } from './img';
import { N } from '../src/core/grid';

// up to 120 of the downloaded zkSNARKs, spread over the ids
const IDS = realIds();
const SAMPLE = IDS.length <= 120 ? IDS : Array.from({ length: 120 }, (_, i) => IDS[Math.floor(i * IDS.length / 120)]);

function upscale(img: RGBAImage, k: number): RGBAImage {
  const out = blank(img.width * k, img.height * k, [0, 0, 0, 0]);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const o = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
    out.data.set(img.data.subarray(o, o + 4), (y * out.width + x) * 4);
  }
  return out;
}
/** The detected grid splits pixels exactly like the source 26×26 (near-identical colours may merge). */
function expectSame(g: SnarkGrid, truth: RGBAImage, mergeBelow = 5) {
  const bg = truth.data.slice(0, 4);
  const key = (r: number, c: number) => { const o = (r * N + c) * 4; return truth.data[o + 3] < 128 ? 'bg' : [0, 1, 2].map(k => truth.data[o + k]).join(','); };
  const bgKey = key(0, 0);
  const map = new Map<string, number>();
  // background = background-coloured and connected to the edge; enclosed ones belong to
  // the figure (transparent holes stay empty)
  const outside = edgeConnected(N, (r, c) => key(r, c) === bgKey);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const k = key(r, c), v = g.cells[r][c];
    if (k === bgKey && (outside[r][c] || k === 'bg')) { expect(v, `bg ${r},${c}`).toBe(-1); continue; }
    expect(v, `pixel ${r},${c}`).toBeGreaterThanOrEqual(0);
    if (!map.has(k)) map.set(k, v);
    expect(v, `pixel ${r},${c}`).toBe(map.get(k));
  }
  const ks = [...map.keys()];
  for (const a of ks) for (const b of ks) if (a < b && map.get(a) === map.get(b)) {
    const la = rgbToLab(a.split(',').map(Number) as RGB), lb = rgbToLab(b.split(',').map(Number) as RGB);
    expect(deltaE(la, lb), `${a} merged with ${b}`).toBeLessThan(mergeBelow);
  }
  void bg;
}

describe.skipIf(!hasRealSnarks())('real zkSNARKs, as visitors upload them', { timeout: 120_000 }, () => {
  it('26×26 PNG on its own background', () => { for (const id of SAMPLE) expectSame(detectSnark(realSnark(id)), realSnark(id)); });
  it('upscaled ×20 PNG', () => { for (const id of SAMPLE.slice(0, 40)) expectSame(detectSnark(upscale(realSnark(id), 20)), realSnark(id)); });
  it('transparent background PNG', () => { for (const id of SAMPLE) expectSame(detectSnark(upscale(realSnark(id, null), 8)), realSnark(id, null)); });
  // (no JPEG or screenshot tests: the site only takes a number, read exactly from the sheet)
  it('builds solid in both sizes', () => {
    for (const id of SAMPLE.slice(0, 30)) for (const size of ['mini', 'xl'] as const) {
      const m = buildModel(detectSnark(realSnark(id)), size);
      expect(m.checks.floating, `#${id} ${size}`).toBe(0);
      expect(m.checks.collisions, `#${id} ${size}`).toBe(0);
      expect(m.checks.com.inside, `#${id} ${size}`).toBe(true);
    }
  });
});
