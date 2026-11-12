// Exercises the frame-rate governor in real time. The software renderer used for tests is far slower
// than any real GPU, so the governor has to back off hard, and the music must keep its tempo meanwhile.
const { chromium } = require('playwright');
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'];
const PAGE = 'file://' + require('path').resolve(__dirname, '..', 'dist', 'standalone.html');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true, args: ARGS });
  let allOk = true;
  // ---- 1. a heavy scene: the resolution must come down, and the sequencer must not lose time ----
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE + '?scene=stage');
    await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 240000 });
    await page.click('#btnPlay');
    const probe = () => page.evaluate(() => ({ t: +(performance.now() / 1000).toFixed(1), scale: App.resScale, canvas: App.canvas.width + 'x' + App.canvas.height, fps: +App.fps.toFixed(1),
      ft: +App.ft.toFixed(0), timer: !!Perf.ext, ahead: +Engine.ahead.toFixed(2), count: Engine.count, at: +AE.ctx.currentTime.toFixed(2), next: +Engine.nextT.toFixed(2), bpm: ENG.bpm,
      note: document.getElementById('resNote') ? document.getElementById('resNote').textContent : '' }));
    const log = [];
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(2500); log.push(await probe()); }
    console.log(log.map(l => JSON.stringify(l)).join('\n'));
    const a = log[2], b = log[log.length - 1];
    const stepsPerSec = (b.count - a.count) / (b.next - a.next), want = a.bpm / 60 * 4;
    const lvl = await page.evaluate(() => T8.test.level());
    console.log('scheduled steps per second:', stepsPerSec.toFixed(3), 'expected', want.toFixed(3), '| level', JSON.stringify(lvl), '| errors:', errs.length ? errs.join(' | ') : 'none');
    const ok = !errs.length && b.scale <= 0.6 && Math.abs(stepsPerSec - want) < 0.02 * want && lvl.mean > 1.5;
    console.log(ok ? 'heavy scene: OK' : 'heavy scene: FAILED'); allOk = allOk && ok;
    await page.close();
  }
  // ---- 2. the fluid scene keeps its ink when the drawing resolution changes ----
  {
    const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(PAGE + '?scene=liquid');
    await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 240000 });
    await page.click('#btnPlay');
    await page.waitForTimeout(9000);
    const r = await page.evaluate(() => {
      App.resMode = 'fixed';
      const dye0 = Scenes.liquid.dye.w + 'x' + Scenes.liquid.dye.h, l0 = T8.test.level();
      setResScale(0.6);
      const l1 = T8.test.level(), dye1 = Scenes.liquid.dye.w + 'x' + Scenes.liquid.dye.h, c1 = App.canvas.width + 'x' + App.canvas.height;
      setResScale(1);
      const l2 = T8.test.level();
      return { dye0, dye1, c1, l0, l1, l2 };
    });
    console.log(JSON.stringify(r), '| errors:', errs.length ? errs.join(' | ') : 'none');
    const ok = !errs.length && r.dye0 === r.dye1 && r.l0.mean > 2 && r.l1.mean > 0.6 * r.l0.mean && r.l2.mean > 0.6 * r.l0.mean;
    console.log(ok ? 'fluid ink survives: OK' : 'fluid ink survives: FAILED'); allOk = allOk && ok;
    await page.close();
  }
  await browser.close();
  console.log(allOk ? 'GOVERNOR OK' : 'GOVERNOR FAILED'); process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(3); });
