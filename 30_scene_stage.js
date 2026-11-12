// ============================================================================
//  scene: STAGE — a liquid-chrome ferrofluid core inside the 16-step ring.
//  The ring of light tubes IS the bass sequence: height = pitch, the lit tube
//  is the playhead. Everything is ray-traced analytically except the core,
//  which is sphere-traced inside its bounding sphere.
// ============================================================================
var Scenes = {};
var SCENE_ORDER = ['stage', 'liquid', 'glass', 'moon'];
function neonJS(h, out, k) {
  h = fract(h);
  var r = clamp(Math.abs(((h * 6) % 6) - 3) - 1, 0, 1), g = clamp(Math.abs(((h * 6 + 4) % 6) - 3) - 1, 0, 1), b = clamp(Math.abs(((h * 6 + 2) % 6) - 3) - 1, 0, 1);
  r = 1 + 0.92 * (r - 1); g = 1 + 0.92 * (g - 1); b = 1 + 0.92 * (b - 1);
  var l = 0.2627 * r + 0.678 * g + 0.0593 * b, s = 0.62 / (0.25 + l) * (k == null ? 1 : k);
  out[0] = r * s; out[1] = g * s; out[2] = b * s; return out;
}
Scenes.stage = {
  label: 'Stage', bloomK: 1.0,
  params: [
    { k: 'spikes', label: 'Spikes', min: 0, max: 2, step: 0.05, v: 1 },
    { k: 'beams', label: 'Sky beams', min: 0, max: 2, step: 0.05, v: 1 },
    { k: 'sparks', label: 'Sparks', min: 0, max: 2, step: 0.05, v: 1 },
    { k: 'orbit', label: 'Camera speed', min: 0, max: 3, step: 0.05, v: 1 },
    { k: 'tubes', label: 'Tube brightness', min: 0.2, max: 2, step: 0.05, v: 1 }
  ],
  P: {},
  FS: `
uniform vec2 uRes;uniform float uT;
uniform vec3 uCam,uTgt;uniform float uFov;
uniform vec4 uBar[16];
uniform float uBeam[16];
uniform vec3 uWaveR,uWaveK;
uniform float uPulse,uSpike,uBass,uHue,uSnare,uHat,uKick,uStab,uBell,uSlide;
uniform vec3 uShot,uShotC,uMag;
const float RR=5.4;const vec3 BC=vec3(0.0,2.9,0.0);const float BR=0.058;const float BOUND=2.9;const float RINGH=9.4,RINGR=3.3;
vec2 barPos(int i){float a=float(i)*0.39269908-1.57079633;return vec2(cos(a),sin(a))*RR;}

// The spikes grow on a spherical Fibonacci lattice: NSP points spread evenly over the sphere. Finding the lattice
// point nearest to a direction in constant time follows Keinert et al., "Spherical Fibonacci Mapping" (2015).
const float NSP=230.0;
float sfNearest(vec3 p,out vec3 qn){
  const float PHI=1.61803398875;
  float phi=min(atan(p.y,p.x),PI),ct=p.z;
  float k=max(2.0,floor(log(NSP*PI*sqrt(5.0)*(1.0-ct*ct))/log(PHI+1.0)));
  float Fk=pow(PHI,k)/sqrt(5.0);
  vec2 F=vec2(round(Fk),round(Fk*PHI));
  vec2 ka=2.0*F/NSP,kb=TAU*(fract((F+1.0)*PHI)-(PHI-1.0));
  mat2 iB=mat2(ka.y,-ka.x,kb.y,-kb.x)/(ka.y*kb.x-ka.x*kb.y);
  vec2 c=floor(iB*vec2(phi,ct-(1.0-1.0/NSP)));
  float d=8.0;qn=p;
  for(int s=0;s<4;s++){
    vec2 uv=vec2(float(s-2*(s/2)),float(s/2));
    float i=clamp(dot(F,uv+c),0.0,NSP-1.0);
    float ph=TAU*fract(i*PHI),cti=1.0-(2.0*i+1.0)/NSP,sti=sqrt(max(1.0-cti*cti,0.0));
    vec3 q=vec3(cos(ph)*sti,sin(ph)*sti,cti);
    float d2=dot(q-p,q-p);
    if(d2<d){d=d2;qn=q;}
  }
  return sqrt(d);
}
mat2 gRa,gRb;vec3 gMag;      // the lattice turns slowly; the magnet's pull is carried into the same frame
void coreFrame(){
  float t=uT*0.42;
  gRa=rot(0.71+t*0.21);gRb=rot(0.53-t*0.17);
  gMag=uMag;gMag.xy=gRa*gMag.xy;gMag.yz=gRb*gMag.yz;
}
// x: 0 between spikes .. 1 on a spike's axis (a cone: the tips stay sharp) · y: how long this spike is
vec2 spikeK(vec3 n){
  vec3 s=n;s.xy=gRa*s.xy;s.yz=gRb*s.yz;
  vec3 q;float d=sfNearest(s,q);
  // ferrofluid bristles along the field: longest facing the magnet, with a restless shimmer on top
  float pull=smoothstep(-0.55,0.85,dot(q,gMag));
  float len=(0.16+0.62*pull)*(0.82+0.18*sin(uT*5.0+q.x*17.0+q.y*29.0));
  return vec2(sat(1.0-d/0.122),len);
}
float blobRad(vec3 n){
  float t=uT*0.42;
  vec3 q=n*1.15;q.xz*=rot(uSlide*0.9*n.y);
  float w=sin(q.x*1.9+t+sin(q.y*1.5-t*0.7)*1.1)*sin(q.y*1.7-t*0.8+sin(q.z*1.9+t*0.5)*1.0)*sin(q.z*1.6+t*0.6+sin(q.x*1.3+t*0.9)*1.2);
  float r=1.42+uPulse*0.16+w*(0.16+0.12*uBass);
  // the whole mass leans towards the magnet
  r+=0.10*uSpike*smoothstep(0.0,1.0,dot(n,uMag));
  if(uSpike>0.003){
    vec2 k=spikeK(n);
    r+=uSpike*k.y*k.x*(0.30+0.70*k.x);
  }
  return r;
}
float sdBlob(vec3 p){vec3 d=p-BC;float l=length(d);return (l-blobRad(d/max(l,1e-4)))*mix(0.70,0.20,sat(uSpike*1.3));}
vec3 blobNormal(vec3 p){const vec2 e=vec2(0.0018,-0.0018);
  return normalize(e.xyy*sdBlob(p+e.xyy)+e.yyx*sdBlob(p+e.yyx)+e.yxy*sdBlob(p+e.yxy)+e.xxx*sdBlob(p+e.xxx));}
float marchBlob(vec3 ro,vec3 rd,int steps){
  vec3 oc=ro-BC;float b=dot(oc,rd);float c=dot(oc,oc)-BOUND*BOUND;float h=b*b-c;if(h<0.0)return -1.0;
  h=sqrt(h);float t=max(-b-h,0.0);float t1=-b+h;if(t1<0.0)return -1.0;
  for(int i=0;i<steps;i++){float d=sdBlob(ro+rd*t);if(d<0.0011*t+0.0004)return t;t+=d;if(t>t1)break;}
  return -1.0;
}
// refl = 1: what the chrome sees (studio lights included); refl = 0: what the camera sees (a dark hall)
vec3 sky(vec3 rd,float refl){
  float y=rd.y;
  vec3 c=mix(vec3(0.010,0.008,0.022),vec3(0.0015,0.0015,0.005),sat(y*1.3+0.15));
  c+=neon(uHue+0.55)*0.070*exp(-abs(y)*9.0)*(0.5+uKick*1.6);
  if(refl>0.5){
    float az=atan(rd.z,rd.x),el=asin(clamp(y,-1.0,1.0));
    c+=vec3(0.05,0.065,0.11)*smoothstep(-0.2,1.0,y);
    // three tall soft boxes around the hall: the bold strokes in the chrome
    for(int i=0;i<3;i++){
      float a0=float(i)*2.0943951+uT*0.07;
      float db=abs(mod(az-a0+PI,TAU)-PI);
      float strip=smoothstep(0.15,0.09,db)*smoothstep(-0.03,0.05,el)*smoothstep(1.15,0.70,el);
      c+=mix(vec3(1.0,0.97,0.93),neon(uHue+0.33*float(i)),0.30)*strip*(4.2+uStab*3.5+uBell*2.0);
    }
  }
  return c;
}
// prof: 0 at the edge of the tube .. 1 looking straight through its middle
float hitBars(vec3 ro,vec3 rd,out int idx,out float prof){
  float tb=1e9;idx=-1;prof=0.0;float a=dot(rd.xz,rd.xz);if(a<1e-6)return tb;
  for(int i=0;i<16;i++){
    vec2 c=barPos(i);vec2 oc=ro.xz-c;
    float b=dot(oc,rd.xz);float cc=dot(oc,oc)-BR*BR;float h=b*b-a*cc;
    if(h>0.0){float t=(-b-sqrt(h))/a;if(t>0.0&&t<tb){float y=ro.y+rd.y*t;if(y>0.0&&y<uBar[i].a){tb=t;idx=i;prof=sqrt(h/(a*BR*BR));}}}
  }
  return tb;
}
// glow of everything thin and bright along a ray: tubes, the beams they fire upward, spotlight, laser
vec3 barGlow(vec3 ro,vec3 rd,float tmax){
  vec3 g=vec3(0.0);float a=dot(rd.xz,rd.xz)+1e-6;
  for(int i=0;i<16;i++){
    vec2 c=barPos(i);vec2 oc=c-ro.xz;
    float t=clamp(dot(oc,rd.xz)/a,0.0,tmax);
    vec2 dxz=ro.xz+rd.xz*t-c;float y=ro.y+rd.y*t;float h=uBar[i].a;
    float d2xz=dot(dxz,dxz);
    float dy=max(max(-y,y-h),0.0);
    float d2=d2xz+dy*dy;
    g+=uBar[i].rgb*(0.0075/(d2+0.0075)+0.0012/(d2+0.22));
    float b=uBeam[i];
    if(b>0.003&&y>h)g+=uBar[i].rgb*b*(0.0040/(d2xz+0.0040)+0.0006/(d2xz+0.07))*exp(-(y-h)*0.05);
  }
  {float t=clamp(-dot(ro.xz,rd.xz)/a,0.0,tmax);vec3 q=ro+rd*t;float d2=dot(q.xz,q.xz);
   float hgt=smoothstep(4.6,6.0,q.y)*smoothstep(30.0,8.0,q.y);
   float wb=0.6+0.05*q.y;g+=vec3(0.75,0.82,1.0)*(0.030+0.16*uSnare)*hgt*wb*wb/(d2+wb*wb);}
  if(rd.y>0.002){
    float t=(RINGH-ro.y)/rd.y;
    if(t>0.0&&t<tmax){float d=length(ro.xz+rd.xz*t)-RINGR;g+=vec3(1.0,0.95,0.88)*(1.0+uSnare*9.0)*(0.010/(d*d+0.010)+0.0022/(d*d+0.40));}
  }
  {vec3 A=BC,B=uShot;vec3 ab=B-A;vec3 ao=ro-A;
   float aa=dot(ab,ab),bb=dot(ab,rd),ee=dot(ab,ao),ff=dot(rd,ao);float den=aa-bb*bb;
   float s=clamp((ee-bb*ff)/max(den,1e-4),0.30,1.0);float t=clamp(bb*s-ff,0.0,tmax);
   vec3 dv=ro+rd*t-(A+ab*s);float d2=dot(dv,dv);
   g+=uShotC*(0.0026/(d2+0.0026)+0.0006/(d2+0.05));}
  return g;
}
// a tube of glowing gas: brightest through the middle, burning to white where it is hottest; dark glass when unlit
vec3 barCol(int i,float y,float prof){
  float h=uBar[i].a;float k=y/h;
  vec3 c=uBar[i].rgb*(1.5+1.3*(1.0-k)*(1.0-k))*smoothstep(1.0,0.95,k);
  float l=max(c.r,max(c.g,c.b));
  return c*(0.22+0.78*prof*prof)+vec3(l)*0.55*pow(prof,7.0)+vec3(0.010,0.012,0.018)*pow(1.0-prof,3.0);
}
vec3 floorCol(vec3 p){
  float r=length(p.xz);
  vec3 col=vec3(0.004,0.004,0.008);
  vec3 pool=vec3(0.0);
  for(int i=0;i<16;i++){vec2 d=p.xz-barPos(i);pool+=uBar[i].rgb/(dot(d,d)*7.0+0.55);}
  col+=pool*0.060;
  float w=fwidth(r)*1.2+0.004;
  float ringL=smoothstep(w+0.012,0.0,abs(r-RR))+0.5*smoothstep(w+0.006,0.0,abs(r-(RR-1.05)))+0.5*smoothstep(w+0.006,0.0,abs(r-(RR+1.05)));
  float an=atan(p.z,p.x)+1.57079633;float seg=fract(an/0.39269908+0.5)-0.5;
  float tick=smoothstep(w+0.010,0.0,abs(seg)*r*0.39269908)*step(abs(r-RR),1.05);
  float seg4=fract(an/1.57079633+0.5)-0.5;
  float tick4=smoothstep(w+0.016,0.0,abs(seg4)*r*1.57079633)*step(abs(r-(RR+1.5)),0.45);
  col+=vec3(0.30,0.46,0.95)*0.10*(ringL+tick+tick4);
  for(int k=0;k<3;k++){float d=r-uWaveR[k];col+=neon(uHue+0.04*float(k))*uWaveK[k]*(exp(-d*d*180.0)*2.6+0.09*exp(-max(-d,0.0)*1.6)*step(d,0.0));}
  col+=neon(uHue)*(0.030+0.10*uBass)/(1.0+r*r*0.55);
  return col;
}
vec3 envR(vec3 ro,vec3 rd){
  int bi;float pf;float tbar=hitBars(ro,rd,bi,pf);
  float tf=(rd.y<-1e-4)?-ro.y/rd.y:1e9;
  vec3 c;float tm;
  if(tbar<tf){c=barCol(bi,ro.y+rd.y*tbar,pf);tm=tbar;}
  else if(tf<1e8){vec3 fp=ro+rd*tf;c=floorCol(fp)+sky(reflect(rd,vec3(0.0,1.0,0.0)),0.0)*0.3;tm=tf;}
  else{c=sky(rd,1.0);tm=1e9;}
  return c+barGlow(ro,rd,tm);
}
vec3 shadeBlob(vec3 pos,vec3 rd){
  vec3 N=blobNormal(pos);float ndv=sat(dot(N,-rd));
  vec3 R=reflect(rd,N);
  vec3 refl=envR(pos+N*0.02,R);
  // black chrome with a faint oil film: mirror-bright where it faces a light, black everywhere else
  vec3 film=0.5+0.5*cos(TAU*(vec3(0.0,0.33,0.67)+ndv*1.15+uHue+0.1));
  vec3 F0=mix(vec3(0.66),film,0.16);
  vec3 F=F0+(1.0-F0)*pow(1.0-ndv,5.0);
  vec3 col=refl*F;
  vec2 k=spikeK(normalize(pos-BC));
  float sp=sat(uSpike*2.0);
  col*=mix(1.0,0.30+0.70*smoothstep(0.0,0.55,k.x),sp);          // the valleys between spikes sit in shade
  col+=neon(uHue)*(0.012+0.05*uBass)*ndv*ndv;
  col+=neon(uHue+0.5)*0.05*pow(1.0-ndv,3.0);
  return col;
}
void main(){
  vec2 p=(vUv*2.0-1.0)*vec2(uRes.x/uRes.y,1.0);
  vec3 ww=normalize(uTgt-uCam),uu=normalize(cross(ww,vec3(0.0,1.0,0.0))),vv=cross(uu,ww);
  vec3 rd=normalize(p.x*uu+p.y*vv+uFov*ww);vec3 ro=uCam;
  coreFrame();
  vec3 col;float tHit=1e4;
  float tb=marchBlob(ro,rd,120);
  int bi;float pf;float tbar=hitBars(ro,rd,bi,pf);
  float tf=(rd.y<-1e-4)?-ro.y/rd.y:1e9;
  if(tb>0.0&&tb<tbar&&tb<tf){col=shadeBlob(ro+rd*tb,rd);tHit=tb;}
  else if(tbar<tf){col=barCol(bi,ro.y+rd.y*tbar,pf);tHit=tbar;}
  else if(tf<1e8){
    vec3 fp=ro+rd*tf;tHit=tf;
    col=floorCol(fp);
    // wet floor: a slightly rippled mirror with puddles, fresnel weighted
    vec2 nz=vec2(vnoise(fp.xz*3.1+uT*0.05),vnoise(fp.xz*3.1+17.0-uT*0.04))-0.5;
    float pud=smoothstep(0.35,0.75,vnoise(fp.xz*0.42+3.0));
    vec3 Nf=normalize(vec3(nz.x*0.045,1.0,nz.y*0.045)*vec3(1.0-0.6*pud,1.0,1.0-0.6*pud));
    vec3 R=reflect(rd,Nf);R.y=abs(R.y);
    float fr=0.045+0.955*pow(1.0-sat(dot(-rd,Nf)),5.0);
    vec3 rc;float tb2=marchBlob(fp+vec3(0.0,0.01,0.0),R,60);
    int b2;float pf2;float tbar2=hitBars(fp+vec3(0.0,0.01,0.0),R,b2,pf2);
    float tm=1e9;
    if(tb2>0.0&&tb2<tbar2){rc=shadeBlob(fp+R*tb2,R);tm=tb2;}
    else if(tbar2<1e8){rc=barCol(b2,R.y*tbar2,pf2);tm=tbar2;}
    else rc=sky(R,0.0);
    rc+=barGlow(fp+vec3(0.0,0.01,0.0),R,tm);
    col+=rc*fr*(0.75+0.5*pud);
    float fog=exp(-tf*0.010);col=col*fog+sky(vec3(rd.x,0.02,rd.z),0.0)*(1.0-fog);
  }
  else col=sky(rd,0.0);
  col+=barGlow(ro,rd,min(tHit,1e9));
  o=vec4(col,min(tHit,1.0e4));
}`,
  init: function () {
    this.prog = new Prog('stage', this.FS);
    this.sparks = new PointCloud(2600);
    this.bars = new Float32Array(64); this.beam = new Float32Array(16); this.beamU = new Float32Array(16);
    this.waves = [{ r: -9, k: 0 }, { r: -9, k: 0 }, { r: -9, k: 0 }]; this.wi = 0;
    this.shot = 0; this.shotT = 0; this.ang = 0.6; this.spike = 0; this.pulse = 0;
    this.tmp = [0, 0, 0]; this.rs = mulberry(808);
    this.cam = [0, 3, 10]; this.tgt = [0, 2.4, 0]; this.fov = 1.9;
    this.U3 = [1, 0, 0]; this.V3 = [0, 1, 0]; this.W3 = [0, 0, -1];
    this.shotPos = [0, 2.9, 0]; this.shotCol = [0, 0, 0]; this.shotK = 0; this.shotHue = 0;
    this.mag = [0.6, 0.5, 0.62]; this.magT = [0.6, 0.5, 0.62];
  },
  resize: function (w, h) {
    if (this.mT && this.mT.w === w && this.mT.h === h) return;
    if (this.mT) this.mT.free();
    this.mT = new Target(w, h, 'rgba16f', gl.NEAREST);
  },
  // camera set-ups: distance, height, lens, orbit speed, look-at height, slow push
  SHOTS: [
    { r: 8.6, h: 3.3, fov: 2.05, spin: 0.10, ty: 2.35, push: -0.05, dof: 5 },
    { r: 7.3, h: 0.7, fov: 1.55, spin: -0.075, ty: 2.9, push: 0.03, dof: 7 },
    { r: 8.2, h: 8.4, fov: 1.75, spin: 0.05, ty: 1.3, push: -0.04, dof: 4 },
    { r: 13.5, h: 2.6, fov: 2.7, spin: 0.035, ty: 2.6, push: -0.10, dof: 5 }
  ],

  on: function (type, ev) {
    var R = this.rs, c = this.tmp, i, n, P = this.P;
    if (type === 'drum' && ev.inst === 'kick') {
      var w = this.waves[this.wi]; this.wi = (this.wi + 1) % 3; w.r = 1.0; w.k = clamp((ev.vel || 100) / 127, 0.3, 1);
      this.pulse = Math.max(this.pulse, 1);
    } else if (type === 'step') {
      if (ev.on) {
        var a = ev.i * 0.39269908 - 1.57079633, hh = 0.9 + 2.9 * notePitch01(ev.note), bx = Math.cos(a) * 5.4, bz = Math.sin(a) * 5.4;
        this.shotPos[0] = bx; this.shotPos[1] = hh; this.shotPos[2] = bz;
        // the magnet swings round to the tube that fired
        var ml = Math.hypot(bx, hh - 2.2, bz); this.magT[0] = bx / ml; this.magT[1] = (hh - 2.2) / ml + 0.25; this.magT[2] = bz / ml;
        this.shotK = ev.accent ? 1.6 : 1.0; this.shotHue = noteHue(ev.note);
        this.beam[ev.i & 15] = ev.accent ? 1.5 : 1.0;
        neonJS(this.shotHue, c, 5.0);
        // a fountain of sparks up the beam of the tube that just fired
        n = Math.round((ev.accent ? 18 : 8) * P.sparks);
        for (i = 0; i < n; i++) this.sparks.emit(bx + (R() - 0.5) * 0.1, hh, bz + (R() - 0.5) * 0.1, (R() - 0.5) * 1.3, 2.5 + R() * 7.5, (R() - 0.5) * 1.3, c[0], c[1], c[2], 0.018 + R() * 0.018, 0.5 + R() * 0.7);
        if (ev.accent) {
          this.spike = 1;
          // ...and the core throws a shell of them outward
          n = Math.round(55 * P.sparks);
          for (i = 0; i < n; i++) {
            var u = R() * 2 - 1, th = R() * 6.2832, q = Math.sqrt(1 - u * u), sp = 3 + R() * 5, dx = q * Math.cos(th), dz = q * Math.sin(th);
            this.sparks.emit(dx * 1.9, 2.9 + u * 1.9, dz * 1.9, dx * sp, u * sp + 1.0, dz * sp, c[0], c[1], c[2], 0.016 + R() * 0.02, 0.5 + R() * 0.8);
          }
        }
      }
      if (ev.i === 0 && Sig.bar > 0 && Sig.bar % 8 === 0) { this.shot = (this.shot + 1) % this.SHOTS.length; this.shotT = 0; this.ang += 1.9; }
    } else if (type === 'start') { this.shotT = 0; }
  },
  update: function (dt, t) {
    var P = this.P, S = this.SHOTS[this.shot], i;
    this.shotT += dt;
    this.ang += dt * S.spin * P.orbit * (0.35 + 0.65 * Sig.energy);
    this.spike *= Math.exp(-dt / 0.42);
    var mk = 1 - Math.exp(-dt / 0.11), M = this.mag, MT = this.magT;
    M[0] += (MT[0] - M[0]) * mk; M[1] += (MT[1] - M[1]) * mk; M[2] += (MT[2] - M[2]) * mk;
    this.pulse *= Math.exp(-dt / 0.20);
    this.shotK *= Math.exp(-dt / 0.09);
    neonJS(this.shotHue, this.shotCol, this.shotK * 3.0 * P.tubes);
    for (i = 0; i < 3; i++) { var w = this.waves[i]; if (w.k > 0.002) { w.r += dt * 15.0; w.k *= Math.exp(-dt / 0.42); } else { w.k = 0; } }
    var r = S.r + S.push * this.shotT * 3.0, h = S.h + 0.25 * Math.sin(t * 0.21);
    this.cam[0] = Math.cos(this.ang) * r; this.cam[1] = Math.max(0.35, h); this.cam[2] = Math.sin(this.ang) * r;
    this.tgt[1] = S.ty;
    this.fov = S.fov * (1 - 0.035 * Sig.kick * UIP.punch);
    var wx = this.tgt[0] - this.cam[0], wy = this.tgt[1] - this.cam[1], wz = this.tgt[2] - this.cam[2], wl = Math.hypot(wx, wy, wz);
    wx /= wl; wy /= wl; wz /= wl;
    var ux = -wz, uz = wx, ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    this.W3[0] = wx; this.W3[1] = wy; this.W3[2] = wz; this.U3[0] = ux; this.U3[1] = 0; this.U3[2] = uz;
    this.V3[0] = -uz * wy; this.V3[1] = uz * wx - ux * wz; this.V3[2] = ux * wy;
    // sequence -> tubes
    var B = this.bars, c = this.tmp, cur = Sig.step, pat = Sig.pat, k = P.tubes, bd = Math.exp(-dt / 0.24);
    for (i = 0; i < 16; i++) {
      var cell = pat[i], on = cell && cell.note != null;
      var hue = on ? noteHue(cell.note) : Sig.hue + 0.5;
      var lvl = on ? 0.20 : 0.010;
      lvl += Sig.stepGlow[i] * 4.2;
      if (i === cur && Sig.running) lvl += (on ? 2.4 : 0.30) * (1 - 0.6 * Sig.stepPhase);
      if (on && cell.accent) lvl *= 1.25;
      neonJS(hue, c, lvl * k);
      if (!on) { var g = (c[0] + c[1] + c[2]) / 3; c[0] = lerp(c[0], g, 0.75); c[1] = lerp(c[1], g, 0.75); c[2] = lerp(c[2], g, 0.75); }
      B[i * 4] = c[0]; B[i * 4 + 1] = c[1]; B[i * 4 + 2] = c[2];
      B[i * 4 + 3] = on ? (0.9 + 2.9 * Sig.stepLevel[i]) : 0.10;
      this.beam[i] *= bd; this.beamU[i] = this.beam[i] * P.beams * 0.55;
    }
    this.sparks.step(dt, -3.2, 0.7, 0.02);
  },
  render: function (t, tgt) {
    var p = this.prog.use(), W = this.waves, P = this.P, m = this.mT, pu = UIP.punch;
    m.bind();
    p.v2('uRes', m.w, m.h).f('uT', t)
      .v3('uCam', this.cam[0], this.cam[1], this.cam[2]).v3('uTgt', this.tgt[0], this.tgt[1], this.tgt[2]).f('uFov', this.fov)
      .v4v('uBar[0]', this.bars).fv('uBeam[0]', this.beamU)
      .v3('uWaveR', W[0].r, W[1].r, W[2].r).v3('uWaveK', W[0].k * pu, W[1].k * pu, W[2].k * pu)
      .f('uPulse', this.pulse * pu).f('uSpike', clamp((0.50 * this.spike + 0.46 * Math.min(Sig.bass, 1.25)) * P.spikes, 0, 1.0)).f('uBass', Math.min(Sig.bass, 1.3))
      .f('uHue', Sig.hue).f('uSnare', Sig.snare * pu).f('uHat', Sig.hat).f('uKick', Sig.kick * pu)
      .f('uStab', Sig.stab).f('uBell', Sig.bell).f('uSlide', Sig.slide)
      .v3('uShot', this.shotPos[0], this.shotPos[1], this.shotPos[2]).v3('uShotC', this.shotCol[0], this.shotCol[1], this.shotCol[2]);
    var ml = Math.hypot(this.mag[0], this.mag[1], this.mag[2]) || 1;
    p.v3('uMag', this.mag[0] / ml, this.mag[1] / ml, this.mag[2] / ml);
    drawFS();
    // the lens is focused on the near face of the core
    Post.dof(m, tgt, Math.max(1.5, Math.hypot(this.cam[0], this.cam[1] - 2.9, this.cam[2]) - 1.5), this.SHOTS[this.shot].dof);
    this.sparks.draw(this.cam, this.U3, this.V3, this.W3, this.fov, m);
  }
};
