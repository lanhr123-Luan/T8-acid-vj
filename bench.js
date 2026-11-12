// Relative GPU cost of each scene (software renderer, so only the ratios mean anything).
const { chromium } = require('playwright');
const ROOT = require('path').resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
  const out = {};
  for (const scene of (process.argv[2] || 'stage,liquid,glass,moon').split(',')) {
    const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
    await page.goto('file://' + ROOT + '/dist/standalone.html?scene=' + scene + '&w=640&h=360&seed=3');
    await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 180000 });
    out[scene] = await page.evaluate(() => {
      T8.test.begin({}); T8.test.advance(2.4, 30, true);          // get into the music first
      const px = new Uint8Array(4);
      const t0 = performance.now(); let n = 0;
      while (n < 6) { T8.test.advance(1 / 30, 30); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); n++; }
      return +((performance.now() - t0) / n).toFixed(0);
    });
    await page.close();
  }
  console.log('ms per 640x360 frame (software renderer):', JSON.stringify(out));
  await browser.close();
})();
