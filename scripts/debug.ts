import { buildModel, type SizeId } from '../src/core/build';
import { detectSnark } from '../src/core/detect';
import { REFERENCE_SNARK, TEST_SNARKS } from '../test/fixtures/snarks';
import { snarkImage } from '../test/img';
const name = process.argv[2] ?? 'reference', size = (process.argv[3] ?? 'mini') as SizeId;
const p = [REFERENCE_SNARK, ...TEST_SNARKS].find(q => q.name === name)!;
const m = buildModel(detectSnark(snarkImage(p, 10)), size);
console.log(m.checks, m.notes);
for (const i of m.checks.floatingIds) console.log(JSON.stringify(m.pieces[i]));
