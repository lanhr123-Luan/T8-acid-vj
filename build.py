#!/usr/bin/env python3
"""Assemble src/ into the two shipped files:
     dist/standalone.html  (copied to ./index.html)       — the whole thing in one page, no hardware needed
     dist/acid_t8_multi.py (copied to ./acid_t8_multi.py) — the T-8 follower with the same page embedded (compressed)
"""
import os, glob, zlib, base64, textwrap, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANNER = "T-8 Acid VJ — https://github.com/ (MIT licence). Built from src/ by tools/build.py; edit the sources, not this file."


def build_html():
    html = open(os.path.join(ROOT, 'src', 'index.html'), encoding='utf-8').read()
    parts = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'src', 'js', '*.js'))):
        parts.append('// ---- %s ----\n%s' % (os.path.basename(f), open(f, encoding='utf-8').read().rstrip('\n')))
    js = '\n'.join(parts)
    assert '</script' not in js.lower(), 'js must not contain a closing script tag'
    assert html.count('/*@JS@*/') == 1 and html.count('/*@MODE@*/') == 1
    # str.replace with a function-free literal: no backslash or group processing happens here
    return html.replace('/*@JS@*/', js)


def main():
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    html = build_html()
    out = os.path.join(ROOT, 'dist', 'standalone.html')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html.replace('/*@MODE@*/', "window.T8_MODE='standalone';"))
    # python follower with the page embedded
    srv = open(os.path.join(ROOT, 'src', 'server.py'), encoding='utf-8').read()
    blob = base64.b64encode(zlib.compress(html.encode('utf-8'), 9)).decode('ascii')
    lines = textwrap.wrap(blob, 116)
    block = 'PAGE_B64 = (\n' + '\n'.join('    "%s"' % l for l in lines) + '\n)'
    marker = 'PAGE_B64 = "@@PAGE_B64@@"'
    assert srv.count(marker) == 1
    srv = srv.replace(marker, '# 下面是打包好的网页 (zlib + base64)。要改网页请改 src/ 里的源码再运行 tools/build.py。\n' + block)
    out2 = os.path.join(ROOT, 'dist', 'acid_t8_multi.py')
    with open(out2, 'w', encoding='utf-8', newline='\n') as f:
        f.write(srv)
    # round-trip check of the embedded page
    m = re.search(r'PAGE_B64 = \(\n(.*?)\n\)', srv, re.S)
    packed = ''.join(re.findall(r'"([^"]*)"', m.group(1)))
    assert zlib.decompress(base64.b64decode(packed)).decode('utf-8') == html, 'embedded page does not round-trip'
    # the two files people actually run live at the top of the repository (index.html also serves GitHub Pages)
    import shutil
    shutil.copyfile(out, os.path.join(ROOT, 'index.html'))
    shutil.copyfile(out2, os.path.join(ROOT, 'acid_t8_multi.py'))
    print('built %s (%d KB) and %s (%d KB); copied to index.html and acid_t8_multi.py' % (os.path.relpath(out, ROOT), len(html) // 1024, os.path.relpath(out2, ROOT), len(srv) // 1024))


if __name__ == '__main__':
    main()
