// ============================================================================
//  scene: GLASS — a backlit rose window that is also the sequencer.
//    16 outer lancets  = the 16 bass steps (fill height = pitch, colour = note)
//    16 outer roundels = the drum hits on each step (gold kick / white snare)
//    16 eyelets        = hats        8 inner petals = kick / snare cross
//    rosette + eye     = stab chords / bells
//  Rendered twice: a small emission buffer feeds the light shafts and the glow
//  that the glass throws onto the stone.
// ============================================================================
Scenes.glass = {
  label: 'Glass',
  params: [
    { k: 'rays', label: 'Light shafts', min: 0, max: 2, step: 0.05, v: 1 },
    { k: 'lead', label: 'Lead width', min: 0.4, max: 2, step: 0.05, v: 1 },
    { k: 'drift', label: 'Glass drift', min: 0, max: 3, step: 0.05, v: 1 }
  ],
  P: {},
  COMMON: `
uniform vec2 uRes;uniform float uT,uHue,uKick,uSnare,uHat,uStab,uBell,uBass,uZoom,uLead,uDrift,uRun;
uniform vec4 uA[16];uniform vec4 uB[16];
const float RW=0.93;
vec3 voro(vec2 x){
  vec2 n=floor(x),f=fract(x);vec2 mg=vec2(0.0),mr=vec2(0.0);float md=8.0;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));vec2 h=hash22(n+g);vec2 oo=0.5+0.36*sin(uDrift+TAU*h);
    vec2 r=g+oo-f;float d=dot(r,r);if(d<md){md=d;mr=r;mg=g;}}
  md=8.0;
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){
    vec2 g=mg+vec2(float(i),float(j));vec2 h=hash22(n+g);vec2 oo=0.5+0.36*sin(uDrift+TAU*h);
    vec2 r=g+oo-f;vec2 dv=r-mr;if(dot(dv,dv)>1e-5)md=min(md,dot(0.5*(mr+r),normalize(dv)));}
  vec2 id=n+mg;return vec3(md,hash21(id+3.7),hash21(id+11.3));
}
// round-headed opening in a ring of n cells. returns signed distance (<0 = glass)
float lancet(float r,float a,float n,float rin,float rout,float m,out float k,out vec2 loc){
  float w=TAU/n;k=floor(a/w+0.5);float da=a-k*w;k=mod(k,n);float ha=PI/n;float sh=sin(ha);
  loc=vec2(r*sin(da),r*cos(da));
  float yc=(rout-0.012+m)/(1.0+sh);float cr=yc*sh-m;
  float d;
  if(r*cos(ha-abs(da))<yc*cos(ha))d=m-r*sin(ha-abs(da));else d=length(vec2(loc.x,loc.y-yc))-cr;
  return max(d,rin+0.012-r);
}
// emission of the window at p (0 on stone). dO = signed distance to the nearest glass edge.
vec3 window(vec2 p,out float dO){
  float r=length(p)/RW;float a=atan(p.x,p.y);if(a<0.0)a+=TAU;
  dO=1.0;vec3 base=vec3(0.0);float lit=0.0;float seed=0.0;float ts=15.0;
  float k;vec2 lc;float d;
  if(r<0.085){
    d=r-0.062;base=vec3(1.0,0.84,0.52);lit=0.75+2.6*uBell+1.3*uBass+1.0*uStab;seed=1.0;ts=24.0;dO=d;
  }else if(r<0.19){
    float w=TAU/8.0;k=floor(a/w+0.5);float da=a-k*w;
    vec2 q=vec2(r*sin(da),r*cos(da))-vec2(0.0,0.125);
    d=length(q)-0.041;base=mix(neon(uHue+0.07),vec3(1.0,0.72,0.25),0.45);lit=0.55+2.6*uStab+0.7*uBell;seed=2.0+k;ts=20.0;dO=d;
  }else if(r<0.458){
    d=lancet(r,a,8.0,0.205,0.447,0.012,k,lc);
    float odd=mod(k,2.0);
    base=mix(vec3(0.05,0.62,0.42),vec3(0.50,0.16,0.85),odd);
    base=mix(base,neon(uHue+0.5+0.12*odd),0.35);
    float drive=mix(uKick,uSnare,odd);
    float hgt=(lc.y-0.205)/0.24;
    lit=0.40+2.4*drive*(1.15-hgt)+0.25*uBass;seed=20.0+k;ts=10.0;dO=d;
  }else if(r<0.812){
    d=lancet(r,a,16.0,0.47,0.80,0.0095,k,lc);
    int ki=int(k);vec4 A=uA[ki],B=uB[ki];
    float hgt=(lc.y-0.482)/(0.788-0.482);
    float on=step(0.001,A.x);
    float fill=on*smoothstep(A.x+0.035,A.x-0.035,hgt);
    vec3 cob=mix(vec3(0.05,0.14,0.75),vec3(0.62,0.05,0.10),mod(k,2.0));
    base=mix(cob,neon(A.z),fill);
    lit=0.30+fill*(0.55+3.4*A.y+2.6*B.w+0.5*A.w)+0.30*B.w;
    seed=40.0+k;ts=11.5;dO=d;
    // eyelets between the lancet heads
    float w=TAU/16.0;float k2=floor(a/w);float da=a-(k2+0.5)*w;
    vec2 q=vec2(r*sin(da),r*cos(da))-vec2(0.0,0.766);
    float de=length(q)-0.0255;
    if(de<dO){dO=de;int e=int(mod(k2,16.0));base=vec3(0.62,0.92,1.0);lit=0.30+2.6*uB[e].z+0.9*uHat;seed=70.0+k2;ts=34.0;}
  }else if(r<0.955){
    float w=TAU/16.0;k=floor(a/w+0.5);float da=a-k*w;k=mod(k,16.0);
    vec2 q=vec2(r*sin(da),r*cos(da))-vec2(0.0,0.878);
    d=length(q)-0.053;
    vec4 B=uB[int(k)];
    base=mix(vec3(0.60,0.07,0.09),vec3(1.0,0.66,0.16),sat(B.x*1.5));
    base=mix(base,vec3(0.86,0.84,1.0),sat(B.y*1.5));
    lit=0.38+3.0*B.x+3.0*B.y+0.35*B.w;seed=90.0+k;ts=19.0;dO=d;
    // small diamonds between the roundels
    float k3=floor(a/w);float db=a-(k3+0.5)*w;
    vec2 q3=vec2(r*sin(db),r*cos(db))-vec2(0.0,0.905);
    float dd=(abs(q3.x)+abs(q3.y))-0.022;
    if(dd<dO){dO=dd;base=vec3(0.12,0.30,0.80);lit=0.40+1.6*uB[int(mod(k3,16.0))].z+0.3*uSnare;seed=120.0+k3;ts=34.0;}
  }
  if(dO>0.004)return vec3(0.0);
  // tesserae
  vec3 v=voro(p*ts+seed*17.31);
  float lw=0.030*uLead;float aa=fwidth(v.x)*1.3+0.004;
  float glass=smoothstep(lw,lw+aa,v.x);
  vec3 col=base*(0.66+0.62*v.y);
  col=mix(col,col.gbr,(v.z-0.5)*0.16);
  col*=0.62+0.38*smoothstep(0.0,0.26,v.x);
  // hand-blown texture: streaks along a per-piece direction + seeds
  vec2 sp=p*rot(v.y*6.283);
  float streak=0.80+0.28*vnoise(sp*vec2(70.0,9.0)+v.z*40.0);
  vec2 bq=fract(p*46.0+v.yz*13.0)-0.5;
  float bub=smoothstep(0.10,0.02,length(bq))*step(0.72,hash21(floor(p*46.0+v.yz*13.0)));
  // light behind the glass: slow clouds plus a wandering sun
  float bl=0.60+0.50*fbm2(p*1.5+vec2(uT*0.045,-uT*0.03));
  vec2 sn=0.40*vec2(sin(uT*0.11),cos(uT*0.083));
  bl+=1.0*exp(-dot(p-sn,p-sn)/0.16);
  lit*=bl*(1.0+0.30*uKick);
  col*=lit*streak*(1.0+bub*(0.5+2.5*uHat));
  float edge=smoothstep(0.004,-0.004,dO);
  return col*glass*edge;
}`,
  init: function () {
    this.pEm = new Prog('glass.em', this.COMMON + `
void main(){vec2 p=(vUv*2.0-1.0)*vec2(uRes.x/uRes.y,1.0)/uZoom;float d;o=vec4(window(p,d),1.0);}`);
    this.pFull = new Prog('glass.full', this.COMMON + `
uniform sampler2D uEm;uniform float uRayK;
void main(){
  float asp=uRes.x/uRes.y;
  vec2 p=(vUv*2.0-1.0)*vec2(asp,1.0)/uZoom;
  float dO;vec3 em=window(p,dO);
  float r=length(p)/RW;
  // light shafts: accumulate emission along the line towards the window centre
  vec2 dir=vec2(0.5)-vUv;float jit=hash21(gl_FragCoord.xy+fract(uT*3.1)*91.0);
  vec3 rays=vec3(0.0);
  for(int i=0;i<30;i++){float f=(float(i)+jit)/30.0;float w=(1.0-f);rays+=texture(uEm,vUv+dir*f*0.80).rgb*w*w;}
  rays*=(1.0/11.0);
  float mote=0.72+0.5*vnoise(p*26.0+vec2(uT*0.11,uT*0.07))*vnoise(p*7.0-uT*0.05);
  vec3 near=texture(uEm,vUv).rgb;
  vec3 col;
  if(r<0.955){
    // tracery: dark carved stone, edge-lit by the glass beside it
    float aa=fwidth(dO)*1.2+0.0012;
    float stone=smoothstep(-aa,aa,dO);
    float bev=smoothstep(0.022,0.0,dO);
    vec3 sc=vec3(0.012,0.011,0.014)*(0.7+0.6*vnoise(p*90.0))+near*(0.035+0.20*bev);
    col=mix(em,sc,stone);
  }else{
    // frame mouldings, then the wall
    float t=(r-0.955)/0.10;
    vec2 b=p*vec2(3.0,5.6);b.x+=0.5*floor(b.y);vec2 bf=abs(fract(b)-0.5);
    float mort=smoothstep(0.455,0.49,max(bf.x,bf.y));
    float rough=0.55*vnoise(p*55.0)+0.45*vnoise(b*2.3+7.0);
    vec3 alb=vec3(0.125,0.115,0.105)*(0.62+0.5*hash21(floor(b)))*(1.0-0.55*mort)*(0.55+0.75*rough);
    vec3 lightIn=texture(uEm,vUv+dir*0.10).rgb+rays*1.2;
    if(t<1.0){
      float prof=0.5+0.5*cos(t*TAU*2.5+0.6);
      float groove=smoothstep(0.0,0.08,abs(fract(t*2.5+0.1)-0.5));
      alb=vec3(0.15,0.14,0.13)*(0.45+0.75*prof)*(0.6+0.4*groove)*(0.75+0.4*vnoise(p*70.0));
      col=alb*(0.05+3.2*lightIn*(1.0-0.6*t));
    }else{
      col=alb*(0.035+2.4*lightIn/(1.0+3.0*(r-1.05)));
    }
  }
  float onGlass=(r<0.955)?smoothstep(0.003,-0.003,dO):0.0;
  col+=rays*uRayK*mote*(0.55+0.9*uKick)*(1.0-0.62*onGlass);
  o=vec4(col,1.0);
}`);
    this.A = new Float32Array(64); this.B = new Float32Array(64);
    this.dk = new Float32Array(16); this.ds = new Float32Array(16); this.dh = new Float32Array(16); this.cur = new Float32Array(16);
    this.zoom = 1; this.drift = 0;
  },
  resize: function (w, h) {
    var ew = Math.max(64, Math.round(w / 3)), eh = Math.max(36, Math.round(h / 3));
    if (this.em && this.em.w === ew && this.em.h === eh) return;
    if (this.em) this.em.free();
    this.em = new Target(ew, eh, 'rgba16f', gl.LINEAR);
  },
  on: function (type, ev) {
    if (type === 'drum') {
      var i = (ev.step | 0) & 15, v = clamp((ev.vel || 100) / 127, 0.3, 1);
      if (ev.inst === 'kick') this.dk[i] = v; else if (ev.inst === 'snare' || ev.inst === 'clap') this.ds[i] = v;
      else if (ev.inst === 'hat' || ev.inst === 'ohat') this.dh[i] = v; else if (ev.inst === 'tom') { this.dk[i] = 0.6; this.ds[i] = 0.4; }
    } else if (type === 'step') { this.cur[ev.i & 15] = 1; }
  },
  update: function (dt, t) {
    var i, a = Math.exp(-dt / 0.45), b = Math.exp(-dt / 0.16), A = this.A, B = this.B, pat = Sig.pat;
    this.drift += dt * 0.22 * this.P.drift * (0.4 + 0.6 * Sig.energy);
    for (i = 0; i < 16; i++) {
      this.dk[i] *= a; this.ds[i] *= a; this.dh[i] *= Math.exp(-dt / 0.25); this.cur[i] *= b;
      var c = pat[i], on = c && c.note != null;
      A[i * 4] = on ? Sig.stepLevel[i] : 0; A[i * 4 + 1] = Sig.stepGlow[i]; A[i * 4 + 2] = on ? noteHue(c.note) : 0.6; A[i * 4 + 3] = Sig.stepAcc[i];
      B[i * 4] = this.dk[i]; B[i * 4 + 1] = this.ds[i]; B[i * 4 + 2] = this.dh[i]; B[i * 4 + 3] = this.cur[i];
    }
    this.zoom = 1.0 + 0.012 * Math.sin(t * 0.17) + 0.014 * Sig.kick * UIP.punch;
  },
  uni: function (p, w, h, t) {
    var pu = UIP.punch;
    p.v2('uRes', w, h).f('uT', t).f('uHue', Sig.hue).f('uKick', Sig.kick * pu).f('uSnare', Sig.snare * pu).f('uHat', Sig.hat)
      .f('uStab', Sig.stab).f('uBell', Sig.bell).f('uBass', Math.min(Sig.bass, 1.3)).f('uZoom', this.zoom)
      .f('uLead', this.P.lead).f('uDrift', this.drift).v4v('uA[0]', this.A).v4v('uB[0]', this.B);
  },
  render: function (t, tgt) {
    this.em.bind(); this.uni(this.pEm.use(), tgt.w, tgt.h, t); drawFS();
    tgt.bind(); var p = this.pFull.use(); this.uni(p, tgt.w, tgt.h, t);
    p.tex('uEm', this.em.tex, 0).f('uRayK', 0.60 * this.P.rays); drawFS();
  }
};
