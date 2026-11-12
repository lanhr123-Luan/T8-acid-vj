// ============================================================================
//  transport: where the music comes from.
//    'hw'         : the Python follower pushes T-8 clock, bass and drum events over SSE
//    'standalone' : the built-in engine
// ============================================================================
var HW = {
  es: null, connected: false, cur: null, next: null, pred: 0, cOff: null, cOffA: 0, lastI: -1, mark: -1, seq: 0, lastMsg: 0, drumAcc: [],
  barFrom: function (m) {
    var cells = m.cells || [], root = (m.root != null) ? m.root : 36, scale = m.scale || 'natural_minor', chord = (m.chord && m.chord.length) ? m.chord : [0, 3, 7, 10];
    return { msg: m, pat: cells, root: root, scale: scale, chord: chord, stab: genStab(cells, chord, root), bell: genBell(true, chord, root, scale) };
  },
  connect: function () {
    var self = this;
    if (!window.EventSource) { UI.setConn('error', 'This browser cannot receive the event stream.'); return; }
    var es = this.es = new EventSource('/events');
    es.onopen = function () { self.connected = true; UI.setConn('ok'); };
    es.onerror = function () { self.connected = false; UI.setConn('lost'); if (Sig.running) { VQ.clear(); Bus.stop(); } };
    es.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } self.handle(m); };
  },
  // play the chord / bell cells of one step of a bar at an audio-clock time
  fire: function (bar, i, when) {
    if (!bar) return;
    var st = bar.stab[i], be = bar.bell[i], due = performance.now() + (when - AE.ctx.currentTime) * 1000 + AE.outputLatency() * 1000;
    if (st && SP.on) { AE.stab(st, when); VQ.push('stab', st, due); }
    if (be && BP.on) { AE.bell(be, when); VQ.push('bell', be, due); }
  },
  // sound is off: the picture still gets the chord and bell events, timed by arrival
  fireSilent: function (bar, i, due) {
    if (!bar) return;
    if (bar.stab[i] && SP.on) VQ.push('stab', bar.stab[i], due);
    if (bar.bell[i] && BP.on) VQ.push('bell', bar.bell[i], due);
  },
  handle: function (m) {
    var now = performance.now(), t = m.type;
    this.lastMsg = now;
    if (t === 'hello') { this.connected = true; UI.setConn('ok'); this.cOff = null; }
    else if (t === 'start') {
      VQ.clear(); this.cur = this.next = null; this.lastI = -1; this.mark = -1; this.seq = 0; this.pred = 0;
      Mus.drumMap = []; this.drumAcc = []; Mus.bellMotif = null; Mus.bellAge = 99; Mus.stabVoice = null;
      VQ.push('start', {}, now);
    }
    else if (t === 'stop') { VQ.clear(); VQ.push('stop', {}, now); }
    else if (t === 'pattern') {
      var b = this.barFrom(m);
      if (m.lead) this.next = b;                                   // arrives a few steps early: becomes current on the downbeat
      else { this.cur = b; VQ.push('pattern', m, now); }
    }
    else if (t === 'step') {
      var i = m.i | 0;
      if (i === 0) { Mus.drumMap = this.drumAcc; this.drumAcc = []; }       // what the T-8's drums did during the last bar
      if (i === 0 && this.next) { this.cur = this.next; this.next = null; VQ.push('pattern', this.cur.msg, now); }
      VQ.push('step', m, now);
      this.seq++;
      if (m.bpm > 20 && AE) AE.setTempo(m.bpm);
      if (audioRunning() && m.bpm > 20) {
        var a = AE.ctx.currentTime, sd = 60 / m.bpm / 4, off = SP.offset;
        if (m.ts != null) {
          // The follower stamps every event with its own clock. A delivery can be late (network, a busy page) but
          // never early, so the smallest difference ever seen between the two clocks is the true one. It is allowed
          // to creep upwards slowly, which follows any drift between the clocks.
          var d = a - m.ts / 1000;
          if (this.cOff == null || d - this.cOff > 0.25) this.cOff = d;
          else this.cOff = Math.min(d, this.cOff + 0.0002 * Math.max(0, a - this.cOffA));
          this.cOffA = a;
          this.pred = m.ts / 1000 + this.cOff;
        } else {
          // (older follower without time stamps) phase-locked estimate: jitter averages out
          var want = this.pred + sd, err = a - want;
          if (!this.pred || Math.abs(err) > sd * 0.5) this.pred = a; else this.pred = want + err * 0.12;
        }
        // this step, unless it was already scheduled one step ago
        if (this.mark !== this.seq) this.fire(this.cur, i, Math.max(a + 0.003, this.pred + off));
        // the next step, scheduled now so that it lands on the grid whatever the network does
        var ni = (i + 1) % 16, nb = (ni === 0) ? (this.next || null) : this.cur;
        if (nb) { this.fire(nb, ni, Math.max(a + 0.003, this.pred + sd + off)); this.mark = this.seq + 1; }
      } else { this.pred = 0; this.fireSilent(this.cur, i, now); }
      this.lastI = i;
    }
    else if (t === 'drum') {
      VQ.push('drum', m, now);
      var s = (m.step | 0) & 15, dm = this.drumAcc[s] || (this.drumAcc[s] = {});
      if (m.inst === 'kick') dm.kick = true; else if (m.inst === 'snare' || m.inst === 'clap') dm.snare = true; else if (m.inst === 'hat' || m.inst === 'ohat') dm.hat = true;
      if (m.inst === 'kick' && audioRunning() && UIP.pump > 0) AE.duck(AE.ctx.currentTime + 0.002, UIP.pump * clamp((m.vel || 100) / 127, 0.3, 1));
    }
    if (document.hidden) VQ.flush(now + 1e6);
  }
};
var Transport = {
  init: function () {
    if (T8.mode === 'hw') HW.connect();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) App.lastT = 0; });
  },
  toggle: function () { if (T8.mode !== 'hw') Engine.toggle(); },
  regen: function () { if (T8.mode !== 'hw') Engine.regen(); }
};
