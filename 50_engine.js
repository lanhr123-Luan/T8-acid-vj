// ============================================================================
//  engine: the built-in sequencer used when no T-8 is connected.
//  A worker ticks every 25 ms; each tick schedules whatever falls inside the
//  next 140 ms on the audio clock, so timing never depends on the UI thread.
// ============================================================================
var Engine = {
  playing: false, stepN: 0, nextT: 0, bar: null, worker: null, timer: null, ahead: 0.14, gap: 0.025, lastTick: 0, count: 0,
  due: function (t) { return performance.now() + (t - AE.ctx.currentTime) * 1000 + AE.outputLatency() * 1000; },
  patMsg: function (b) { return { root: b.root, scale: b.scale, chord: b.chord, bar: b.b, cells: b.pat }; },
  start: function () {
    var E = audioEnsure();
    if (!E) { UI.toast('This browser has no Web Audio, so there is nothing to play.'); return; }
    if (this.playing) return;
    harmReset(); Mus.bellMotif = null; Mus.bellAge = 99;
    this.playing = true; ENG.playing = true; this.stepN = 0; this.bar = null; this.lastTick = 0; this.count = 0;
    this.nextT = E.ctx.currentTime + 0.12;
    E.applyParams(); E.setTempo(ENG.bpm);
    VQ.push('start', {}, this.due(this.nextT) - 2);
    this.tickOn(); this.tick();
  },
  stop: function () {
    if (!this.playing) return;
    this.playing = false; ENG.playing = false; this.tickOff();
    if (AE) AE.bassOff(AE.ctx.currentTime);
    VQ.clear(); Bus.stop();
  },
  toggle: function () { if (this.playing) this.stop(); else this.start(); },
  // throw the phrase away and start a fresh one on the next step
  regen: function () {
    harmReset(); Mus.bellMotif = null; Mus.bellAge = 99;
    if (!this.playing) return;
    this.bar = seqNewBar();
    VQ.push('pattern', this.patMsg(this.bar), this.due(this.nextT) - 2);
  },
  tickOn: function () {
    this.tickOff();
    var self = this;
    try {
      var blob = new Blob(['setInterval(function(){postMessage(0)},25);'], { type: 'text/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = function () { self.tick(); };
    } catch (e) { this.worker = null; this.timer = setInterval(function () { self.tick(); }, 25); }
  },
  tickOff: function () {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },
  tick: function () {
    if (!this.playing || !AE) return;
    var ctx = AE.ctx;
    if (ctx.state !== 'running') { ctx.resume(); return; }
    var now = ctx.currentTime, sd = 60 / ENG.bpm / 4;
    // 140 ms of lookahead is plenty while ticks arrive on time. If this thread keeps being held up (very
    // heavy frames, a slow machine) look further ahead instead, so the music keeps its tempo regardless.
    var gap = this.lastTick ? now - this.lastTick : 0.025; this.lastTick = now;
    this.gap = Math.max(gap, this.gap * Math.exp(-gap / 4));
    this.ahead = clamp(this.gap * 1.6 + 0.06, 0.14, 0.9);
    if (this.nextT < now - 0.05) this.nextT = now + 0.04;      // the page was frozen for a while: re-sync, never burst
    while (this.nextT < now + this.ahead) {
      var i = this.stepN, t = this.nextT;
      if (i === 0 || !this.bar) {
        this.bar = seqNewBar();
        VQ.push('pattern', this.patMsg(this.bar), this.due(t) - 2);
      }
      this.playStep(this.bar, i, t, sd);
      this.stepN = (i + 1) % 16; this.nextT += sd; this.count++;
    }
    if (document.hidden) VQ.flush(performance.now() + 1e6);    // nothing is drawn while hidden: do not let events pile up
  },
  playStep: function (bar, i, t, sd) {
    var E = AE, c = bar.pat[i], prev = i > 0 ? bar.pat[i - 1] : null, hs = bar.drums[i], k;
    var ts = t + ((i % 2) ? ENG.swing * sd * 0.5 : 0);         // swing pushes the off-sixteenths late
    if (c.note != null) E.bass(ts, c.note, !!c.accent, !!(prev && prev.slide && prev.note != null), !!c.slide, sd);
    else if (E.bassOn) E.bassOff(ts);
    for (k = 0; k < hs.length; k++) E.drum(hs[k].inst, hs[k].vel, ts);
    if (bar.stab[i]) E.stab(bar.stab[i], ts);
    if (bar.bell[i]) E.bell(bar.bell[i], ts);
    var due = this.due(ts);
    seqEmitStep(bar, i, ENG.bpm, function (type, ev) { VQ.push(type, ev, due); });
  }
};
