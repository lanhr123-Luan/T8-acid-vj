// ============================================================================
//  audio: one engine that runs on a live AudioContext or, for tests, an
//  OfflineAudioContext. Every trigger takes an absolute context time.
//    hardware mode : chords + bells (the T-8 plays bass and drums itself)
//    standalone    : 303-style bass, drum machine, chords, bells
// ============================================================================
var UIP = { punch: 1, bloom: 1, grain: 0.5, lens: 0.6, dof: 1, avDelay: 0, volume: 0.9, pump: 0.3, autoBars: 16, auto: false, muted: false };
function AudioEngine(ctx, live) {
  var E = this; E.ctx = ctx; E.live = !!live; E.bpm = 130; E.rnd = mulberry(99);
  function G(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
  // ---- master: everything sums here, then a bus limiter keeps peaks out of the converter ----
  E.sum = G(1);
  E.lim = ctx.createDynamicsCompressor();
  E.lim.threshold.value = -5; E.lim.knee.value = 4; E.lim.ratio.value = 16; E.lim.attack.value = 0.002; E.lim.release.value = 0.12;
  E.out = G(UIP.muted ? 0 : UIP.volume);
  E.sum.connect(E.lim); E.lim.connect(E.out); E.out.connect(ctx.destination);
  if (live && ctx.createMediaStreamDestination) { E.recDest = ctx.createMediaStreamDestination(); E.out.connect(E.recDest); }
  // ---- "high" group (chords, bells and their effects) ducks under the kick ----
  E.duckG = G(1); E.duckG.connect(E.sum);
  E.stabBus = G(SP.level * 1.15); E.stabBus.connect(E.duckG);
  E.bellHP = ctx.createBiquadFilter(); E.bellHP.type = 'highpass'; E.bellHP.frequency.value = 420; E.bellHP.connect(E.duckG);
  E.bellBus = G(BP.level * 1.05); E.bellBus.connect(E.bellHP);
  // ---- shared effects: dotted-eighth ping-pong delay and a small plate ----
  E.dlyIn = G(1);
  E.dA = ctx.createDelay(1.5); E.dB = ctx.createDelay(1.5);
  var fb = G(0.36), damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3200;
  var pA = ctx.createStereoPanner(), pB = ctx.createStereoPanner(); pA.pan.value = -0.75; pB.pan.value = 0.75;
  E.fxOut = G(0.9); E.fxOut.connect(E.duckG);
  E.dlyIn.connect(E.dA); E.dA.connect(E.dB); E.dB.connect(damp); damp.connect(fb); fb.connect(E.dA);
  E.dA.connect(pA); E.dB.connect(pB); pA.connect(E.fxOut); pB.connect(E.fxOut);
  E.revIn = G(1); E.rev = ctx.createConvolver(); E.rev.buffer = E.makeIR(2.3); E.revOut = G(0.55);
  E.revIn.connect(E.rev); E.rev.connect(E.revOut); E.revOut.connect(E.fxOut);
  E.stabDly = G(SP.space * 0.6); E.stabRev = G(SP.space * 0.45);
  E.stabBus.connect(E.stabDly); E.stabDly.connect(E.dlyIn); E.stabBus.connect(E.stabRev); E.stabRev.connect(E.revIn);
  E.bellDly = G(BP.space * 0.45); E.bellRev = G(BP.space * 0.8);
  E.bellBus.connect(E.bellDly); E.bellDly.connect(E.dlyIn); E.bellBus.connect(E.bellRev); E.bellRev.connect(E.revIn);
  // ---- bass: one mono voice that lives for the whole session (needed for true slides) ----
  E.bassBus = G(AP.lvl * 0.70); E.bassBus.connect(E.sum);
  E.bOsc = ctx.createOscillator(); E.bOsc.type = 'sawtooth'; E.bOsc.frequency.value = 55;
  E.bF1 = ctx.createBiquadFilter(); E.bF1.type = 'lowpass'; E.bF1.Q.value = AP.res; E.bF1.frequency.value = AP.cut;
  E.bF2 = ctx.createBiquadFilter(); E.bF2.type = 'lowpass'; E.bF2.Q.value = 0.55; E.bF2.frequency.value = AP.cut * 1.6;
  E.bDrive = ctx.createWaveShaper(); E.bDrive.curve = E.curve(2.2); E.bDrive.oversample = '2x';
  E.bVca = G(0);
  E.bOsc.connect(E.bF1); E.bF1.connect(E.bF2); E.bF2.connect(E.bDrive); E.bDrive.connect(E.bVca); E.bVca.connect(E.bassBus);
  E.bOsc.start(); E.bFreq = 55; E.bassOn = false;
  // ---- drums ----
  E.drumBus = G(AP.drums * 0.56); E.drumSat = ctx.createWaveShaper(); E.drumSat.curve = E.curve(1.25);
  E.drumBus.connect(E.drumSat); E.drumSat.connect(E.sum);
  E.drumRev = G(0.16); E.drumRev.connect(E.revIn);
  E.noise = E.makeNoise(); E.openHat = null;
  // ---- the T-8's own audio, when it is monitored through the browser ----
  E.monG = G(UIP.monLvl == null ? 0.9 : UIP.monLvl); E.monG.connect(E.sum); E.monSrc = null; E.monStream = null;
  E.setTempo(130);
}
AudioEngine.prototype.curve = function (k) {
  var n = 1025, c = new Float32Array(n), i, x, norm = Math.tanh(k);
  for (i = 0; i < n; i++) { x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / norm; }
  return c;
};
AudioEngine.prototype.makeNoise = function () {
  var ctx = this.ctx, n = Math.floor(ctx.sampleRate * 1.5), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), r = mulberry(77), i;
  for (i = 0; i < n; i++) d[i] = r() * 2 - 1;
  return b;
};
AudioEngine.prototype.makeIR = function (secs) {
  // plate-like impulse: short pre-delay, dense decorrelated tail that loses highs as it decays
  var ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr), r = mulberry(4321), ch, i;
  var pre = Math.floor(sr * 0.012);
  for (ch = 0; ch < 2; ch++) {
    var d = b.getChannelData(ch), lp = 0;
    for (i = pre; i < n; i++) {
      var t = (i - pre) / sr, env = Math.exp(-t * 3.0 / secs * 2.3), a = 0.12 + 0.75 * Math.exp(-t * 2.2);
      lp += a * ((r() * 2 - 1) - lp);
      d[i] = lp * env * (t < 0.02 ? t / 0.02 : 1);
    }
  }
  return b;
};
AudioEngine.prototype.setTempo = function (bpm) {
  if (!(bpm > 20 && bpm < 400)) return;
  this.bpm = bpm;
  var d = Math.min(1.4, 60 / bpm / 4 * 3), t = this.ctx.currentTime;      // three sixteenths
  this.dA.delayTime.setTargetAtTime(d, t, 0.05); this.dB.delayTime.setTargetAtTime(d, t, 0.05);
};
AudioEngine.prototype.applyParams = function () {
  var E = this, t = E.ctx.currentTime, k = 0.03;
  E.out.gain.setTargetAtTime(UIP.muted ? 0 : UIP.volume, t, k);
  E.stabBus.gain.setTargetAtTime(SP.on ? SP.level * 1.15 : 0, t, k);
  E.bellBus.gain.setTargetAtTime(BP.on ? BP.level * 1.05 : 0, t, k);
  E.stabDly.gain.setTargetAtTime(SP.space * 0.6, t, k); E.stabRev.gain.setTargetAtTime(SP.space * 0.45, t, k);
  E.bellDly.gain.setTargetAtTime(BP.space * 0.45, t, k); E.bellRev.gain.setTargetAtTime(BP.space * 0.8, t, k);
  E.bassBus.gain.setTargetAtTime(AP.lvl * 0.70, t, k); E.drumBus.gain.setTargetAtTime(AP.drums * 0.56, t, k);
};
// ---- chord stab: detuned saw pair per note through one filter and one envelope ----
AudioEngine.prototype.stab = function (cell, when) {
  var E = this, ctx = E.ctx, notes = cell.notes || [], n = notes.length, i;
  if (!n || !SP.on) return;
  var dec = Math.max(0.05, SP.decay * (cell.dec || 1)), tone = SP.tone * (cell.ton || 1), acc = cell.accent ? 1 : 0.72;
  var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3.2;
  f.frequency.setValueAtTime(Math.min(15000, tone * (2.2 + 0.8 * acc)), when);
  f.frequency.exponentialRampToValueAtTime(Math.max(180, tone * 0.42), when + dec * 1.3);
  var v = ctx.createGain(), peak = 0.30 * acc / Math.sqrt(n);
  v.gain.setValueAtTime(0, when); v.gain.linearRampToValueAtTime(peak, when + 0.004);
  v.gain.setTargetAtTime(0, when + 0.010, dec * 0.42);
  f.connect(v); v.connect(E.stabBus);
  var end = when + dec * 3.4 + 0.15;
  for (i = 0; i < n; i++) {
    var fr = midiToFreq(notes[i]);
    for (var s = -1; s <= 1; s += 2) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = s * 8;
      o.connect(f); o.start(when); o.stop(end);
    }
  }
};
// ---- FM bell: sine carrier, modulator at ~3x whose depth collapses quickly (bright strike, pure tail) ----
AudioEngine.prototype.bellVoice = function (freq, vel, when) {
  var E = this, ctx = E.ctx;
  var car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), v = ctx.createGain(), pan = ctx.createStereoPanner();
  car.frequency.value = freq; mod.frequency.value = freq * 3.009;
  mg.gain.setValueAtTime(freq * (0.8 + BP.shimmer * 1.2), when);
  mg.gain.exponentialRampToValueAtTime(Math.max(0.5, freq * 0.015), when + 0.32);
  mod.connect(mg); mg.connect(car.frequency);
  var dec = Math.max(0.2, BP.decay);
  v.gain.setValueAtTime(0, when); v.gain.linearRampToValueAtTime(0.26 * vel, when + 0.003);
  v.gain.setTargetAtTime(0, when + 0.006, dec / 4.2);
  pan.pan.value = (E.rnd() * 2 - 1) * 0.6;
  car.connect(v); v.connect(pan); pan.connect(E.bellBus);
  var end = when + dec * 1.7 + 0.2;
  car.start(when); mod.start(when); car.stop(end); mod.stop(end);
};
AudioEngine.prototype.bell = function (cell, when) {
  if (!BP.on || !cell) return;
  var f = midiToFreq(cell.note);
  this.bellVoice(f, cell.vel || 0.8, when);
  if (cell.oct) this.bellVoice(f * 2, (cell.vel || 0.8) * 0.42, when + 0.012);
};
// ---- 303 voice. legato = arrive by sliding from the previous note without re-striking the envelopes ----
AudioEngine.prototype.bass = function (when, midi, accent, legato, hold, stepDur) {
  var E = this, f = midiToFreq(midi), fq = E.bOsc.frequency;
  fq.cancelScheduledValues(when);
  if (legato && E.bassOn) fq.setTargetAtTime(f, when, 0.022);
  else fq.setValueAtTime(f, when);
  E.bFreq = f;
  var top = Math.min(11000, AP.cut + AP.env * (accent ? 1.75 : 1.0)), base = Math.max(60, AP.cut), dec = AP.dec * (accent ? 0.85 : 1.0);
  if (!(legato && E.bassOn)) {
    var c1 = E.bF1.frequency, c2 = E.bF2.frequency, q = E.bF1.Q, g = E.bVca.gain;
    c1.cancelScheduledValues(when); c1.setValueAtTime(top, when); c1.setTargetAtTime(base, when + 0.004, dec / 2.6);
    c2.cancelScheduledValues(when); c2.setValueAtTime(Math.min(16000, top * 1.6), when); c2.setTargetAtTime(base * 1.6, when + 0.004, dec / 2.6);
    q.cancelScheduledValues(when); q.setValueAtTime(AP.res * (accent ? 1.18 : 1.0), when);
    g.cancelScheduledValues(when); g.setTargetAtTime(accent ? 1.0 : 0.64, when, 0.0025);
  }
  E.bassOn = true;
  if (!hold) { E.bVca.gain.setTargetAtTime(0, when + stepDur * 0.56, 0.010); E.bassOn = false; }
};
AudioEngine.prototype.bassOff = function (when) {
  var g = this.bVca.gain; g.cancelScheduledValues(when); g.setTargetAtTime(0, when, 0.015); this.bassOn = false;
};
// ---- drum machine ----
AudioEngine.prototype.nz = function (when, dur, off) {
  var s = this.ctx.createBufferSource(); s.buffer = this.noise; s.start(when, off || (this.rnd() * 0.9), dur + 0.02); return s;
};
AudioEngine.prototype.drum = function (inst, vel, when) {
  var E = this, ctx = E.ctx, t = when, o, g, n, f, k;
  if (inst === 'kick') {
    o = ctx.createOscillator(); g = ctx.createGain();
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(47, t + 0.085);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.0 * vel, t + 0.002); g.gain.setTargetAtTime(0, t + 0.06, 0.075);
    o.connect(g); g.connect(E.drumBus); o.start(t); o.stop(t + 0.5);
    n = E.nz(t, 0.02); f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.8;
    k = ctx.createGain(); k.gain.setValueAtTime(0.30 * vel, t); k.gain.setTargetAtTime(0, t, 0.004);
    n.connect(f); f.connect(k); k.connect(E.drumBus);
    if (UIP.pump > 0) E.duck(t, UIP.pump * vel);
  } else if (inst === 'snare') {
    n = E.nz(t, 0.25); f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2100; f.Q.value = 0.7;
    g = ctx.createGain(); g.gain.setValueAtTime(0.62 * vel, t); g.gain.setTargetAtTime(0, t + 0.01, 0.055);
    n.connect(f); f.connect(g); g.connect(E.drumBus); g.connect(E.drumRev);
    o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(215, t); o.frequency.exponentialRampToValueAtTime(165, t + 0.05);
    k = ctx.createGain(); k.gain.setValueAtTime(0.42 * vel, t); k.gain.setTargetAtTime(0, t + 0.005, 0.03);
    o.connect(k); k.connect(E.drumBus); o.start(t); o.stop(t + 0.25);
  } else if (inst === 'clap') {
    f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.1;
    g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    for (k = 0; k < 3; k++) { g.gain.setValueAtTime(0.6 * vel, t + k * 0.011); g.gain.setTargetAtTime(0.12 * vel, t + k * 0.011 + 0.001, 0.004); }
    g.gain.setValueAtTime(0.55 * vel, t + 0.033); g.gain.setTargetAtTime(0, t + 0.036, 0.06);
    n = E.nz(t, 0.4); n.connect(f); f.connect(g); g.connect(E.drumBus); g.connect(E.drumRev);
  } else if (inst === 'hat' || inst === 'ohat') {
    var open = inst === 'ohat';
    if (E.openHat) { E.openHat.gain.cancelScheduledValues(t); E.openHat.gain.setTargetAtTime(0, t, 0.006); E.openHat = null; }   // choke
    n = E.nz(t, open ? 0.45 : 0.08); f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = open ? 6200 : 7400;
    g = ctx.createGain(); g.gain.setValueAtTime((open ? 0.26 : 0.30) * vel, t); g.gain.setTargetAtTime(0, t + 0.004, open ? 0.11 : 0.016);
    n.connect(f); f.connect(g); g.connect(E.drumBus);
    if (open) E.openHat = g;
  } else if (inst === 'tom') {
    o = ctx.createOscillator(); g = ctx.createGain();
    o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(118, t + 0.13);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6 * vel, t + 0.002); g.gain.setTargetAtTime(0, t + 0.02, 0.07);
    o.connect(g); g.connect(E.drumBus); o.start(t); o.stop(t + 0.45);
  }
};
AudioEngine.prototype.duck = function (when, amt) {
  var g = this.duckG.gain; amt = clamp(amt, 0, 0.85);
  g.cancelScheduledValues(when); g.setTargetAtTime(1 - amt, when, 0.006); g.setTargetAtTime(1, when + 0.035, 0.085);
};
AudioEngine.prototype.outputLatency = function () {
  var c = this.ctx, l = (c.outputLatency || 0) + (c.baseLatency || 0);
  return (l > 0 && l < 1.5) ? l : 0;
};
// ---- live context management -------------------------------------------------
var AE = null;
function audioEnsure() {
  if (!AE) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { AE = new AudioEngine(new AC({ latencyHint: 'interactive' }), true); }
    catch (e) { try { console.error('[t8] audio failed', e); } catch (x) { } return null; }
  }
  if (AE.ctx.state === 'suspended') { AE.ctx.resume(); }
  return AE;
}
function audioRunning() { return !!AE && AE.ctx.state === 'running'; }
function monitorDevices(cb) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { cb([]); return; }
  navigator.mediaDevices.enumerateDevices().then(function (ds) {
    cb(ds.filter(function (d) { return d.kind === 'audioinput'; }));
  }).catch(function () { cb([]); });
}
function monitorConnect(deviceId, done) {
  var E = audioEnsure();
  if (!E || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { done('This browser cannot open an audio input.'); return; }
  var c = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
  if (deviceId) c.deviceId = { exact: deviceId };
  navigator.mediaDevices.getUserMedia({ audio: c, video: false }).then(function (stream) {
    monitorStop();
    E.monStream = stream; E.monSrc = E.ctx.createMediaStreamSource(stream); E.monSrc.connect(E.monG);
    var tr = stream.getAudioTracks()[0];
    done(null, tr ? tr.label : '');
  }).catch(function (e) { done(e && e.name === 'NotAllowedError' ? 'Microphone permission was refused.' : 'Could not open that input (' + (e && e.name || 'error') + ').'); });
}
function monitorStop() {
  if (!AE) return;
  if (AE.monSrc) { try { AE.monSrc.disconnect(); } catch (e) { } AE.monSrc = null; }
  if (AE.monStream) { AE.monStream.getTracks().forEach(function (t) { t.stop(); }); AE.monStream = null; }
}
