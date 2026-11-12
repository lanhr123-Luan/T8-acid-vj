// Injected into pages under test: replaces EventSource with a deterministic T-8 simulator.
// Emits the same message schema as the Python Follower (start / pattern / step / drum).
(function () {
  var BPM = window.__FAKE_BPM || 130;
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = mulberry(1234);
  var SC = [0, 2, 3, 5, 7, 8, 10];
  function genPattern(bar) {
    var cells = [];
    for (var i = 0; i < 16; i++) {
      var on = (i % 4 === 0) ? rnd() < 0.95 : rnd() < 0.6;
      if (!on) { cells.push({ note: null, accent: false, slide: false }); continue; }
      var pc = (i % 4 === 0) ? 0 : SC[Math.floor(rnd() * SC.length)];
      cells.push({ note: 36 + pc + (rnd() < 0.25 ? 12 : 0), accent: rnd() < 0.3, slide: rnd() < 0.2 });
    }
    return { type: 'pattern', steps: 16, root: 36, scale: 'natural_minor', cells: cells, chord: [0, 3, 7, 10], deg: 0, bar: bar % 4 };
  }
  function FakeES(url) {
    var self = this; this.readyState = 1; this.onmessage = null; this.onopen = null; this.onerror = null;
    var step = 0, bar = 0, pat = null;
    function send(o) { if (self.onmessage) self.onmessage({ data: JSON.stringify(o) }); }
    setTimeout(function () {
      if (self.onopen) self.onopen({});
      send({ type: 'hello' }); send({ type: 'start' });
      pat = genPattern(0); send(pat);
      var sd = 60000 / BPM / 4;
      var t0 = performance.now(), n = 0;
      function tick() {
        var i = step % 16;
        if (i === 0 && step > 0) { bar++; pat = genPattern(bar); send(pat); }
        var c = pat.cells[i];
        send({ type: 'step', i: i, note: c.note, accent: c.accent, slide: c.slide, on: c.note != null, bpm: BPM });
        if (i % 4 === 0) send({ type: 'drum', inst: 'kick', vel: 110, step: i });
        if (i % 8 === 4) send({ type: 'drum', inst: 'clap', vel: 100, step: i });
        if (i % 2 === 0) send({ type: 'drum', inst: 'hat', vel: 80, step: i });
        if (i % 4 === 2) send({ type: 'drum', inst: 'ohat', vel: 90, step: i });
        if (i === 15 && bar % 4 === 3) send({ type: 'drum', inst: 'tom', vel: 90, step: i });
        step++; n++;
        var next = t0 + n * sd;
        setTimeout(tick, Math.max(0, next - performance.now()));
      }
      tick();
    }, 300);
  }
  FakeES.prototype.close = function () { };
  window.EventSource = FakeES;
})();
