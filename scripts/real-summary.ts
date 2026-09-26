import { readFileSync, readdirSync } from 'node:fs';
const rows = readdirSync('out/real').filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync('out/real/' + f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
rows.sort((a, b) => a.id - b.id);
const err = rows.filter(r => r.error);
const drop = rows.filter(r => r.dropError);
console.log('read as a dropped file failed for', drop.length, 'of', rows.length, drop.slice(0, 5).map(r => `#${r.id}: ${r.dropError}`));
console.log('snarks', rows.length, 'detection/build errors', err.length, err.slice(0, 5).map(r => `#${r.id}: ${r.error}`));
{
  const d = rows.filter(r => r.dEavg !== undefined), q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const avg = d.map(r => r.dEavg).sort((a, b) => a - b), mx = d.map(r => r.dEmax).sort((a, b) => a - b);
  console.log(`colour match (art colour vs brick colour, CIEDE2000, pixel-weighted per model): median ${q(avg, .5)} · p95 ${q(avg, .95)} · worst ${avg[avg.length - 1]} | largest single-colour gap: median ${q(mx, .5)} · worst ${mx[mx.length - 1]}`);
}
for (const s of ['mini', 'xl', 'mini-lego', 'xl-lego']) {
  const ok = rows.filter(r => r[s]);
  const bad = ok.filter(r => r[s].floating || r[s].collisions || !r[s].com);
  const pcs = ok.map(r => r[s].pieces).sort((a, b) => a - b), ms = ok.map(r => r[s].ms).sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  console.log(`\n${s.toUpperCase()}: failing ${bad.length} (floating ${ok.filter(r => r[s].floating).length}, collisions ${ok.filter(r => r[s].collisions).length}, CoM out ${ok.filter(r => !r[s].com).length})`);
  console.log(`  pieces min ${pcs[0]} median ${q(pcs, .5)} p95 ${q(pcs, .95)} max ${pcs[pcs.length - 1]} · ms median ${q(ms, .5)} max ${ms[ms.length - 1]} · weak median ${q(ok.map(r => r[s].weak).sort((a, b) => a - b), .5)} max ${Math.max(...ok.map(r => r[s].weak))}`);
  const L = ok.filter(r => r[s].lists.length), K = ok.filter(r => r[s].likeness.length);
  console.log(`  parts lists / order files with any problem: ${L.length}${L.length ? ' e.g. ' + L.slice(0, 5).map(r => `#${r.id}: ${r[s].lists[0]}`).join(' | ') : ''}`);
  console.log(`  models with a pixel not showing its colour on the front: ${K.length}${K.length ? ' e.g. ' + K.slice(0, 5).map(r => `#${r.id}: ${r[s].likeness[0]}`).join(' | ') : ''}`);
  if (s.endsWith('-lego')) { const nl = ok.filter(r => r[s].notLego); console.log(`  "only parts LEGO sells" models with a lot LEGO doesn't sell: ${nl.length}`); }
  const tr = ok.filter(r => r[s].trans);
  console.log(`  transparent pieces other than the clear supports: in ${tr.length} models, ${tr.reduce((a, r) => a + r[s].trans, 0)} pieces${tr.length ? ` e.g. ${tr.slice(0, 8).map(r => `#${r.id}(${r[s].trans})`).join(' ')}` : ''}`);
  console.log('  worst:', bad.slice(0, 12).map(r => `#${r.id}(f${r[s].floating},c${r[s].collisions}${r[s].com ? '' : ',CoM'})`).join(' '));
  const notes = new Map<string, number>();
  for (const r of ok) for (const n of r[s].notes) { const k = n.replace(/\d+/g, 'N').replace(/row N/g, 'row N'); notes.set(k, (notes.get(k) ?? 0) + 1); }
  console.log('  notes:', [...notes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${v}× ${k}`).join('\n         '));
}
