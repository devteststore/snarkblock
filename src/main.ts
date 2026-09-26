import type { Model, SizeId } from './core/build';
import { rgbToHex } from './core/color';
import type { SnarkGrid, RGBAImage } from './core/detect';
import { Viewer } from './viewer/scene';
import { brickLinkXML, partsCSV } from './export/parts';
import { brickLinkRemainderXML, orderSummary, pickABrickFiles } from './export/order';
import { icon } from './export/pdf';
import { renderHex } from './core/palette';
import { FIRST_ID, LAST_ID, N } from './core/grid';
import { cutSnark, type SheetMeta } from './core/sheet';
import type { BuildReply, BuildRequest } from './worker/build.worker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const worker = new Worker(new URL('./worker/build.worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map<number, (r: BuildReply) => void>();
worker.onmessage = (e: MessageEvent<BuildReply>) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
const build = (req: Omit<BuildRequest, 'id'>) => new Promise<BuildReply>(res => { const id = nextId++; pending.set(id, res); worker.postMessage({ ...req, id }); });

const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const viewer = new Viewer($('view'), { lowPoly: isPhone, label: '' });
viewer.onFinished = () => { $('hint').hidden = false; };

let grid: SnarkGrid | null = null;
/** the zkSNARK number the shown model was built from (labels, file names, nameplate) */
let loadedId: number | null = null;
/** each load gets a number; an older load that finishes late is dropped */
let loadSeq = 0;
let size: SizeId = 'xl';
// one model per size and "prefer LEGO parts" choice
const models = new Map<string, Model>();
let preferLego = false;
const mkey = (s: SizeId) => `${s}|${preferLego}`;

// ---------- input ----------
/** Decode any image blob. SVG (which createImageBitmap can't read everywhere) goes through an <img>. */
async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  const svg = blob.type.includes('svg');
  if (!svg) try { return await createImageBitmap(blob); } catch { /* try an <img> below */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // pixel-art SVGs often have no size of their own: draw them big, the grid reader samples cell centres
    if (svg || !img.naturalWidth) { img.width = img.height = N * 20; }
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
async function fileToImage(blob: Blob): Promise<RGBAImage> {
  const src = await decode(blob);
  const bmp = { width: src instanceof HTMLImageElement ? src.width || src.naturalWidth : src.width, height: src instanceof HTMLImageElement ? src.height || src.naturalHeight : src.height };
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingEnabled = false;
  x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}
/**
 * All 10,000 zkSNARKs in one image, served by this site (public/snarks.png +
 * public/snarks.json, made by scripts/make-sheet.browser.js). Loaded once, the
 * first time it is needed; zkSNARK #n is then cut out in the browser.
 */
let sheet: Promise<{ img: RGBAImage; meta: SheetMeta }> | null = null;
function loadSheet() {
  sheet ??= Promise.all([
    fetch('./snarks.json').then(r => { if (!r.ok) throw new Error('no sheet'); return r.json() as Promise<SheetMeta>; }),
    fetch('./snarks.png').then(r => { if (!r.ok) throw new Error('no sheet'); return r.blob(); })
      .then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(bmp => { const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); return { width: d.width, height: d.height, data: d.data }; }),
  ]).then(([meta, img]) => ({ img, meta })).catch(e => { sheet = null; throw e; });
  return sheet;
}
async function snarkByNumber(n: number): Promise<RGBAImage> {
  const { img, meta } = await loadSheet();
  const tile = cutSnark(img, meta, n);
  if (!tile) throw new Error('missing');
  return tile;
}
async function loadNumber(n: number) {
  const my = ++loadSeq;
  showError(null); $('result').hidden = false; busy(`Finding zkSNARK #${n}…`);
  let img: RGBAImage;
  try { img = await snarkByNumber(n); } catch (e) {
    if (my !== loadSeq) return;
    busy(null); $('result').hidden = !grid;
    showError((e as Error).message === 'missing'
      ? `zkSNARK #${n} isn’t in our copy of the collection.`
      : 'We couldn’t load the zkSNARKs. Check your connection and try again.');
    return;
  }
  if (my !== loadSeq) return;
  await start(img, true, n, my);
}
$('by-number').addEventListener('submit', async e => {
  e.preventDefault();
  const raw = $<HTMLInputElement>('snark-number').value.trim();
  if (!/^\d{1,5}$/.test(raw) || +raw < FIRST_ID || +raw > LAST_ID) { showError(`Type a zkSNARK number from ${FIRST_ID} to ${LAST_ID.toLocaleString('en')}.`); return; }
  await loadNumber(+raw);
});

/** An example zkSNARK, cut from the sheet like a typed number. */
const exampleImage = (n: number): Promise<RGBAImage> => snarkByNumber(n);

/** `known`: the image came from our copy of the official art, so it is a zkSNARK for sure. */
async function start(image: RGBAImage, known: boolean, id: number, my: number) {
  showError(null);
  $('result').hidden = false;
  $('sec-bust').scrollIntoView({ behavior: 'smooth', block: 'start' });
  busy('Reading your zkSNARK…');
  const s = size, pl = preferLego;
  const r = await build({ size: s, image, preferLego: pl, known });
  if (my !== loadSeq) return;   // a newer number was asked for meanwhile
  if (!r.ok) { busy(null); $('result').hidden = !grid; showError(r.message); return; }
  // grid, number and models change together, in one step
  grid = r.grid;
  loadedId = id;
  models.clear();
  models.set(`${s}|${pl}`, r.model);
  drawGrid(r.grid);
  if (s === size && pl === preferLego) show(r.model, r.ms); else setSize(size);   // size or option changed while building
}

async function setSize(s: SizeId) {
  size = s;
  document.querySelectorAll<HTMLButtonElement>('.size').forEach(b => b.setAttribute('aria-checked', String(b.dataset.size === s)));
  if (!grid) return;
  const g = grid, pl = preferLego, k = `${s}|${pl}`;
  const have = models.get(k);
  if (!have) {
    busy(`Building the ${s === 'xl' ? 'XL' : 'Mini'} model${pl ? ' with parts LEGO sells' : ''}…`);
    const r = await build({ size: s, grid: g, preferLego: pl });
    if (grid !== g) return;   // another number was loaded meanwhile
    if (!r.ok) { busy(null); showError(r.message); return; }
    models.set(k, r.model);
    if (s === size && pl === preferLego) show(r.model, r.ms);   // still what is asked for
  } else show(have, 0);
}

function show(m: Model, ms: number) {
  busy(null);
  $('hint').hidden = true;
  $('snarkno').textContent = plateLabel();
  viewer.setLabel(plateLabel());
  viewer.setModel(m);
  viewer.play();
  renderChecks(m, ms);
  renderBustSub();
  $('secnav').hidden = false;
  renderBuy(m);
  renderReader(m);
}

// ---------- panels ----------
function busy(text: string | null) {
  $('busy').hidden = text === null;
  if (text) $('busy-text').textContent = text;
}
function showError(msg: string | null) {
  const e = $('error'); e.hidden = !msg; e.textContent = msg ?? '';
}
function drawGrid(g: SnarkGrid) {
  const c = $<HTMLCanvasElement>('grid'), x = c.getContext('2d')!, k = c.width / N;
  x.fillStyle = g.background ? rgbToHex(g.background) : '#638596'; x.fillRect(0, 0, c.width, c.height);
  g.cells.forEach((row, r) => row.forEach((v, col) => { if (v >= 0) { x.fillStyle = rgbToHex(g.colors[v].rgb); x.fillRect(col * k, r * k, k, k); } }));
  $('read-text').textContent = `${N} × ${N} pixels, ${g.colors.length} colours`;
}
function renderChecks(m: Model, ms: number) {
  const c = m.checks;
  const li = (cls: string, big: string, small: string) => `<li class="${cls}"><b>${big}</b>${small}</li>`;
  $('checks').innerHTML = [
    li('ok', `${c.connections.toLocaleString('en')} studs`, 'connected between pieces'),
    c.collisions === 0 ? li('ok', '0 collisions', 'no two pieces overlap') : li('bad', `${c.collisions} collisions`, 'some pieces overlap: this model can’t be built as is'),
    c.floating === 0 ? li('ok', '0 floating', 'every piece is attached to the base') : li('bad', `${c.floating} floating`, 'pieces not attached to the base: this model can’t be built as is'),
    c.com.inside ? li('ok', 'Balanced', `centre of mass ${c.com.margin} studs inside the base`) : li('bad', 'Will tip over', 'the centre of mass is outside the base'),
    c.weak === 0 ? li('ok', '0 weak joints', 'no piece hangs on a single stud') : li('warn', `${c.weak} weak joint${c.weak > 1 ? 's' : ''}`, 'held by a single stud: fine for display, handle gently'),
  ].join('');
  $('notes').innerHTML = [...m.notes, `Computed in your browser${ms ? ` in ${(ms / 1000).toFixed(1)} s` : ''}. Computer-checked, not physically build-tested.`].map(n => `<li>${n}</li>`).join('');
  // the key figures, big; the rest folds under "More info"
  const stat = (v: string, l: string) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $('stats').innerHTML = stat(c.pieces.toLocaleString('en'), 'pieces') + stat(String(m.steps.length), 'steps')
    + stat(String(m.bom.length), 'lots to buy') + stat(`${m.dims[0]}×${m.dims[1]}×${m.dims[2]}`, 'cm');
  const solid = c.floating === 0 && c.collisions === 0 && c.com.inside;
  const pill = $('pill');
  pill.className = solid ? 'pill' : 'pill bad';
  pill.textContent = solid ? '✓ Checked: solid' : '✗ Check failed';
  $('status-short').textContent = `${c.floating} floating · ${c.collisions} collisions · ${c.com.inside ? 'balanced' : 'will tip over'}`;
}

// ---------- wiring ----------
document.querySelectorAll<HTMLButtonElement>('.size').forEach(b => b.addEventListener('click', () => setSize(b.dataset.size as SizeId)));
$('replay').addEventListener('click', () => { $('hint').hidden = true; viewer.play(); });
$('skip').addEventListener('click', () => viewer.skip());
export const plateLabel = () => (loadedId === null ? '' : `#${loadedId}`);

// ---------- exports ----------
const current = () => models.get(mkey(size)) ?? null;
const baseName = () => `${loadedId === null ? 'my-zksnark' : `zksnark-${loadedId}`}-${size}`;
/**
 * Everything a download needs, taken once when it is clicked: the model on screen,
 * the grid it was built from, its number and file name. Loading another number
 * while a file is being made can't change what goes into it or how it is named.
 */
function snapshot() {
  const m = current();
  return m && grid ? { m, grid, label: plateLabel(), name: baseName() } : null;
}
function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
function progress(text: string | null, f = 0) {
  $('progress').hidden = text === null;
  if (text !== null) { $('progress-text').textContent = text; $('bar').style.width = `${Math.round(f * 100)}%`; }
}
let exporting = false;
const busyButtons = () => document.querySelectorAll<HTMLButtonElement>('.act, .vid-btn, .ctab');
async function run(label: string, job: () => Promise<void>) {
  if (exporting || !current()) return;
  exporting = true;
  busyButtons().forEach(b => { b.disabled = true; });
  try { await job(); progress(null); }
  catch (e) { progress(`${label} failed: ${(e as Error).message}`, 0); setTimeout(() => progress(null), 6000); }
  finally { exporting = false; busyButtons().forEach(b => { b.disabled = false; }); }
}

// ---------- ② instructions reader: pages are drawn only when looked at ----------
type Maker = import('./export/pdf').PageMaker;
let maker: Maker | null = null, makerFor: Model | null = null, pageNo = 1;
let thumbObserver: IntersectionObserver | null = null;
async function renderReader(m: Model) {
  const { PageMaker } = await import('./export/pdf');
  if (current() !== m) return;
  maker?.dispose();
  maker = new PageMaker(m, grid!, { label: plateLabel(), renderSize: isPhone ? 800 : 1000 });
  makerFor = m;
  const range = $<HTMLInputElement>('pg-range');
  range.max = String(maker.total);
  $('manual-sub').textContent = `${m.steps.length} steps · ${maker.total} pages · one page per layer`;
  $('pdf-note').textContent = `PDF · ${maker.total} pages`;
  // thumbnails: placeholders now, drawn when they scroll into view
  thumbObserver?.disconnect();
  const strip = $('thumbs'); strip.innerHTML = '';
  const queue: number[] = [];
  let drawing = false;
  const drain = () => {
    if (drawing || !queue.length || !maker) return;
    drawing = true;
    const n = queue.shift()!, c = strip.querySelector<HTMLCanvasElement>(`[data-n="${n}"] canvas`);
    setTimeout(() => {
      if (c && maker && makerFor === m) c.getContext('2d')!.drawImage(maker.page(n), 0, 0, c.width, c.height);
      drawing = false; drain();
    }, 0);
  };
  thumbObserver = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const n = +(e.target as HTMLElement).dataset.n!;
    thumbObserver!.unobserve(e.target); queue.push(n); drain();
  }), { root: strip, rootMargin: '0px 240px' });
  for (let n = 1; n <= maker.total; n++) {
    const b = document.createElement('button');
    b.dataset.n = String(n);
    const c = document.createElement('canvas'); c.width = 224; c.height = 158;
    b.append(c, maker.label(n));
    b.addEventListener('click', () => showPage(n));
    strip.append(b); thumbObserver.observe(b);
  }
  showPage(1);
}
function showPage(n: number) {
  if (!maker) return;
  pageNo = Math.max(1, Math.min(maker.total, n));
  const c = $<HTMLCanvasElement>('page-canvas');
  c.getContext('2d')!.drawImage(maker.page(pageNo), 0, 0, c.width, c.height);
  $<HTMLInputElement>('pg-range').value = String(pageNo);
  $('pg-label').textContent = `${maker.label(pageNo)}${pageNo > 1 && pageNo <= maker.steps + 1 ? ` of ${maker.steps}` : ''}`;
  $<HTMLButtonElement>('pg-prev').disabled = pageNo === 1;
  $<HTMLButtonElement>('pg-next').disabled = pageNo === maker.total;
  const strip = $('thumbs');
  strip.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n! === pageNo));
  const on = strip.querySelector<HTMLElement>(`[data-n="${pageNo}"]`);
  if (on) strip.scrollTo({ left: on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2, behavior: 'smooth' });
}
$('pg-prev').addEventListener('click', () => showPage(pageNo - 1));
$('pg-next').addEventListener('click', () => showPage(pageNo + 1));
$('pg-range').addEventListener('input', e => showPage(+(e.target as HTMLInputElement).value));
$('page-view').tabIndex = 0;
$('page-view').addEventListener('keydown', e => { if (e.key === 'ArrowRight') showPage(pageNo + 1); if (e.key === 'ArrowLeft') showPage(pageNo - 1); });
{ // swipe on phones
  let x0: number | null = null;
  $('page-view').addEventListener('pointerdown', e => { x0 = e.clientX; });
  $('page-view').addEventListener('pointerup', e => { if (x0 !== null && Math.abs(e.clientX - x0) > 40) showPage(pageNo + (e.clientX < x0 ? 1 : -1)); x0 = null; });
}
$('dl-pdf').addEventListener('click', () => { const snap = snapshot(); if (snap) run('Instructions', async () => {
  const { makeInstructions } = await import('./export/pdf');
  progress('Drawing the instructions…', 0);
  const pdf = await makeInstructions(snap.m, snap.grid, { label: snap.label, renderSize: isPhone ? 800 : 1100, onProgress: (d, t) => progress(`Drawing page ${d} of ${t}…`, d / t) });
  save(pdf, `${snap.name}-instructions.pdf`);
}); });
$('dl-kit').addEventListener('click', () => { const snap = snapshot(); if (snap) run('Kit', async () => {
  const [{ makeInstructions }, { makeZip }] = await Promise.all([import('./export/pdf'), import('./export/zip')]);
  const { m, name } = snap;
  progress('Drawing the instructions…', 0);
  const pdf = await makeInstructions(m, snap.grid, { label: snap.label, renderSize: isPhone ? 800 : 1100, onProgress: (d, t) => progress(`Drawing page ${d} of ${t}…`, d / t) });
  const readme = [`${name} — made with Snark to Bricks`, '', `${m.checks.pieces} pieces · ${m.steps.length} steps · ${m.bom.length} lots · about ${m.dims.join(' × ')} cm`, '',
    `${name}-instructions.pdf   step-by-step instructions, one page per layer`, `${name}-parts.csv   parts list (BrickLink part and colour numbers)`, '',
    'To order the bricks, use "Buy the bricks" on the site: it makes your LEGO Pick a Brick and BrickLink lists.', '',
    'Models are generated automatically and checked by software only. They have NOT been physically built. Provided "as is", without warranty of any kind.',
    'Unofficial fan project · Not affiliated with, sponsored or endorsed by the LEGO Group, BrickLink or the zkSNARKs project. LEGO® is a trademark of the LEGO Group. Parts data: Rebrickable.', ''].join('\r\n');
  save(await makeZip([{ name: `${name}-instructions.pdf`, data: pdf }, { name: `${name}-parts.csv`, data: partsCSV(m) }, { name: 'README.txt', data: readme }]), `${name}-kit.zip`);
}); });
for (const format of ['square', 'story'] as const) $(format === 'square' ? 'vid-square' : 'vid-story').addEventListener('click', () => { const snap = snapshot(); if (snap) run('Video', async () => {
  const { recordVideo } = await import('./export/video');
  progress('Preparing the booklet pages…', 0);
  const { blob, ext } = await recordVideo(snap.m, snap.grid, { format, label: snap.label, small: isPhone,
    onProgress: (stage, f) => progress(stage === 'pages' ? 'Preparing the booklet pages…' : 'Recording the video (24 s)… keep this tab open', f) });
  save(blob, `${snap.name}-${format === 'story' ? '9x16' : 'square'}.${ext}`);
}); });

// ---------- ③ buy the bricks ----------
function renderBuy(m: Model) {
  const s = orderSummary(m), total = m.bom.length, pcs = m.checks.pieces.toLocaleString('en');
  const legoSet = new Set(s.lego.map(l => `${l.part}|${l.color}`));
  $('shop-sum').textContent = `${total} lots · ${pcs} pieces · BrickLink part numbers`;
  const g = $('shop-grid'); g.innerHTML = '';
  for (const b of m.bom) {
    const lot = document.createElement('div'); lot.className = 'lot';
    const at = legoSet.has(`${b.part}|${b.color}`);
    lot.title = `${b.qty}× ${b.name}, ${b.colorName} (${b.part}) · ${at ? 'at LEGO Pick a Brick' : 'BrickLink only'}`;
    const c = document.createElement('canvas'); c.width = 112; c.height = 88;
    icon(c.getContext('2d')!, 56, 44, b.d, b.w, renderHex(b.color), 96, b.kind);
    const dot = document.createElement('i'); dot.className = `dot ${at ? 'lego' : 'bl'}`;
    const t = document.createElement('span');
    t.innerHTML = `<span class="q">${b.qty}x</span><small>${b.name}</small><small>${b.colorName}</small>`;
    lot.append(dot, c, t); g.append(lot);
  }
  const more = $('shop-more');
  more.hidden = total <= 8;
  $('shoplist').classList.toggle('open', false);
  more.textContent = `See all ${total} lots ▾`;
  // LEGO button
  $('lego-n').textContent = String(s.lego.length);
  $('lego-total').textContent = `/${total} lots`;
  $<HTMLButtonElement>('buy-lego').disabled = s.lego.length === 0;
  $('lego-guide').hidden = true;
  const other = models.get(`${size}|${!preferLego}`);
  const delta = other ? (preferLego ? m.checks.pieces - other.checks.pieces : other.checks.pieces - m.checks.pieces) : null;
  const plus = delta === null ? '' : ` (${delta >= 0 ? '+' : ''}${delta} pieces)`;
  $('lego-option').hidden = !preferLego && s.brickLinkOnly.length === 0;
  $('prefer-text').textContent = preferLego
    ? `Only parts LEGO sells: on${plus}, every check passed again`
    : `Get all ${total} lots at LEGO: use only parts LEGO sells${plus}`;
  $<HTMLInputElement>('prefer-lego').checked = preferLego;
  // BrickLink button: the missing lots, or everything if LEGO has it all
  const missing = s.brickLinkOnly.length;
  $('bl-n').textContent = String(missing || total);
  $('bl-total').textContent = `/${total} lots`;
  $('bl-sub').textContent = missing ? 'Independent shops · the rest' : 'Independent shops · if LEGO runs out';
  $('bl-after').hidden = true;
  $('bl-option').hidden = missing === 0;
  $('copy-all').textContent = `copy all ${total} lots`;
  const files = pickABrickFiles(m).length;
  $('pab-files').textContent = files > 1 ? `${files} files, 400 references each at most` : 'one CSV file';
  $('dl-xml-rest').hidden = missing === 0;
  // how many extra pieces "only parts LEGO sells" would cost: build it in the background
  if (!preferLego && missing && !other && grid) {
    const g0 = grid, s0 = size;
    build({ size: s0, grid: g0, preferLego: true }).then(r => { if (r.ok && grid === g0) { models.set(`${s0}|true`, r.model); if (current() === m) renderBuy(m); } });
  }
}
$('shop-more').addEventListener('click', () => {
  const open = $('shoplist').classList.toggle('open');
  $('shop-more').textContent = open ? 'Show less ▴' : `See all ${current()?.bom.length ?? ''} lots ▾`;
});
/** The "Before you order" notice, once per visit, before the first order file. */
let understood = false;
function beforeOrder(): Promise<boolean> {
  if (understood) return Promise.resolve(true);
  const d = $<HTMLDialogElement>('before-order'), ok = $<HTMLInputElement>('bo-ok'), go = $<HTMLButtonElement>('bo-continue');
  ok.checked = false; go.disabled = true;
  ok.onchange = () => { go.disabled = !ok.checked; };
  d.showModal();
  return new Promise(res => { d.onclose = () => { understood = d.returnValue === 'ok' && ok.checked; res(understood); }; });
}
/** Order files for the model on screen when clicked (the notice may stay open while another number loads). */
async function orderAction(make: (m: Model, name: string) => void | Promise<void>) {
  const snap = snapshot();
  if (snap && await beforeOrder()) await make(snap.m, snap.name);
}
const downloadLego = (m: Model, name: string) => {
  const files = pickABrickFiles(m);
  files.forEach((f, i) => setTimeout(() => save(new Blob([f], { type: 'text/csv' }), `${name}-pick-a-brick${files.length > 1 ? `-${i + 1}-of-${files.length}` : ''}.csv`), i * 400));
  return files.length;
};
async function copyOrSave(xml: string, file: string): Promise<'copied' | 'downloaded'> {
  try { await navigator.clipboard.writeText(xml); return 'copied'; }
  catch { save(new Blob([xml], { type: 'application/xml' }), file); return 'downloaded'; }
}
$('buy-lego').addEventListener('click', () => orderAction((m, name) => {
  const n = downloadLego(m, name);
  $('lego-file').textContent = n > 1
    ? `${n} files saved to your Downloads (${name}-pick-a-brick-1-of-${n}.csv …): upload them one after the other`
    : `${name}-pick-a-brick.csv · saved to your Downloads`;
  const g = $('lego-guide'); g.hidden = false;
  g.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}));
$('lego-again').addEventListener('click', () => orderAction((m, name) => { downloadLego(m, name); }));
async function buyBrickLink(all: boolean) {
  await orderAction(async (m, name) => {
    const missing = orderSummary(m).brickLinkOnly.length;
    const everything = all || missing === 0;
    const how = await copyOrSave(everything ? brickLinkXML(m) : brickLinkRemainderXML(m), `${name}-bricklink${everything ? '' : '-missing'}.xml`);
    const lots = everything ? m.bom.length : missing;
    $('bl-after-text').textContent = how === 'copied' ? `List copied (${lots} of ${m.bom.length} lots)` : `Couldn’t copy: list downloaded instead (open it and copy its text)`;
    $('bl-after').hidden = false;
  });
}
$('buy-bl').addEventListener('click', () => buyBrickLink(false));
$('copy-all').addEventListener('click', () => buyBrickLink(true));
$('dl-pab').addEventListener('click', () => orderAction((m, name) => { downloadLego(m, name); }));
$('dl-xml').addEventListener('click', () => orderAction((m, name) => save(new Blob([brickLinkXML(m)], { type: 'application/xml' }), `${name}-bricklink.xml`)));
$('dl-xml-rest').addEventListener('click', () => orderAction((m, name) => save(new Blob([brickLinkRemainderXML(m)], { type: 'application/xml' }), `${name}-bricklink-missing.xml`)));
$('prefer-lego').addEventListener('change', e => {
  preferLego = (e.target as HTMLInputElement).checked;
  $('prefer-text').textContent = 'Rebuilding with parts LEGO sells and checking again…';
  setSize(size);
});

// ---------- sticky section menu ----------
const secLinks = [...document.querySelectorAll<HTMLAnchorElement>('#secnav a')];
const secObserver = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) secLinks.forEach(a => a.classList.toggle('on', a.dataset.sec === e.target.id));
}, { rootMargin: '-45% 0px -50% 0px' });
['sec-bust', 'sec-manual', 'sec-buy'].forEach(id => secObserver.observe($(id)));
function renderBustSub() {
  const m = current(); if (!m) return;
  $('bust-sub').textContent = `${plateLabel() ? `zkSNARK ${plateLabel()} · ` : ''}${m.size === 'xl' ? 'XL' : 'Mini'} · built and checked in your browser`;
}
function shareLink() {
  const m = current();
  const text = m
    ? `I turned my zkSNARK into a ${m.checks.pieces.toLocaleString('en')}-piece brick bust you can really build 🧱\n\nMade with Snark to Bricks, inspired by @victormustar's Microduck.`
    : 'Turn your zkSNARK into a brick bust you can really build 🧱';
  const url = location.origin + location.pathname;
  $<HTMLAnchorElement>('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
$('share-x').addEventListener('pointerdown', shareLink);
$('share-x').addEventListener('focus', shareLink);

const examples = [1, 7, 42, 100, 256, 420, 777, 1000, 1337, 2048, 3141, 4096, 5000, 6969, 8192, 9999, 10000]
  .map(id => ({ id, title: `zkSNARK #${id}` }));
const exampleButtons = examples.map(ex => {
  const b = document.createElement('button');
  b.title = ex.title; b.textContent = `#${ex.id}`; b.classList.add('no-img');
  b.addEventListener('click', () => loadNumber(ex.id));
  $('examples').append(b);
  return b;
});
// thumbnails from the sheet, once the page has settled
const drawExamples = () => loadSheet().then(({ img, meta }) => examples.forEach((ex, i) => {
  const tile = cutSnark(img, meta, ex.id);
  if (!tile) return;
  const c = document.createElement('canvas'); c.width = tile.width; c.height = tile.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tile.data), tile.width, tile.height), 0, 0);
  const im = document.createElement('img'); im.src = c.toDataURL(); im.alt = ex.title; im.width = im.height = N;
  const b = exampleButtons[i]; b.textContent = ''; b.classList.remove('no-img'); b.append(im);
}), () => { /* no sheet yet: the buttons keep their numbers */ });
if ('requestIdleCallback' in window) requestIdleCallback(drawExamples, { timeout: 3000 }); else setTimeout(drawExamples, 1500);
setSize(size);

// dev/test hook: lets scripts drive the viewer frame by frame
if (import.meta.env.DEV) {
  Promise.all([import('./core/detect'), import('./core/build')]).then(([d, b]) =>
    Object.assign(window, { ptb: { viewer, start, exampleImage, examples, setSize, build, detectSnark: d.detectSnark, buildModel: b.buildModel, fileToImage } }));
}
