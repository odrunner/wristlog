#!/usr/bin/env python3
"""Copy every VERBATIM mirrored function from index.html into wrotate_test.js (the app is the source of truth).
A design-system pass that rewrites markup inside a mirrored function drifts the copy; tests/mirror-drift.test.js
then fails. Run this after such a pass.   sync_mirrors.py [--apply]
"""
import re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv
app = open(ROOT + 'index.html', encoding='utf-8').read()
mir = open(ROOT + 'wrotate_test.js', encoding='utf-8').read()
# Only the names the guard itself reports as drifted: matching by name alone can pick the wrong definition.
import subprocess
run = subprocess.run(['npx', 'vitest', 'run', 'tests/mirror-drift.test.js'], cwd=ROOT, capture_output=True, text=True)
m = re.search(r'source of truth\): ([\w, ]+)', run.stdout + run.stderr)
names = [x.strip() for x in m.group(1).split(',')] if m else []
def span(src, name, export=False):
    m = re.search(r'%sfunction\s+%s\b' % ('export\\s+' if export else '(?<!export )', re.escape(name)), src)
    if not m: return None
    i = m.start(); k = src.index('(', i); d = 0
    while True:                                                                # end of the parameter list
        if src[k] == '(': d += 1
        elif src[k] == ')':
            d -= 1
            if d == 0: break
        k += 1
    j = src.index('{', k); d = 0
    while True:
        if src[j] == '{': d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0: break
        j += 1
    return i, j + 1, src[i:j + 1]
synced = []
for n in names:
    a = span(app, n); b = span(mir, n, True)
    if not a or not b: continue
    if b[2][len('export '):] == a[2]: continue
    if abs(len(a[2]) - len(b[2])) > len(b[2]) * 0.5:                           # a suspiciously different body: wrong match
        print('SKIPPED %s: bodies differ by more than half, check by hand' % n); continue
    mir = mir[:b[0]] + 'export ' + a[2] + mir[b[1]:]; synced.append(n)
print('drifted mirrors:', synced or 'none')
if APPLY and synced:
    open(ROOT + 'wrotate_test.js', 'w', encoding='utf-8').write(mir); print('synced')
