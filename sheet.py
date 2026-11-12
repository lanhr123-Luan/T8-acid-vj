#!/usr/bin/env python3
"""Contact sheet: render a scene at several moments and tile the frames into one picture.
usage: sheet.py <scene> <out.png> <w> <h> <cols> <t1,t2,...> [pre-JS] [extra query]"""
import subprocess, sys, os
from PIL import Image
scene, out, w, h, cols, times = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
pre = sys.argv[7] if len(sys.argv) > 7 else ''
extra = sys.argv[8] if len(sys.argv) > 8 else ''
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = os.path.join(root, 'shots', '_sheet'); os.makedirs(tmp, exist_ok=True)
env = dict(os.environ)
if os.path.isdir('/opt/npm-tools/node_modules'): env.setdefault('NODE_PATH', '/opt/npm-tools/node_modules')
if os.environ.get('SEEK', '1') == '1': env['SEEK'] = '1'
r = subprocess.run(['node', os.path.join(root, 'tools', 'shot.js'), scene, os.path.join(tmp, 'f'), str(w), str(h), times, extra, pre], env=env, capture_output=True, text=True, timeout=3000)
print('\n'.join(l for l in (r.stdout + r.stderr).splitlines() if 'rendered' in l or 'rror' in l or 'FAIL' in l)[:3000])
ts = times.split(',')
ims = [Image.open(os.path.join(tmp, 'f_%s.png' % ('%g' % float(t)).replace('.', 'p'))) for t in ts]
rows = (len(ims) + cols - 1) // cols
W = Image.new('RGB', (cols * w, rows * h))
for i, im in enumerate(ims): W.paste(im, ((i % cols) * w, (i // cols) * h))
W.save(out); print('sheet', out, W.size)
