// The order files the site must produce for zkSNARK numbers, built here in Node
// straight from the sheet, for scripts/e2e-downloads.cjs to compare downloads with.
//   npx tsx scripts/expected-files.ts 62,9421 > out/expected.json
import { buildModel } from '../src/core/build';
import { detectSnark } from '../src/core/detect';
import { brickLinkRemainderXML, pickABrickFiles } from '../src/export/order';
import { brickLinkXML, partsCSV } from '../src/export/parts';
import { realSnark } from './real';

const ids = (process.argv[2] ?? '62').split(',').map(Number);
const out: Record<string, unknown> = {};
for (const id of ids) {
  const g = detectSnark(realSnark(id), { known: true });
  for (const size of ['xl', 'mini'] as const) {
    const m = buildModel(g, size);
    out[`${id}|${size}`] = { pieces: m.checks.pieces, lots: m.bom.length, csv: partsCSV(m), xml: brickLinkXML(m), xmlRest: brickLinkRemainderXML(m), pab: pickABrickFiles(m) };
  }
}
process.stdout.write(JSON.stringify(out));
