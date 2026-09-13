#!/usr/bin/env python3
"""Stamp every module import with the game version, so browsers never mix a
cached old file with a fresh new one.

GitHub Pages lets browsers cache files for a while. ES module imports are
fetched and cached one file at a time, so after an update a player could run
the new main.js against yesterday's schoolgen.js -- a different school than
their friend's, doors that do not line up, keys that seem not to work.

Run before every release:
    python tools/stamp.py

It reads GAME_VERSION from js/main.js and rewrites
    from './x.js'   ->  from './x.js?v=<version>'
in every js file, plus the main.js <script> tag in index.html.
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    main_js = io.open(os.path.join(ROOT, 'js', 'main.js'), encoding='utf-8').read()
    m = re.search(r"GAME_VERSION = '([^']+)'", main_js)
    if not m:
        sys.exit('GAME_VERSION not found in js/main.js')
    ver = m.group(1)
    imp = re.compile(r"""((?:from|import)\s*\(?\s*['"])(\.{1,2}/[^'"?]+\.js)(?:\?v=[^'"]*)?(['"])""")
    changed = 0
    for dirpath, _, files in os.walk(os.path.join(ROOT, 'js')):
        for f in files:
            if not f.endswith('.js'):
                continue
            p = os.path.join(dirpath, f)
            s = io.open(p, encoding='utf-8').read()
            t = imp.sub(lambda mm: f"{mm.group(1)}{mm.group(2)}?v={ver}{mm.group(3)}", s)
            if t != s:
                io.open(p, 'w', encoding='utf-8', newline='').write(t)
                changed += 1
    p = os.path.join(ROOT, 'index.html')
    s = io.open(p, encoding='utf-8').read()
    t = re.sub(r'src="js/main\.js(?:\?v=[^"]*)?"', f'src="js/main.js?v={ver}"', s)
    t = re.sub(r'href="css/style\.css(?:\?v=[^"]*)?"', f'href="css/style.css?v={ver}"', t)
    if t != s:
        io.open(p, 'w', encoding='utf-8', newline='').write(t)
        changed += 1
    print(f'stamped {changed} files with v={ver}')


if __name__ == '__main__':
    main()
