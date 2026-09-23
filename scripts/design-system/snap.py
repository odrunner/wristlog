#!/usr/bin/env python3
"""Snap off-scale values to the nearest design-system token, inside ONE screen's
scope, and only when the move is tiny. Prints every move for review.

usage: snap.py <scope> [--apply]      scope = a key of SCOPES
"""
import re, sys, collections
sys.path.insert(0, __file__.rsplit('/', 1)[0])

import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..") + "/"
APPLY = '--apply' in sys.argv

FS = [('--fs-2xs', 9.92), ('--fs-xs', 10.88), ('--fs-sm', 12), ('--fs-base', 13.12), ('--fs-md', 14.08),
      ('--fs-body', 15), ('--fs-xl', 17.6), ('--fs-2xl', 20.8), ('--fs-3xl', 25.6), ('--fs-4xl', 40)]
SP = [('--space-0-5', 2), ('--space-1', 4), ('--space-1-5', 6), ('--space-2', 8), ('--space-2-5', 10), ('--space-3', 12),
      ('--space-3-5', 14), ('--space-4', 16), ('--space-5', 20), ('--space-6', 24), ('--space-8', 32)]
RAD = [('--radius-sm', 6), ('--radius-btn', 8), ('--radius', 10)]
LH = [('--lh-tight', 1.2), ('--lh-snug', 1.4), ('--lh-body', 1.55)]
LS = [('--ls-eyebrow', .08)]

def px(v):
    m = re.fullmatch(r'(-?)0?(\.\d+|\d+(?:\.\d+)?)(rem|px)', v)
    if not m: return None
    x = float(m.group(2)) * (16 if m.group(3) == 'rem' else 1)
    return -x if m.group(1) else x

def nearest(x, table, up_on_tie=True):
    best = min(table, key=lambda t: (abs(t[1] - x), -t[1] if up_on_tie else t[1]))
    return best, best[1] - x

moves = collections.Counter(); left = collections.Counter()

def snap_len(v, table, tol, lo, prop, up_on_tie=True):
    x = px(v)
    if x is None or x < lo:
        if x is not None and x != 0: left['%s: %s' % (prop, v)] += 1
        return None
    (tok, tv), d = nearest(round(x, 4), table, up_on_tie)
    t = tol(x)
    if abs(d) > t + 1e-9:
        left['%s: %s (%.2fpx, nearest %s is %+.2f)' % (prop, v, x, tok, d)] += 1
        return None
    moves['%s: %s -> %s (%+.2fpx)' % (prop, v, tok, d)] += 1
    return 'var(%s)' % tok

def fs(v):
    # 16px / 1rem is left alone: iOS zooms the page on focus of any input under 16px.
    x = px(v)
    if x is not None and abs(x - 16) < 1e-9:
        left['font-size: %s (kept — 16px is the iOS no-zoom floor for inputs)' % v] += 1; return None
    return snap_len(v, FS, lambda x: .6 if x < 16 else 1.0, 9.3, 'font-size', up_on_tie=False)

def space(prop):
    def f(v):
        parts = v.split(); out = []; hit = False
        for p in parts:
            if p.startswith('var(') or p == '0' or p.startswith('-'): out.append(p); continue
            r = snap_len(p, SP, lambda x: 1.0 if x <= 16 else 2.0, 2, prop)
            out.append(r or p); hit = hit or bool(r)
        return ' '.join(out) if hit else None
    return f

def radius(v):
    parts = v.split(); out = []; hit = False
    for p in parts:
        if p.startswith('var(') or p in ('0', '50%'): out.append(p); continue
        r = snap_len(p, RAD, lambda x: 1.0, 4, 'border-radius')
        out.append(r or p); hit = hit or bool(r)
    return ' '.join(out) if hit else None

def unitless(table, tol, prop, unit=''):
    def f(v):
        m = re.fullmatch(r'0?(\.\d+|\d+(?:\.\d+)?)' + unit, v)
        if not m: return None
        x = float(m.group(1)); (tok, tv), d = nearest(x, table)
        if abs(d) > tol + 1e-9:
            left['%s: %s' % (prop, v)] += 1; return None
        moves['%s: %s -> %s (%+.2f)' % (prop, v, tok, d)] += 1
        return 'var(%s)' % tok
    return f

TERM = r'(?=\s*(?:!important)?\s*(?:[;"\'}<`]|$))'
def rx(names): return re.compile(r'(?<![-\w])(' + names + r')(\s*:\s*)([^;"\'}<`$]+?)' + TERM)
RULES = [(rx('font-size'), fs), (rx('padding(?:-(?:top|right|bottom|left))?'), space('padding')),
         (rx('margin(?:-(?:top|right|bottom|left))?'), space('margin')), (rx('gap'), space('gap')),
         (rx('border-radius'), radius), (rx('line-height'), unitless(LH, .05, 'line-height')),
         (rx('letter-spacing'), unitless(LS, .011, 'letter-spacing', 'em'))]

CANVAS = re.compile(r'fillStyle|strokeStyle|addColorStop|shadowColor|ctx\.|\.font\s*=|getContext')

def process(line):
    if CANVAS.search(line): return line
    for r, fn in RULES:
        def rep(m, fn=fn):
            v = m.group(3).strip()
            if '${' in v: return m.group(0)
            out = fn(v)
            return m.group(0) if out is None else m.group(1) + m.group(2) + out
        line = r.sub(rep, line)
    return line

from scope import SCOPES
# snap.py --file p/index.html [--apply]   whole file is the scope (the small pages have no screens)
FILE = sys.argv[sys.argv.index('--file') + 1] if '--file' in sys.argv else 'index.html'
scope = 'file:' + FILE if FILE != 'index.html' else sys.argv[1]
lines = open(ROOT + FILE, encoding='utf-8').read().split('\n')
idx = set(range(len(lines))) if FILE != 'index.html' else SCOPES[scope](lines)
changed = 0
for i in sorted(idx):
    n = process(lines[i])
    if n != lines[i]: changed += 1; lines[i] = n
print('scope %s: %d lines in scope, %d changed, %d values moved' % (scope, len(idx), changed, sum(moves.values())))
print('\nMOVED'); [print('%4d  %s' % (n, k)) for k, n in sorted(moves.items(), key=lambda kv: (kv[0].split(':')[0], -kv[1]))]
print('\nLEFT ALONE (too far from any step, or deliberate)'); [print('%4d  %s' % (n, k)) for k, n in sorted(left.items())]
if APPLY:
    open(ROOT + FILE, 'w', encoding='utf-8').write('\n'.join(lines)); print('\napplied')
