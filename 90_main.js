// ============================================================================
//  main: scene manager, render loop, adaptive resolution, test hooks
// ============================================================================
var App = {
  canvas: null, sceneId: null, scene: null, lastT: 0, simT: 0, fade: 1, flashCut: 0,
  resMode: 'auto', resScale: 1, ft: 16.7, ftN: 0, upHold: 0, broken: {}, paused: false,
  auto: false, autoBars: 16, autoAt: 0, fps: 60, minDt: 16.7, settle: 0, slowN: 0, failScale: 1, failAt: -1e9, failWait: 45000, sceneScale: {}
};
function appResize() {
  var c = App.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.max(16, Math.round(c.clientWidth * dpr * App.resScale)), h = Math.max(16, Math.round(c.clientHeight * dpr * App.resScale));
  if (QS.w && QS.h) { w = parseInt(QS.w, 10); h = parseInt(QS.h, 10); }
  if (c.width === w && c.height === h && Post.hdr) return;
  c.width = w; c.height = h; GLX.w = w; GLX.h = h;
  Post.resize(w, h);
  if (App.scene && App.scene.resize) App.scene.resize(w, h);
}
function sceneFail(id, e) {
  App.broken[id] = true;
  glFail('The "' + id + '" scene could not start on this GPU.\n' + (e && e.message ? e.message : e));
  UI.setSceneBroken(id);
}
function sceneActivate(id, quiet) {
  var s = Scenes[id];
  App.sceneId = id; App.scene = s; Bus.scene = s; App.pending = null;
  // each scene costs differently: go back to the resolution that worked for it last time
  if (App.resMode === 'auto' && App.sceneScale[id] && !QS.res) { App.resScale = App.sceneScale[id]; appResize(); UI.setRes(App.resScale); }
  Perf.reset(); App.ftN = 0; App.settle = 0; App.slowN = 0; App.ft = 16.7; App.failAt = -1e9; App.failWait = 45000;
  if (s.resize) s.resize(GLX.w, GLX.h);
  if (s.enter) s.enter();
  if (!quiet) App.flashCut = 1;
  Post.P.flashK = (s.flashK == null) ? 1 : s.flashK; App.sceneBloom = (s.bloomK == null) ? 1 : s.bloomK;
  UI.setSceneUI(id); UI.setLoading(null);
  try { history.replaceState(null, '', '#' + id); } catch (e) { }
}
// returns false only when the scene is unknown or known to be broken; otherwise it is (or will be) shown
function setScene(id, quiet) {
  if (!Scenes[id] || App.broken[id]) return false;
  var s = Scenes[id];
  if (s._ready) { sceneActivate(id, quiet); return true; }
  if (!s._built) {
    try {
      if (!s.P) s.P = {};
      (s.params || []).forEach(function (p) { if (s.P[p.k] == null) s.P[p.k] = p.v; });
      Prog.collect = []; s.init(); s._progs = Prog.collect; Prog.collect = null; s._built = true;
    } catch (e) { Prog.collect = null; sceneFail(id, e); return false; }
  }
  App.pending = id; App.pendingQuiet = !!quiet; App.pendingAt = performance.now();
  UI.setLoading(s.label);
  return true;
}
function scenePoll() {
  var id = App.pending; if (!id) return;
  var s = Scenes[id], i;
  // give the browser one painted frame for the "preparing" label before a driver without parallel compile blocks
  if (performance.now() - App.pendingAt < 60 && !Clock.virtual) return;
  for (i = 0; i < s._progs.length; i++) if (!s._progs[i].done()) return;
  try { for (i = 0; i < s._progs.length; i++) s._progs[i].check(); s._ready = true; }
  catch (e) {
    App.pending = null; UI.setLoading(null); sceneFail(id, e);
    if (!App.scene) { for (i = 0; i < SCENE_ORDER.length; i++) if (setScene(SCENE_ORDER[i], true)) break; }
    return;
  }
  sceneActivate(id, App.pendingQuiet);
}
function nextScene(dir) {
  var i = SCENE_ORDER.indexOf(App.sceneId);
  for (var n = 1; n <= SCENE_ORDER.length; n++) {
    var id = SCENE_ORDER[(i + dir * n + SCENE_ORDER.length * 4) % SCENE_ORDER.length];
    if (setScene(id)) return;
  }
}
function appFrame(dt, nowPerf, noDraw) {
  scenePoll();
  if (App.wantNext) { App.wantNext = false; nextScene(1); }
  VQ.flush(nowPerf);
  sigUpdate(dt, nowPerf);
  App.simT += dt;
  App.flashCut *= Math.exp(-dt / 0.16);
  var s = App.scene;
  if (!s || GLX.lost) return;
  s.update(dt, App.simT);
  if (noDraw) return;
  Post.begin();
  s.render(App.simT, Post.hdr);
  Post.P.bloom = UIP.bloom * (App.sceneBloom || 1); Post.P.grain = UIP.grain; Post.P.lens = UIP.lens;
  Post.P.exposure = 1 + App.flashCut * 1.4;
  Post.end(App.simT, 1);
}
// ---- frame-rate governor -----------------------------------------------------
// Keeps the picture smooth by lowering the drawing resolution when a scene is too heavy for the GPU
// (the canvas is then scaled up by the browser). With EXT_disjoint_timer_query_webgl2 it measures the
// real GPU time per frame; without it, it can only see dropped frames, so it backs off fast and returns
// to a higher resolution cautiously.
var Perf = {
  ext: null, q: null, pending: [], gpuMs: 0, have: false, n: 0,
  init: function () { try { this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (e) { this.ext = null; } },
  begin: function () { if (!this.ext || this.q) return; this.q = gl.createQuery(); gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.q); },
  end: function () {
    if (!this.ext) return;
    if (this.q) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.q); this.q = null; }
    while (this.pending.length) {
      var q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
        var ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.gpuMs = this.n ? this.gpuMs + (ms - this.gpuMs) * 0.18 : ms; this.n++; this.have = true;
      }
      gl.deleteQuery(q); this.pending.shift();
    }
    while (this.pending.length > 6) gl.deleteQuery(this.pending.shift());
  },
  reset: function () { this.n = 0; }
};
var RES_MIN = 0.35;
function setResScale(s) {
  s = clamp(Math.round(s * 50) / 50, RES_MIN, 1);
  if (Math.abs(s - App.resScale) < 0.015) return false;
  App.resScale = s; appResize(); UI.setRes(s); Perf.reset(); App.ftN = 0; App.settle = 0; App.slowN = 0;
  if (App.sceneId) App.sceneScale[App.sceneId] = s;
  return true;
}
function resFail(s, f) {
  // remember where it went wrong; every repeat at (about) the same place doubles the wait before trying again
  var now = performance.now();
  App.failWait = (now - App.failAt < App.failWait * 1.5 + 8000 && s <= App.failScale + 0.05) ? Math.min(App.failWait * 2, 600000) : 45000;
  App.failScale = s; App.failAt = now;
  setResScale(s * f);
}
function adaptRes(dtMs) {
  if (App.resMode !== 'auto' || Clock.virtual || dtMs < 3) return;
  var d = Math.min(dtMs, 600), s = App.resScale;
  if (App.ftN++ < 1) { App.slowN = 0; return; }                  // the first frame after a change pays for new buffers
  if (dtMs < 200) App.minDt = Math.min(App.minDt * 1.0015, dtMs);  // shortest interval seen lately ~ the display's refresh
  App.ft += (d - App.ft) * (1 - Math.exp(-d / 260));             // time-based average: slow frames count as much as fast ones
  App.settle += d;
  // far too slow to wait for an average: two frames in a row above a quarter of a second
  App.slowN = (d > 250) ? App.slowN + 1 : 0;
  if (App.slowN >= 2 && s > RES_MIN) { App.ft = 16.7; resFail(s, 0.45); return; }
  if (App.ftN < 5 || App.settle < 700) return;                   // let the measurement settle after any change
  var period = clamp(App.minDt, 6.9, 16.9), budget = Math.max(period, 8.3);
  if (Perf.have && Perf.n >= 12) {
    var ratio = Perf.gpuMs / (budget * 0.72);                    // aim to use ~72% of the frame
    if (ratio > 1.04) setResScale(s * clamp(Math.pow(ratio, -0.5), 0.6, 0.98));
    else if (ratio < 0.74 && s < 1 && App.settle > 1200) setResScale(s * Math.min(1.14, Math.pow(ratio, -0.5) * 0.96));
  } else {
    // no GPU timer on this browser: all that can be seen is whether frames are being dropped
    var r = App.ft / period;
    if (r > 1.45 && s > RES_MIN) resFail(s, clamp(Math.sqrt(0.9 / (r - 0.6)), 0.45, 0.87));
    else if (r < 1.12 && s < 1 && App.settle > 5000) {
      var cap = (performance.now() - App.failAt < App.failWait) ? App.failScale * 0.94 : 1;   // do not walk straight back into trouble
      if (s * 1.06 <= cap + 0.001) setResScale(s * 1.06); else App.settle = 0;
    }
  }
}
function appLoop(now) {
  requestAnimationFrame(appLoop);
  if (App.paused || Clock.virtual) return;
  var dtMs = App.lastT ? (now - App.lastT) : 16.7; App.lastT = now;
  var dt = clamp(dtMs / 1000, 0.001, 0.1);
  App.fps += (1000 / Math.max(1, dtMs) - App.fps) * 0.05;
  if (document.hidden) return;
  appResize();
  Perf.begin();
  appFrame(dt, performance.now());
  Perf.end();
  adaptRes(dtMs);
}
function appBoot() {
  App.canvas = $('c');
  UI.init();
  if (!glInit(App.canvas)) return;
  try { Post.init(); } catch (e) { glFail('Post pipeline failed: ' + e.message); return; }
  Perf.init();
  if (QS.res) { App.resMode = 'fixed'; App.resScale = clamp(parseFloat(QS.res) || 1, 0.2, 2); }
  appResize();
  var want = (QS.scene || (location.hash || '').replace('#', '') || UI.saved('scene') || 'stage');
  if (!setScene(want, true)) { for (var i = 0; i < SCENE_ORDER.length; i++) if (setScene(SCENE_ORDER[i], true)) break; }
  window.addEventListener('resize', appResize);
  Transport.init();
  requestAnimationFrame(appLoop);
}

// ---- test hooks: reproducible frames on a virtual clock (used by the headless render tests) ----
var VSeq = { bar: null, stepN: 0, nextT: 0, on: false };
function vseqTick(nowMs) {
  if (!VSeq.on) return;
  while (nowMs >= VSeq.nextT) {
    var i = VSeq.stepN;
    if (i === 0) {
      VSeq.bar = seqNewBar();
      Bus.pattern({ root: VSeq.bar.root, scale: VSeq.bar.scale, chord: VSeq.bar.chord, bar: VSeq.bar.b, cells: VSeq.bar.pat });
    }
    seqEmitStep(VSeq.bar, i, ENG.bpm, function (type, ev) { Bus[type](ev); });
    VSeq.stepN = (i + 1) % 16; VSeq.nextT += 60000 / ENG.bpm / 4;
  }
}
T8.test.begin = function (o) {
  o = o || {};
  Clock.virtual = true; Clock.t = 0; App.simT = 0;
  if (o.bpm) ENG.bpm = o.bpm;
  if (o.style) ENG.style = o.style;
  harmReset(); VSeq.on = o.play !== false; VSeq.stepN = 0; VSeq.nextT = 100;
  if (VSeq.on) Bus.start();
  return true;
};
T8.test.advance = function (seconds, fps, seek) {
  fps = fps || 30; var n = Math.round(seconds * fps), dt = 1 / fps;
  appResize();
  for (var i = 0; i < n; i++) { Clock.t += dt * 1000; vseqTick(Clock.t); appFrame(dt, Clock.t, seek && i < n - 1); }
  gl.finish();
  return { t: Clock.t, step: Sig.step, bar: Sig.bar, errors: GLX.errors.slice() };
};
T8.test.ready = function () { scenePoll(); return !!App.scene && !App.pending; };
T8.test.snap = function () { return App.canvas.toDataURL('image/png'); };
T8.test.frame = function (seconds, fps) { T8.test.advance(seconds, fps); return T8.test.snap(); };
// live mode: draw one frame now and return the mean 8-bit level of what is on the canvas
T8.test.level = function () {
  appFrame(0.016, performance.now()); gl.finish();
  var c = document.createElement('canvas'); c.width = 64; c.height = 36;
  var g = c.getContext('2d'); g.drawImage(App.canvas, 0, 0, 64, 36);
  var d = g.getImageData(0, 0, 64, 36).data, s = 0, mx = 0;
  for (var i = 0; i < d.length; i += 4) { var v = d[i] + d[i + 1] + d[i + 2]; s += v; if (v > mx) mx = v; }
  return { mean: +(s / (64 * 36 * 3)).toFixed(2), max: +(mx / 3).toFixed(1) };
};
window.T8 = T8;
window.addEventListener('DOMContentLoaded', appBoot);
// ---- audio test hooks ----
T8.test.meter = function () {
  if (!AE) return null;
  if (!T8.test._an) { T8.test._an = AE.ctx.createAnalyser(); T8.test._an.fftSize = 2048; AE.out.connect(T8.test._an); }
  var b = new Float32Array(2048), i, pk = 0, sq = 0; T8.test._an.getFloatTimeDomainData(b);
  for (i = 0; i < b.length; i++) { var a = Math.abs(b[i]); if (a > pk) pk = a; sq += b[i] * b[i]; }
  return { peak: pk, rms: Math.sqrt(sq / b.length), state: AE.ctx.state, t: AE.ctx.currentTime, lat: AE.outputLatency() };
};
// render `bars` bars of the standalone engine offline and return per-layer level statistics
T8.test.offline = function (bars, solo) {
  var sr = 44100, sd = 60 / ENG.bpm / 4, len = bars * 16 * sd + 2.5;
  var oc = new OfflineAudioContext(2, Math.ceil(len * sr), sr), E = new AudioEngine(oc, false), b, i, k, bar, t = 0.05;
  harmReset(); Mus.bellMotif = null; Mus.bellAge = 99;
  var keep = { s: SP.on, b: BP.on }; 
  E.applyParams(); E.setTempo(ENG.bpm);
  var mute = function (g) { g.gain.cancelScheduledValues(0); g.gain.value = 0; };
  for (b = 0; b < bars; b++) {
    bar = seqNewBar();
    for (i = 0; i < 16; i++) {
      var c = bar.pat[i], prev = i > 0 ? bar.pat[i - 1] : null, hs = bar.drums[i];
      if (!solo || solo === 'bass') { if (c.note != null) E.bass(t, c.note, !!c.accent, !!(prev && prev.slide && prev.note != null), !!c.slide, sd); else if (E.bassOn) E.bassOff(t); }
      if (!solo || solo === 'drums') for (k = 0; k < hs.length; k++) E.drum(hs[k].inst, hs[k].vel, t);
      if ((!solo || solo === 'stab') && bar.stab[i]) E.stab(bar.stab[i], t);
      if ((!solo || solo === 'bell') && bar.bell[i]) E.bell(bar.bell[i], t);
      t += sd;
    }
  }
  E.bassOff(t);
  return oc.startRendering().then(function (buf) {
    var L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, pk = 0, sq = 0, dc = 0, clip = 0, nan = 0, tail = 0, j;
    for (j = 0; j < n; j++) {
      var a = Math.max(Math.abs(L[j]), Math.abs(R[j]));
      if (a !== a) nan++; if (a > pk) pk = a; if (a >= 0.999) clip++;
      sq += (L[j] * L[j] + R[j] * R[j]) * 0.5; dc += L[j];
      if (j > n - sr * 0.25) tail = Math.max(tail, a);
    }
    // crude spectrum split: energy below ~200 Hz vs above (one-pole)
    var lp = 0, lo = 0, hi = 0, al = 1 - Math.exp(-2 * Math.PI * 200 / sr);
    for (j = 0; j < n; j++) { lp += al * (L[j] - lp); lo += lp * lp; hi += (L[j] - lp) * (L[j] - lp); }
    return { secs: +(n / sr).toFixed(2), peak: +pk.toFixed(4), rmsDb: +(20 * Math.log10(Math.sqrt(sq / n) + 1e-9)).toFixed(1), peakDb: +(20 * Math.log10(pk + 1e-9)).toFixed(1),
      dc: +(dc / n).toFixed(5), clipped: clip, nan: nan, tailPeak: +tail.toFixed(5), lowShare: +(lo / (lo + hi + 1e-12)).toFixed(3) };
  });
};
