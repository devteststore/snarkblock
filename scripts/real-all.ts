// Build every real zkSNARK in a shard, Mini and XL; write one JSON line per zkSNARK.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { buildModel } from '../src/core/build';
import { detectSnark } from '../src/core/detect';
import { realIds, realSnark } from './real';
import { COLOR_BY_ID, TRANS_CLEAR } from '../src/core/palette';
import { auditLikeness, auditLists } from './audit';
import { orderSummary } from '../src/export/order';
import { analyze } from '../src/core/analyze';
import { deltaE, hexToRgb, rgbToLab } from '../src/core/color';

const [shard, of] = [+(process.argv[2] ?? 0), +(process.argv[3] ?? 1)];
mkdirSync('out/real', { recursive: true });
const out = `out/real/shard-${shard}.jsonl`;
writeFileSync(out, '');
const ids = realIds();
for (let i = shard; i < ids.length; i += of) {
  const id = ids[i];
  const row: Record<string, unknown> = { id };
  try {
    // as a dropped file (all checks), else as loaded by number (known zkSNARK)
    let g;
    try { g = detectSnark(realSnark(id)); } catch (e) { row.dropError = (e as Error).message; g = detectSnark(realSnark(id), { known: true }); }
    row.colors = g.colors.length;
    // how far each art colour is from the brick colour it got (CIEDE2000; ~2 = barely visible, >10 = clearly different)
    const A = analyze(g);
    const dE = g.colors.map((c, i) => deltaE(rgbToLab(c.rgb), rgbToLab(hexToRgb(COLOR_BY_ID.get(A.brickOf[i])!.hex))));
    row.dEmax = Math.round(Math.max(...dE) * 10) / 10;
    row.dEavg = Math.round(dE.reduce((a, d, i) => a + d * g.colors[i].count, 0) / g.colors.reduce((a, c) => a + c.count, 0) * 10) / 10;
    for (const [label, size, preferLego] of [['mini', 'mini', false], ['xl', 'xl', false], ['mini-lego', 'mini', true], ['xl-lego', 'xl', true]] as const) {
      const t = performance.now();
      const m = buildModel(g, size, { preferLego });
      const c = m.checks;
      row[label] = { ms: Math.round(performance.now() - t), pieces: c.pieces, lots: m.bom.length, floating: c.floating, collisions: c.collisions, weak: c.weak, com: c.com.inside, margin: c.com.margin, notes: m.notes, top: m.pieces.some(p => p.group === 'top'), trans: m.pieces.filter(p => p.c !== TRANS_CLEAR && COLOR_BY_ID.get(p.c)?.trans).length, lists: auditLists(m).slice(0, 3), likeness: auditLikeness(g, m, size, preferLego).slice(0, 3), notLego: preferLego ? m.bom.filter(b => !orderSummary(m).lego.some(l => l.part === b.part && l.color === b.color)).length : 0 };
    }
  } catch (e) { row.error = (e as Error).message; }
  appendFileSync(out, JSON.stringify(row) + '\n');
}
