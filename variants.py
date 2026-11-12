#!/usr/bin/env python3
"""Cost breakdown of the moon shader: build variants with one part switched off and time each."""
import subprocess, sys, os, json, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(ROOT + '/dist/standalone.html', encoding='utf-8').read()
V = {
 'full': [],
 'no terrain shadows': [("  float sh=shadowT(ps+vec3(0.0,0.006+0.25*s,0.0),s);", "  float sh=1.0;")],
 'no astronaut': [("vec2 marchA(vec3 ro,vec3 rd){\n", "vec2 marchA(vec3 ro,vec3 rd){\n  return vec2(-1.0,0.0);\n"), ("float shadowA(vec3 p){\n", "float shadowA(vec3 p){\n  return 1.0;\n")],
 'no far field': [("float marchFar(vec3 ro,vec3 rd){\n", "float marchFar(vec3 ro,vec3 rd){\n  return -1.0;\n")],
 'ground unshaded': [("vec3 shadeG(vec3 p,vec3 rd,float t,float sM){\n", "vec3 shadeG(vec3 p,vec3 rd,float t,float sM){\n  return vec3(0.3);\n")],
 'no depth of field': [("    Post.dof(m, tgt, Math.hypot(fx, fy, fz), this.SHOTS[this.shotI].dof || 0);", "    Post.dof(m, tgt, Math.hypot(fx, fy, fz), 0);")],
 'no earth/sky': [("vec3 earthCol(vec3 rd,out float alpha){\n  alpha=0.0;", "vec3 earthCol(vec3 rd,out float alpha){\n  alpha=0.0;return vec3(0.0);")],
}
res = {}
for name, reps in V.items():
    h = html
    for a, b in reps:
        assert h.count(a) == 1, (name, a[:40], h.count(a))
        h = h.replace(a, b)
    open(ROOT + '/dist/_var.html', 'w', encoding='utf-8').write(h)
    js = open(ROOT + '/tools/bench.js').read().replace("/dist/standalone.html", "/dist/_var.html")
    open(ROOT + '/tools/_bench_var.js', 'w').write(js)
    out = subprocess.run(['node', ROOT + '/tools/_bench_var.js', 'moon'], capture_output=True, text=True, env=dict(os.environ), timeout=600).stdout
    m = re.search(r'"moon":(\d+)', out)
    res[name] = int(m.group(1)) if m else None
    print('%-34s %s ms' % (name, res[name]), flush=True)
os.remove(ROOT + '/dist/_var.html'); os.remove(ROOT + '/tools/_bench_var.js')
