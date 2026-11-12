// Headless render test for the NEW build: virtual clock, deterministic frames, shader errors surfaced.
// usage: node tools/shot.js <scene> <outPrefix> [w] [h] [t1,t2,...seconds] [extra query]
const { chromium } = require('playwright');
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const [scene, prefix, W = '640', H = '360', times = '2,4,8', extra = '', pre = ''] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(t)) errs.push('[' + m.type() + '] ' + t); });
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await page.goto('file://' + ROOT + '/dist/standalone.html?scene=' + scene + '&w=' + W + '&h=' + H + '&seed=3' + (extra ? '&' + extra : ''));
  await page.waitForFunction(() => window.T8 && window.T8.test && window.T8.test.ready && (window.T8.test.ready() || document.getElementById('glerr').style.display === 'block'), null, { timeout: 120000 });
  const boot = await page.evaluate(() => document.getElementById('glerr').textContent);
  if (boot) { console.log('BOOT ERROR:\n' + boot); await browser.close(); process.exit(2); }
  await page.evaluate(() => T8.test.begin({}));
  if (pre) await page.evaluate(pre);
  let last = 0; const t0 = Date.now();
  for (const ts of times.split(',').map(Number)) {
    const r = await page.evaluate(([d, sk]) => { const r = T8.test.advance(d, 30, sk); return { r, png: T8.test.snap() }; }, [ts - last, process.env.SEEK === '1']);
    last = ts;
    fs.writeFileSync(prefix + '_' + String(ts).replace('.', 'p') + '.png', Buffer.from(r.png.split(',')[1], 'base64'));
    if (r.r.errors.length) errs.push(...r.r.errors.map(e => '[gl] ' + e));
  }
  console.log(scene, 'rendered', times, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's', '| errors:', errs.length ? '\n  ' + errs.slice(0, 6).join('\n  ') : 'none');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
