// End to end in a real browser: type zkSNARK numbers on the built site (vite preview),
// wait for the bust, and report the checks, the instructions and the shopping list.
//   node scripts/e2e-number.cjs http://localhost:4173/ 1,42,777 out/e2e
const { chromium } = require('playwright-core');
const fs = require('fs');
const [, , URL = 'http://localhost:4173/', idsArg = '1,42,777,10000', outDir = 'out/e2e'] = process.argv;
const exe = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(p => p && fs.existsSync(p));
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL, { waitUntil: 'load' });
  let failed = 0;
  for (const id of idsArg.split(',').map(Number)) {
    await p.fill('#snark-number', String(id));
    await p.evaluate(() => document.querySelector('.go').click());
    const done = await p.waitForFunction(n => {
      const err = document.getElementById('error');
      if (!err.hidden && err.textContent) return 'error';
      return document.getElementById('busy').hidden && document.getElementById('snarkno').textContent === `#${n}`
        && document.querySelector('#stats .stat') && +document.getElementById('pg-range').max > 1 ? 'ok' : false;
    }, id, { timeout: 180000 }).then(h => h.jsonValue()).catch(() => 'timeout');
    if (done !== 'ok') { failed++; console.log(`#${id}: ${done.toUpperCase()} ${await p.textContent('#error')}`); continue; }
    await p.evaluate(() => document.getElementById('skip').click());
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({
      sub: document.getElementById('bust-sub').textContent,
      stats: [...document.querySelectorAll('#stats .stat')].map(s => s.innerText.replace(/\n/g, ' ')).join(' / '),
      pill: document.getElementById('pill').textContent,
      status: document.getElementById('status-short').textContent,
      read: document.getElementById('read-text').textContent,
      manual: document.getElementById('manual-sub').textContent,
      shop: document.getElementById('shop-sum').textContent,
      lego: document.getElementById('lego-n').textContent + document.getElementById('lego-total').textContent,
      notes: [...document.querySelectorAll('#notes li')].map(l => l.textContent).join(' | '),
    }));
    if (!/solid/.test(r.pill)) failed++;
    console.log(`#${id}: ${r.pill} · ${r.status} · ${r.stats} · read ${r.read} · ${r.manual} · ${r.shop} · LEGO ${r.lego}\n      ${r.notes}`);
    await p.locator('#sec-bust').screenshot({ path: `${outDir}/snark-${id}-xl.png`, timeout: 15000 }).catch(() => {});
    await p.locator('#grid').screenshot({ path: `${outDir}/snark-${id}-grid.png`, timeout: 3000 }).catch(() => {});   // inside the folded 'More info'
  }
  console.log(`errors in page: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
