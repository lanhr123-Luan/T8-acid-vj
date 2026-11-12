'use strict';
// ============================================================================
//  t8-acid-vj  ·  core: helpers, signal bus, visual event queue
// ============================================================================
var T8 = { mode: (window.T8_MODE === 'hw') ? 'hw' : 'standalone', version: '2.0', test: {} };
function $(id) { return document.getElementById(id); }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
function fract(x) { return x - Math.floor(x); }
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// One clock for everything visual. Tests switch it to a virtual timeline for reproducible frames.
var Clock = { virtual: false, t: 0, now: function () { return this.virtual ? this.t : performance.now(); } };
var QS = (function () {
  var o = {};
  try { new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); } catch (e) { }
  return o;
})();
// visual randomness is seeded (reproducible renders); musical randomness is seeded only when ?seed= is given
var vrand = mulberry(QS.seed ? (parseInt(QS.seed, 10) || 1) * 7919 : 20261110);
var mrand = QS.seed ? mulberry((parseInt(QS.seed, 10) || 1) * 104729) : Math.random;

// ---------------------------------------------------------------------------
//  Sig: the one shared, time-based description of "what the music is doing".
//  Every envelope decays in seconds (never per frame), so 60 / 144 / 240 Hz
//  displays and dropped frames all look the same.
// ---------------------------------------------------------------------------
var Sig = {
  running: false, bpm: 130, step: -1, bar: 0, barInPhrase: 0,
  stepPhase: 0, beat: 0, barPhase: 0, beatCount: 0, time: 0, song: 0,
  kick: 0, snare: 0, hat: 0, ohat: 0, tom: 0, bass: 0, accent: 0, stab: 0, bell: 0, flash: 0,
  hue: 0.08, hueT: 0.08, note: 36, pitch: 0.3, slide: 0, energy: 0,
  root: 36, scale: 'natural_minor', chord: [0, 3, 7, 10], pat: [], steps: 16,
  lastStepPerf: 0, stepDur: 60 / 130 / 4,
  // per-step "afterglow" used by scenes that draw the sequence itself
  stepGlow: new Float32Array(16), stepLevel: new Float32Array(16), stepAcc: new Float32Array(16)
};
var TAU = {
  kick: 0.16, snare: 0.18, hat: 0.055, ohat: 0.20, tom: 0.22, bass: 0.22, accent: 0.30,
  stab: 0.32, bell: 0.7, flash: 0.10, slide: 0.12
};
function noteHue(note) {
  // low notes warm (amber), climbing through magenta into violet/cyan
  var lo = Sig.root - 2, hi = Sig.root + 26;
  var t = clamp((note - lo) / (hi - lo), 0, 1);
  var h = 0.10 - t * 0.52; if (h < 0) h += 1;
  return h;
}
function notePitch01(note) { return clamp((note - (Sig.root - 2)) / 28, 0, 1); }
function hueLerp(a, b, t) { var d = b - a; if (d > 0.5) d -= 1; if (d < -0.5) d += 1; return fract(a + d * t + 1); }

var Bus = {
  scene: null,
  // msg handlers shared by every transport (SSE hardware, internal engine, virtual test clock)
  start: function () {
    Sig.running = true; Sig.step = -1; Sig.bar = 0; Sig.beatCount = 0; Sig.song = 0;
    for (var i = 0; i < 16; i++) { Sig.stepGlow[i] = 0; }
    UI.setRunning(true);
    if (Bus.scene && Bus.scene.on) Bus.scene.on('start', {});
  },
  stop: function () {
    Sig.running = false; UI.setRunning(false);
    if (Bus.scene && Bus.scene.on) Bus.scene.on('stop', {});
  },
  pattern: function (m) {
    if (m.root != null) Sig.root = m.root;
    if (m.scale) Sig.scale = m.scale;
    if (m.chord && m.chord.length) Sig.chord = m.chord;
    if (m.bar != null) Sig.barInPhrase = m.bar;
    Sig.pat = m.cells || [];
    Sig.steps = Sig.pat.length || 16;
    for (var i = 0; i < 16; i++) {
      var c = Sig.pat[i];
      Sig.stepLevel[i] = (c && c.note != null) ? (0.22 + 0.78 * notePitch01(c.note)) : 0;
      Sig.stepAcc[i] = (c && c.note != null && c.accent) ? 1 : 0;
    }
    UI.setKey(Sig.scale, Sig.root); UI.setPattern(Sig.pat);
    if (Bus.scene && Bus.scene.on) Bus.scene.on('pattern', m);
  },
  step: function (ev) {
    var now = Clock.now();
    if (ev.bpm) { Sig.bpm = ev.bpm; Sig.stepDur = 60 / ev.bpm / 4; }
    if (ev.i === 0 && Sig.step !== -1) { Sig.bar++; if (UIP.auto && Sig.bar % UIP.autoBars === 0) App.wantNext = true; }
    if (ev.i % 4 === 0) Sig.beatCount++;
    Sig.step = ev.i; Sig.lastStepPerf = now;
    if (ev.on) {
      Sig.bass = Math.min(1.6, Sig.bass * 0.4 + (ev.accent ? 1.25 : 0.8));
      if (ev.accent) Sig.accent = 1;
      if (ev.note != null) { Sig.note = ev.note; Sig.hueT = noteHue(ev.note); Sig.pitch = notePitch01(ev.note); }
      Sig.slide = ev.slide ? 1 : Sig.slide;
      Sig.stepGlow[ev.i % 16] = ev.accent ? 1.5 : 1.0;
    }
    UI.setStep(ev.i, Sig.bpm);
    if (Bus.scene && Bus.scene.on) Bus.scene.on('step', ev);
  },
  drum: function (ev) {
    var v = clamp((ev.vel || 100) / 127, 0.2, 1);
    var k = ev.inst;
    if (k === 'kick') { Sig.kick = Math.max(Sig.kick, v); Sig.flash = Math.max(Sig.flash, 0.35 * v); }
    else if (k === 'snare' || k === 'clap') { Sig.snare = Math.max(Sig.snare, v); }
    else if (k === 'hat') { Sig.hat = Math.max(Sig.hat, 0.75 * v); }
    else if (k === 'ohat') { Sig.ohat = Math.max(Sig.ohat, v); Sig.hat = Math.max(Sig.hat, 0.5 * v); }
    else if (k === 'tom') { Sig.tom = Math.max(Sig.tom, v); }
    if (Bus.scene && Bus.scene.on) Bus.scene.on('drum', ev);
  },
  stab: function (ev) { Sig.stab = 1; if (Bus.scene && Bus.scene.on) Bus.scene.on('stab', ev); },
  bell: function (ev) { Sig.bell = 1; if (Bus.scene && Bus.scene.on) Bus.scene.on('bell', ev); }
};

// Visual events are queued with a due time (performance.now domain) so the picture can be
// delayed to match what is actually heard (output latency, Bluetooth speakers...).
var VQ = {
  q: [], delayMs: 0,
  push: function (type, ev, duePerf) { this.q.push({ type: type, ev: ev, t: duePerf + this.delayMs }); },
  flush: function (nowPerf) {
    var q = this.q;
    if (!q.length) return;
    q.sort(function (a, b) { return a.t - b.t; });
    var n = 0;
    while (n < q.length && q[n].t <= nowPerf) { var e = q[n++]; Bus[e.type](e.ev); }
    if (n) q.splice(0, n);
  },
  clear: function () { this.q.length = 0; }
};

function sigUpdate(dt, nowPerf) {
  var k;
  for (k in TAU) { Sig[k] *= Math.exp(-dt / TAU[k]); }
  Sig.hue = hueLerp(Sig.hue, Sig.hueT, 1 - Math.exp(-dt / 0.09));
  var gl16 = Sig.stepGlow, gd = Math.exp(-dt / 0.55);
  for (var i = 0; i < 16; i++) gl16[i] *= gd;
  if (Sig.running && Sig.step >= 0) {
    Sig.stepPhase = clamp((nowPerf - Sig.lastStepPerf) / 1000 / Sig.stepDur, 0, 1);
    Sig.beat = ((Sig.step % 4) + Sig.stepPhase) / 4;
    Sig.barPhase = (Sig.step + Sig.stepPhase) / 16;
    // song position in bars: free-runs at the tempo and is pulled gently onto the incoming steps
    var gp = Sig.bar + Sig.barPhase;
    Sig.song += dt / (16 * Sig.stepDur);
    var err = gp - Sig.song;
    if (Math.abs(err) > 0.3) Sig.song = gp; else Sig.song += err * (1 - Math.exp(-dt / 0.18));
  }
  var act = Sig.running ? 1 : 0;
  Sig.energy += (act - Sig.energy) * (1 - Math.exp(-dt / 1.2));
  Sig.time += dt;
}
