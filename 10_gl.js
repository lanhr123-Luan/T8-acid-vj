// ============================================================================
//  WebGL2 core + HDR post pipeline (bloom, lens, filmic tonemap, FXAA, grain)
// ============================================================================
var gl = null;
var GLX = { hdr: false, w: 0, h: 0, scale: 1, vao: null, errors: [] };
var VS_FULL = '#version 300 es\nout vec2 vUv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';
var FS_HEAD = '#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;\nin vec2 vUv;out vec4 o;\n';
// shared GLSL library ---------------------------------------------------------
var GLSL_LIB = `
#define PI 3.14159265359
#define TAU 6.28318530718
float sat(float x){return clamp(x,0.0,1.0);}
vec3 sat3(vec3 x){return clamp(x,0.0,1.0);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float hash11(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 hash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
vec3 hash32(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));p3+=dot(p3,p3.yxz+33.33);return fract((p3.xxy+p3.yzz)*p3.zyx);}
float hash31(vec3 p3){p3=fract(p3*0.1031);p3+=dot(p3,p3.zyx+31.32);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x),u.y);}
float vnoise3(vec3 p){vec3 i=floor(p),f=fract(p);vec3 u=f*f*(3.0-2.0*f);
  float a=mix(mix(hash31(i),hash31(i+vec3(1,0,0)),u.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),u.x),u.y);
  float b=mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),u.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),u.x),u.y);
  return mix(a,b,u.z);}
float fbm2(vec2 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.3,9.1);a*=0.5;}return s;}
vec3 hsv(float h,float s,float v){vec3 k=clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);return v*mix(vec3(1.0),k,s);}
// perceptually even-ish neon palette: hue in turns -> saturated colour with balanced luminance
vec3 neon(float h){vec3 c=hsv(fract(h),0.92,1.0);float l=dot(c,vec3(0.2627,0.678,0.0593));return c*(0.62/(0.25+l));}
float luma(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
`;

function glFail(msg) {
  GLX.errors.push(msg);
  try { console.error('[t8] ' + msg); } catch (e) { }
  var el = $('glerr');
  if (el) { el.style.display = 'block'; el.textContent = msg.slice(0, 1400); }
}
function glInit(canvas) {
  gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false, desynchronized: false
  });
  if (!gl) { glFail('WebGL2 unavailable: this browser / GPU cannot run the visuals (use a current Chrome or Edge).'); return false; }
  GLX.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  GLX.par = gl.getExtension('KHR_parallel_shader_compile');
  GLX.vao = gl.createVertexArray();
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); GLX.lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', function () { location.reload(); }, false);
  return true;
}
function shaderLog(sh, src, name) {
  var log = gl.getShaderInfoLog(sh) || '';
  var m = /ERROR:\s*\d+:(\d+)/.exec(log), ctxl = '';
  if (m) { var L = src.split('\n'), n = parseInt(m[1], 10); ctxl = '\n>> ' + (L[n - 2] || '') + '\n>> ' + (L[n - 1] || '') + '\n>> ' + (L[n] || ''); }
  return 'shader "' + name + '" failed: ' + log + ctxl;
}
// Compiling a big ray-marching shader can take seconds on Windows (ANGLE/D3D). Nothing here asks the
// driver for a result, so with KHR_parallel_shader_compile the page keeps animating while it works.
function Prog(name, fsBody, vsSrc, noLib) {
  this.name = name; this.u = {}; this.ok = false;
  this.vsSrc = vsSrc || VS_FULL; this.fsSrc = FS_HEAD + (noLib ? '' : GLSL_LIB) + fsBody;
  var p = this.p = gl.createProgram();
  this.vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(this.vs, this.vsSrc); gl.compileShader(this.vs);
  this.fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(this.fs, this.fsSrc); gl.compileShader(this.fs);
  gl.attachShader(p, this.vs); gl.attachShader(p, this.fs); gl.linkProgram(p);
  if (Prog.collect) Prog.collect.push(this);
}
Prog.collect = null;
Prog.prototype.done = function () {
  if (this.ok) return true;
  return GLX.par ? !!gl.getProgramParameter(this.p, GLX.par.COMPLETION_STATUS_KHR) : true;
};
Prog.prototype.check = function () {
  if (this.ok) return;
  if (!gl.getProgramParameter(this.p, gl.LINK_STATUS)) {
    var msg;
    if (!gl.getShaderParameter(this.vs, gl.COMPILE_STATUS)) msg = shaderLog(this.vs, this.vsSrc, this.name + '.vs');
    else if (!gl.getShaderParameter(this.fs, gl.COMPILE_STATUS)) msg = shaderLog(this.fs, this.fsSrc, this.name + '.fs');
    else msg = 'program "' + this.name + '" link failed: ' + gl.getProgramInfoLog(this.p);
    throw new Error(msg);
  }
  gl.deleteShader(this.vs); gl.deleteShader(this.fs); this.vs = this.fs = null; this.fsSrc = this.vsSrc = null;
  this.ok = true;
};
Prog.prototype.use = function () { gl.useProgram(this.p); return this; };
Prog.prototype.loc = function (n) { var l = this.u[n]; if (l === undefined) { l = this.u[n] = gl.getUniformLocation(this.p, n); } return l; };
Prog.prototype.f = function (n, x) { gl.uniform1f(this.loc(n), x); return this; };
Prog.prototype.i = function (n, x) { gl.uniform1i(this.loc(n), x); return this; };
Prog.prototype.v2 = function (n, x, y) { gl.uniform2f(this.loc(n), x, y); return this; };
Prog.prototype.v3 = function (n, x, y, z) { gl.uniform3f(this.loc(n), x, y, z); return this; };
Prog.prototype.v4 = function (n, x, y, z, w) { gl.uniform4f(this.loc(n), x, y, z, w); return this; };
Prog.prototype.fv = function (n, a) { gl.uniform1fv(this.loc(n), a); return this; };
Prog.prototype.v2v = function (n, a) { gl.uniform2fv(this.loc(n), a); return this; };
Prog.prototype.v3v = function (n, a) { gl.uniform3fv(this.loc(n), a); return this; };
Prog.prototype.v4v = function (n, a) { gl.uniform4fv(this.loc(n), a); return this; };
Prog.prototype.m3 = function (n, a) { gl.uniformMatrix3fv(this.loc(n), false, a); return this; };
Prog.prototype.tex = function (n, t, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(this.loc(n), unit); return this; };
function drawFS() { gl.bindVertexArray(GLX.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

// render targets --------------------------------------------------------------
function texFormat(fmt) {
  if (!GLX.hdr) return [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
  if (fmt === 'rgba16f') return [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
  if (fmt === 'rg16f') return [gl.RG16F, gl.RG, gl.HALF_FLOAT];
  if (fmt === 'r16f') return [gl.R16F, gl.RED, gl.HALF_FLOAT];
  return [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
}
function Target(w, h, fmt, filter, wrap) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  var f = texFormat(fmt || 'rgba16f');
  this.w = w; this.h = h;
  this.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, f[0], w, h, 0, f[1], f[2], null);
  this.fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
  gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
}
Target.prototype.bind = function () { gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, this.w, this.h); };
Target.prototype.free = function () { gl.deleteTexture(this.tex); gl.deleteFramebuffer(this.fbo); };
function DoubleTarget(w, h, fmt, filter, wrap) {
  this.a = new Target(w, h, fmt, filter, wrap); this.b = new Target(w, h, fmt, filter, wrap); this.w = this.a.w; this.h = this.a.h;
}
DoubleTarget.prototype.swap = function () { var t = this.a; this.a = this.b; this.b = t; };
DoubleTarget.prototype.free = function () { this.a.free(); this.b.free(); };
function bindScreen() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }

// ---- point sprites for ray-traced scenes --------------------------------------
// World-space particles drawn additively on top of a traced image whose alpha holds the hit distance,
// so they are hidden correctly behind whatever the rays hit.
function PointCloud(n) {
  this.n = n; this.p = new Float32Array(n * 4); this.c = new Float32Array(n * 4); this.v = new Float32Array(n * 3); this.l = new Float32Array(n); this.head = 0; this.live = 0;
  var vs = '#version 300 es\nlayout(location=0) in vec4 aP;layout(location=1) in vec4 aC;uniform vec3 uCam,uU,uV,uW;uniform float uFov,uAsp,uResY,uFocus,uK,uMaxR;out vec4 vC;out float vDist;out float vSoft;\n' +
    'void main(){vec3 d=aP.xyz-uCam;float z=dot(d,uW);vDist=length(d);float life=aP.w;\n' +
    'if(z<0.15||life<=0.0){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=1.0;vC=vec4(0.0);vSoft=1.0;return;}\n' +
    'vec2 ndc=vec2(dot(d,uU),dot(d,uV))*uFov/z;ndc.x/=uAsp;gl_Position=vec4(ndc,0.0,1.0);\n' +
    'float px=max(aC.a*uFov*uResY*0.5/z,1.5);float coc=min(uK*abs(1.0-uFocus/z),uMaxR);float px2=px+2.0*coc;gl_PointSize=min(px2,64.0);\n' +
    'vSoft=mix(1.0,px/px2,smoothstep(4.0,9.0,px2));vC=vec4(aC.rgb*min(life*3.0,1.0)*min(1.0,aC.a*uFov*uResY*0.5/z/1.5)*pow(px/px2,1.25),1.0);}';
  // in focus: a small soft spark; out of focus: a flat disc with a slightly brighter rim, as a lens draws it
  this.prog = new Prog('points', 'in vec4 vC;in float vDist;in float vSoft;uniform sampler2D uScene;uniform vec2 uRes;\n' +
    'void main(){float r=length(gl_PointCoord-0.5)*2.0;float a=smoothstep(1.0,0.0,r);float disc=smoothstep(1.0,0.86,r)*(0.75+0.35*r*r);\n' +
    'if(vDist>texture(uScene,gl_FragCoord.xy/uRes).a+0.05)discard;o=vec4(vC.rgb*mix(disc,a*a*1.6,smoothstep(0.35,0.9,vSoft)),1.0);}', vs, true);
  this.vao = gl.createVertexArray(); this.bp = gl.createBuffer(); this.bc = gl.createBuffer();
  gl.bindVertexArray(this.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bp); gl.bufferData(gl.ARRAY_BUFFER, this.p, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bc); gl.bufferData(gl.ARRAY_BUFFER, this.c, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}
PointCloud.prototype.emit = function (x, y, z, vx, vy, vz, r, g, b, size, life) {
  var k = this.head; this.head = (k + 1) % this.n;
  this.p[k * 4] = x; this.p[k * 4 + 1] = y; this.p[k * 4 + 2] = z; this.p[k * 4 + 3] = life;
  this.v[k * 3] = vx; this.v[k * 3 + 1] = vy; this.v[k * 3 + 2] = vz;
  this.c[k * 4] = r; this.c[k * 4 + 1] = g; this.c[k * 4 + 2] = b; this.c[k * 4 + 3] = size; this.dirty = true;
};
PointCloud.prototype.step = function (dt, grav, drag, floorY) {
  var p = this.p, v = this.v, n = this.n, i, live = 0, dk = Math.exp(-drag * dt);
  for (i = 0; i < n; i++) {
    if (p[i * 4 + 3] <= 0) continue;
    live++;
    v[i * 3 + 1] += grav * dt; v[i * 3] *= dk; v[i * 3 + 1] *= dk; v[i * 3 + 2] *= dk;
    p[i * 4] += v[i * 3] * dt; p[i * 4 + 1] += v[i * 3 + 1] * dt; p[i * 4 + 2] += v[i * 3 + 2] * dt;
    if (p[i * 4 + 1] < floorY && v[i * 3 + 1] < 0) { p[i * 4 + 1] = floorY; v[i * 3 + 1] *= -0.45; }
    p[i * 4 + 3] -= dt;
  }
  this.live = live;
};
PointCloud.prototype.draw = function (cam, U, V, W, fov, scene) {
  if (!this.live) return;
  gl.bindVertexArray(this.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bp); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.p);
  if (this.dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, this.bc); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.c); this.dirty = false; }
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  this.prog.use().tex('uScene', scene.tex, 0).v2('uRes', scene.w, scene.h)
    .v3('uCam', cam[0], cam[1], cam[2]).v3('uU', U[0], U[1], U[2]).v3('uV', V[0], V[1], V[2]).v3('uW', W[0], W[1], W[2])
    .f('uFov', fov).f('uAsp', scene.w / scene.h).f('uResY', scene.h)
    .f('uFocus', Post.dofFocus || 10).f('uK', Post.dofK || 0).f('uMaxR', Post.dofMax || 0);
  gl.drawArrays(gl.POINTS, 0, this.n);
  gl.disable(gl.BLEND); gl.bindVertexArray(null);
};

// post ------------------------------------------------------------------------
var Post = {
  hdr: null, ldr: null, mips: [], ready: false,
  P: { bloom: 1.0, grain: 0.5, lens: 0.6, exposure: 1.0, fxaa: 1, flashK: 1.0 },
  init: function () {
    this.pDown = new Prog('bloomDown', `
      uniform sampler2D uTex;uniform vec2 uPx;uniform float uFirst;uniform float uThresh;
      vec3 pre(vec3 c){ // soft-knee threshold + clamp fireflies
        c=min(c,vec3(40.0));float br=max(c.r,max(c.g,c.b));float kn=uThresh*0.6;
        float s=clamp(br-uThresh+kn,0.0,2.0*kn);s=s*s/(4.0*kn+1e-4);return c*max(s,br-uThresh)/max(br,1e-4);}
      vec3 S(vec2 d){vec3 c=texture(uTex,vUv+d*uPx).rgb;return uFirst>0.5?pre(c):c;}
      void main(){
        vec3 a=S(vec2(-2,2)),b=S(vec2(0,2)),c=S(vec2(2,2)),d=S(vec2(-2,0)),e=S(vec2(0,0)),f=S(vec2(2,0));
        vec3 g=S(vec2(-2,-2)),h=S(vec2(0,-2)),i=S(vec2(2,-2)),j=S(vec2(-1,1)),k=S(vec2(1,1)),l=S(vec2(-1,-1)),m=S(vec2(1,-1));
        vec3 col=e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125;
        o=vec4(col,1.0);}`);
    this.pUp = new Prog('bloomUp', `
      uniform sampler2D uTex;uniform vec2 uPx;uniform float uRad,uGain;
      void main(){vec2 d=uPx*uRad;
        vec3 c=texture(uTex,vUv).rgb*4.0;
        c+=(texture(uTex,vUv+vec2(d.x,0)).rgb+texture(uTex,vUv-vec2(d.x,0)).rgb+texture(uTex,vUv+vec2(0,d.y)).rgb+texture(uTex,vUv-vec2(0,d.y)).rgb)*2.0;
        c+=texture(uTex,vUv+d).rgb+texture(uTex,vUv-d).rgb+texture(uTex,vUv+vec2(d.x,-d.y)).rgb+texture(uTex,vUv+vec2(-d.x,d.y)).rgb;
        o=vec4(c/16.0*uGain,1.0);}`);
    this.pComp = new Prog('composite', `
      uniform sampler2D uHdr,uBloom;uniform vec2 uRes;uniform float uBloomK,uLens,uExposure,uKick,uFlash,uFade;
      vec3 filmic(vec3 c){ // hue-preserving curve that lets very bright neon burn to a white core
        c=max(c,0.0);float pk=max(c.r,max(c.g,c.b));if(pk<1e-5){return vec3(0.0);}
        vec3 ratio=c/pk;float tp=1.0-exp(-pk*1.05);tp=pow(tp,1.06);
        float w=smoothstep(0.55,1.0,tp);ratio=mix(ratio,vec3(1.0),w*w*0.85);
        vec3 r=ratio*tp;float l=luma(r);return mix(vec3(l),r,1.06);}
      void main(){
        vec2 cc=vUv-0.5;float asp=uRes.x/uRes.y;float r2=dot(cc*vec2(asp,1.0),cc*vec2(asp,1.0));
        vec2 uv=0.5+cc*(1.0-0.035*uLens*r2);
        vec2 off=cc*(0.0013+0.0042*uKick)*uLens*(0.25+r2*2.2);
        vec3 col;
        col.r=texture(uHdr,uv+off).r;col.g=texture(uHdr,uv).g;col.b=texture(uHdr,uv-off).b;
        vec3 bl;bl.r=texture(uBloom,uv+off*0.7).r;bl.g=texture(uBloom,uv).g;bl.b=texture(uBloom,uv-off*0.7).b;
        col+=bl*uBloomK;
        col*=uExposure*(1.0+uFlash*0.55);
        col*=1.0-smoothstep(0.25,1.25,r2)*0.62*min(uLens+0.25,1.0);
        col=filmic(col)*uFade;
        o=vec4(pow(col,vec3(1.0/2.2)),1.0);}`);
    this.pFinal = new Prog('final', `
      uniform sampler2D uTex;uniform vec2 uPx;uniform float uGrain,uTime,uFxaa;
      float L(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}
      void main(){
        vec3 m=texture(uTex,vUv).rgb;
        if(uFxaa>0.5){
          float lm=L(m),ln=L(texture(uTex,vUv+vec2(0,uPx.y)).rgb),ls=L(texture(uTex,vUv-vec2(0,uPx.y)).rgb);
          float le=L(texture(uTex,vUv+vec2(uPx.x,0)).rgb),lw=L(texture(uTex,vUv-vec2(uPx.x,0)).rgb);
          float mx=max(lm,max(max(ln,ls),max(le,lw))),mn=min(lm,min(min(ln,ls),min(le,lw)));
          float rng=mx-mn;
          if(rng>max(0.035,mx*0.11)){
            float lnw=L(texture(uTex,vUv+vec2(-uPx.x,uPx.y)).rgb),lne=L(texture(uTex,vUv+uPx).rgb);
            float lsw=L(texture(uTex,vUv-uPx).rgb),lse=L(texture(uTex,vUv+vec2(uPx.x,-uPx.y)).rgb);
            vec2 dir=vec2(-((lnw+lne)-(lsw+lse)),((lnw+lsw)-(lne+lse)));
            float red=max((lnw+lne+lsw+lse)*0.03125,0.0078125);
            float rmin=1.0/(min(abs(dir.x),abs(dir.y))+red);
            dir=clamp(dir*rmin,vec2(-6.0),vec2(6.0))*uPx;
            vec3 a=0.5*(texture(uTex,vUv+dir*(1.0/3.0-0.5)).rgb+texture(uTex,vUv+dir*(2.0/3.0-0.5)).rgb);
            vec3 b=a*0.5+0.25*(texture(uTex,vUv-dir*0.5).rgb+texture(uTex,vUv+dir*0.5).rgb);
            float lb=L(b);m=(lb<mn||lb>mx)?a:b;}
        }
        vec2 gp=vUv/uPx+vec2(fract(uTime*7.13)*311.0,fract(uTime*3.71)*173.0);
        float n=hash21(gp)+hash21(gp+19.19)-1.0; // triangular noise
        float lm2=L(m);
        m+=n*uGrain*0.045*(1.0-0.55*lm2);
        m+=n*(1.0/255.0);
        o=vec4(max(m,0.0),1.0);}`);
    // Depth of field for the ray-traced scenes (their alpha channel holds the hit distance). One gather pass:
    // a spiral of taps, each accepted if its own circle of confusion reaches this pixel.
    this.pDof = new Prog('dof', `
      uniform sampler2D uSrc;uniform vec2 uPx;uniform float uFocus,uK,uMaxR;
      float coc(float d){return min(uK*abs(1.0-uFocus/max(d,0.01)),uMaxR)*(d>9500.0?0.3:1.0);}   // (the sky: stars stay points)
      void main(){
        vec4 c0=texture(uSrc,vUv);float d0=c0.a,r0=coc(d0);
        vec3 acc=min(c0.rgb,vec3(24.0));float n=1.0,rad=0.9;
        for(float a=0.0;rad<uMaxR;a+=2.39996323){
          vec4 s=texture(uSrc,vUv+vec2(cos(a),sin(a))*uPx*rad);
          float rs=coc(s.a);
          if(s.a>d0)rs=min(rs,r0*2.0);
          float m=smoothstep(rad-0.5,rad+0.5,rs);
          acc+=mix(acc/n,min(s.rgb,vec3(24.0)),m);n+=1.0;
          rad+=1.5/rad;
        }
        o=vec4(acc/n,d0);}`);
    this.progs = [this.pDown, this.pUp, this.pComp, this.pFinal, this.pDof];
    for (var i = 0; i < this.progs.length; i++) this.progs[i].check();
    this.ready = true;
  },
  resize: function (w, h) {
    if (this.hdr) { this.hdr.free(); this.ldr.free(); for (var i = 0; i < this.mips.length; i++) this.mips[i].free(); }
    this.hdr = new Target(w, h, 'rgba16f', gl.LINEAR);
    this.ldr = new Target(w, h, 'rgba8', gl.LINEAR);
    this.mips = [];
    var mw = w, mh = h;
    for (var k = 0; k < 7; k++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      this.mips.push(new Target(mw, mh, 'rgba16f', gl.LINEAR));
      if (mw <= 8 || mh <= 8) break;
    }
  },
  begin: function () { this.hdr.bind(); },
  // src: traced image with distance in alpha · focus in metres · k: blur radius (pixels at 1080p) of things at infinity
  dof: function (src, dst, focus, k) {
    var sc = src.h / 1080, K = k * UIP.dof * sc;
    dst.bind();
    this.pDof.use().tex('uSrc', src.tex, 0).v2('uPx', 1 / src.w, 1 / src.h).f('uFocus', focus).f('uK', K).f('uMaxR', Math.min(K, 16 * sc));
    drawFS();
    this.dofK = K; this.dofMax = Math.min(K, 16 * sc); this.dofFocus = focus;
  },
  end: function (time, fade) {
    var P = this.P, mips = this.mips, i;
    // bloom: progressive downsample then tent-upsample back up, each level added to the next
    var src = this.hdr;
    this.pDown.use();
    for (i = 0; i < mips.length; i++) {
      mips[i].bind();
      this.pDown.tex('uTex', src.tex, 0).v2('uPx', 1 / src.w, 1 / src.h).f('uFirst', i === 0 ? 1 : 0).f('uThresh', 0.85);
      drawFS(); src = mips[i];
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    this.pUp.use();
    for (i = mips.length - 1; i > 0; i--) {
      mips[i - 1].bind();
      this.pUp.tex('uTex', mips[i].tex, 0).v2('uPx', 1 / mips[i].w, 1 / mips[i].h).f('uRad', 1.0).f('uGain', 0.68);
      drawFS();
    }
    gl.disable(gl.BLEND);
    this.ldr.bind();
    this.pComp.use().tex('uHdr', this.hdr.tex, 0).tex('uBloom', mips[0].tex, 1)
      .v2('uRes', this.hdr.w, this.hdr.h).f('uBloomK', P.bloom * 0.20).f('uLens', P.lens)
      .f('uExposure', P.exposure).f('uKick', Sig.kick * UIP.punch).f('uFlash', Sig.flash * UIP.punch * P.flashK).f('uFade', fade == null ? 1 : fade);
    drawFS();
    bindScreen();
    this.pFinal.use().tex('uTex', this.ldr.tex, 0).v2('uPx', 1 / this.ldr.w, 1 / this.ldr.h)
      .f('uGrain', P.grain).f('uTime', time).f('uFxaa', P.fxaa);
    drawFS();
  }
};
