#!/usr/bin/env python3
"""Lossless spacing swap: a padding / margin / gap value that EXACTLY equals a --space-* step becomes var(--space-N).
Every file on the system, one pass. Nothing moves: 3rem and 48px both become var(--space-12), which is 3rem.
Never: email HTML, the landing screen, promo cards, the fun-fact clamp, canvas, `${…}` values.
  swap_spacing.py [--apply]
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
sys.path.insert(0, HERE); import scope
APPLY = '--apply' in sys.argv
FILES = ['index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'privacy.html', 'terms.html', 'open.html', 'model-page.js', 'design-system.css']

ds = open(ROOT + 'design-system.css', encoding='utf-8').read()
STEPS = {}                                    # px -> token, read from the stylesheet so the two can never disagree
for name, val, unit in re.findall(r'(--space-[\w-]+)\s*:\s*([\d.]+)(rem|px)\s*;', ds):
    STEPS[round(float(val) * (16 if unit == 'rem' else 1), 3)] = name
TOL = float(sys.argv[sys.argv.index('--tol') + 1]) if '--tol' in sys.argv else 0.0     # 0 = exact only
def step(x):
    x = round(abs(x), 3)
    if x in STEPS: return STEPS[x]
    best = min(STEPS, key=lambda s: (abs(s - x), -s))
    return STEPS[best] if abs(best - x) <= TOL + 1e-9 else None
RX = re.compile(r'(?<![-\w])((?:padding|margin)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)(\s*:\s*)([^;"\'}<`]+)')
def px(v):
    m = re.fullmatch(r'(-?)(\d*\.?\d+)(px|rem)', v)
    return None if not m else (-1 if m.group(1) else 1) * float(m.group(2)) * (16 if m.group(3) == 'rem' else 1)

def fences(f, lines):
    if f != 'index.html': return set()
    out = scope.email_lines(lines)
    la = next(i for i, l in enumerate(lines) if 'id="auth-screen"' in l); lb = next(i for i in range(la + 1, len(lines)) if '<!-- ════' in lines[i])
    out |= set(range(la, lb))
    out |= scope._css(lines, re.compile(r'#auth-screen|[.#]landing|[.#]auth-|\.btn-google|\.btn-apple|[.#]promo|\.funfact'))
    return out

moves = collections.Counter(); left = collections.Counter(); total = 0
for f in FILES:
    lines = open(ROOT + f, encoding='utf-8').read().split('\n'); fence = fences(f, lines); changed = 0
    for i, l in enumerate(lines):
        if i in fence or re.search(r'fillStyle|strokeStyle|getContext', l): continue
        def rep(m):
            v = m.group(3)                                     # rebuilt part by part, whitespace kept exactly as written
            if '${' in v or v.lstrip().startswith('--'): return m.group(0)
            out = []
            for p in re.split(r'(\s+)', v):
                x = px(p) if p.strip() else None
                if x is not None and x != 0 and step(x):
                    t = 'var(%s)' % step(x)
                    out.append(t if x > 0 else 'calc(-1 * %s)' % t); moves['%s %s -> %s' % (m.group(1).split('-')[0], p, step(x))] += 1
                else:
                    if x is not None and x != 0: left['%s %s' % (m.group(1).split('-')[0], p)] += 1
                    out.append(p)
            return m.group(1) + m.group(2) + ''.join(out)
        n = RX.sub(rep, l)
        if n != l: lines[i] = n; changed += 1
    total += changed
    if APPLY and changed: open(ROOT + f, 'w', encoding='utf-8').write('\n'.join(lines))
    if changed: print('%-20s %3d lines' % (f, changed))
print('\nMOVED (%d)' % sum(moves.values())); [print('%4d  %s' % (n, k)) for k, n in sorted(moves.items(), key=lambda x: -x[1])]
print('\nLEFT (not an exact step)'); [print('%4d  %s' % (n, k)) for k, n in sorted(left.items(), key=lambda x: -x[1])]
if APPLY: print('\napplied')
