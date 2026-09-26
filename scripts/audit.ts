// Audit one finished model the way a buyer relies on it: the parts lists and
// order files must match the instructions piece for piece, and the bust must
// show every pixel of the art in its colour.
import { analyze } from '../src/core/analyze';
import { SIZES_SPEC, type Model, type SizeId } from '../src/core/build';
import type { SnarkGrid } from '../src/core/detect';
import { N } from '../src/core/grid';
import { elementId } from '../src/core/lego';
import { COLOR_BY_ID, TRANS_CLEAR } from '../src/core/palette';
import { partId } from '../src/core/parts';
import { brickLinkRemainderXML, orderSummary, PAB_MAX_LINES, PAB_MAX_QTY, pickABrickFiles } from '../src/export/order';
import { brickLinkXML, partsCSV } from '../src/export/parts';

const xmlItems = (x: string) => [...x.matchAll(/<ITEM><ITEMTYPE>P<\/ITEMTYPE><ITEMID>(\w+)<\/ITEMID><COLOR>(\d+)<\/COLOR><MINQTY>(\d+)<\/MINQTY><CONDITION>X<\/CONDITION><\/ITEM>/g)]
  .map(m => ({ part: m[1], color: +m[2], qty: +m[3] }));

/** Problems with the parts list and order files (empty = all correct). */
export function auditLists(m: Model): string[] {
  const bad: string[] = [], n = m.pieces.length;
  if (m.checks.pieces !== n) bad.push(`piece count ${m.checks.pieces} ≠ ${n} pieces`);
  // every piece is a real part in a real colour, in exactly one step
  const byLot = new Map<string, number>();
  m.pieces.forEach((p, i) => {
    let id = '';
    try { id = partId(p.kind, p.w, p.d); } catch { bad.push(`piece ${i}: no part for ${p.kind} ${p.w}x${p.d}`); }
    if (id && id !== p.part) bad.push(`piece ${i}: part ${p.part} ≠ ${id}`);
    if (!COLOR_BY_ID.has(p.c)) bad.push(`piece ${i}: unknown colour ${p.c}`);
    else if (COLOR_BY_ID.get(p.c)!.trans && p.c !== TRANS_CLEAR) bad.push(`piece ${i}: transparent colour from the art (${COLOR_BY_ID.get(p.c)!.name}); only supports may be clear`);
    byLot.set(`${p.part}|${p.c}`, (byLot.get(`${p.part}|${p.c}`) ?? 0) + 1);
  });
  const inSteps = m.steps.flat().sort((a, b) => a - b);
  if (inSteps.length !== n || inSteps.some((v, i) => v !== i)) bad.push('pieces not in exactly one step each');
  // parts list = pieces, lot by lot
  const bomSeen = new Set<string>();
  for (const b of m.bom) {
    const k = `${b.part}|${b.color}`;
    if (bomSeen.has(k)) bad.push(`lot ${k} listed twice`);
    bomSeen.add(k);
    if (byLot.get(k) !== b.qty) bad.push(`lot ${k}: list says ${b.qty}, instructions use ${byLot.get(k) ?? 0}`);
    if (COLOR_BY_ID.get(b.color)?.name !== b.colorName) bad.push(`lot ${k}: colour name ${b.colorName}`);
  }
  for (const k of byLot.keys()) if (!bomSeen.has(k)) bad.push(`lot ${k} used but not listed`);
  // CSV parts list
  const csvLots = partsCSV(m).trim().split('\n').slice(1).filter(l => /^\d+,\d/.test(l));
  if (csvLots.length !== m.bom.length) bad.push(`CSV has ${csvLots.length} lots, list ${m.bom.length}`);
  if (csvLots.reduce((a, l) => a + +l.split(',')[0], 0) !== n) bad.push('CSV quantities ≠ pieces');
  // BrickLink wanted list: every lot, every piece
  const xml = xmlItems(brickLinkXML(m));
  if (xml.length !== m.bom.length) bad.push(`BrickLink list has ${xml.length} lots, list ${m.bom.length}`);
  for (const it of xml) if (byLot.get(`${it.part}|${it.color}`) !== it.qty) bad.push(`BrickLink ${it.part}|${it.color}: ${it.qty}`);
  // LEGO Pick a Brick files: only parts LEGO sells, right quantities, within LEGO's limits
  const s = orderSummary(m);
  if (s.legoPieces + s.brickLinkOnlyPieces !== n) bad.push('LEGO + BrickLink-only pieces ≠ pieces');
  const want = new Map(s.lego.map(l => [l.elementId, l.qty]));
  const got = new Map<string, number>();
  for (const f of pickABrickFiles(m)) {
    const rows = f.split('\r\n');
    if (rows[0] !== 'elementId,quantity') bad.push('Pick a Brick file header');
    if (rows.length - 1 > PAB_MAX_LINES) bad.push('Pick a Brick file over 400 lines');
    for (const r of rows.slice(1)) {
      const [id, q] = r.split(',');
      if (+q > PAB_MAX_QTY || +q < 1) bad.push(`Pick a Brick ${id}: quantity ${q}`);
      got.set(id, (got.get(id) ?? 0) + +q);
    }
  }
  for (const [id, q] of want) if (got.get(id) !== q) bad.push(`Pick a Brick element ${id}: file ${got.get(id) ?? 0}, needed ${q}`);
  for (const id of got.keys()) if (!want.has(id)) bad.push(`Pick a Brick element ${id} not needed`);
  for (const l of s.lego) if (elementId(l.part, l.color) !== l.elementId) bad.push(`element ID for ${l.part}|${l.color}`);
  // BrickLink list of what LEGO doesn't sell
  const rest = xmlItems(brickLinkRemainderXML(m));
  if (rest.reduce((a, it) => a + it.qty, 0) !== s.brickLinkOnlyPieces) bad.push('BrickLink remainder ≠ BrickLink-only pieces');
  return bad;
}

/**
 * Pixels whose colour doesn't show on the front of their row: for each art pixel,
 * at least one plate level of its row must show, front-most, a brick in the colour
 * that pixel was matched to. (Clear supports and the base are looked past: the base
 * stands in front of the bottom row, and the rounded top sets the top pixels back.)
 */
export function auditLikeness(g: SnarkGrid, m: Model, size: SizeId, onlyLego = false): string[] {
  const S = SIZES_SPEC[size], sx = S.sx;
  const brickOf = analyze(g, S.hold ?? 'path', onlyLego).brickOf;
  const rows = [...Array(N).keys()].filter(r => g.cells[r].some(v => v >= 0));
  const rBot = rows[rows.length - 1], rTop = rows[0];
  const band = new Map<number, [number, number]>();
  let y = 0;
  for (let r = rBot; r >= rTop; r--) {
    const own = S.rowLayersAlt && (rBot - r) % 2 === 1 ? S.rowLayersAlt : S.rowLayers;
    const h = own.reduce((a, l) => a + l.h, 0);
    band.set(r, [y, y + h]); y += h;
  }
  const front = new Map<string, { z: number; c: number }>();
  for (const p of m.pieces) {
    if (p.group === 'base' || p.c === TRANS_CLEAR || COLOR_BY_ID.get(p.c)?.trans) continue;
    for (let i = 0; i < p.w; i++) for (let yy = p.y; yy < p.y + p.h; yy++) {
      const k = `${p.x + i},${yy}`, f = front.get(k);
      if (!f || p.z < f.z) front.set(k, { z: p.z, c: p.c });
    }
  }
  const bad: string[] = [];
  for (const r of rows) {
    const [y0, y1] = band.get(r)!;
    for (let c = 0; c < N; c++) {
      const v = g.cells[r][c];
      if (v < 0) continue;
      const want = brickOf[v];
      for (let i = 0; i < sx; i++) {
        let shows = false, any = false;
        for (let yy = y0; yy < y1; yy++) { const f = front.get(`${c * sx + i},${yy}`); if (f) { any = true; if (f.c === want) shows = true; } }
        if (!shows) { bad.push(`${any ? 'wrong colour' : 'missing'} at pixel (${r},${c}), should be ${COLOR_BY_ID.get(want)!.name}`); break; }
      }
    }
  }
  return bad;
}
