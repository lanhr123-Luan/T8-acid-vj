// Real-time screenshot of the page as a viewer would see it (no virtual clock).
// usage: node tools/liveshot.js <scene> <out.png> [res] [seconds] [w] [h]
const { chromium } = require('playwright');
const [scene, out, res = '', secs = '6', w = '1280', h = '720'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'dist', 'standalone.html') + '?scene=' + scene + (res ? '&res=' + res : ''));
  await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 240000 });
  await page.click('#btnPlay');
  await page.waitForTimeout(+secs * 1000);
  await page.screenshot({ path: out });
  console.log(JSON.stringify(await page.evaluate(() => ({ scale: App.resScale, canvas: App.canvas.width + 'x' + App.canvas.height, fps: +App.fps.toFixed(1), bar: Sig.bar, step: Sig.step, lvl: T8.test.level() }))), errs.length ? errs.join(' | ') : 'no errors');
  await browser.close();
})().catch(e => { console.error(e); process.exit(3); });
