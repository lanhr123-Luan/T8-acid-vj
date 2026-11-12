// Screenshot of the whole page (picture + controls) at a chosen moment of the virtual clock.
// usage: node tools/uishot.js <scene> <out.png> [seconds] [w] [h]
const { chromium } = require('playwright');
const path = require('path');
const [scene, out, secs = '5.1', W = '1280', H = '720'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'standalone.html') + '?scene=' + scene + '&res=1&seed=3');
  await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 240000 });
  await page.evaluate((s) => { T8.test.begin({}); T8.test.advance(s, 30, true); UI.setDrawer(true); document.body.classList.remove('quiet'); }, +secs);
  await page.waitForTimeout(400);
  await page.evaluate(() => { T8.test.advance(1 / 30, 30, false); });
  await page.screenshot({ path: out });
  await browser.close();
})().catch(e => { console.error(e); process.exit(3); });
