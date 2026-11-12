// ============================================================================
//  ui: transport bar, 16 step pads, scene switcher, settings drawer, shortcuts
// ============================================================================
var Rec = {
  mr: null, chunks: [], t0: 0,
  can: function () { return !!(window.MediaRecorder && App.canvas && App.canvas.captureStream); },
  start: function () {
    if (!this.can()) { UI.toast('Recording is not supported in this browser.'); return; }
    var stream = App.canvas.captureStream(60), self = this;
    if (AE && AE.recDest) AE.recDest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
    var types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'], mime = '';
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
    try { this.mr = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 16000000, audioBitsPerSecond: 256000 }); }
    catch (e) { UI.toast('Recording could not start (' + e.name + ').'); return; }
    this.chunks = []; this.t0 = performance.now();
    this.mr.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
    this.mr.onstop = function () {
      var blob = new Blob(self.chunks, { type: 'video/webm' }), a = document.createElement('a'), d = new Date();
      function p(n) { return (n < 10 ? '0' : '') + n; }
      a.href = URL.createObjectURL(blob);
      a.download = 't8-acid-vj-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.webm';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 20000);
      UI.toast('Saved ' + a.download + ' (' + (blob.size / 1048576).toFixed(1) + ' MB)', 5000);
      self.mr = null; self.chunks = []; UI.setRec(false);
    };
    this.mr.start(1000); UI.setRec(true);
    UI.toast(AE && AE.recDest ? 'Recording picture and sound. Press R to finish.' : 'Recording picture only (sound is off). Press R to finish.', 4000);
  },
  stop: function () { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); },
  toggle: function () { if (this.mr) this.stop(); else this.start(); }
};
var UI = {
  el: {}, pads: [], lastMove: 0, bpmShown: -1, conn: 'wait', sound: false, hideAll: false, toastT: 0,
  saved: function (k) { try { var v = localStorage.getItem('t8vj.' + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
  save: function (k, v) { try { localStorage.setItem('t8vj.' + k, JSON.stringify(v)); } catch (e) { } },
  fmt2: function (v) { return (+v).toFixed(2); },
  fmtPct: function (v) { return Math.round(v * 100) + '%'; },
  fmtMs: function (v) { return Math.round(v) + ' ms'; },
  fmtHz: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz'; },
  fmtS: function (v) { return (+v).toFixed(2) + ' s'; },
  // ---- control rows -------------------------------------------------------
  row: function (parent, o) {
    var d = document.createElement('div'), id = 'ctl_' + o.k.replace(/[^a-z0-9]/gi, '_'), self = this, val = this.saved(o.k), inp;
    d.className = 'row' + (o.type === 'check' ? ' chk' : '');
    var lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = o.label;
    if (o.type === 'check') {
      if (typeof val !== 'boolean') val = !!o.v;
      inp = document.createElement('input'); inp.type = 'checkbox'; inp.id = id; inp.checked = val;
      d.appendChild(inp); d.appendChild(lab);
      inp.addEventListener('change', function () { self.save(o.k, inp.checked); o.set(inp.checked, true); });
    } else if (o.type === 'select') {
      inp = document.createElement('select'); inp.id = id;
      var ok = false;
      o.opts.forEach(function (p) { var op = document.createElement('option'); op.value = String(p[0]); op.textContent = p[1]; inp.appendChild(op); if (String(p[0]) === String(val)) ok = true; });
      if (!ok) val = o.v;
      inp.value = String(val);
      d.appendChild(lab); d.appendChild(document.createElement('span')); d.appendChild(inp);
      inp.addEventListener('change', function () { self.save(o.k, inp.value); o.set(inp.value, true); });
      val = inp.value;
    } else {
      if (typeof val !== 'number' || !(val >= o.min && val <= o.max)) val = o.v;
      inp = document.createElement('input'); inp.type = 'range'; inp.id = id; inp.min = o.min; inp.max = o.max; inp.step = o.step; inp.value = val;
      var out = document.createElement('output'), f = o.fmt || this.fmt2; out.textContent = f(val); out.htmlFor = id;
      d.appendChild(lab); d.appendChild(out); d.appendChild(inp);
      inp.addEventListener('input', function () { var v = parseFloat(inp.value); out.textContent = f(v); self.save(o.k, v); o.set(v, true); });
      // double-click a slider to put it back to its default
      inp.addEventListener('dblclick', function () { inp.value = o.v; out.textContent = f(o.v); self.save(o.k, o.v); o.set(o.v, true); });
    }
    parent.appendChild(d);
    o.set(val, false);
    return d;
  },
  group: function (title, cls) {
    var s = document.createElement('section'); if (cls) s.className = cls;
    var h = document.createElement('h2'); h.textContent = title; s.appendChild(h);
    this.el.groups.appendChild(s); return s;
  },
  audioParams: function () { if (AE) AE.applyParams(); },
  buildDrawer: function () {
    var self = this, hw = T8.mode === 'hw', g, ap = function () { self.audioParams(); };
    this.el.sceneGroup = this.group('Scene');
    g = this.group('Picture');
    this.row(g, { k: 'bloom', label: 'Glow', min: 0, max: 2, step: 0.05, v: 1, set: function (v) { UIP.bloom = v; } });
    this.row(g, { k: 'punch', label: 'Impact of the beat', min: 0, max: 2, step: 0.05, v: 1, set: function (v) { UIP.punch = v; } });
    this.row(g, { k: 'grain', label: 'Film grain', min: 0, max: 1.5, step: 0.05, v: 0.5, set: function (v) { UIP.grain = v; } });
    this.row(g, { k: 'lens', label: 'Lens (fringing, vignette)', min: 0, max: 1.5, step: 0.05, v: 0.6, set: function (v) { UIP.lens = v; } });
    this.row(g, { k: 'dof', label: 'Depth of field (Stage, Moon)', min: 0, max: 2, step: 0.05, v: 1, set: function (v) { UIP.dof = v; } });
    this.row(g, { k: 'res', label: 'Resolution', type: 'select', v: 'auto', opts: [['auto', 'Automatic (keeps it smooth)'], ['1', 'Full'], ['0.75', '75%'], ['0.5', '50%']],
      set: function (v) { if (QS.res) return; if (v === 'auto') { App.resMode = 'auto'; } else { App.resMode = 'fixed'; App.resScale = parseFloat(v) || 1; } if (App.canvas && gl) appResize(); } });
    this.row(g, { k: 'avDelay', label: 'Delay the picture', min: 0, max: 400, step: 5, v: 0, fmt: this.fmtMs, set: function (v) { UIP.avDelay = v; VQ.delayMs = v; } });
    this.row(g, { k: 'autoBars', label: 'Auto: change scene every', type: 'select', v: '16', opts: [['8', '8 bars'], ['16', '16 bars'], ['32', '32 bars'], ['64', '64 bars']], set: function (v) { UIP.autoBars = parseInt(v, 10) || 16; } });
    g = this.group('Sound');
    this.row(g, { k: 'volume', label: 'Volume', min: 0, max: 1.2, step: 0.02, v: 0.9, set: function (v) { UIP.volume = v; ap(); } });
    this.row(g, { k: 'pump', label: 'Pump under the kick', min: 0, max: 0.8, step: 0.02, v: 0.3, set: function (v) { UIP.pump = v; } });
    if (hw) {
      g = this.group('T-8 audio through this output');
      var mon = document.createElement('p'); mon.className = 'note';
      mon.textContent = 'Routes the T-8\'s USB audio into the same output as the chords and bells, so both arrive together.';
      g.appendChild(mon);
      var b = document.createElement('button'); b.className = 'btn wide'; b.textContent = 'Listen to the T-8 here'; g.appendChild(b);
      var devRow = this.row(g, { k: 'monDev', label: 'Input', type: 'select', v: '', opts: [['', 'Default input']], set: function (v, user) { self.monDev = v; if (user && AE && AE.monSrc) self.monitorOn(); } });
      this.el.monSel = devRow.querySelector('select'); this.el.monBtn = b;
      this.row(g, { k: 'monLvl', label: 'Level', min: 0, max: 1.5, step: 0.02, v: 0.9, set: function (v) { UIP.monLvl = v; if (AE) AE.monG.gain.setTargetAtTime(v, AE.ctx.currentTime, 0.03); } });
      b.addEventListener('click', function () { if (AE && AE.monSrc) { monitorStop(); self.setMon(false); } else self.monitorOn(); });
    }
    g = this.group('Chords');
    this.row(g, { k: 'sOn', label: 'Play chords', type: 'check', v: true, set: function (v) { SP.on = v; ap(); } });
    this.row(g, { k: 'sLvl', label: 'Level', min: 0, max: 1, step: 0.02, v: 0.5, set: function (v) { SP.level = v; ap(); } });
    this.row(g, { k: 'sDec', label: 'Length', min: 0.05, max: 0.8, step: 0.01, v: 0.22, fmt: this.fmtS, set: function (v) { SP.decay = v; } });
    this.row(g, { k: 'sTone', label: 'Brightness', min: 500, max: 8000, step: 50, v: 2600, fmt: this.fmtHz, set: function (v) { SP.tone = v; } });
    this.row(g, { k: 'sDen', label: 'How often', min: 0, max: 1, step: 0.02, v: 0.4, fmt: this.fmtPct, set: function (v) { SP.density = v; } });
    this.row(g, { k: 'sMot', label: 'Movement (arpeggios, leaps)', min: 0, max: 1, step: 0.02, v: 0.5, fmt: this.fmtPct, set: function (v) { SP.motion = v; } });
    this.row(g, { k: 'sSpc', label: 'Echo and reverb', min: 0, max: 1, step: 0.02, v: 0.35, fmt: this.fmtPct, set: function (v) { SP.space = v; ap(); } });
    this.row(g, { k: 'sOct', label: 'Register', type: 'select', v: '24', opts: [['12', 'Low'], ['24', 'Middle'], ['36', 'High']], set: function (v) { SP.oct = parseInt(v, 10) || 24; Mus.stabVoice = null; } });
    this.row(g, { k: 'sLock', label: 'Leave room for the snare', type: 'check', v: true, set: function (v) { SP.lockDrums = v; } });
    if (hw) this.row(g, { k: 'sOff', label: 'Timing against the T-8', min: -40, max: 200, step: 1, v: 20, fmt: this.fmtMs, set: function (v) { SP.offset = v / 1000; } });
    else SP.offset = 0;
    g = this.group('Bells');
    this.row(g, { k: 'bOn', label: 'Play bells', type: 'check', v: !hw, set: function (v) { BP.on = v; ap(); } });
    this.row(g, { k: 'bLvl', label: 'Level', min: 0, max: 1, step: 0.02, v: 0.5, set: function (v) { BP.level = v; ap(); } });
    this.row(g, { k: 'bDec', label: 'Ring time', min: 0.3, max: 4, step: 0.05, v: 1.6, fmt: this.fmtS, set: function (v) { BP.decay = v; } });
    this.row(g, { k: 'bDen', label: 'How often', min: 0, max: 1, step: 0.02, v: 0.5, fmt: this.fmtPct, set: function (v) { BP.density = v; } });
    this.row(g, { k: 'bShm', label: 'Shimmer', min: 0, max: 1, step: 0.02, v: 0.5, fmt: this.fmtPct, set: function (v) { BP.shimmer = v; } });
    this.row(g, { k: 'bSpc', label: 'Echo and reverb', min: 0, max: 1, step: 0.02, v: 0.6, fmt: this.fmtPct, set: function (v) { BP.space = v; ap(); } });
    this.row(g, { k: 'bOct', label: 'Register', type: 'select', v: '3', opts: [['2', 'Middle'], ['3', 'High'], ['4', 'Very high']], set: function (v) { BP.oct = parseInt(v, 10) || 3; } });
    if (!hw) {
      g = this.group('Bass');
      this.row(g, { k: 'aCut', label: 'Cutoff', min: 120, max: 3000, step: 10, v: 900, fmt: this.fmtHz, set: function (v) { AP.cut = v; } });
      this.row(g, { k: 'aRes', label: 'Resonance', min: 1, max: 22, step: 0.5, v: 14, set: function (v) { AP.res = v; if (AE) AE.bF1.Q.setTargetAtTime(v, AE.ctx.currentTime, 0.03); } });
      this.row(g, { k: 'aEnv', label: 'Envelope depth', min: 0, max: 5000, step: 20, v: 1400, fmt: this.fmtHz, set: function (v) { AP.env = v; } });
      this.row(g, { k: 'aDec', label: 'Decay', min: 0.05, max: 0.8, step: 0.01, v: 0.22, fmt: this.fmtS, set: function (v) { AP.dec = v; } });
      this.row(g, { k: 'aLvl', label: 'Level', min: 0, max: 1, step: 0.02, v: 0.55, set: function (v) { AP.lvl = v; ap(); } });
      g = this.group('Drums');
      this.row(g, { k: 'dSty', label: 'Groove', type: 'select', v: 'fourfloor', opts: [['fourfloor', 'Four on the floor'], ['breaks', 'Breaks'], ['minimal', 'Minimal']], set: function (v) { ENG.style = v; } });
      this.row(g, { k: 'dLvl', label: 'Level', min: 0, max: 1.2, step: 0.02, v: 0.9, set: function (v) { AP.drums = v; ap(); } });
      this.row(g, { k: 'swing', label: 'Swing', min: 0, max: 0.6, step: 0.02, v: 0, fmt: this.fmtPct, set: function (v) { ENG.swing = v; } });
      g = this.group('Song');
      this.row(g, { k: 'bpm', label: 'Tempo', min: 90, max: 160, step: 1, v: 130, fmt: function (v) { return Math.round(v) + ' bpm'; },
        set: function (v) { ENG.bpm = v; if (AE) AE.setTempo(v); if (!Sig.running) { Sig.bpm = v; self.setBpm(v); } } });
      var roots = []; for (var r = 0; r < 12; r++) roots.push([String(33 + r), NOTE_NAMES[(33 + r) % 12]]);
      this.row(g, { k: 'root', label: 'Key', type: 'select', v: '36', opts: roots, set: function (v) { ENG.root = parseInt(v, 10) || 36; if (!Sig.running) self.setKey(ENG.scale, ENG.root); } });
      this.row(g, { k: 'scale', label: 'Scale', type: 'select', v: 'natural_minor', opts: [['natural_minor', 'Minor'], ['phrygian', 'Phrygian (darker)'], ['harmonic_minor', 'Harmonic minor'], ['minor_penta', 'Minor pentatonic']],
        set: function (v) { ENG.scale = SCALES[v] ? v : 'natural_minor'; if (!Sig.running) self.setKey(ENG.scale, ENG.root); } });
      this.row(g, { k: 'dens', label: 'Busy bass line', min: 0.3, max: 1, step: 0.02, v: 0.62, fmt: this.fmtPct, set: function (v) { ENG.density = v; } });
    }
    g = this.group('Keys', 'keys');
    var keys = hw ? [['1 – 4', 'scene'], ['← →', 'previous / next scene'], ['A', 'change scenes automatically'], ['S', 'sound on / off'], ['R', 'record a video'], ['F', 'full screen'], ['H', 'hide the controls'], ['Tab', 'settings']]
      : [['Space', 'play / stop'], ['N', 'new pattern'], ['1 – 4', 'scene'], ['← →', 'previous / next scene'], ['A', 'change scenes automatically'], ['S', 'mute'], ['R', 'record a video'], ['F', 'full screen'], ['H', 'hide the controls'], ['Tab', 'settings']];
    var dl = document.createElement('dl');
    keys.forEach(function (k) { var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k[0]; dd.textContent = k[1]; dl.appendChild(dt); dl.appendChild(dd); });
    g.appendChild(dl);
    var rs = document.createElement('p'); rs.className = 'note'; rs.id = 'resNote'; g.appendChild(rs); this.el.resNote = rs;
  },
  monitorOn: function () {
    var self = this;
    monitorConnect(this.monDev || null, function (err, label) {
      if (err) { self.toast(err, 5000); self.setMon(false); return; }
      self.setMon(true); self.setSound(true);
      self.toast('Listening to: ' + (label || 'audio input'), 3500);
      monitorDevices(function (ds) {
        var sel = self.el.monSel, cur = self.monDev || ''; if (!sel) return;
        while (sel.options.length > 1) sel.remove(1);
        ds.forEach(function (d, i) { var o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('Input ' + (i + 1)); sel.appendChild(o); });
        sel.value = cur; if (sel.value !== cur) sel.value = '';
      });
    });
  },
  setMon: function (on) { if (this.el.monBtn) { this.el.monBtn.textContent = on ? 'Stop listening' : 'Listen to the T-8 here'; this.el.monBtn.classList.toggle('on', on); } },
  // ---- construction ------------------------------------------------------
  init: function () {
    var self = this, e = this.el, hw = T8.mode === 'hw', i;
    ['bar', 'btnPlay', 'btnNew', 'conn', 'connTxt', 'bpm', 'key', 'pads', 'scenes', 'btnAuto', 'btnSound', 'btnRec', 'btnFull', 'btnSet', 'drawer', 'groups', 'hint', 'load', 'toast'].forEach(function (k) { e[k] = $(k); });
    document.body.classList.add(hw ? 'hw' : 'sa');
    for (i = 0; i < 16; i++) { var p = document.createElement('i'); e.pads.appendChild(p); this.pads.push(p); }
    SCENE_ORDER.forEach(function (id, n) {
      var b = document.createElement('button'); b.textContent = Scenes[id].label; b.setAttribute('role', 'tab'); b.dataset.scene = id; b.title = String(n + 1);
      b.addEventListener('click', function () { setScene(id); });
      e.scenes.appendChild(b);
    });
    this.buildDrawer();
    e.btnPlay.addEventListener('click', function () { Transport.toggle(); });
    e.btnNew.addEventListener('click', function () { Transport.regen(); self.toast('New pattern'); });
    e.btnAuto.addEventListener('click', function () { self.setAuto(!UIP.auto); });
    e.btnSound.addEventListener('click', function () { self.toggleSound(); });
    e.btnRec.addEventListener('click', function () { Rec.toggle(); });
    e.btnFull.addEventListener('click', function () { self.fullscreen(); });
    e.btnSet.addEventListener('click', function () { self.setDrawer(!document.body.classList.contains('open')); });
    if (!Rec.can()) e.btnRec.style.display = 'none';
    this.setAuto(this.saved('auto') === true);
    this.setSound(!hw);
    this.setKey(ENG.scale, ENG.root); this.setBpm(ENG.bpm);
    this.setRunning(false);
    var wake = function () { self.lastMove = performance.now(); document.body.classList.remove('quiet'); };
    ['mousemove', 'mousedown', 'touchstart', 'wheel'].forEach(function (n) { window.addEventListener(n, wake, { passive: true }); });
    window.addEventListener('keydown', function (ev) { self.key(ev); });
    setInterval(function () { self.idle(); }, 500);
    wake();
  },
  idle: function () {
    var b = document.body;
    if (this.hideAll) { b.classList.add('quiet'); return; }
    var busy = b.classList.contains('open') || !Sig.running || (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName));
    if (!busy && performance.now() - this.lastMove > 2800) b.classList.add('quiet');
    if (T8.mode === 'hw' && this.conn === 'ok' && HW.es && HW.es.readyState === 2) this.setConn('lost');
  },
  key: function (ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var tag = ev.target && ev.target.tagName, k = ev.key;
    if (k === 'Escape') { this.setDrawer(false); if (ev.target && ev.target.blur) ev.target.blur(); return; }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { if (k !== 'Tab') return; }
    var used = true;
    if (k === ' ' || k === 'Spacebar') { if (tag === 'BUTTON') return; Transport.toggle(); }
    else if (k >= '1' && k <= '9') { var id = SCENE_ORDER[parseInt(k, 10) - 1]; if (id) setScene(id); else used = false; }
    else if (k === 'ArrowRight') nextScene(1);
    else if (k === 'ArrowLeft') nextScene(-1);
    else if (k === 'n' || k === 'N') { if (T8.mode !== 'hw') { Transport.regen(); this.toast('New pattern'); } }
    else if (k === 'f' || k === 'F') this.fullscreen();
    else if (k === 'h' || k === 'H') { this.hideAll = !this.hideAll; document.body.classList.toggle('quiet', this.hideAll); if (!this.hideAll) this.lastMove = performance.now(); }
    else if (k === 'r' || k === 'R') Rec.toggle();
    else if (k === 'a' || k === 'A') this.setAuto(!UIP.auto);
    else if (k === 's' || k === 'S') this.toggleSound();
    else if (k === 'Tab') this.setDrawer(!document.body.classList.contains('open'));
    else used = false;
    if (used) { ev.preventDefault(); if (!this.hideAll) { this.lastMove = performance.now(); document.body.classList.remove('quiet'); } }
  },
  fullscreen: function () {
    var d = document;
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); }
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(function () { });
  },
  setDrawer: function (open) { document.body.classList.toggle('open', open); this.el.btnSet.classList.toggle('on', open); this.el.btnSet.setAttribute('aria-expanded', open ? 'true' : 'false'); },
  setAuto: function (on) { UIP.auto = !!on; this.save('auto', !!on); this.el.btnAuto.classList.toggle('on', !!on); this.el.btnAuto.setAttribute('aria-pressed', on ? 'true' : 'false'); },
  // sound: in hardware mode this switches the browser's own layers on; standalone it is a mute
  toggleSound: function () {
    if (T8.mode === 'hw') {
      if (audioRunning()) { AE.ctx.suspend(); this.setSound(false); }
      else { var E = audioEnsure(); if (!E) { this.toast('This browser has no Web Audio.'); return; } E.applyParams(); this.setSound(true); }
    } else {
      UIP.muted = !UIP.muted; if (AE) AE.applyParams(); this.setSound(!UIP.muted);
    }
  },
  setSound: function (on) {
    this.sound = !!on; var b = this.el.btnSound;
    b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = (T8.mode === 'hw') ? (on ? 'Sound on' : 'Sound off') : (on ? 'Sound on' : 'Muted');
  },
  setRec: function (on) { var b = this.el.btnRec; b.classList.toggle('rec', !!on); b.textContent = on ? 'Stop recording' : 'Record'; },
  setRunning: function (r) {
    document.body.classList.toggle('running', !!r);
    this.el.btnPlay.textContent = r ? 'Stop' : 'Play'; this.el.btnPlay.classList.toggle('on', !!r);
    if (!r) { for (var i = 0; i < 16; i++) this.pads[i].classList.remove('cur'); this.lastMove = performance.now(); document.body.classList.remove('quiet'); }
    this.hint();
  },
  hint: function () {
    var t = '';
    if (!Sig.running) {
      if (T8.mode !== 'hw') t = 'Press Play, or the space bar';
      else if (this.conn === 'lost') t = 'The follower stopped answering. Is its window still open?';
      else t = 'Press play on the T-8';
    }
    this.el.hint.textContent = t; this.el.hint.classList.toggle('show', !!t);
  },
  setConn: function (state) {
    this.conn = state;
    this.el.conn.className = 'conn ' + state;
    this.el.connTxt.textContent = state === 'ok' ? 'T-8 follower connected' : (state === 'lost' ? 'Follower not answering' : 'Connecting');
    this.hint();
  },
  setBpm: function (bpm) { bpm = Math.round(bpm); if (bpm !== this.bpmShown && bpm > 0) { this.bpmShown = bpm; this.el.bpm.textContent = bpm; } },
  setKey: function (scale, root) { this.el.key.textContent = keyLabel(scale, root); },
  setPattern: function (cells) {
    for (var i = 0; i < 16; i++) { var c = cells[i], on = c && c.note != null, p = this.pads[i]; p.classList.toggle('on', !!on); p.classList.toggle('acc', !!(on && c.accent)); }
  },
  setStep: function (i, bpm) {
    var p = this.pads, j = (i + 15) % 16;
    p[j].classList.remove('cur'); if (this.curPad != null && this.curPad !== j) p[this.curPad].classList.remove('cur');
    p[i].classList.add('cur'); this.curPad = i;
    this.setBpm(bpm);
  },
  setSceneUI: function (id) {
    var bs = this.el.scenes.children, i, self = this, s = Scenes[id];
    for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-selected', bs[i].dataset.scene === id ? 'true' : 'false');
    this.save('scene', id);
    var g = this.el.sceneGroup; while (g.children.length > 1) g.removeChild(g.lastChild);
    g.firstChild.textContent = s.label + ' scene';
    (s.params || []).forEach(function (p) {
      var o = { k: 'sc.' + id + '.' + p.k, label: p.label, min: p.min, max: p.max, step: p.step, v: p.v, set: function (v) { s.P[p.k] = (p.max === 1 && p.step === 1) ? (v ? 1 : 0) : v; } };
      if (p.max === 1 && p.step === 1) { o.type = 'check'; o.v = !!p.v; }
      self.row(g, o);
    });
  },
  setSceneBroken: function (id) {
    var bs = this.el.scenes.children;
    for (var i = 0; i < bs.length; i++) if (bs[i].dataset.scene === id) { bs[i].disabled = true; bs[i].title = 'This scene does not run on this graphics card'; }
  },
  setLoading: function (label) { this.el.load.textContent = label ? ('Preparing ' + label + '…') : ''; this.el.load.classList.toggle('show', !!label); },
  setRes: function (s) { if (this.el.resNote) this.el.resNote.textContent = (App.resMode === 'auto') ? ('Drawing at ' + Math.round(s * 100) + '% of full resolution.') : ''; },
  toast: function (msg, ms) {
    var t = this.el.toast; t.textContent = msg; t.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 1800);
  }
};
