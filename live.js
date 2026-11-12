// Real-time functional test of a built page (no virtual clock): boots, plays, switches scenes, checks audio + console.
// usage: node tools/live.js <url> <outPrefix> [hw|sa]
const { chromium } = require('playwright');
const [url, prefix, mode = 'sa'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels|Automatic fallback to software WebGL/.test(t)) errs.push('[' + m.type() + '] ' + t); });
  page.on('pageerror', e => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  await page.goto(url);
  await page.waitForFunction(() => window.T8 && T8.test.ready && (T8.test.ready() || document.getElementById('glerr').style.display === 'block'), null, { timeout: 180000 });
  const out = {};
  out.boot = await page.evaluate(() => ({ mode: T8.mode, scene: App.sceneId, glerr: document.getElementById('glerr').textContent, hint: document.getElementById('hint').textContent, hdr: GLX.hdr, par: !!GLX.par }));
  if (mode === 'sa') {
    await page.click('#btnPlay');
  } else {
    await page.click('#btnSound');
  }
  await page.waitForTimeout(4200);
  out.playing = await page.evaluate(() => ({ running: Sig.running, bar: Sig.bar, step: Sig.step, bpm: Sig.bpm, key: document.getElementById('key').textContent, pads: document.querySelectorAll('.pads i.on').length,
    play: document.getElementById('btnPlay').textContent, quiet: document.body.classList.contains('quiet'), meter: T8.test.meter(), vq: VQ.q.length, fps: +App.fps.toFixed(1), res: +App.resScale.toFixed(2), kick: +Sig.kick.toFixed(3) }));
  let pk = 0, rms = 0;
  for (let i = 0; i < 12; i++) { const m = await page.evaluate(() => T8.test.meter()); if (m) { pk = Math.max(pk, m.peak); rms = Math.max(rms, m.rms); } await page.waitForTimeout(110); }
  out.audio = { peakMax: +pk.toFixed(3), rmsMax: +rms.toFixed(3) };
  await page.mouse.move(640, 300);
  await page.screenshot({ path: prefix + '_ui.png' });
  // open settings, move a slider, switch scenes with the keyboard
  await page.keyboard.press('Tab'); await page.waitForTimeout(400);
  out.drawer = await page.evaluate(() => ({ open: document.body.classList.contains('open'), groups: [].map.call(document.querySelectorAll('#drawer h2'), h => h.textContent), rows: document.querySelectorAll('#drawer .row').length }));
  await page.screenshot({ path: prefix + '_drawer.png' });
  await page.keyboard.press('Escape');
  for (const k of ['2', '3', '4', '1']) {
    await page.keyboard.press(k);
    await page.waitForFunction(() => T8.test.ready(), null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => ({ scene: App.sceneId, sel: (document.querySelector('.seg button[aria-selected=true]') || {}).textContent, broken: Object.keys(App.broken), glerr: document.getElementById('glerr').textContent.slice(0, 300) }));
    (out.scenes = out.scenes || []).push(s);
  }
  if (mode === 'sa') {
    await page.keyboard.press('n'); await page.waitForTimeout(300);
    await page.keyboard.press(' '); await page.waitForTimeout(600);
    out.stopped = await page.evaluate(() => ({ running: Sig.running, hint: document.getElementById('hint').textContent, play: document.getElementById('btnPlay').textContent }));
  }
  out.errors = errs.slice(0, 12);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(3); });
