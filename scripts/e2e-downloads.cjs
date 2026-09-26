// Every download is for the number on screen, and its contents are exactly right.
// Loads zkSNARK numbers on the built site (vite preview), downloads the BrickLink list,
// the LEGO Pick a Brick file, the full kit (parts list inside) and the instructions PDF,
// and compares each with the files built independently in Node for that number
// (scripts/expected-files.ts). Also switches numbers quickly before downloading.
//   node scripts/e2e-downloads.cjs http://localhost:4173/ 62,9421,1000
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const [, , URL = 'http://localhost:4173/', idsArg = '62,9421,1000'] = process.argv;
const ids = idsArg.split(',').map(Number);
const exe = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(p => p && fs.existsSync(p));
const expected = JSON.parse(execFileSync('npx', ['tsx', 'scripts/expected-files.ts', ids.join(',')], { maxBuffer: 1 << 28 }).toString());

/** the files stored in a ZIP made by src/export/zip.ts (stored, not compressed) */
function unzip(buf) {
  const files = {};
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18), nameLen = buf.readUInt16LE(o + 26), extra = buf.readUInt16LE(o + 28);
    const name = buf.toString('utf8', o + 30, o + 30 + nameLen), start = o + 30 + nameLen + extra;
    files[name] = buf.subarray(start, start + size);
    o = start + size;
  }
  return files;
}

(async () => {
  const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
  let fail = 0;
  const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fail++; };
  const load = async id => {
    await p.fill('#snark-number', String(id));
    await p.evaluate(() => document.querySelector('.go').click());
  };
  const loaded = id => p.waitForFunction(n => document.getElementById('busy').hidden && document.getElementById('snarkno').textContent === `#${n}` && document.querySelector('#stats .stat'), id, { timeout: 180000 });
  const download = async (click, notice, timeout = 180000) => {
    const [d] = await Promise.all([p.waitForEvent('download', { timeout }), (async () => {
      await p.evaluate(sel => document.querySelector(sel).click(), click);
      if (notice && await p.isVisible('#before-order[open]').catch(() => false)) { await p.check('#bo-ok'); await p.click('#bo-continue'); }
    })()]);
    return { name: d.suggestedFilename(), data: fs.readFileSync(await d.path()) };
  };
  // quick switch: ask for the first number, then the last one straight away
  const plan = ids.map(id => ({ id }));
  if (ids.length > 1) plan.push({ id: ids[ids.length - 1], first: ids[0], quick: true });
  for (const step of plan) {
    const { id } = step;
    if (step.quick) { console.log(`#${step.first} then #${id} straight away:`); await load(step.first); await load(id); }
    else { console.log(`#${id}:`); await load(id); }
    await loaded(id);
    await p.waitForTimeout(500);
    const e = expected[`${id}|xl`];
    const shown = await p.evaluate(() => document.getElementById('shop-sum').textContent);
    check(shown.includes(`${e.lots} lots`) && shown.includes(`${e.pieces.toLocaleString('en')} pieces`), `shopping list shows ${e.lots} lots · ${e.pieces} pieces (page: "${shown}")`);
    const xml = await download('#dl-xml', true);
    check(xml.name === `zksnark-${id}-xl-bricklink.xml`, `BrickLink list file name ${xml.name}`);
    check(xml.data.toString() === e.xml, 'BrickLink list identical to the model for this number');
    const pab = await download('#dl-pab', true);
    check(pab.name.startsWith(`zksnark-${id}-xl-pick-a-brick`), `Pick a Brick file name ${pab.name}`);
    check(pab.data.toString() === e.pab[0], 'Pick a Brick file identical to the model for this number');
    // the kit draws the whole instructions booklet: slow without a graphics card, so only for the first number
    if (!step.quick && id === ids[0]) {
      const kit = await download('#dl-kit', false, 20 * 60000);
      check(kit.name === `zksnark-${id}-xl-kit.zip`, `kit file name ${kit.name}`);
      const files = unzip(kit.data);
      check(files[`zksnark-${id}-xl-parts.csv`]?.toString() === e.csv, 'parts list in the kit identical to the model for this number');
      check(!!files[`zksnark-${id}-xl-instructions.pdf`], 'instructions PDF in the kit, named for this number');
      const pdf = files[`zksnark-${id}-xl-instructions.pdf`];
      const title = `zkSNARK #${id} brick bust`, hex = Buffer.from('\ufeff' + title, 'utf16le').swap16().toString('hex').toUpperCase();
      check(!!pdf && (pdf.toString('latin1').includes(title) || pdf.toString('latin1').toUpperCase().includes(hex)), 'instructions PDF title is for this number');
    }
  }
  console.log(`errors in page: ${errs.length ? errs.join(' | ') : 'none'}`);
  console.log(fail ? `${fail} CHECK(S) FAILED` : 'all download checks passed');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
