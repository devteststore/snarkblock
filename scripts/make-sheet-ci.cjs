// Runs scripts/make-sheet.browser.js in a real Chrome on zilkroad.com (where the art is
// served) and saves public/snarks.png + public/snarks.json. Used by the make-sheet workflow.
//   xvfb-run -a node scripts/make-sheet-ci.cjs
const { chromium } = require('playwright-core');
const fs = require('fs');
const exe = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(p => p && fs.existsSync(p));
const SITE = process.env.SITE || 'https://zilkroad.com/';
(async () => {
  const b = await chromium.launch({ executablePath: exe, headless: !process.env.DISPLAY, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({
    acceptDownloads: true, viewport: { width: 1280, height: 900 }, locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  const p = await ctx.newPage();
  p.on('console', m => { const t = m.text(); if (!/^Failed to load resource/.test(t)) console.log('[page]', t); });
  const home = await p.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`${SITE}: HTTP ${home.status()} · "${await p.title()}"`);
  await p.waitForTimeout(5000);   // let any browser check finish
  const probe = await p.evaluate(async () => {
    const r = await fetch('/api/art/1', { credentials: 'include' });
    const b = await r.blob();
    let size = '';
    try { const bmp = await createImageBitmap(b); size = `${bmp.width}×${bmp.height}`; } catch { size = 'not an image'; }
    return `/api/art/1: HTTP ${r.status} · ${b.type} · ${b.size} bytes · ${size}`;
  });
  console.log(probe);
  if (!/HTTP 200/.test(probe) || /not an image/.test(probe)) { console.error('zilkroad.com did not serve the art to this browser: stopping'); await b.close(); process.exit(1); }

  const got = {};
  p.on('download', async d => { const f = `public/${d.suggestedFilename()}`; await d.saveAs(f); got[d.suggestedFilename()] = f; });
  await p.evaluate(fs.readFileSync('scripts/make-sheet.browser.js', 'utf8'));
  const t = Date.now();
  while (!(got['snarks.png'] && got['snarks.json']) && Date.now() - t < 50 * 60000) await p.waitForTimeout(2000);
  await p.waitForTimeout(2000);
  await b.close();
  if (!fs.existsSync('public/snarks.png') || !fs.existsSync('public/snarks.json')) { console.error('sheet not produced'); process.exit(1); }
  const meta = JSON.parse(fs.readFileSync('public/snarks.json', 'utf8'));
  console.log(`sheet: ${fs.statSync('public/snarks.png').size} bytes · ${meta.last - meta.first + 1 - meta.missing.length} zkSNARKs · missing ${meta.missing.length}${meta.missing.length ? ': ' + meta.missing.slice(0, 30).join(', ') : ''}`);
  // a sheet with most of the collection missing is not worth committing
  if (meta.missing.length > 500) { console.error('too many missing: not committing'); process.exit(1); }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
