// Build every test zkSNARK and print the checks.
import { buildModel, type SizeId } from '../src/core/build';
import { detectSnark } from '../src/core/detect';
import { REFERENCE_SNARK, TEST_SNARKS } from '../test/fixtures/snarks';
import { snarkImage } from '../test/img';

const sizes = (process.argv[2] ?? 'mini,xl').split(',') as SizeId[];
for (const size of sizes) {
  console.log(`\n=== ${size.toUpperCase()} ===`);
  console.log('snark'.padEnd(18), 'pieces studs  float coll weak  CoM(margin)  steps lots  ms   notes');
  for (const p of [REFERENCE_SNARK, ...TEST_SNARKS]) {
    const t = performance.now();
    const m = buildModel(detectSnark(snarkImage(p, 10)), size);
    const ms = performance.now() - t, c = m.checks;
    console.log(p.name.padEnd(18), String(c.pieces).padStart(6), String(c.connections).padStart(6), String(c.floating).padStart(5), String(c.collisions).padStart(4), String(c.weak).padStart(4),
      `${c.com.inside ? 'ok' : 'OUT'}(${c.com.margin})`.padStart(12), String(m.steps.length).padStart(6), String(m.bom.length).padStart(4), String(Math.round(ms)).padStart(5), ' ', m.notes.join(' | '));
  }
}
