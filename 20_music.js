// ============================================================================
//  music: harmony plan + pattern generators (pure logic, no audio)
//  One 4-bar chord plan drives all three pitched layers so they agree.
// ============================================================================
var SCALES = {
  natural_minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11], minor_penta: [0, 3, 5, 7, 10]
};
var SCALE_LABEL = { natural_minor: 'minor', phrygian: 'phrygian', harmonic_minor: 'harmonic minor', minor_penta: 'minor pentatonic' };
var PROGS = {
  natural_minor: [[0, 0, 0, 0], [0, 0, 5, 6], [0, 3, 0, 6], [0, 5, 0, 4], [0, 0, 3, 0]],
  phrygian: [[0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 6, 0], [0, 1, 0, 0]],
  harmonic_minor: [[0, 0, 0, 0], [0, 3, 0, 4], [0, 0, 5, 4]],
  minor_penta: [[0, 0, 0, 0]]
};
var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// user-tweakable layer settings (the settings drawer writes into these)
var SP = { on: true, level: 0.5, decay: 0.22, tone: 2600, oct: 24, density: 0.4, space: 0.35, offset: 0.02, motion: 0.5, lockDrums: true };
var BP = { on: false, level: 0.5, decay: 1.6, density: 0.5, shimmer: 0.5, space: 0.6, oct: 3 };
var ENG = { bpm: 130, root: 36, scale: 'natural_minor', style: 'fourfloor', playing: false, density: 0.62, swing: 0 };
var AP = { cut: 900, res: 14, env: 1400, dec: 0.22, lvl: 0.55, drums: 0.9 };

var Mus = {
  harmBar: -1, harmProg: null, harmMask: null, stabVoice: null, bellMotif: null, bellAge: 99,
  drumMap: []
};
function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function pc12(x) { return ((x % 12) + 12) % 12; }
function chordTones(sc, deg) {
  var n = sc.length;
  if (n !== 7) { var o = [], ix = [0, 1, 3, 4]; for (var q = 0; q < ix.length; q++) if (ix[q] < n) o.push(sc[ix[q]]); return { pcs: o, deg: 0 }; }
  var pcs = [sc[deg % 7], sc[(deg + 2) % 7], sc[(deg + 4) % 7], sc[(deg + 6) % 7]];
  // a diminished triad as "home" sounds wrong under an acid line: fall back to the tonic chord
  if (pc12(pcs[2] - pcs[0]) === 6) return { pcs: [sc[0], sc[2], sc[4], sc[6]], deg: 0 };
  return { pcs: pcs, deg: deg };
}
function harmReset() { Mus.harmBar = -1; Mus.harmProg = null; Mus.harmMask = null; Mus.stabVoice = null; }
function nextChord(scaleName) {
  var sc = SCALES[scaleName] || SCALES.natural_minor;
  Mus.harmBar++; var b = Mus.harmBar % 4;
  if (!Mus.harmProg || b === 0) {
    var pr = PROGS[scaleName] || [[0, 0, 0, 0]];
    Mus.harmProg = (mrand() < 0.45) ? pr[0] : pr[Math.floor(mrand() * pr.length)];
    Mus.harmMask = null;
  }
  var ct = chordTones(sc, Mus.harmProg[b]);
  return { chord: ct.pcs, deg: ct.deg, b: b };
}
// 303-style bass. `slide` on step i means: hold this note and glide INTO step i+1 (same meaning as
// the T-8 / TB-303 step flag and as the Python follower).
function genBass(b, chord, root, scaleName, density) {
  var sc = SCALES[scaleName] || SCALES.natural_minor;
  var ch = (chord && chord.length) ? chord : [0, 3, 7, 10];
  var rt = ch[0], third = ch[1 % ch.length], fifth = ch[2 % ch.length], seventh = ch[ch.length - 1];
  var dk = (density == null ? 0.62 : density) / 0.62, q, i;
  if (!Mus.harmMask || b === 0) {
    Mus.harmMask = [];
    for (q = 0; q < 16; q++) { var pq = (q % 4 === 0) ? 0.95 : ((q % 2 === 0) ? 0.72 : 0.55); Mus.harmMask.push(mrand() < pq * dk); }
    Mus.harmMask[0] = true;
  }
  var mask = Mus.harmMask.slice();
  for (i = 0; i < 16; i++) { if (mrand() < ((b < 3) ? 0.12 : 0.30)) mask[i] = (i % 4 === 0) ? true : !mask[i]; }
  if (b === 3) for (var f = 12; f < 16; f++) mask[f] = mask[f] || mrand() < 0.5;
  var cells = [];
  for (i = 0; i < 16; i++) {
    if (!mask[i]) { cells.push({ note: null, accent: false, slide: false }); continue; }
    var r = mrand(), pc;
    if (i % 4 === 0) pc = (r < 0.72) ? rt : ((r < 0.88) ? fifth : seventh);
    else if (i % 2 === 0) pc = (r < 0.42) ? rt : ((r < 0.62) ? fifth : ((r < 0.78) ? third : seventh));
    else {
      if (r < 0.30) pc = rt; else if (r < 0.45) pc = fifth; else if (r < 0.60) pc = seventh;
      else {
        var cands = [];
        for (var s = 0; s < sc.length; s++) { var dd = Math.min(pc12(sc[s] - rt), pc12(rt - sc[s])); if (dd > 0 && dd <= 2) cands.push(sc[s]); }
        pc = cands.length ? cands[Math.floor(mrand() * cands.length)] : third;
      }
    }
    var note = root + pc;
    if (pc === rt) { if (mrand() < 0.36) note += 12; } else if (mrand() < 0.11) note += 12;
    var accent = mrand() < 0.30 * ((i % 4 === 0) ? 1.4 : 1.0) * ((note >= root + 12) ? 1.3 : 1.0);
    cells.push({ note: clamp(note, 12, 96), accent: accent, slide: false, pc: pc });
  }
  for (i = 0; i < 15; i++) {
    var a = cells[i], nx = cells[i + 1];
    if (a.note != null && nx.note != null && ch.indexOf(nx.pc) >= 0 && nx.note !== a.note && mrand() < 0.30) a.slide = true;
  }
  return cells;
}
function genDrums(style) {
  var P = []; for (var i = 0; i < 16; i++) P.push([]);
  function add(i, inst, v, pr) { P[i].push([inst, v, pr]); }
  var h, b;
  if (style === 'fourfloor') {
    add(0, 'kick', 1, 1); add(4, 'kick', 1, 1); add(8, 'kick', 1, 1); add(12, 'kick', 1, 1); add(14, 'kick', 0.7, 0.18);
    add(4, 'clap', 0.9, 1); add(12, 'clap', 0.9, 1);
    for (h = 0; h < 16; h++) { if (h % 4 !== 2) add(h, 'hat', ((h % 2) ? 0.42 : 0.7), 0.9); }
    add(2, 'ohat', 0.8, 0.85); add(6, 'ohat', 0.8, 0.85); add(10, 'ohat', 0.8, 0.85); add(14, 'ohat', 0.8, 0.85);
    add(15, 'tom', 0.7, 0.12);
  } else if (style === 'breaks') {
    add(0, 'kick', 1, 1); add(7, 'kick', 0.9, 0.85); add(10, 'kick', 1, 1); add(13, 'kick', 0.7, 0.3);
    add(4, 'snare', 1, 1); add(12, 'snare', 1, 1); add(6, 'snare', 0.35, 0.4); add(11, 'snare', 0.3, 0.35);
    for (b = 0; b < 16; b += 2) add(b, 'hat', 0.6, 0.85);
    add(15, 'hat', 0.4, 0.5); add(14, 'ohat', 0.75, 0.6);
  } else {
    add(0, 'kick', 1, 1); add(8, 'kick', 0.95, 1); add(11, 'kick', 0.6, 0.25);
    add(12, 'clap', 0.85, 0.7);
    add(2, 'hat', 0.55, 0.7); add(6, 'hat', 0.55, 0.7); add(10, 'hat', 0.55, 0.7); add(14, 'hat', 0.55, 0.7);
  }
  return P;
}
function voiceChord(pcs, base, prev, lo, hi) {
  var out = [];
  for (var i = 0; i < pcs.length; i++) {
    var n = base + pc12(pcs[i]);
    if (prev && prev.length) {
      var ref = prev[Math.min(i, prev.length - 1)], best = n, bd = Math.abs(n - ref);
      if (n - 12 >= lo && Math.abs(n - 12 - ref) < bd) { best = n - 12; bd = Math.abs(n - 12 - ref); }
      if (n + 12 <= hi && Math.abs(n + 12 - ref) < bd) { best = n + 12; }
      n = best;
    }
    while (n < lo) n += 12; while (n > hi) n -= 12;
    out.push(n);
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}
// stab: 3-note shell voicing of the current chord (3rd/5th/7th, the bass owns the root),
// voice-led from the previous bar, placed in the gaps the bass and drums leave.
function genStab(pat, chord, root) {
  var n = 16, cells = new Array(n);
  var mo = SP.motion;
  var pcs = (chord && chord.length) ? chord : [0, 3, 7, 10];
  var base = root + SP.oct, lo = base - 5, hi = base + 17;
  var shell = (pcs.length >= 4) ? [pcs[1], pcs[2], pcs[3]] : pcs.slice(0, 3);
  var full = voiceChord(shell, base, Mus.stabVoice, lo, hi);
  Mus.stabVoice = full;
  var arp = mrand() < mo * 0.6;
  var dir = mrand() < 0.5 ? 1 : -1, ai = 0;
  for (var i = 0; i < n; i++) {
    var bassRest = !(pat[i] && pat[i].note != null);
    var p;
    if (i % 4 === 2) p = 0.7; else if (i % 2 === 1) p = 0.22 + mo * 0.28; else p = 0.10;
    if (bassRest) p += 0.22;
    p *= (0.45 + SP.density);
    if (pat[i] && pat[i].accent) p *= 0.4;
    if (SP.lockDrums) { var dm = Mus.drumMap[i]; if (dm) { if (dm.snare) p *= 0.18; else if (dm.kick) p *= 0.6; if (dm.hat && !dm.snare && !dm.kick) p *= 1.5; } }
    if (mrand() > p) { cells[i] = null; continue; }
    var notes, acc = mrand() < 0.35, dec = 1, ton = 1;
    if (arp) {
      var tone = full[((ai % full.length) + full.length) % full.length]; ai += dir;
      notes = [tone + ((mrand() < 0.2) ? 12 : 0)]; dec = 0.8; ton = 1.05;
    } else {
      var r = mrand();
      if (r < 0.18 + mo * 0.32) { notes = [full[full.length - 1] + ((mrand() < 0.3) ? 12 : 0)]; dec = 0.7; ton = 1.15; }
      else if (r < 0.62) { notes = full.slice(); }
      else { notes = [full[0], full[full.length - 1]]; }
      if (mrand() < mo * 0.35) { dec = 1.7; ton = 1.2; }
    }
    if (mrand() < mo * 0.15) { for (var z = 0; z < notes.length; z++) notes[z] += 12; }
    cells[i] = { notes: notes, accent: acc, dec: dec, ton: ton };
  }
  return cells;
}
// bells: a 2-4 note motif stored as rungs on the "chord ladder" (chord tones + the 9th when it is a
// whole step), kept for four bars, so it follows chord changes without leaving the harmony.
function genBell(fromPattern, chord, root, scaleName) {
  var sc = SCALES[scaleName] || SCALES.natural_minor;
  var pcs = (chord && chord.length) ? chord : [0, 3, 7, 10];
  var ladder = pcs.slice();
  var nn = pc12(pcs[0] + 2);
  if (sc.indexOf(nn) >= 0 && ladder.indexOf(nn) < 0) ladder.push(nn);
  ladder.sort(function (a, b) { return a - b; });
  if (fromPattern) Mus.bellAge++;
  var mt = Mus.bellMotif;
  if (!mt || Mus.bellAge >= 4 || mt.root !== root || mt.scale !== scaleName) {
    Mus.bellAge = 0;
    var nN = 2 + Math.floor(mrand() * 3);
    var cand = [0, 3, 6, 8, 10, 12, 14], ms = [], mi = [];
    for (var k = 0; k < nN && cand.length > 0; k++) {
      var ci = Math.floor(mrand() * cand.length);
      ms.push(cand[ci]); cand.splice(ci, 1);
      mi.push({ ix: Math.floor(mrand() * 4), up: mrand() < 0.3 });
    }
    mt = Mus.bellMotif = { root: root, scale: scaleName, steps: ms, idx: mi };
  }
  var cells = []; for (var i = 0; i < 16; i++) cells.push(null);
  var base = root + 12 * BP.oct;
  for (var j = 0; j < mt.steps.length; j++) {
    var st = mt.steps[j];
    if (mrand() < 0.50 + BP.density * 0.5) {
      var mm = mt.idx[j], pc = ladder[mm.ix % ladder.length];
      cells[st] = { note: base + pc + (mm.up ? 12 : 0), vel: 0.8 + mrand() * 0.2, oct: mrand() < 0.18 };
    }
  }
  if (mrand() < BP.density * 0.6) {
    var ex = Math.floor(mrand() * 16);
    if (!cells[ex]) cells[ex] = { note: base + ladder[Math.floor(mrand() * ladder.length)], vel: 0.45, oct: false };
  }
  return cells;
}

// A bar of music for the internal engine (standalone + test clock).
function seqNewBar() {
  var h = nextChord(ENG.scale);
  var pat = genBass(h.b, h.chord, ENG.root, ENG.scale, ENG.density);
  var dp = genDrums(ENG.style);
  // realise the probabilistic drum hits now so the "lock to drums" map matches what will play
  var hits = [], i, k;
  Mus.drumMap = [];
  for (i = 0; i < 16; i++) {
    hits.push([]);
    for (k = 0; k < dp[i].length; k++) {
      var H = dp[i][k];
      if (mrand() > H[2]) continue;
      hits[i].push({ inst: H[0], vel: H[1] });
      var dm = Mus.drumMap[i] || (Mus.drumMap[i] = {});
      if (H[0] === 'kick') dm.kick = true; else if (H[0] === 'snare' || H[0] === 'clap') dm.snare = true; else if (H[0] === 'hat' || H[0] === 'ohat') dm.hat = true;
    }
    // an open hat chokes the closed hat on the same step
    var hasOpen = hits[i].some(function (x) { return x.inst === 'ohat'; });
    if (hasOpen) hits[i] = hits[i].filter(function (x) { return x.inst !== 'hat'; });
  }
  return {
    chord: h.chord, deg: h.deg, b: h.b, root: ENG.root, scale: ENG.scale, pat: pat, drums: hits,
    stab: genStab(pat, h.chord, ENG.root), bell: genBell(true, h.chord, ENG.root, ENG.scale)
  };
}
function keyLabel(scale, root) { return NOTE_NAMES[pc12(root)] + ' ' + (SCALE_LABEL[scale] || scale); }
// events of one step, in the order a listener should receive them
function seqEmitStep(bar, i, bpm, emit) {
  var c = bar.pat[i], hs = bar.drums[i], k;
  emit('step', { i: i, on: c.note != null, note: c.note, accent: !!c.accent, slide: !!c.slide, bpm: bpm });
  for (k = 0; k < hs.length; k++) emit('drum', { inst: hs[k].inst, vel: Math.round(hs[k].vel * 127), step: i });
  if (SP.on && bar.stab[i]) emit('stab', bar.stab[i]);
  if (BP.on && bar.bell[i]) emit('bell', bar.bell[i]);
}
