// Hardware mode: are the chord hits scheduled on the T-8's grid, ahead of time, regardless of event jitter?
const { chromium } = require('playwright');
const [url, secs = '12'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || (require('fs').existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.T8 && T8.test.ready && T8.test.ready(), null, { timeout: 180000 });
  await page.click('#btnSound');
  await page.evaluate(() => {
    window.__log = []; window.__steps = [];
    SP.density = 1.0; BP.on = true;                      // many hits = many samples
    const st = AE.stab.bind(AE), be = AE.bell.bind(AE);
    AE.stab = function (c, when) { window.__log.push(['stab', when, AE.ctx.currentTime]); return st(c, when); };
    AE.bell = function (c, when) { window.__log.push(['bell', when, AE.ctx.currentTime]); return be(c, when); };
    const h = HW.handle.bind(HW);
    HW.handle = function (m) { if (m.type === 'step') window.__steps.push([m.i, AE.ctx.currentTime, m.bpm]); return h(m); };
  });
  await page.waitForTimeout(+secs * 1000);
  const r = await page.evaluate(() => ({ log: window.__log, steps: window.__steps, off: SP.offset }));
  await browser.close();
  const sd = 60 / 130 / 4, st = r.steps.slice(8);
  // arrival jitter of the step events themselves
  const iv = []; for (let i = 1; i < st.length; i++) iv.push((st[i][1] - st[i - 1][1]) * 1000);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sdv = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
  // The grid as the T-8 played it: deliveries can only be late, so the least-delayed arrival marks it.
  // (the audio clock is read in 2.7 ms quanta, so a few ms of constant offset is expected here)
  const t0s = st.map((s, k) => s[1] - k * sd), g0 = Math.min(...t0s);
  const hits = r.log.filter(l => l[1] > st[0][1] + 1);
  const phase = hits.map(l => { let d = (l[1] - g0 - r.off) / sd; d = d - Math.round(d); return d * sd * 1000; });
  const lead = hits.map(l => (l[1] - l[2]) * 1000);
  console.log('step events: ' + st.length + ', arrival interval sd ' + sdv(iv).toFixed(2) + ' ms (min ' + Math.min(...iv).toFixed(1) + ', max ' + Math.max(...iv).toFixed(1) + ')');
  console.log('chord/bell hits scheduled: ' + hits.length);
  console.log('  distance from the grid: mean ' + mean(phase).toFixed(2) + ' ms, sd ' + sdv(phase).toFixed(2) + ' ms, worst ' + Math.max(...phase.map(Math.abs)).toFixed(2) + ' ms');
  console.log('  scheduled ahead of the audio clock by: min ' + Math.min(...lead).toFixed(1) + ' ms, mean ' + mean(lead).toFixed(1) + ' ms (late hits: ' + lead.filter(x => x < 0).length + ')');
  console.log('page errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  // The software renderer used for tests stalls the page badly (arrivals jitter by tens of ms). None of that may
  // reach the scheduled notes: they are placed from the follower's time stamps.
  const ok = hits.length > 20 && sdv(phase) < 3 && Math.abs(mean(phase)) < 6 && Math.max(...phase.map(Math.abs)) < 10 && lead.filter(x => x < 0).length === 0 && !errs.length;
  console.log(ok ? 'HW TIMING OK' : 'HW TIMING FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(3); });
