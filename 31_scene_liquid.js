// ============================================================================
//  scene: LIQUID — a real 2-D incompressible fluid (stable-fluids solver on the GPU).
//  The music injects ink and momentum: kick = radial burst, each bass step = a
//  jet from its own slot along the bottom, snare = two colliding side jets,
//  hats = droplets, stab/bells = falling ink.
// ============================================================================
Scenes.liquid = {
  label: 'Liquid',
  params: [
    { k: 'swirl', label: 'Swirl', min: 0, max: 2, step: 0.05, v: 1 },
    { k: 'ink', label: 'Ink amount', min: 0.3, max: 2, step: 0.05, v: 1 },
    { k: 'fade', label: 'Fade speed', min: 0.3, max: 2.5, step: 0.05, v: 1 },
    { k: 'mirror', label: 'Mirror', min: 0, max: 1, step: 1, v: 1 }
  ],
  P: {},
  init: function () {
    if (!GLX.hdr) throw new Error('float render targets are not supported by this GPU');
    var NB = 'uniform sampler2D uVel;uniform vec2 uPx;\n#define VL texture(uVel,vUv-vec2(uPx.x,0.0)).xy\n#define VR texture(uVel,vUv+vec2(uPx.x,0.0)).xy\n#define VT texture(uVel,vUv+vec2(0.0,uPx.y)).xy\n#define VB texture(uVel,vUv-vec2(0.0,uPx.y)).xy\n';
    this.pAdvect = new Prog('fl.advect', `
      uniform sampler2D uVel,uSrc;uniform float uDt,uDiss,uAsp;
      void main(){vec2 v=texture(uVel,vUv).xy;vec2 c=vUv-uDt*v*vec2(1.0/uAsp,1.0);
        o=texture(uSrc,c)/(1.0+uDiss*uDt);}`, null, true);
    this.pSplat = new Prog('fl.splat', `
      uniform sampler2D uSrc;uniform vec2 uPoint;uniform vec3 uCol;uniform float uRad,uAsp,uCover;
      void main(){vec2 p=vUv-uPoint;p.x*=uAsp;float g=exp(-dot(p,p)/uRad);
        o=vec4(texture(uSrc,vUv).rgb*(1.0-min(g,1.0)*uCover)+uCol*g,1.0);}`, null, true);
    this.pCurl = new Prog('fl.curl', NB + `void main(){o=vec4(0.5*(VR.y-VL.y-VT.x+VB.x),0.0,0.0,1.0);}`, null, true);
    this.pVort = new Prog('fl.vort', NB + `
      uniform sampler2D uCurl;uniform float uK,uDt;
      void main(){
        float L=texture(uCurl,vUv-vec2(uPx.x,0.0)).x,R=texture(uCurl,vUv+vec2(uPx.x,0.0)).x;
        float T=texture(uCurl,vUv+vec2(0.0,uPx.y)).x,B=texture(uCurl,vUv-vec2(0.0,uPx.y)).x,C=texture(uCurl,vUv).x;
        vec2 f=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+1e-4;f*=uK*C;f.y*=-1.0;
        vec2 v=texture(uVel,vUv).xy+f*uDt;o=vec4(clamp(v,-6.0,6.0),0.0,1.0);}`, null, true);
    this.pDiv = new Prog('fl.div', NB + `
      void main(){vec2 C=texture(uVel,vUv).xy;float L=VL.x,R=VR.x,T=VT.y,B=VB.y;
        if(vUv.x-uPx.x<0.0)L=-C.x;if(vUv.x+uPx.x>1.0)R=-C.x;if(vUv.y+uPx.y>1.0)T=-C.y;if(vUv.y-uPx.y<0.0)B=-C.y;
        o=vec4(0.5*(R-L+T-B),0.0,0.0,1.0);}`, null, true);
    this.pPres = new Prog('fl.pres', `
      uniform sampler2D uP,uDiv;uniform vec2 uPx;
      void main(){float L=texture(uP,vUv-vec2(uPx.x,0.0)).x,R=texture(uP,vUv+vec2(uPx.x,0.0)).x;
        float T=texture(uP,vUv+vec2(0.0,uPx.y)).x,B=texture(uP,vUv-vec2(0.0,uPx.y)).x;
        o=vec4((L+R+B+T-texture(uDiv,vUv).x)*0.25,0.0,0.0,1.0);}`, null, true);
    this.pGrad = new Prog('fl.grad', `
      uniform sampler2D uP,uVel;uniform vec2 uPx;
      void main(){float L=texture(uP,vUv-vec2(uPx.x,0.0)).x,R=texture(uP,vUv+vec2(uPx.x,0.0)).x;
        float T=texture(uP,vUv+vec2(0.0,uPx.y)).x,B=texture(uP,vUv-vec2(0.0,uPx.y)).x;
        o=vec4(texture(uVel,vUv).xy-vec2(R-L,T-B),0.0,1.0);}`, null, true);
    this.pScale = new Prog('fl.scale', `uniform sampler2D uSrc;uniform float uK;void main(){o=texture(uSrc,vUv)*uK;}`, null, true);
    this.pShow = new Prog('fl.show', `
      uniform sampler2D uDye;uniform vec2 uPx;uniform float uT,uHue,uKick,uAsp;
      float H(vec2 uv){return log(1.0+luma(texture(uDye,uv).rgb)*2.6);}
      void main(){
        vec2 uv=vUv;
        vec3 c=texture(uDye,uv).rgb;
        float l=luma(c);
        vec2 e=uPx*1.6;
        float hL=H(uv-vec2(e.x,0.0)),hR=H(uv+vec2(e.x,0.0)),hB=H(uv-vec2(0.0,e.y)),hT=H(uv+vec2(0.0,e.y));
        vec2 g=vec2(hR-hL,hT-hB);
        vec3 n=normalize(vec3(-g*5.0,1.0));
        vec3 L=normalize(vec3(-0.42,0.58,0.70));
        float diff=sat(dot(n,L));
        float spec=pow(sat(dot(n,normalize(L+vec3(0.0,0.0,1.0)))),70.0);
        float body=smoothstep(0.015,0.22,l);
        c=c/(1.0+l*0.30);
        float lc=luma(c);c=max(mix(vec3(lc),c,1.28),0.0);
        vec3 col=c*(0.62+0.85*diff);
        col+=spec*(0.25+0.9*c)*body*0.9;
        float edge=sat(length(g)*3.0);
        vec3 film=0.5+0.5*cos(TAU*(vec3(0.0,0.33,0.67)+H(uv)*0.8+uHue));
        col+=film*edge*body*0.07;
        vec2 q=(uv-0.5)*vec2(uAsp,1.0);
        vec3 bg=vec3(0.010,0.011,0.024)*(1.25-dot(q,q)*1.1)+neon(uHue+0.55)*0.012*(0.4+uKick);
        o=vec4(max(bg,0.0)+col,1.0);}`);
    this.q = []; this.amb = 0; this.rs = mulberry(991);
    this.tmpc = [0, 0, 0];
  },
  resize: function (w, h) {
    // The simulation size follows the window, not the (adaptive) drawing resolution, so the ink is not
    // thrown away every time the frame rate governor changes the render scale.
    var c = App.canvas, full = (QS.h ? h : Math.round((c.clientHeight || h) * Math.min(window.devicePixelRatio || 1, 2)));
    var asp = (!QS.w && c.clientWidth > 0 && c.clientHeight > 0) ? c.clientWidth / c.clientHeight : w / h;
    var sh = 176, dh = Math.min(900, Math.max(360, Math.round(full * 0.85)));
    var sw = Math.round(sh * asp), dw = Math.round(dh * asp);
    if (this.vel && this.vel.w === sw && this.vel.h === sh && this.dye.w === dw && this.dye.h === dh) return;
    var oldDye = this.dye, oldVel = this.vel;
    if (this.pres) this.pres.free();
    if (this.div) { this.div.free(); this.curl.free(); }
    this.vel = new DoubleTarget(sw, sh, 'rg16f', gl.LINEAR);
    this.pres = new DoubleTarget(sw, sh, 'r16f', gl.NEAREST);
    this.div = new Target(sw, sh, 'r16f', gl.NEAREST);
    this.curl = new Target(sw, sh, 'r16f', gl.NEAREST);
    this.dye = new DoubleTarget(dw, dh, 'rgba16f', gl.LINEAR);
    // carry the old picture across a window resize
    if (oldDye && this.pScale.ok) {
      this.dye.a.bind(); this.pScale.use().tex('uSrc', oldDye.a.tex, 0).f('uK', 1.0); drawFS();
      this.vel.a.bind(); this.pScale.use().tex('uSrc', oldVel.a.tex, 0).f('uK', 1.0); drawFS();
    }
    if (oldDye) { oldDye.free(); oldVel.free(); }
    this.asp = asp;
  },
  // x,y in 0..1 (y up), velocity in screen-heights / second
  splat: function (x, y, vx, vy, col, rad, k) {
    this.q.push([x, y, vx, vy, col[0] * k, col[1] * k, col[2] * k, rad]);
    if (this.P.mirror >= 0.5) this.q.push([1 - x, y, -vx, vy, col[0] * k, col[1] * k, col[2] * k, rad]);
  },
  on: function (type, ev) {
    var R = this.rs, c = this.tmpc, P = this.P, ink = P.ink, i, a, pu = UIP.punch;
    if (this.q.length > 220) return;
    if (type === 'drum') {
      var v = clamp((ev.vel || 100) / 127, 0.3, 1);
      if (ev.inst === 'kick') {
        var mir = P.mirror >= 0.5, cx = 0.5 + (mir ? 0 : (R() - 0.5) * 0.24), cy = 0.5 + (R() - 0.5) * 0.14;
        this.kn = (this.kn || 0) + 1;
        var ph = (this.kn % 2) ? 0.7854 : 0, nj = 4;
        for (i = 0; i < nj; i++) {
          a = ph + i / nj * 6.2832;
          if (mir && Math.cos(a) < -0.01) continue;           // the mirror supplies the left half
          neonJS(Sig.hue + 0.035 * i, c, 1);
          this.q.push([cx + Math.cos(a) * 0.045 / this.asp, cy + Math.sin(a) * 0.045, Math.cos(a) * 2.6 * v * pu, Math.sin(a) * 2.6 * v * pu, c[0] * 0.95 * ink, c[1] * 0.95 * ink, c[2] * 0.95 * ink, 0.0011]);
          if (mir && Math.abs(Math.cos(a)) > 0.01) this.q.push([1 - (cx + Math.cos(a) * 0.045 / this.asp), cy + Math.sin(a) * 0.045, -Math.cos(a) * 2.6 * v * pu, Math.sin(a) * 2.6 * v * pu, c[0] * 0.95 * ink, c[1] * 0.95 * ink, c[2] * 0.95 * ink, 0.0011]);
        }
      } else if (ev.inst === 'snare' || ev.inst === 'clap') {
        var sy = 0.38 + R() * 0.3; neonJS(Sig.hue + 0.5, c, 1);
        this.splat(0.03, sy, 2.3 * v * pu, (R() - 0.5) * 0.3, c, 0.0016, 1.0 * ink);
        if (P.mirror < 0.5) { neonJS(Sig.hue + 0.42, c, 1); this.splat(0.97, 1 - sy + 0.1, -2.3 * v * pu, (R() - 0.5) * 0.3, c, 0.0016, 1.0 * ink); }
      } else if (ev.inst === 'hat') {
        c[0] = 0.75; c[1] = 0.85; c[2] = 1.0;
        this.splat(0.08 + R() * 0.84, 0.90 + R() * 0.07, (R() - 0.5) * 0.5, -0.55 - R() * 0.35, c, 0.00020, 0.40 * ink * v);
      } else if (ev.inst === 'ohat') {
        var ox = 0.15 + R() * 0.7, oy = 0.62 + R() * 0.25, od = R() < 0.5 ? 1 : -1; neonJS(Sig.hue + 0.33, c, 1);
        this.splat(ox - 0.02, oy, 0, 1.0 * od, c, 0.0006, 0.5 * ink); this.splat(ox + 0.02, oy, 0, -1.0 * od, c, 0.0006, 0.5 * ink);
      } else if (ev.inst === 'tom') {
        neonJS(Sig.hue + 0.2, c, 1); this.splat(0.2 + R() * 0.6, 0.1, (R() - 0.5) * 1.2, 1.4, c, 0.002, 1.0 * ink);
      }
    } else if (type === 'step' && ev.on) {
      // one slot per step along the bottom: the bar reads left to right like the 16 pads
      var x = 0.07 + 0.86 * (ev.i + 0.5) / 16, pit = notePitch01(ev.note);
      neonJS(noteHue(ev.note), c, 1);
      if (ev.accent) { c[0] = c[0] * 0.75 + 0.45; c[1] = c[1] * 0.75 + 0.45; c[2] = c[2] * 0.75 + 0.45; }
      this.splat(x, 0.02, (R() - 0.5) * 0.25 + (ev.slide ? 0.7 : 0), (0.85 + 1.05 * pit) * (ev.accent ? 1.35 : 1) * pu, c, ev.accent ? 0.0012 : 0.00070, (ev.accent ? 1.25 : 0.85) * ink);
    } else if (type === 'stab') {
      var ns = ev.notes || [], m = ns.length;
      for (i = 0; i < m; i++) {
        neonJS(noteHue(ns[i] - 24) + 0.08, c, 1); c[0] = c[0] * 0.7 + 0.22; c[1] = c[1] * 0.7 + 0.22; c[2] = c[2] * 0.7 + 0.22;
        this.splat(0.5 + (i - (m - 1) / 2) * 0.13 + (R() - 0.5) * 0.3, 0.98, (R() - 0.5) * 0.2, -1.25, c, 0.0007, 0.7 * ink);
      }
    } else if (type === 'bell') {
      c[0] = 1.0; c[1] = 0.93; c[2] = 0.72;
      this.splat(0.1 + R() * 0.8, 0.55 + R() * 0.4, (R() - 0.5) * 0.15, -0.22, c, 0.00016, 2.2 * ink);
    }
  },
  pass: function (prog, dst) { dst.bind(); drawFS(); },
  update: function (dt, t) {
    var P = this.P, R = this.rs, c = this.tmpc;
    // idle: a slow pen keeps the surface alive while the transport is stopped
    if (Sig.energy < 0.5) {
      this.amb += dt;
      if (this.amb > 0.09) {
        this.amb = 0; var a = t * 0.55, x = 0.5 + 0.30 * Math.sin(a * 1.3), y = 0.5 + 0.28 * Math.sin(a * 1.9 + 1.0);
        neonJS(t * 0.03, c, 1);
        this.splat(x, y, Math.cos(a * 1.3) * 0.45, Math.cos(a * 1.9 + 1.0) * 0.45, c, 0.0009, 0.30 * (1 - Sig.energy));
      }
    }
    this.dt = Math.min(dt, 1 / 30);
  },
  render: function (t, tgt) {
    var v = this.vel, d = this.dye, pr = this.pres, dt = this.dt || 0.016, asp = this.asp, P = this.P, i;
    var px = 1 / v.w, py = 1 / v.h;
    // 1. inject
    var q = this.q;
    if (q.length) {
      this.pSplat.use().f('uAsp', asp);
      for (i = 0; i < q.length; i++) {
        var s = q[i];
        v.b.bind(); this.pSplat.tex('uSrc', v.a.tex, 0).v2('uPoint', s[0], s[1]).v3('uCol', s[2], s[3], 0).f('uRad', s[7] * 1.6).f('uCover', 0.0); drawFS(); v.swap();
        d.b.bind(); this.pSplat.tex('uSrc', d.a.tex, 0).v2('uPoint', s[0], s[1]).v3('uCol', s[4], s[5], s[6]).f('uRad', s[7]).f('uCover', 0.85); drawFS(); d.swap();
      }
      q.length = 0;
    }
    // 2. vorticity confinement
    this.curl.bind(); this.pCurl.use().tex('uVel', v.a.tex, 0).v2('uPx', px, py); drawFS();
    v.b.bind(); this.pVort.use().tex('uVel', v.a.tex, 0).tex('uCurl', this.curl.tex, 1).v2('uPx', px, py).f('uK', 4.2 * P.swirl).f('uDt', dt); drawFS(); v.swap();
    // 3. projection
    this.div.bind(); this.pDiv.use().tex('uVel', v.a.tex, 0).v2('uPx', px, py); drawFS();
    pr.b.bind(); this.pScale.use().tex('uSrc', pr.a.tex, 0).f('uK', 0.8); drawFS(); pr.swap();
    this.pPres.use().tex('uDiv', this.div.tex, 1).v2('uPx', px, py);
    for (i = 0; i < 22; i++) { pr.b.bind(); this.pPres.tex('uP', pr.a.tex, 0); drawFS(); pr.swap(); }
    v.b.bind(); this.pGrad.use().tex('uP', pr.a.tex, 0).tex('uVel', v.a.tex, 1).v2('uPx', px, py); drawFS(); v.swap();
    // 4. advect
    this.pAdvect.use().f('uDt', dt).f('uAsp', asp);
    v.b.bind(); this.pAdvect.tex('uVel', v.a.tex, 0).tex('uSrc', v.a.tex, 1).f('uDiss', 0.22); drawFS(); v.swap();
    d.b.bind(); this.pAdvect.tex('uVel', v.a.tex, 0).tex('uSrc', d.a.tex, 1).f('uDiss', 0.62 * P.fade); drawFS(); d.swap();
    // 5. shade into the HDR target
    tgt.bind();
    this.pShow.use().tex('uDye', d.a.tex, 0).v2('uPx', 1 / d.w, 1 / d.h).f('uT', t).f('uHue', Sig.hue).f('uKick', Sig.kick * UIP.punch).f('uAsp', asp);
    drawFS();
  }
};
