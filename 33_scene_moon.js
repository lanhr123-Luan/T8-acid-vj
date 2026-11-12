// ============================================================================
//  scene: MOON — an astronaut loping across the lunar surface, sphere-traced.
//  The gait is locked to the bar: the left boot lands on beat 1, the right on
//  beat 3 (one long low-gravity stride every two beats, close to the cadence of
//  the Apollo "lope"). Boots are planted with two-bone IK so they never slide,
//  and the dust follows vacuum ballistics under lunar gravity.
// ============================================================================
function hermiteKeys(K, s, m0, m1) {
  var n = K.length, i = 0;
  if (s <= K[0][0]) return K[0][1];
  if (s >= K[n - 1][0]) return K[n - 1][1];
  while (i < n - 2 && s > K[i + 1][0]) i++;
  var t0 = K[i][0], t1 = K[i + 1][0], v0 = K[i][1], v1 = K[i + 1][1], h = t1 - t0;
  var d0 = (i === 0) ? m0 : (K[i + 1][1] - K[i - 1][1]) / (K[i + 1][0] - K[i - 1][0]);
  var d1 = (i === n - 2) ? m1 : (K[i + 2][1] - K[i][1]) / (K[i + 2][0] - K[i][0]);
  var u = (s - t0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * d0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * d1;
}
// SD: fraction of a foot's cycle spent on the ground · STEP: metres travelled per footfall
// REACH: how far ahead of the hips the boot lands · BALL/ANKH: boot geometry used for the toe-off roll
var MOON = { SD: 0.16, STEP: 1.25, REACH: 0.16, PELV: 0.955, HOP: 0.08, L1: 0.43, L2: 0.42, TOE: 0.55, BALL: 0.17, ANKH: 0.10 };
(function () {
  var M = MOON, th = M.TOE;
  M.X1 = M.REACH - M.SD * 2 * M.STEP + M.BALL * (1 - Math.cos(th)) + M.ANKH * Math.sin(th);   // ankle at toe-off
  M.Y1 = M.BALL * Math.sin(th) + M.ANKH * Math.cos(th);
  M.KX = [[0, M.X1], [0.14, M.X1 - 0.14], [0.5, -0.02], [0.86, M.REACH + 0.20], [1, M.REACH]];
  M.KY = [[0, M.Y1], [0.13, 0.27], [0.32, 0.37], [0.62, 0.31], [0.86, 0.21], [1, M.ANKH]];
  M.KP = [[0, th], [0.18, 0.95], [0.5, 0.45], [0.8, -0.10], [1, 0.0]];
})();
// the smooth ground the boots stand on; it repeats every 256 m, like the baked relief (see baseH in the shader)
function moonGroundY(x, z) { return 0.38 * Math.sin(x * 0.12272 + 1.3) * Math.sin(z * 0.09817 + 0.5) + 0.16 * Math.sin(x * 0.22089 + z * 0.17181 + 2.0); }
function moonLaneA(z) { return smooth01((Math.abs(z) - 1.5) / 6.0) * (z > 0 ? 0.35 : 1); }
function moonLaneG(z) { return smooth01((Math.abs(z) - 0.6) / 1.8) * (z > 0 ? 0.5 : 1); }
// one boot's cycle, u in [0,1): ankle x relative to the hips, ankle height over the ground, boot pitch (toe down +)
function moonFoot(u, o) {
  var M = MOON, travel = 2 * M.STEP;
  if (u < M.SD) {
    var s = u / M.SD, th = M.TOE * smooth01((s - 0.55) / 0.45);
    // the ball of the foot stays put while the heel peels off the ground
    o.x = M.REACH - u * travel + M.BALL * (1 - Math.cos(th)) + M.ANKH * Math.sin(th);
    o.y = M.BALL * Math.sin(th) + M.ANKH * Math.cos(th);
    o.pitch = th; o.ground = 1;
  } else {
    var sg = (u - M.SD) / (1 - M.SD), vx = -travel * (1 - M.SD);
    o.x = hermiteKeys(M.KX, sg, vx, vx);
    o.y = hermiteKeys(M.KY, sg, 0.5, -0.95);
    o.pitch = hermiteKeys(M.KP, sg, 1.2, 0.5);
    o.ground = 0;
  }
}
// Hips height over the ground through one step (w in [0,1)). In the air it is a ballistic arc; on the planted
// leg the body is slowed and thrown back up at a constant rate, which reverses the fall with the least knee bend
// (the two parabolas meet with the same speed, so nothing jerks).
function moonPelvis(w, hop, o) {
  var M = MOON, ws = 2 * M.SD, dip = hop * ws / (1 - ws);
  if (w < ws) { var q = 2 * w / ws - 1; o.dip = dip * (1 - q * q); o.y = M.PELV - o.dip; o.rise = 0; }
  else { var tau = (w - ws) / (1 - ws); o.rise = hop * 4 * tau * (1 - tau); o.y = M.PELV + o.rise; o.dip = 0; }
}
// how high a hop lunar gravity allows in the time one step spends in the air at this tempo (a step is two beats)
function moonHop(bpm) { var tf = (1 - 2 * MOON.SD) * 120 / bpm; return clamp(1.62 * tf * tf / 8, 0.03, 0.24); }
Scenes.moon = {
  label: 'Moon', flashK: 0.3, bloomK: 0.7,
  params: [
    { k: 'bounce', label: 'Hop height', min: 0, max: 2.5, step: 0.05, v: 1 },
    { k: 'dust', label: 'Dust', min: 0, max: 2, step: 0.05, v: 1 },
    { k: 'cuts', label: 'Camera cuts', min: 0, max: 1, step: 1, v: 1 }
  ],
  P: {},
  // Height maps, drawn once. Everything is built on lattices that wrap, so both tiles repeat seamlessly.
  BAKE: `
uniform float uMode;
vec3 ph3(vec2 ip,float per,float seed){ip=mod(ip,per);return hash32(ip+vec2(seed*13.7+0.5,seed*7.3+0.5));}
float pgn(vec2 p,float per,float seed){
  vec2 i=floor(p),f=fract(p);vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 ga=ph3(i,per,seed).xy*2.0-1.0,gb=ph3(i+vec2(1.0,0.0),per,seed).xy*2.0-1.0;
  vec2 gc=ph3(i+vec2(0.0,1.0),per,seed).xy*2.0-1.0,gd=ph3(i+vec2(1.0,1.0),per,seed).xy*2.0-1.0;
  return mix(mix(dot(ga,f),dot(gb,f-vec2(1.0,0.0)),u.x),mix(dot(gc,f-vec2(0.0,1.0)),dot(gd,f-vec2(1.0,1.0)),u.x),u.y);
}
float smin(float a,float b,float k){float h=max(k-abs(a-b),0.0)/k;return min(a,b)-h*h*k*0.25;}
// At most one crater per lattice cell: a parabolic bowl up to a raised rim, then a blanket of ejecta that
// thins with the cube of the distance. Old craters are shallow with soft rims; young ones deep and crisp.
// Returns (height, brightness of fresh ejecta).
vec2 craters(vec2 p,float cell,float per,float seed,float prob,float ageLo){
  vec2 q=p/cell,ip=floor(q),fp=fract(q);float h=0.0,ej=0.0;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec3 rn=ph3(ip+g,per,seed),r2=ph3(ip+g,per,seed+5.0);
    if(rn.z>prob)continue;
    vec2 c=g+0.15+0.7*rn.xy-fp;
    float R=mix(0.13,0.37,r2.x*r2.x);
    float age=mix(ageLo,1.0,sqrt(r2.y));
    float d=length(c)/R;
    if(d>3.0)continue;
    float D=mix(0.36,0.09,age),Hr=mix(0.070,0.010,age);
    float dc=max(d,0.7);
    float prof=smin(-D+(D+Hr)*d*d,Hr/(dc*dc*dc),mix(0.035,0.11,age))*(1.0-smoothstep(2.0,3.0,d));
    h+=prof*R;
    ej+=(1.0-age)*(1.0-age)*smoothstep(0.55,1.0,d)*(1.0-smoothstep(1.0,2.7,d));
  }
  return vec2(h*cell,ej);
}
// Stones: steep-sided lumps with a partly faceted outline. Returns (height, mask).
vec2 rocks(vec2 p,float cell,float per,float seed,float prob,float rlo,float rhi){
  vec2 q=p/cell,ip=floor(q),fp=fract(q);float h=0.0,m=0.0;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j));
    vec3 rn=ph3(ip+g,per,seed),r2=ph3(ip+g,per,seed+3.0);
    if(rn.z>prob)continue;
    vec2 c=fp-(g+0.1+0.8*rn.xy);
    float R=mix(rlo,rhi,r2.x*r2.x*r2.x);
    c=rot(r2.y*6.2832)*c;c.x*=0.65+0.7*r2.z;
    float dn=length(c)/R;if(dn>1.25)continue;
    vec2 cf=rot(1.1)*c;float fac=max(abs(cf.x),abs(cf.y))*1.22/R;
    float dd=mix(dn,max(dn,fac),0.6);
    float k=1.0-dd*dd;if(k<=0.0)continue;
    float top=0.80+0.20*sin(c.x/R*4.3+r2.z*9.0)*sin(c.y/R*3.1+r2.x*7.0);
    float hh=R*cell*(0.55+0.55*rn.x)*pow(k,0.55)*top;
    if(hh>h){h=hh;m=smoothstep(0.0,0.25,k);}
  }
  return vec2(h,m);
}
void main(){
  if(uMode<0.5){
    vec2 p=vUv*256.0;
    float h=1.25*pgn(p/64.0,4.0,1.0)+0.55*pgn(p/32.0,8.0,2.0)+0.22*pgn(p/16.0,16.0,3.0)+0.08*pgn(p/8.0,32.0,4.0);
    float ej=0.0;vec2 c;
    c=craters(p,64.0,4.0,11.0,0.62,0.45);h+=c.x;ej+=c.y;
    c=craters(p,32.0,8.0,12.0,0.58,0.30);h+=c.x;ej+=c.y;
    c=craters(p,16.0,16.0,13.0,0.60,0.15);h+=c.x;ej+=c.y;
    c=craters(p,8.0,32.0,14.0,0.60,0.0);h+=c.x;ej+=c.y;
    float tone=0.5+0.75*pgn(p/32.0,8.0,21.0)+0.40*pgn(p/8.0,32.0,22.0);
    o=vec4(h,ej,tone,1.0);
  }else{
    vec2 p=vUv*32.0;
    float soft=0.013*pgn(p/0.5,64.0,31.0)+0.007*pgn(p/0.25,128.0,32.0)+0.0035*pgn(p/0.125,256.0,33.0);
    soft+=craters(p,0.5,64.0,34.0,0.50,0.50).x;
    float hard=craters(p,4.0,8.0,41.0,0.55,0.10).x+craters(p,2.0,16.0,42.0,0.55,0.10).x+craters(p,1.0,32.0,43.0,0.50,0.15).x;
    // stones gather in patches
    float dens=smoothstep(-0.15,0.30,pgn(p/8.0,4.0,77.0));
    vec2 r1=rocks(p,4.0,8.0,51.0,0.16*dens,0.035,0.105);
    vec2 r2=rocks(p,1.0,32.0,52.0,0.30*dens+0.04,0.05,0.17);
    vec2 r3=rocks(p,0.5,64.0,53.0,0.34*dens+0.05,0.05,0.15);
    float rk=max(r1.x,max(r2.x,r3.x)),rm=max(r1.y,max(r2.y,r3.y));
    float tone=0.5+0.9*pgn(p/1.0,32.0,61.0)+0.6*pgn(p/0.25,128.0,62.0);
    o=vec4(soft,hard+rk,rm,tone);
  }
}`,
  FS: `
uniform vec2 uRes;uniform float uT;
uniform vec3 uCam,uU,uV,uW;uniform float uFov,uPix;
uniform vec3 uJ[21];
uniform vec4 uFoot[16];
uniform vec3 uSun,uEarth;
uniform sampler2D uTA,uTB;
uniform vec3 uHi;uniform float uFarOff;
uniform float uHue,uKick,uSnare,uHat,uBass,uAccent,uStab,uBell;
uniform vec3 uBeaconC;uniform vec4 uSpark;
const float SUNI=3.2;const float BR=1.26;
const float SA=256.0,SB=32.0,TMAX=420.0;
float sdCap(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h)-r;}
float sdCone(vec3 p,vec3 a,vec3 b,float ra,float rb){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h)-mix(ra,rb,h);}
float capH(vec3 p,vec3 a,vec3 b){vec3 pa=p-a,ba=b-a;return clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);}
float sdRBox(vec3 q,vec3 b,float r){vec3 d=abs(q)-b+r;return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0)-r;}
float smin(float a,float b,float k){float h=max(k-abs(a-b),0.0)/k;return min(a,b)-h*h*k*0.25;}
float fbm3(vec3 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*vnoise3(p);p=p*2.02+vec3(3.1,1.7,5.3);a*=0.5;}return s;}

// ---------------- terrain ----------------
// The relief lives in two tiling height maps baked once on the GPU (see BAKE below):
//   uTA  256 m tile, 25 cm texels : swells and craters from 2 m to 50 m across  (r height, g fresh ejecta, b tone)
//   uTB   32 m tile,  3 cm texels : small craters, rocks, clods                  (r soft relief, g rocks+craters, b rock, a tone)
// Reading them at a mip level that matches the marching step keeps the surface smooth at the scale it is
// sampled, so thin rims and stones can never flicker in and out between neighbouring rays.
// The strip the astronaut walks on (z = 0) stays smooth, because the boots are placed in JS on baseH().
float baseH(vec2 p){return 0.38*sin(p.x*0.12272+1.3)*sin(p.y*0.09817+0.5)+0.16*sin(p.x*0.22089+p.y*0.17181+2.0);}
// how much of each layer exists at this z: x large relief, y rocks and small craters, z soft small relief
vec3 lanes(float z){
  float az=abs(z),cam=(z>0.0)?1.0:0.0;
  return vec3(smoothstep(1.5,7.5,az)*mix(1.0,0.35,cam),smoothstep(0.6,2.4,az)*mix(1.0,0.5,cam),smoothstep(0.25,0.6,az));
}
// s = size (metres) of the smallest feature worth keeping here
float terrH(vec2 p,float s){
  vec3 L=lanes(p.y);float h=baseH(p);
  if(L.x>0.0)h+=L.x*textureLod(uTA,p/SA,log2(max(s*4.0,1.0))).r;
  if(L.z>0.0&&s<4.0){vec2 d=textureLod(uTB,p/SB,log2(max(s*32.0,1.0))).rg;h+=(d.r*L.z+d.g*L.y)*(1.0-smoothstep(2.0,4.0,s));}
  return h;
}
// no relief reaches higher than this above the smooth ground at this z (uHi = measured maxima of the maps)
float topB(float z){vec3 L=lanes(z);return L.x*uHi.x+L.y*uHi.y+L.z*uHi.z+0.012;}
float stepK(float t){return mix(0.008,0.032,smoothstep(4.0,70.0,t));}
// Distance to the ground, or -1 when the ray leaves the near field (sky, mountains, far plain).
float marchT(vec3 ro,vec3 rd,out float sHit){
  sHit=0.02;
  float ch=max(length(rd.xz),1e-4);
  float tanD=-rd.y/ch;                          // metres the ray comes down per metre travelled over the ground
  float t=0.03,lt=0.0,lh=0.02;
  for(int i=0;i<150;i++){
    vec3 p=ro+rd*t;
    float hb=p.y-baseH(p.xz),B=topB(p.z);
    if(hb>B){
      // above all relief: stride straight to where the ray can first meet it. The smooth ground never slopes
      // more than 0.125, and the bound only grows with |z|, so its value where the stride ends is the largest on the way.
      float den=tanD+0.125;
      if(den<=0.004)return -1.0;
      float x=(hb-B)/den;
      float B1=max(B,topB(p.z+rd.z/ch*x));
      x=(hb-B1)/den;
      if(x>0.0){lt=t;lh=hb-B;t+=x/ch+0.01;if(t>TMAX)return -1.0;continue;}
    }
    float rs=stepK(t);
    float s=max(2.0*rs*t,uPix*t*1.5);
    float h=p.y-terrH(p.xz,s);
    if(h<0.0){
      float a=lt,b=t,ha=max(lh,1e-4),hn=h;
      for(int k=0;k<3;k++){
        float m=a+(b-a)*ha/(ha-hn);float hm=(ro.y+rd.y*m)-terrH(ro.xz+rd.xz*m,s);
        if(hm<0.0){b=m;hn=hm;}else{a=m;ha=hm;}
      }
      sHit=s;return a+(b-a)*ha/(ha-hn);
    }
    lt=t;lh=h;
    // the gap may be crossed faster where only gentle slopes survive the filtering (no stones, no small craters)
    t+=max(h*mix(0.5,1.3,smoothstep(0.15,1.0,s)),rs*t)+0.004;
    if(t>TMAX)return -1.0;
  }
  // out of steps while skimming the ground: land the ray on the level last seen
  if(rd.y<-1e-4){sHit=max(2.0*stepK(t)*t,0.05);return min(t+max(lh,0.0)/(-rd.y),TMAX);}
  return -1.0;
}
float shadowT(vec3 p,float s0){
  float res=1.0,t=max(s0*1.2,0.015);
  for(int i=0;i<34;i++){
    vec3 q=p+uSun*t;
    float hb=q.y-baseH(q.xz),B=topB(q.z);
    if(hb>B){
      // clear of the relief here, and of the larger bound at the place where the ray tops everything
      float zt=q.z+uSun.z*max(uHi.x+uHi.y+0.06-hb,0.0)/uSun.y;
      if(hb>topB(zt))break;
    }
    float s=max(s0,t*0.05);
    float h=q.y-terrH(q.xz,s);
    if(h<0.0)return 0.0;
    res=min(res,40.0*h/t);
    t+=clamp(h*0.7,max(s*0.7,0.02),6.0);
  }
  return smoothstep(0.0,1.0,res);
}
// the land beyond the near field: a flat plain and, towards -z, the rounded massifs on the skyline
float farH(vec2 p){
  float m=smoothstep(420.0,1900.0,-p.y);
  float mx=smoothstep(700.0,2600.0,abs(p.x-uCam.x));
  vec2 q=p+vec2(uFarOff,0.0);
  float h=0.0;
  if(m>0.0){
    float n=vnoise(q*0.00038+vec2(3.1,7.7))*0.62+vnoise(q*0.0011+vec2(11.0,2.0))*0.26+vnoise(q*0.0034+5.0)*0.12;
    h+=m*(520.0*smoothstep(0.24,1.04,n)+7.0*vnoise(q*0.011));
  }
  if(mx>0.0){float r=smoothstep(0.28,1.05,vnoise(q*0.0009+vec2(40.0,3.0))*0.8+vnoise(q*0.0031+vec2(7.0,19.0))*0.2);h+=mx*(150.0*r*r+5.0*vnoise(q*0.013+9.0));}
  return h;
}
float marchFar(vec3 ro,vec3 rd){
  if(rd.y>0.17)return -1.0;
  float t=TMAX*0.97,lt=t,lh=1.0;
  for(int i=0;i<40;i++){
    vec3 p=ro+rd*t;float h=p.y-farH(p.xz);
    if(h<0.0){
      float a=lt,b=t,ha=max(lh,1e-3),hn=h;
      for(int k=0;k<4;k++){
        float m=a+(b-a)*ha/(ha-hn);float hm=(ro.y+rd.y*m)-farH(ro.xz+rd.xz*m);
        if(hm<0.0){b=m;hn=hm;}else{a=m;ha=hm;}
      }
      return a+(b-a)*ha/(ha-hn);
    }
    if(h<0.0006*t)return t;
    lt=t;lh=h;
    t+=max(h*0.45,t*0.055);
    if(t>9000.0)break;
  }
  return -1.0;
}

// ---------------- astronaut (signed distance field) ----------------
// joints: 0 hips 1 chest 2 head | 3 hip 4 knee 5 ankle 6-7 boot axis (left) | 8-12 the same (right)
//         13 shoulder 14 elbow 15 wrist (left) | 16-18 (right) | 19 body up 20 body forward
// Sizes follow the Apollo A7LB suit and its backpack: 1.83 m to the top of the helmet.
vec3 gU,gF,gR;                  // body frame
vec3 gLf,gLt,gLs,gRf,gRt,gRs;   // hand frames: along the hand, towards the thumb, through the palm
vec3 gBL,gBR;                   // boot directions
void frames(){
  gU=uJ[19];gF=uJ[20];gR=cross(gF,gU);
  vec3 ref=normalize(gF+gU);
  gLf=normalize(uJ[15]-uJ[14]);gLt=normalize(ref-gLf*dot(ref,gLf)+gR*1e-3);gLs=cross(gLf,gLt);
  gRf=normalize(uJ[18]-uJ[17]);gRt=normalize(ref-gRf*dot(ref,gRf)-gR*1e-3);gRs=cross(gRf,gRt);
  gBL=normalize(uJ[7]-uJ[6]);gBR=normalize(uJ[12]-uJ[11]);
}
float sdEll(vec3 p,vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.0)/k1;}
float sdDisc(vec3 l,float r,float hh){vec2 d=abs(vec2(length(l.yz),l.x))-vec2(r,hh);return min(max(d.x,d.y),0.0)+length(max(d,0.0));}
float limb(vec3 p,vec3 a,vec3 b,float ra,float rb,out float h){vec3 pa=p-a,ba=b-a;h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h)-mix(ra,rb,h);}
// the ribbed bellows of a pressure suit's joints, centred at h0 along a limb of length len (2.4 cm pitch)
float ribs(float h,float h0,float w,float len){return smoothstep(w,w*0.4,abs(h-h0))*(0.5+0.5*cos((h-h0)*len*261.8));}
// glove and the metal wrist ring; returns (distance, material)
vec2 hand(vec3 p,vec3 w,vec3 fd,vec3 tf,vec3 sd,float ringMat){
  vec3 q=p-w;vec3 l=vec3(dot(q,fd),dot(q,tf),dot(q,sd));
  float palm=sdRBox(l-vec3(0.068,0.0,0.0),vec3(0.060,0.047,0.027),0.025);
  float fing=sdRBox(l-vec3(0.136,-0.006,0.004),vec3(0.032,0.041,0.023),0.021);
  float thumb=sdCap(l,vec3(0.040,0.040,0.0),vec3(0.092,0.076,0.006),0.0195);
  float g=smin(smin(palm,fing,0.022),thumb,0.018);
  float ring=sdDisc(l-vec3(0.004,0.0,0.0),0.060,0.013)-0.004;
  return (ring<g)?vec2(ring,ringMat):vec2(g,7.0);
}
// lunar overshoe: l.x along the boot, l.y up (the sole's underside is at -0.09)
vec2 boot(vec3 p,vec3 a,vec3 b,vec3 d,float m){
  vec3 n=vec3(-d.y,d.x,0.0);vec3 q=p-(a+b)*0.5;vec3 l=vec3(dot(q,d),dot(q,n),q.z);
  float upper=sdRBox(l-vec3(0.0,-0.022,0.0),vec3(0.160,0.052,0.070),0.045);
  float sole=sdRBox(l-vec3(0.0,-0.074,0.0),vec3(0.168,0.016,0.076),0.012);
  return (sole<upper)?vec2(sole,m+0.25):vec2(upper,m);
}
// A loose hull around everything. Rays spend most of their steps out here, where this is all that is evaluated.
float proxyA(vec3 p){
  float d=sdCap(p,uJ[0]-gU*0.02-gF*0.08,uJ[2]+gU*0.02-gF*0.10,0.43);
  d=min(d,min(sdCap(p,uJ[3],uJ[5],0.17),sdCap(p,uJ[8],uJ[10],0.17)));
  d=min(d,min(sdCap(p,uJ[6],uJ[7],0.16),sdCap(p,uJ[11],uJ[12],0.16)));
  d=min(d,min(sdCap(p,uJ[13],uJ[15]+gLf*0.10,0.13),sdCap(p,uJ[16],uJ[18]+gRf*0.10,0.13)));
  d=min(d,sdCap(p,uJ[1]+gU*0.55-gF*0.27,uJ[1]+gU*0.95-gF*0.31,0.03));
  return d;
}
vec2 mapA(vec3 p){
  float pb=proxyA(p);
  if(pb>0.10)return vec2(pb,0.0);
  vec3 tq=p-uJ[1];vec3 tl=vec3(dot(tq,gF),dot(tq,gU),dot(tq,gR));   // chest space: x forward, y up, z right
  // torso: chest barrel, pelvis, shoulder yoke
  float d=sdRBox(tl,vec3(0.145,0.25,0.215),0.105);
  d=smin(d,sdEll(tl-vec3(0.0,-0.30,0.0),vec3(0.155,0.15,0.205)),0.07);
  d=smin(d,sdCap(tl,vec3(0.0,0.225,-0.20),vec3(0.0,0.225,0.20),0.10),0.05);
  float m=1.0,dm=d,x,h,a1,a2;
  a1=limb(p,uJ[3],uJ[4],0.110,0.093,h);a1-=0.006*ribs(h,0.86,0.16,0.43);
  a2=limb(p,uJ[4],uJ[5],0.091,0.074,h);a2-=0.006*ribs(h,0.10,0.14,0.42);
  d=smin(d,a1,0.045);d=smin(d,a2,0.03);if(a1<dm){dm=a1;m=10.0;}if(a2<dm){dm=a2;m=11.0;}
  a1=limb(p,uJ[8],uJ[9],0.110,0.093,h);a1-=0.006*ribs(h,0.86,0.16,0.43);
  a2=limb(p,uJ[9],uJ[10],0.091,0.074,h);a2-=0.006*ribs(h,0.10,0.14,0.42);
  d=smin(d,a1,0.045);d=smin(d,a2,0.03);if(a1<dm){dm=a1;m=12.0;}if(a2<dm){dm=a2;m=13.0;}
  a1=limb(p,uJ[13],uJ[14],0.092,0.079,h);a1-=0.005*(ribs(h,0.10,0.16,0.29)+ribs(h,0.90,0.14,0.29));
  a2=limb(p,uJ[14],uJ[15],0.077,0.064,h);a2-=0.005*ribs(h,0.08,0.12,0.27);
  d=smin(d,a1,0.04);d=smin(d,a2,0.028);if(a1<dm){dm=a1;m=14.0;}if(a2<dm){dm=a2;m=15.0;}
  a1=limb(p,uJ[16],uJ[17],0.092,0.079,h);a1-=0.005*(ribs(h,0.10,0.16,0.29)+ribs(h,0.90,0.14,0.29));
  a2=limb(p,uJ[17],uJ[18],0.077,0.064,h);a2-=0.005*ribs(h,0.08,0.12,0.27);
  d=smin(d,a1,0.04);d=smin(d,a2,0.028);if(a1<dm){dm=a1;m=16.0;}if(a2<dm){dm=a2;m=17.0;}
  d*=0.92;
  // life-support pack, the oxygen purge unit on top of it, the control unit on the chest
  x=sdRBox(tl-vec3(-0.268,0.085,0.0),vec3(0.115,0.33,0.235),0.035);if(x<d){d=x;m=2.0;}
  x=sdRBox(tl-vec3(-0.255,0.50,0.0),vec3(0.088,0.085,0.20),0.03);if(x<d){d=x;m=2.5;}
  x=sdRBox(tl-vec3(0.19,0.055,0.0),vec3(0.045,0.07,0.10),0.012);if(x<d){d=x;m=3.0;}
  // helmet: a white shell, cut open at the front over the gold visor
  vec3 hl=tl-vec3(0.02,0.435,0.0);float hr=length(hl);
  x=max(hr-0.176,-sdRBox(hl-vec3(0.17,-0.022,0.0),vec3(0.14,0.098,0.134),0.06));if(x<d){d=x;m=4.0;}
  x=hr-0.165;if(x<d){d=x;m=4.5;}
  x=sdDisc(vec3(tl.y-0.285,tl.x-0.01,tl.z),0.138,0.020)-0.006;if(x<d){d=x;m=8.0;}
  // hose connectors on the chest (red left, blue right) and the hoses round to the pack
  vec3 hz=vec3(tl.x,tl.y,abs(tl.z));
  x=sdDisc(hz-vec3(0.155,-0.11,0.095),0.030,0.022)-0.003;if(x<d){d=x;m=(tl.z<0.0)?5.5:5.7;}
  x=min(sdCap(hz,vec3(0.170,-0.11,0.095),vec3(0.085,-0.165,0.232),0.019),sdCap(hz,vec3(0.085,-0.165,0.232),vec3(-0.16,-0.13,0.236),0.019));
  if(x<d){d=x;m=5.0;}
  x=sdCap(tl,vec3(-0.27,0.585,0.12),vec3(-0.305,0.93,0.12),0.008);if(x<d){d=x;m=9.0;}
  vec2 r;
  r=boot(p,uJ[6],uJ[7],gBL,6.0);if(r.x<d){d=r.x;m=r.y;}
  r=boot(p,uJ[11],uJ[12],gBR,6.5);if(r.x<d){d=r.x;m=r.y;}
  r=hand(p,uJ[15],gLf,gLt,gLs,7.5);if(r.x<d){d=r.x;m=r.y;}
  r=hand(p,uJ[18],gRf,gRt,gRs,7.7);if(r.x<d){d=r.x;m=r.y;}
  return vec2(d,m);
}
vec3 normalA(vec3 p){const vec2 e=vec2(0.0012,-0.0012);
  return normalize(e.xyy*mapA(p+e.xyy).x+e.yyx*mapA(p+e.yyx).x+e.yxy*mapA(p+e.yxy).x+e.xxx*mapA(p+e.xxx).x);}
bool boundA(vec3 ro,vec3 rd,out float t0,out float t1){
  vec3 oc=ro-(uJ[0]+uJ[19]*0.12);float b=dot(oc,rd);float c=dot(oc,oc)-BR*BR;float h=b*b-c;
  t0=0.0;t1=0.0;
  if(h<0.0)return false;h=sqrt(h);t0=max(-b-h,0.0);t1=-b+h;return t1>0.0;
}
vec2 marchA(vec3 ro,vec3 rd){
  float t0,t1;if(!boundA(ro,rd,t0,t1))return vec2(-1.0,0.0);
  float t=t0;
  for(int i=0;i<90;i++){vec2 r=mapA(ro+rd*t);if(r.x<0.0006*t+0.0003)return vec2(t,r.y);t+=r.x;if(t>t1)break;}
  return vec2(-1.0,0.0);
}
float shadowA(vec3 p){
  float t0,t1;if(!boundA(p,uSun,t0,t1))return 1.0;
  float res=1.0,t=max(t0,0.02);
  for(int i=0;i<48;i++){float d=mapA(p+uSun*t).x;if(d<0.001)return 0.0;res=min(res,40.0*d/t);t+=clamp(d,0.010,0.30);if(t>t1)break;}
  return sat(res);
}
float aoA(vec3 p,vec3 n){float a=0.0,s=1.0;for(int i=1;i<=4;i++){float h=0.03*float(i);a+=(h-mapA(p+n*h).x)*s;s*=0.6;}return sat(1.0-3.0*a);}

// ---------------- sky ----------------
vec3 starLayer(vec3 rd,float sc,float seed){
  vec3 a=abs(rd);vec2 uv;float face;
  if(a.x>a.y&&a.x>a.z){uv=rd.yz/a.x;face=rd.x>0.0?0.0:1.0;}
  else if(a.y>a.z){uv=rd.xz/a.y;face=rd.y>0.0?2.0:3.0;}
  else{uv=rd.xy/a.z;face=rd.z>0.0?4.0:5.0;}
  vec2 g=uv*sc;vec2 id=floor(g);vec2 f=fract(g)-0.5;
  vec3 rn=hash32(id+face*37.0+seed);
  float d=length(f-(rn.xy-0.5)*0.7);
  float mag=pow(rn.z,16.0);
  float tw=0.8+0.2*sin(uT*(2.0+6.0*rn.x)+rn.y*40.0)+uHat*1.3*step(0.5,rn.x);
  vec3 tint=mix(vec3(1.0,0.84,0.66),vec3(0.70,0.82,1.0),rn.y);
  return tint*smoothstep(0.055,0.0,d)*2.4*mag*tw;
}
vec3 skyCol(vec3 rd){
  // a daylit camera sees very few stars: only the brightest survive the exposure
  vec3 c=starLayer(rd,90.0,0.0)+starLayer(rd,210.0,9.0)*0.5;
  // sparkle (bells)
  if(uSpark.w>0.001){
    vec3 dv=rd-normalize(uSpark.xyz);float d=length(dv);
    float cx=abs(dot(dv,uU)),cy=abs(dot(dv,uV));
    c+=vec3(1.0,0.93,0.78)*uSpark.w*(0.000010/(d*d+0.000004)+0.0000018/(cx*cy+0.0000012)*exp(-d*42.0));
  }
  return c;
}
vec3 earthCol(vec3 rd,out float alpha){
  alpha=0.0;
  vec3 c=uEarth*100.0;float R=5.6;
  float b=dot(rd,c);float h=b*b-(dot(c,c)-R*R);
  vec3 col=vec3(0.0);
  if(h>0.0){
    float t=b-sqrt(h);vec3 n=normalize(rd*t-c);
    float ndl=dot(n,uSun);float day=smoothstep(-0.08,0.20,ndl);
    vec3 q=n;q.xz*=rot(uT*0.010+1.0);q.xy*=rot(0.41);
    float land=fbm3(q*2.1+vec3(1.7,0.3,4.1));
    float lm=smoothstep(0.545,0.60,land);
    vec3 sea=mix(vec3(0.010,0.045,0.17),vec3(0.025,0.11,0.28),sat(land*1.6));
    vec3 gnd=mix(vec3(0.10,0.15,0.07),vec3(0.34,0.27,0.17),smoothstep(0.60,0.74,land+0.08*vnoise3(q*9.0)));
    gnd=mix(gnd,vec3(0.85),smoothstep(0.80,0.95,abs(q.y)));
    vec3 sf=mix(sea,gnd,lm);
    // weather systems: noise warped by itself so the cloud bands curl
    vec3 qw=q+0.26*vec3(fbm3(q*2.6+5.0),fbm3(q*2.6+11.0),fbm3(q*2.6+19.0));
    float cl=fbm3(qw*3.4+vec3(uT*0.005,7.0,0.0))*0.62+fbm3(qw*9.0-vec3(0.0,uT*0.003,3.0))*0.38;
    cl=smoothstep(0.43,0.70,cl+0.07*sin(q.y*9.0+qw.x*4.0));
    sf=mix(sf,vec3(0.92,0.94,0.97),cl*0.95);
    float ndv=sat(dot(n,-rd));
    vec3 hv=normalize(uSun-rd);
    sf+=vec3(1.0,0.9,0.7)*pow(sat(dot(n,hv)),80.0)*(1.0-lm)*(1.0-cl)*0.8;
    col=sf*SUNI*0.50*day*sat(ndl*0.8+0.2);
    // air: a thin blue limb, brightest on the day side
    col+=vec3(0.20,0.44,1.0)*pow(1.0-ndv,3.5)*0.9*day*(1.0+uSnare*1.2);
    alpha=1.0;
  }else{
    float ang=acos(clamp(dot(rd,uEarth),-1.0,1.0));
    float halo=exp(-max(ang-0.0561,0.0)*150.0);
    col=vec3(0.20,0.42,1.0)*halo*0.30*sat(dot(normalize(rd-uEarth*dot(rd,uEarth)),uSun)*1.6-0.15)*(1.0+uSnare*1.2);
  }
  return col;
}

// ---------------- shading ----------------
// value noise with its gradient
vec3 vnoised(vec2 p){
  vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f),du=6.0*f*(1.0-f);
  float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y,du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));
}
// Lunar soil scatters light back towards its source: brightest with the sun behind the camera, with a
// sharp surge at zero phase, and it does not darken towards grazing view the way a matte surface does.
vec3 regolith(vec3 alb,vec3 n,vec3 rd,float sh){
  float mu0=max(dot(n,uSun),0.0),mu=max(dot(n,-rd),0.03);
  float g=acos(clamp(dot(-rd,uSun),-1.0,1.0));
  float ph=0.60+0.74*exp(-g*1.15)+0.45*exp(-g*9.0);
  float ls=2.0*mu0/(mu0+mu);
  return alb*SUNI*sh*ph*mix(ls,2.4*mu0,0.42)*0.86;
}
// the print of a ribbed boot sole, as a height (metres); d.x runs along the boot
float printH(vec2 d){
  vec2 e=abs(d)/vec2(0.165,0.072);
  float k=pow(e.x*e.x*e.x+e.y*e.y*e.y,0.3333);
  float inside=smoothstep(1.0,0.84,k);
  float ribs=smoothstep(0.30,0.70,0.5+0.5*cos(d.x*251.0));
  return -0.017*inside+0.007*inside*ribs*smoothstep(0.92,0.70,k)+0.005*smoothstep(1.40,1.02,k)*smoothstep(0.84,1.0,k);
}
vec3 shadeG(vec3 p,vec3 rd,float t,float sM){
  vec2 q=p.xz;
  float sx=t*uPix;                                   // one pixel across the view (metres)...
  float cg=max(-rd.y,0.004);                         // ...is stretched by 1/cg along the view where it skims the ground
  float s=max(max(sx*inversesqrt(cg),0.25*sx/cg),0.003);
  float e=max(s*0.75,0.022);
  float h1=terrH(q+vec2(e,0.0),s),h2=terrH(q-vec2(e,0.0),s),h3=terrH(q+vec2(0.0,e),s),h4=terrH(q-vec2(0.0,e),s);
  vec3 n=normalize(vec3(h2-h1,2.0*e,h4-h3));
  float hc=0.25*(h1+h2+h3+h4);
  vec3 L=lanes(q.y);
  vec4 ta=textureLod(uTA,q/SA,log2(max(s*4.0,1.0)));
  vec4 tb=textureLod(uTB,q/SB,log2(max(s*32.0,1.0)));
  float dfade=1.0-smoothstep(2.0,4.0,s);
  float rock=sat(tb.b)*L.y*dfade;
  // tone: dark mare soil, mottled; fresh craters throw brighter material around themselves
  vec3 alb=vec3(0.150,0.141,0.132)*(0.80+0.42*ta.b)*(0.90+0.22*tb.a*dfade);
  alb*=1.0+0.50*sat(ta.g)*L.x;
  alb=mix(alb,alb*1.22+0.012,rock*0.7);
  // clods and grains finer than the height maps
  vec2 g=vec2(0.0);
  float f0=1.0-smoothstep(0.020,0.060,s);if(f0>0.0)g+=f0*0.090*vnoised(q*17.0).yz;
  float f1=1.0-smoothstep(0.006,0.020,s);if(f1>0.0)g+=f1*0.100*vnoised(q*57.0+7.0).yz;
  float f2=1.0-smoothstep(0.0018,0.006,s);if(f2>0.0)g+=f2*0.090*vnoised(q*190.0+3.0).yz;
  n=normalize(n-vec3(g.x,0.0,g.y)*(1.0-0.5*rock));
  // boot prints
  float prSh=1.0;
  float wF=1.0-smoothstep(0.010,0.035,s),wT=1.0-smoothstep(0.06,0.20,s);
  if(wT>0.0&&abs(q.y)<0.40){
    vec2 sd=normalize(uSun.xz);float tanE=uSun.y/length(uSun.xz);
    for(int i=0;i<16;i++){
      vec4 f=uFoot[i];if(f.w<0.5)continue;
      vec2 d=q-f.xy;if(abs(d.x)>0.27||abs(d.y)>0.14)continue;
      float h0=printH(d);
      alb*=1.0-0.42*(1.0-wF)*wT*smoothstep(-0.002,-0.012,h0);
      if(wF<=0.0)continue;
      float hx=printH(d+vec2(0.004,0.0)),hz=printH(d+vec2(0.0,0.004));
      n=normalize(n+wF*vec3(h0-hx,0.0,h0-hz)/0.004);
      // the wall on the sun's side shades the floor of the print
      float o1=printH(d+sd*0.012)-h0-0.012*tanE,o2=printH(d+sd*0.030)-h0-0.030*tanE;
      prSh=min(prSh,1.0-wF*smoothstep(0.0,0.003,max(o1,o2)));
      alb*=1.0-wF*0.20*smoothstep(-0.003,-0.012,h0);
    }
  }
  vec3 ps=vec3(p.x,hc,p.z);
  float sh=shadowT(ps+vec3(0.0,0.006+0.25*s,0.0),s);
  if(sh>0.0)sh*=shadowA(ps+vec3(0.0,0.012,0.0));
  sh*=prSh;
  vec3 col=regolith(alb,n,rd,sh);
  // shadows are filled only by light scattered off the sunlit ground around them, and a trace of earthshine
  col+=alb*(0.050*vec3(1.0,0.96,0.90)+0.012*vec3(0.5,0.65,1.0)*sat(dot(n,uEarth)+0.3))*(0.55+0.45*n.y)*SUNI*0.33;
  // contact shadow under the boots
  vec3 dq=p-uJ[0];
  if(dot(dq,dq)<3.2){vec2 cd=mapA(p+vec3(0.0,0.03,0.0));if(cd.y>0.5)col*=0.45+0.55*smoothstep(0.0,0.16,cd.x);}
  return col;
}
vec3 shadeFar(vec3 p,vec3 rd,float t){
  float e=max(t*0.006,5.0);
  float h=farH(p.xz);
  vec3 n=normalize(vec3(h-farH(p.xz+vec2(e,0.0)),e,h-farH(p.xz+vec2(0.0,e))));
  float hi=smoothstep(3.0,45.0,h);
  vec2 q=p.xz+vec2(uFarOff,0.0);
  vec2 g=(vec2(vnoise(q*0.021),vnoise(q*0.021+37.0))-0.5)*0.55+(vec2(vnoise(q*0.083),vnoise(q*0.083+11.0))-0.5)*0.35;
  n=normalize(n+vec3(g.x,0.0,g.y)*mix(0.10,0.55,hi));
  // the highlands are paler than the plain
  vec3 alb=mix(vec3(0.150,0.141,0.132),vec3(0.225,0.218,0.206),hi)*(0.86+0.28*vnoise(q*0.0040+3.0));
  float sh=1.0,ts=e*1.2;
  for(int i=0;i<12;i++){vec3 sp=p+vec3(0.0,0.4,0.0)+uSun*ts;sh=min(sh,7.0*(sp.y-farH(sp.xz))/ts);ts*=1.5;}
  sh=smoothstep(0.0,1.0,sh);
  vec3 col=regolith(alb,n,rd,sh);
  col+=alb*0.022*SUNI*0.33*(0.55+0.45*n.y);
  return col;
}
// what the gold visor mirrors: the suit's own arms and chest pack, the sunlit plain, the black sky
vec3 visorEnv(vec3 pos,vec3 R){
  float t=0.05;
  for(int i=0;i<26;i++){
    vec2 r=mapA(pos+R*t);
    if(r.x<0.004){
      vec3 q=pos+R*t;vec3 n=normalA(q);
      vec3 a=(r.y>6.9&&r.y<7.4)?vec3(0.45):vec3(0.78);
      return a*SUNI*(0.40*max(dot(n,uSun),0.0)+0.050*(0.65-0.35*n.y));
    }
    t+=r.x;if(t>0.9)break;
  }
  vec3 gnd=regolith(vec3(0.150,0.141,0.132),vec3(0.0,1.0,0.0),R,1.0)*smoothstep(1.0,0.72,-R.y);
  float sd=max(dot(R,uSun),0.0);
  vec3 sky=vec3(1.0,0.96,0.88)*(pow(sd,2500.0)*260.0+pow(sd,400.0)*30.0+pow(sd,60.0)*1.2);
  sky+=vec3(0.30,0.52,1.0)*pow(max(dot(R,uEarth),0.0),700.0)*5.0;
  return mix(gnd,sky,smoothstep(-0.012,0.012,R.y));
}
vec3 shadeA(vec3 p,vec3 rd,float mat){
  vec3 n=normalA(p);
  vec3 tq=p-uJ[1];vec3 tl=vec3(dot(tq,gF),dot(tq,gU),dot(tq,gR));
  float hgt=p.y-baseH(p.xz);
  vec3 alb=vec3(0.80,0.79,0.76);float spec=0.03,gloss=14.0,cloth=1.0;vec3 emis=vec3(0.0);
  if(mat<1.5){
    // harness straps over the shoulders, the belt, the seam of the front flap
    float strap=smoothstep(0.024,0.018,abs(abs(tl.z)-0.115))*step(-0.06,tl.x)*step(-0.04,tl.y);
    alb=mix(alb,vec3(0.55,0.55,0.57),strap*0.85);
    alb*=1.0-0.30*smoothstep(0.010,0.004,abs(tl.y+0.215));
    alb*=1.0-0.22*smoothstep(0.006,0.002,abs(tl.z-0.02*sin(tl.y*9.0)))*step(0.0,tl.x)*step(tl.y,0.12);
  }else if(mat<2.3){
    alb=vec3(0.79,0.79,0.77);
    alb*=1.0-0.28*smoothstep(0.008,0.003,abs(tl.y-0.25))-0.28*smoothstep(0.008,0.003,abs(tl.y+0.08));
    alb*=1.0-0.20*smoothstep(0.007,0.002,abs(abs(tl.z)-0.13))*step(tl.x,-0.37);
  }else if(mat<2.8){
    alb=vec3(0.69,0.69,0.70);alb*=1.0-0.25*smoothstep(0.007,0.002,abs(tl.y-0.50));
  }else if(mat<3.5){
    alb=vec3(0.50,0.51,0.54);spec=0.22;gloss=40.0;cloth=0.0;
    if(tl.x>0.226){
      vec2 g=vec2(tl.z,tl.y-0.055);float led=0.0;
      for(int i=0;i<3;i++)led=max(led,smoothstep(0.016,0.010,length(g-vec2(-0.055+0.055*float(i),0.035))));
      emis+=neon(uHue)*led*(0.5+5.0*uBass);
      alb=mix(alb,vec3(0.06),smoothstep(0.028,0.022,length(g-vec2(-0.04,-0.025))));
      alb=mix(alb,vec3(0.76,0.74,0.70),smoothstep(0.012,0.008,abs(g.x-0.045))*smoothstep(0.030,0.022,abs(g.y+0.025)));
    }
  }else if(mat<4.3){
    vec3 hl=tl-vec3(0.02,0.435,0.0);
    alb=vec3(0.83,0.82,0.80);spec=0.10;gloss=30.0;cloth=0.0;
    // the commander's red stripe over the crown
    alb=mix(alb,vec3(0.68,0.06,0.05),smoothstep(0.024,0.018,abs(hl.z))*step(0.03,hl.y)*step(hl.x,0.10));
  }else if(mat<4.8){
    vec3 env=visorEnv(p+n*0.004,reflect(rd,n));
    vec3 gold=vec3(1.0,0.76,0.33);
    return env*gold*(0.72+0.28*pow(1.0-sat(dot(n,-rd)),4.0))+gold*0.005;
  }else if(mat<5.3){
    alb=vec3(0.66,0.67,0.70)*(0.86+0.14*sin(tl.x*210.0+tl.y*130.0));
  }else if(mat<5.6){alb=vec3(0.62,0.06,0.05);spec=0.45;gloss=50.0;cloth=0.0;}
  else if(mat<5.8){alb=vec3(0.05,0.14,0.55);spec=0.45;gloss=50.0;cloth=0.0;}
  else if(mat<6.9){
    cloth=0.0;
    if(fract(mat*2.0)>0.25)alb=vec3(0.17,0.19,0.25);
    else{
      vec3 a=(mat<6.4)?uJ[6]:uJ[11],b=(mat<6.4)?uJ[7]:uJ[12],d=(mat<6.4)?gBL:gBR;
      vec3 q=p-(a+b)*0.5;float lx=dot(q,d);
      alb=vec3(0.64,0.64,0.66)*(1.0-0.30*smoothstep(0.010,0.004,abs(lx-0.03))-0.30*smoothstep(0.010,0.004,abs(lx+0.08)));
    }
  }else if(mat<7.3){
    // gloves: grey, with dark blue silicone fingertips
    bool lf=distance(p,uJ[15])<distance(p,uJ[18]);
    float lx=lf?dot(p-uJ[15],gLf):dot(p-uJ[18],gRf);
    alb=mix(vec3(0.52,0.53,0.56),vec3(0.13,0.16,0.26),smoothstep(0.118,0.136,lx));cloth=0.0;
  }else if(mat<7.6){alb=vec3(0.60,0.07,0.05);spec=0.5;gloss=60.0;cloth=0.0;}
  else if(mat<7.8){alb=vec3(0.05,0.15,0.55);spec=0.5;gloss=60.0;cloth=0.0;}
  else if(mat<8.5){alb=vec3(0.30,0.31,0.35);spec=0.6;gloss=50.0;cloth=0.0;}
  else if(mat<9.5){alb=vec3(0.55,0.56,0.58);spec=0.6;gloss=40.0;cloth=0.0;}
  else{
    // limbs: the darker grooves of the bellows, red bands on upper arms and thighs
    vec3 a,b;float h0,len;bool arm=mat>13.5;
    if(mat<10.5){a=uJ[3];b=uJ[4];h0=0.86;len=0.43;}else if(mat<11.5){a=uJ[4];b=uJ[5];h0=0.10;len=0.42;}
    else if(mat<12.5){a=uJ[8];b=uJ[9];h0=0.86;len=0.43;}else if(mat<13.5){a=uJ[9];b=uJ[10];h0=0.10;len=0.42;}
    else if(mat<14.5){a=uJ[13];b=uJ[14];h0=0.90;len=0.29;}else if(mat<15.5){a=uJ[14];b=uJ[15];h0=0.08;len=0.27;}
    else if(mat<16.5){a=uJ[16];b=uJ[17];h0=0.90;len=0.29;}else{a=uJ[17];b=uJ[18];h0=0.08;len=0.27;}
    vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
    float bel=smoothstep(0.15,0.06,abs(h-h0));
    alb*=1.0-0.20*bel*(0.5-0.5*cos((h-h0)*len*261.8));
    bool upper=(mat<10.5)||(mat>11.5&&mat<12.5)||(mat>13.5&&mat<14.5)||(mat>15.5&&mat<16.5);
    if(upper)alb=mix(alb,vec3(0.68,0.06,0.05),smoothstep(0.026,0.020,abs(h-0.50)*len));
  }
  // woven cloth: creases too fine for the distance field
  if(cloth>0.5){
    vec3 q=tl*27.0;float n0=vnoise3(q);
    vec3 gr=vec3(vnoise3(q+vec3(0.4,0.0,0.0)),vnoise3(q+vec3(0.0,0.4,0.0)),vnoise3(q+vec3(0.0,0.0,0.4)))-n0;
    vec3 gw=gF*gr.x+gU*gr.y+gR*gr.z;
    n=normalize(n-0.50*(gw-n*dot(gw,n)));
    alb*=0.95+0.07*n0;
  }
  // lunar dust clings to everything that goes near the ground: grey to the knees
  float dirt=smoothstep(0.66,0.06,hgt)*(0.60+0.40*vnoise3(tl*19.0));
  alb=mix(alb,vec3(0.31,0.295,0.28),dirt*0.72);
  float ndl=dot(n,uSun),ndv=sat(dot(n,-rd));
  float sh=(ndl>0.0)?shadowA(p+n*0.012):0.0;
  float ao=aoA(p,n);
  vec3 col=alb*SUNI*0.42*sat(ndl)*sh;
  // the bright ground lights the shadow side from below (it is why suits glow in the Apollo photographs)
  col+=alb*vec3(0.62,0.59,0.55)*SUNI*0.058*(0.25+0.75*sat(0.55-0.45*n.y))*ao;
  col+=alb*vec3(0.30,0.45,0.9)*0.010*SUNI*sat(dot(n,uEarth)*0.5+0.5)*ao;
  col+=vec3(1.0,0.97,0.92)*spec*pow(sat(dot(n,normalize(uSun-rd))),gloss)*sh*SUNI*0.4;
  col+=emis;
  return col;
}
// soft halo of a small lamp at c, drawn only when it is in front of whatever the ray hit
vec3 lamp(vec3 ro,vec3 rd,vec3 c,vec3 colr,float w2,float tHit){
  float t=dot(c-ro,rd);if(t<0.0||t>tHit+0.05)return vec3(0.0);
  vec3 d=ro+rd*t-c;return colr*w2/(dot(d,d)+w2);
}
void main(){
  frames();
  vec2 pp=(vUv*2.0-1.0)*vec2(uRes.x/uRes.y,1.0);
  vec3 rd=normalize(pp.x*uU+pp.y*uV+uFov*uW);vec3 ro=uCam;
  float sH;float tT=marchT(ro,rd,sH);
  vec2 hA=marchA(ro,rd);
  vec3 col;float depth=1.0e4;
  if(hA.x>0.0&&(tT<0.0||hA.x<tT)){col=shadeA(ro+rd*hA.x,rd,hA.y);depth=hA.x;}
  else if(tT>0.0){col=shadeG(ro+rd*tT,rd,tT,sH);depth=tT;}
  else{
    float tf=marchFar(ro,rd);
    if(tf>0.0){col=shadeFar(ro+rd*tf,rd,tf);depth=min(tf,9000.0);}
    else{
      float ea;vec3 e=earthCol(rd,ea);
      col=skyCol(rd)*(1.0-ea)+e;
      float sd=max(dot(rd,uSun),0.0);
      col+=vec3(1.0,0.96,0.88)*(pow(sd,3000.0)*500.0+pow(sd,160.0)*1.6+pow(sd,22.0)*0.05);
    }
  }
  // suit lamps: a beacon in the bass colour on the antenna tip, twin helmet lights on accents
  col+=lamp(ro,rd,uJ[1]-gF*0.306+gU*0.945+gR*0.12,uBeaconC,0.00022,depth);
  o=vec4(col,depth);
}`,
  init: function () {
    if (!GLX.hdr) throw new Error('The moon needs floating-point render targets, which this browser/GPU does not offer.');
    this.prog = new Prog('moon', this.FS);
    this.pBake = new Prog('moon.bake', this.BAKE);
    var vs = '#version 300 es\nlayout(location=0) in vec4 aP;uniform vec3 uCam,uU,uV,uW;uniform float uFov,uAsp,uResY;out float vLife;out float vDist;\n' +
      'void main(){vec3 d=aP.xyz-uCam;float z=dot(d,uW);vLife=aP.w;vDist=length(d);\n' +
      'if(z<0.2||aP.w<=0.0){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=1.0;return;}\n' +
      'vec2 ndc=vec2(dot(d,uU),dot(d,uV))*uFov/z;ndc.x/=uAsp;gl_Position=vec4(ndc,0.0,1.0);\n' +
      'gl_PointSize=clamp(0.011*uFov*uResY*0.5/z*(0.7+0.6*aP.w),1.2,14.0);}';
    this.pDust = new Prog('moon.dust', 'in float vLife;in float vDist;uniform sampler2D uScene;uniform vec2 uRes;\n' +
      'void main(){vec2 q=gl_PointCoord-0.5;float a=smoothstep(0.5,0.05,length(q));\n' +
      'float sd=texture(uScene,gl_FragCoord.xy/uRes).a;if(vDist>sd+0.04)discard;\n' +
      'float k=a*sat(vLife*3.0);o=vec4(vec3(1.10,1.04,0.97)*k*0.34,k*0.26);}', vs);
    this.NP = 14000;
    this.dp = new Float32Array(this.NP * 4); this.dv = new Float32Array(this.NP * 3); this.dn = 0;
    this.dbuf = gl.createBuffer(); this.dvao = gl.createVertexArray();
    gl.bindVertexArray(this.dvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.dbuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.dp, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.J = new Float32Array(63); this.foot = new Float32Array(64); this.fi = 0; this.NF = 16; this.farOff = 0; this.hi = [3.0, 0.7, 0.05];
    this.gait = 0; this.lastSong = 0; this.wk = 0; this.dist = 0;
    this.fo = [{}, {}]; this.prevU = [0, 0.5]; this.pv = {};
    this.cam = [0, 1.4, 6]; this.tgt = [0, 1, 0]; this.U3 = [1, 0, 0]; this.V3 = [0, 1, 0]; this.W3 = [0, 0, -1];
    this.shotI = 0; this.shotT = 0; this.fov = 2.6;
    this.sun = this.norm([0.86, 0.27, 0.18]); this.earth = this.norm([-0.30, 0.20, -0.93]);
    this.spark = [0, 1, 0, 0];
    this.beacon = [0, 0, 0]; this.bk = 0; this.rs = mulberry(4242);
    moonFoot(0, this.fo[0]); moonFoot(0.5, this.fo[1]);
  },
  norm: function (v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; },
  // draw the two height maps, build their mip chains, and keep what JS needs to know about them
  bake: function () {
    var N = 1024, self = this, buf = new Float32Array(N * N * 4), ok = true, x, y, i, j;
    var run = function (mode) {
      var T = new Target(N, N, 'rgba16f', gl.LINEAR, gl.REPEAT);
      T.bind(); self.pBake.use().f('uMode', mode); drawFS();
      while (gl.getError() !== gl.NO_ERROR) { }
      gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf);
      if (gl.getError() !== gl.NO_ERROR) ok = false;
      gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      return T;
    };
    this.tA = run(0);
    // the large relief, as the highest point of every square metre: bounds for the ray marcher, clearance for the camera
    var C = this.cpuA = new Float32Array(256 * 256), hiA = 0, hiG = 0, hiR = 0;
    if (ok) {
      for (y = 0; y < 256; y++) for (x = 0; x < 256; x++) {
        var m = -1e9;
        for (j = 0; j < 4; j++) for (i = 0; i < 4; i++) m = Math.max(m, buf[((y * 4 + j) * N + x * 4 + i) * 4]);
        C[y * 256 + x] = m; if (m > hiA) hiA = m;
      }
    } else { for (i = 0; i < C.length; i++) C[i] = 1.5; hiA = 3.2; }
    this.tB = run(1);
    if (ok) { for (i = 0; i < N * N; i++) { if (buf[i * 4] > hiR) hiR = buf[i * 4]; if (buf[i * 4 + 1] > hiG) hiG = buf[i * 4 + 1]; } }
    else { hiG = 0.75; hiR = 0.06; }
    this.hi = [hiA + 0.01, hiG + 0.01, hiR + 0.004];
    this.baked = true;
  },
  // highest the ground can be near (x, z): smooth ground + large relief + the tallest stone
  groundTop: function (x, z) {
    var h = moonGroundY(x, z), la = moonLaneA(z);
    if (la > 0 && this.cpuA) {
      var cx = Math.floor(((x % 256) + 256) % 256), cz = Math.floor(((z % 256) + 256) % 256), m = -1e9, i, j;
      for (j = -1; j <= 1; j++) for (i = -1; i <= 1; i++) m = Math.max(m, this.cpuA[((cz + j + 256) % 256) * 256 + ((cx + i + 256) % 256)]);
      h += la * Math.max(m, 0);
    }
    return h + moonLaneG(z) * this.hi[1];
  },
  resize: function (w, h) {
    if (this.mT && this.mT.w === w && this.mT.h === h) return;
    if (this.mT) this.mT.free();
    this.mT = new Target(w, h, 'rgba16f', gl.NEAREST);
  },
  enter: function () { this.lastSong = Sig.song; },
  // camera set-ups, relative to the ground point under the walker
  SHOTS: [
    { p: [0.9, 1.30, 6.0], t: [0.55, 1.12, 0], fov: 2.75, dx: -0.08, dof: 3 },    // side tracking shot
    { p: [2.3, 1.45, 1.9], t: [0.15, 1.32, 0], fov: 2.6, dx: -0.05, dof: 5 },     // close on the visor
    { p: [6.0, 0.55, 4.6], t: [0.3, 1.10, 0], fov: 2.8, dx: -0.20, dof: 2.5 },    // low, walking towards the lens
    { p: [2.5, 1.30, 13.0], t: [0.6, 2.2, 0], fov: 2.9, dx: -0.30, dof: 0 },      // wide: a small figure under the Earth
    { p: [-4.8, 2.3, 4.0], t: [1.7, 0.85, 0], fov: 2.5, dx: 0.10, dof: 4 }        // from behind: the trail of prints, the long shadow
  ],

  emit: function (x, y, z, n, dirX, pw) {
    var R = this.rs, i;
    n = Math.round(n * this.P.dust);
    for (i = 0; i < n; i++) {
      var k = this.dn; this.dn = (this.dn + 1) % this.NP;
      this.dp[k * 4] = x + (R() - 0.5) * 0.16; this.dp[k * 4 + 1] = y + 0.02; this.dp[k * 4 + 2] = z + (R() - 0.5) * 0.12; this.dp[k * 4 + 3] = 1;
      var sp = (0.35 + R() * R() * 1.9) * pw, el = 0.12 + R() * 0.66, az = (R() - 0.5) * 2.3;
      this.dv[k * 3] = Math.cos(az) * Math.cos(el) * sp * dirX; this.dv[k * 3 + 1] = Math.sin(el) * sp; this.dv[k * 3 + 2] = Math.sin(az) * Math.cos(el) * sp;
    }
  },
  skyDir: function (out, spread, elLo, elHi) {
    // a direction in the part of the sky the camera is facing
    var R = this.rs, a = (R() - 0.5) * spread, e = elLo + R() * (elHi - elLo), W = this.W3, U = this.U3;
    var dx = W[0] * Math.cos(a) + U[0] * Math.sin(a), dz = W[2] * Math.cos(a) + U[2] * Math.sin(a), l = Math.hypot(dx, dz) || 1;
    out[0] = dx / l * Math.cos(e); out[1] = Math.sin(e); out[2] = dz / l * Math.cos(e); out[3] = 1;
  },
  on: function (type, ev) {
    var R = this.rs, i;
    if (type === 'step') {
      if (ev.on) { neonJS(noteHue(ev.note), this.beacon, 1); this.bk = ev.accent ? 1.5 : 1; }
      if (ev.i === 0 && Sig.bar > 0 && Sig.bar % 4 === 0 && this.P.cuts >= 0.5) {
        this.shotI = (this.shotI + 1) % this.SHOTS.length; this.shotT = 0; App.flashCut = 0.45;
      }
    } else if (type === 'bell') {
      this.skyDir(this.spark, 1.3, 0.22, 0.70);
    }
  },
  setJ: function (i, x, y, z) { var J = this.J; J[i * 3] = x; J[i * 3 + 1] = y; J[i * 3 + 2] = z; },
  // two-bone IK in the sagittal plane (the knee always bends forwards), then the boot axis from its pitch
  leg: function (hx, hy, hz, ax, ay, az, base, pitch) {
    var M = MOON, dx = ax - hx, dy = ay - hy, dz = az - hz;
    var d = Math.hypot(dx, dy, dz), mx = M.L1 + M.L2 - 0.004;
    if (d > mx) { var k = mx / d; dx *= k; dy *= k; dz *= k; d = mx; ax = hx + dx; ay = hy + dy; az = hz + dz; }
    d = Math.max(d, 0.08);
    var ux = dx / d, uy = dy / d, uz = dz / d;
    var a = (M.L1 * M.L1 - M.L2 * M.L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, M.L1 * M.L1 - a * a));
    var px = 1 - ux * ux, py = -uy * ux, pz = -uz * ux, pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    this.setJ(base, hx, hy, hz);
    this.setJ(base + 1, hx + ux * a + px * h, hy + uy * a + py * h, hz + uz * a + pz * h);
    this.setJ(base + 2, ax, ay, az);
    var c = Math.cos(pitch), s = Math.sin(pitch);
    this.setJ(base + 3, ax - 0.045 * c - 0.01 * s, ay + 0.045 * s - 0.01 * c, az);
    this.setJ(base + 4, ax + 0.195 * c - 0.01 * s, ay - 0.195 * s - 0.01 * c, az);
  },
  pose: function (t) {
    var M = MOON, P = this.P, g = this.gait, wk = this.wk, i, pv = this.pv;
    moonPelvis(fract(2 * g), moonHop(Sig.bpm) * P.bounce, pv);
    var c2 = Math.cos(6.2832 * g), s2 = Math.sin(6.2832 * g);
    // blend between standing still and the lope
    var lean = lerp(0.055 + 0.010 * Math.sin(t * 0.9), 0.215 + 0.045 * Math.sin(12.566 * g + 0.6), wk);
    var yaw = lerp(0, 0.11 * s2, wk);
    var pelY = lerp(0.950 + 0.004 * Math.sin(t * 1.3), pv.y, wk);
    var X = this.dist, Z = lerp(0, 0.028 * s2, wk);
    var gy = moonGroundY(X, 0), px = X, py = gy + pelY, pz = Z;
    var Ux = Math.sin(lean), Uy = Math.cos(lean), Fx = Math.cos(lean), Fy = -Math.sin(lean);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    // body frame after the twist about its own up axis: F2 forward, R2 right
    var F2x = Fx * cy, F2y = Fy * cy, F2z = sy, R2x = -Fx * sy, R2y = -Fy * sy, R2z = cy;
    this.setJ(0, px, py, pz);
    this.setJ(1, px + Ux * 0.27, py + Uy * 0.27, pz);
    this.setJ(2, px + Ux * 0.705 + F2x * 0.02, py + Uy * 0.705 + F2y * 0.02, pz + F2z * 0.02);
    this.setJ(19, Ux, Uy, 0); this.setJ(20, F2x, F2y, F2z);
    for (i = 0; i < 2; i++) {
      var sgn = i === 0 ? -1 : 1, fo = this.fo[i];
      moonFoot(fract(g + (i === 0 ? 0 : 0.5)), fo);
      var fyRel = fo.y + (fo.ground ? 0 : 0.8 * pv.rise - 0.7 * pv.dip);   // a swinging boot rides up and down with the body
      var hx = px - Ux * 0.03 + R2x * 0.105 * sgn, hy = py - Uy * 0.03 + R2y * 0.105 * sgn, hz = pz + R2z * 0.105 * sgn;
      var fx = lerp(X + 0.03, X + fo.x, wk), fz = sgn * lerp(0.15, 0.135, wk);
      var gf = moonGroundY(fx, fz), fy = gf + lerp(M.ANKH, fyRel, wk);
      this.leg(hx, hy, hz, fx, fy, fz, i === 0 ? 3 : 8, lerp(0, fo.pitch, wk));
      fo.wx = fx; fo.wz = fz; fo.wy = gf;
    }
    // Arms swing against the legs, held forward and out the way a pressurised suit forces them. What the eye
    // pairs an arm with is the opposite THIGH (the knee driving forward), which leads the foot by about a fifth
    // of a cycle in this loping gait: so each hand peaks when the knee on its own side is furthest back.
    var ca = Math.cos(6.2832 * (g + 0.23));
    for (i = 0; i < 2; i++) {
      var sg = i === 0 ? -1 : 1, ph = (i === 0) ? -ca : ca;
      var al = lerp(0.10, 0.26 + 0.36 * ph, wk), ga = lerp(0.42, 0.86 + 0.20 * ph, wk), be = lerp(0.22, 0.36, wk);
      var shx = px + Ux * 0.495 + R2x * 0.225 * sg, shy = py + Uy * 0.495 + R2y * 0.225 * sg, shz = pz + R2z * 0.225 * sg;
      var cal = Math.cos(al), sa = Math.sin(al), cb = Math.cos(be), sb = Math.sin(be);
      var ux = (-Ux * cal + F2x * sa) * cb + R2x * sb * sg, uy = (-Uy * cal + F2y * sa) * cb + R2y * sb * sg, uz = (F2z * sa) * cb + R2z * sb * sg;
      var ex = shx + ux * 0.29, ey = shy + uy * 0.29, ez = shz + uz * 0.29;
      var cg = Math.cos(al + ga), sgm = Math.sin(al + ga), cb2 = Math.cos(be * 0.35), sb2 = Math.sin(be * 0.35);
      var vx = (-Ux * cg + F2x * sgm) * cb2 + R2x * sb2 * sg, vy = (-Uy * cg + F2y * sgm) * cb2 + R2y * sb2 * sg, vz = (F2z * sgm) * cb2 + R2z * sb2 * sg;
      var b0 = i === 0 ? 13 : 16;
      this.setJ(b0, shx, shy, shz); this.setJ(b0 + 1, ex, ey, ez); this.setJ(b0 + 2, ex + vx * 0.27, ey + vy * 0.27, ez + vz * 0.27);
    }
  },
  update: function (dt, t) {
    var M = MOON, i, P = this.P;
    // the gait follows the song position exactly while the transport runs
    var dg = Sig.song - this.lastSong; this.lastSong = Sig.song;
    if (!Sig.running || dg < 0 || dg > 0.25) dg = 0;
    this.wk += ((Sig.running ? 1 : 0) - this.wk) * (1 - Math.exp(-dt / 0.35));
    this.gait += dg; this.dist += dg * 2 * M.STEP;
    this.pose(t);
    // the terrain repeats every 256 m: step everything back by one tile now and then, which cannot be seen
    if (this.dist > 300) {
      this.dist -= 256; this.farOff += 256;
      for (i = 0; i < this.NF; i++) this.foot[i * 4] -= 256;
      for (i = 0; i < this.NP; i++) this.dp[i * 4] -= 256;
    }
    for (i = 0; i < this.NF; i++) this.foot[i * 4 + 2] += dt;
    // boot events: prints and sprays of regolith
    for (i = 0; i < 2; i++) {
      var u = fract(this.gait + (i === 0 ? 0 : 0.5)), pu = this.prevU[i], fo = this.fo[i];
      if (this.wk > 0.6 && dg > 0) {
        if (u < pu) {                              // touchdown
          var k = this.fi; this.fi = (this.fi + 1) % this.NF;
          this.foot[k * 4] = fo.wx + 0.075; this.foot[k * 4 + 1] = fo.wz; this.foot[k * 4 + 2] = 0; this.foot[k * 4 + 3] = 1;
          this.emit(fo.wx + 0.14, fo.wy, fo.wz, 900, 1, 1.0 + 0.4 * Sig.kick);
          this.emit(fo.wx - 0.03, fo.wy, fo.wz, 300, -1, 0.7);
        } else if (pu < M.SD && u >= M.SD) {       // toe-off throws a low fan backwards
          this.emit(fo.wx + 0.05, fo.wy, fo.wz, 650, -1, 1.2);
        }
      }
      this.prevU[i] = u;
    }
    // vacuum ballistics under lunar gravity: no drag, so every grain flies a clean parabola
    var dp = this.dp, dv = this.dv, N = this.NP;
    for (i = 0; i < N; i++) {
      if (dp[i * 4 + 3] <= 0) continue;
      dv[i * 3 + 1] -= 1.62 * dt;
      dp[i * 4] += dv[i * 3] * dt; dp[i * 4 + 1] += dv[i * 3 + 1] * dt; dp[i * 4 + 2] += dv[i * 3 + 2] * dt;
      dp[i * 4 + 3] -= dt * 0.45;
      if (dv[i * 3 + 1] < 0 && dp[i * 4 + 1] < moonGroundY(dp[i * 4], dp[i * 4 + 2]) + 0.01) dp[i * 4 + 3] = 0;
    }
    this.bk *= Math.exp(-dt / 0.16);
    this.spark[3] *= Math.exp(-dt / 0.55);
    // camera
    this.shotT += dt;
    var S = this.SHOTS[this.shotI], X = this.dist, gy = moonGroundY(X, 0), pu2 = UIP.punch;
    var drift = S.dx * Math.min(this.shotT, 14);
    var sx = 0.010 * Sig.kick * pu2 * Math.sin(t * 83), syk = 0.014 * Sig.kick * pu2 * Math.sin(t * 97 + 1);
    var cx = X + S.p[0] + drift + sx, cz = S.p[2];
    this.cam[0] = cx; this.cam[1] = Math.max(gy + S.p[1] + syk, this.groundTop(cx, cz) + 0.32); this.cam[2] = cz;
    var hopFollow = (this.J[1] - gy - M.PELV) * 0.35 * this.wk;
    this.tgt[0] = X + S.t[0]; this.tgt[1] = gy + S.t[1] + hopFollow; this.tgt[2] = S.t[2];
    this.fov = S.fov;
    var wx = this.tgt[0] - this.cam[0], wy = this.tgt[1] - this.cam[1], wz = this.tgt[2] - this.cam[2], wl = Math.hypot(wx, wy, wz);
    wx /= wl; wy /= wl; wz /= wl;
    var ux = -wz, uz = wx, ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    this.W3[0] = wx; this.W3[1] = wy; this.W3[2] = wz; this.U3[0] = ux; this.U3[1] = 0; this.U3[2] = uz;
    this.V3[0] = -uz * wy; this.V3[1] = uz * wx - ux * wz; this.V3[2] = ux * wy;
  },
  render: function (t, tgt) {
    if (!this.baked) this.bake();
    var p = this.prog.use(), m = this.mT, pu = UIP.punch, k = this.bk * 3.2, J = this.J;
    m.bind();
    p.v2('uRes', m.w, m.h).f('uT', t)
      .v3('uCam', this.cam[0], this.cam[1], this.cam[2]).v3('uU', this.U3[0], this.U3[1], this.U3[2])
      .v3('uV', this.V3[0], this.V3[1], this.V3[2]).v3('uW', this.W3[0], this.W3[1], this.W3[2]).f('uFov', this.fov)
      .f('uPix', 1 / (this.fov * 0.5 * m.h))
      .v3v('uJ[0]', J).v4v('uFoot[0]', this.foot)
      .v3('uSun', this.sun[0], this.sun[1], this.sun[2]).v3('uEarth', this.earth[0], this.earth[1], this.earth[2])
      .tex('uTA', this.tA.tex, 0).tex('uTB', this.tB.tex, 1).v3('uHi', this.hi[0], this.hi[1], this.hi[2]).f('uFarOff', this.farOff)
      .f('uHue', Sig.hue).f('uKick', Sig.kick * pu).f('uSnare', Sig.snare * pu).f('uHat', Sig.hat)
      .f('uBass', Math.min(Sig.bass, 1.3)).f('uAccent', Sig.accent).f('uStab', Sig.stab).f('uBell', Sig.bell)
      .v3('uBeaconC', this.beacon[0] * k, this.beacon[1] * k, this.beacon[2] * k)
      .v4('uSpark', this.spark[0], this.spark[1], this.spark[2], this.spark[3]);
    drawFS();
    // lens focused on the walker
    var fx = J[3] - this.cam[0], fy = J[4] - this.cam[1], fz = J[5] - this.cam[2];
    Post.dof(m, tgt, Math.hypot(fx, fy, fz), this.SHOTS[this.shotI].dof || 0);
    // dust drawn on top, depth-tested against the traced scene (its distance is stored in alpha)
    gl.bindVertexArray(this.dvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.dbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dp);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.pDust.use().tex('uScene', m.tex, 0).v2('uRes', m.w, m.h)
      .v3('uCam', this.cam[0], this.cam[1], this.cam[2]).v3('uU', this.U3[0], this.U3[1], this.U3[2])
      .v3('uV', this.V3[0], this.V3[1], this.V3[2]).v3('uW', this.W3[0], this.W3[1], this.W3[2])
      .f('uFov', this.fov).f('uAsp', m.w / m.h).f('uResY', m.h);
    gl.drawArrays(gl.POINTS, 0, this.NP);
    gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }
};
