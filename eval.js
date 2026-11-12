// Run a JS expression in the built page after advancing the virtual clock. usage: node tools/eval.js <scene> <seconds> "<expr>" [w] [h]
const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..');
const [scene, secs, expr, W = '320', H = '180'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: +W, height: +H } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await page.goto('file://' + ROOT + '/dist/standalone.html?scene=' + scene + '&w=' + W + '&h=' + H + '&seed=3');
  await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 120000 });
  await page.evaluate(([s]) => { T8.test.begin({}); T8.test.advance(s, 30, true); }, [+secs]);
  const out = await page.evaluate(expr);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
  await browser.close();
})();
