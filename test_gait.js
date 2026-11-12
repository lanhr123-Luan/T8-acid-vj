// Pure-math checks of the lunar gait (no GPU): planted boots must not slide, nothing may jump, legs must reach.
const fs = require('fs'), vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..', 'src', 'js') + '/';
const core = fs.readFileSync(ROOT + '00_core.js', 'utf8');
const moon = fs.readFileSync(ROOT + '33_scene_moon.js', 'utf8');
const helpers = core.slice(core.indexOf('function clamp'), core.indexOf('function mulberry'));
const gait = moon.slice(moon.indexOf('function hermiteKeys'), moon.indexOf('Scenes.moon = {'));
const ctx = { Math, console }; vm.createContext(ctx);
vm.runInContext(helpers + '\n' + gait + '\nthis.MOON=MOON;this.moonFoot=moonFoot;this.moonPelvis=moonPelvis;', ctx);
const { MOON: M, moonFoot, moonPelvis } = ctx;
let fail = 0; const bad = (m) => { fail++; console.log('  FAIL', m); };
// 1. planted boot: the ball of the foot must stay put in the world while the hips travel over it
{
  let mn = 1e9, mx = -1e9, mny = 1e9, mxy = -1e9; const o = {};
  for (let k = 0; k <= 400; k++) {
    const u = M.SD * k / 400 * 0.9999; moonFoot(u, o);
    const X = u * 2 * M.STEP;      // hips have moved this far
    const bx = X + o.x + M.BALL * Math.cos(o.pitch) - M.ANKH * Math.sin(o.pitch);
    const by = o.y - M.BALL * Math.sin(o.pitch) - M.ANKH * Math.cos(o.pitch);
    mn = Math.min(mn, bx); mx = Math.max(mx, bx); mny = Math.min(mny, by); mxy = Math.max(mxy, by);
  }
  console.log('stance: ball of foot drifts', ((mx - mn) * 1000).toFixed(3), 'mm horizontally,', ((mxy - mny) * 1000).toFixed(3), 'mm vertically; height', (mny * 1000).toFixed(3), 'mm');
  if (mx - mn > 1e-6 || Math.abs(mxy) > 1e-6 || Math.abs(mny) > 1e-6) bad('planted boot slides');
}
// 2. continuity of the boot path (including the wrap and the stance/swing joins), in world terms
{
  const o = {}, N = 20000; let px, py, pp, jx = 0, jy = 0, jp = 0, at = [0, 0, 0];
  for (let k = 0; k <= N; k++) {
    const g = k / N; const u = g % 1; moonFoot(u, o);
    const wx = g * 2 * M.STEP + o.x - (u < 1e-12 && k > 0 ? 0 : 0);
    const X = (k === N) ? 2 * M.STEP + (moonFoot(0, o), o.x) : wx;
    if (k === N) moonFoot(0, o);
    if (k > 0) {
      const dx = Math.abs(X - px), dy = Math.abs(o.y - py), dp = Math.abs(o.pitch - pp);
      if (dx > jx) { jx = dx; at[0] = g; } if (dy > jy) { jy = dy; at[1] = g; } if (dp > jp) { jp = dp; at[2] = g; }
    }
    px = X; py = o.y; pp = o.pitch;
  }
  console.log('boot path: largest change per 1/20000 cycle  x', (jx * 1000).toFixed(3), 'mm @', at[0].toFixed(3), ' y', (jy * 1000).toFixed(3), 'mm @', at[1].toFixed(3), ' pitch', jp.toFixed(5), 'rad @', at[2].toFixed(3));
  if (jx > 0.0008 || jy > 0.0008 || jp > 0.002) bad('boot path has a jump');
}
// 3. hips: position and vertical speed continuous through landing and take-off
for (const b of [0, 1, 2.5]) {
  const o = {}, hop = M.HOP * b, N = 20000; let pyv, pv, jv = 0, jy = 0;
  for (let k = 0; k <= N + 1; k++) {
    moonPelvis((k / N) % 1, hop, o);
    if (k > 0) { const v = (o.y - pyv) * N; jy = Math.max(jy, Math.abs(o.y - pyv)); if (k > 1) jv = Math.max(jv, Math.abs(v - pv)); pv = v; }
    pyv = o.y;
  }
  console.log('hips (hop x' + b + '): max step', (jy * 1000).toFixed(3), 'mm, max speed change', jv.toFixed(4), 'm per cycle');
  if (jy > 0.001) bad('hips jump');
}
// 4. leg reach over the whole cycle: hip-to-ankle distance must stay inside the leg length
for (const b of [0, 1, 2.5]) {
  const o = {}, pv = {}, hop = M.HOP * b, N = 4000; let mxd = 0, mnd = 9, over = 0, lean = 0.215;
  for (let k = 0; k < N; k++) {
    const g = k / N; moonPelvis((2 * g) % 1, hop, pv);
    for (const off of [0, 0.5]) {
      moonFoot((g + off) % 1, o);
      const fy = o.y + (o.ground ? 0 : 0.8 * pv.rise - 0.7 * pv.dip);
      if (!o.ground && fy < M.ANKH - 1e-9) bad('swinging boot dips into the ground: ' + fy.toFixed(3));
      const hx = -Math.sin(lean) * 0.03, hy = pv.y - Math.cos(lean) * 0.03;
      const d = Math.hypot(o.x - hx, fy - hy);
      mxd = Math.max(mxd, d); mnd = Math.min(mnd, d); if (d > M.L1 + M.L2 - 0.004) over++;
    }
  }
  console.log('leg (hop x' + b + '): hip-ankle distance', mnd.toFixed(3), '..', mxd.toFixed(3), 'm of', (M.L1 + M.L2).toFixed(2), '| samples over reach:', over);
  if (b <= 1 && over > 0) bad('leg over-extends at default settings');
  if (mnd < 0.30) bad('leg folds too far');
}
// 5. cadence facts for the README
const bar = 60 / 130 * 4;
console.log('at 130 BPM: footfall every', (bar / 2).toFixed(2), 's, contact', (M.SD * bar).toFixed(2), 's, airborne', ((0.5 - M.SD) * bar).toFixed(2), 's, speed', (2 * M.STEP / bar).toFixed(2), 'm/s, hop apex', (M.HOP * 100).toFixed(0), 'cm');
console.log(fail ? ('GAIT TEST FAILED (' + fail + ')') : 'gait test passed');
process.exit(fail ? 1 : 0);
