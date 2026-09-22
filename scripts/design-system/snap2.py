#!/usr/bin/env python3
"""Decisions pass (user-approved 2026-09-20): headings to the nearest step (<=1.6px, ties down),
non-input 16px -> --fs-lg, tiny text -> --fs-3xs, tracking -> tight/eyebrow, line-height 1.3 -> snug."""
import re, sys, collections
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from scope import email_lines, LANDING
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..") + "/"; APPLY = '--apply' in sys.argv
CANVAS = re.compile(r'fillStyle|strokeStyle|addColorStop|shadowColor|ctx\.|\.font\s*=|getContext')
FS = [('--fs-3xs', 8.96), ('--fs-2xs', 9.92), ('--fs-xs', 10.88), ('--fs-sm', 12), ('--fs-base', 13.12), ('--fs-md', 14.08), ('--fs-lg', 15.2),
      ('--fs-xl', 17.6), ('--fs-2xl', 20.8), ('--fs-3xl', 25.6), ('--fs-4xl', 40)]
LS = {'.03em': '--ls-tight', '.05em': '--ls-tight', '.06em': '--ls-tight', '.1em': '--ls-eyebrow', '.09em': '--ls-eyebrow', '.07em': '--ls-eyebrow'}
LH = {'1.3': '--lh-snug', '1.35': '--lh-snug', '1.25': '--lh-tight', '1.1': '--lh-tight', '1.5': '--lh-body', '1.6': '--lh-body', '1.65': '--lh-body'}
moves = collections.Counter(); left = collections.Counter()
def px(v):
    m = re.fullmatch(r'0?(\.\d+|\d+(?:\.\d+)?)(rem|px)', v)
    return None if not m else float(m.group(1)) * (16 if m.group(2) == 'rem' else 1)
def fs(v):
    x = px(v)
    if x is None: return None
    tok, tv = min(FS, key=lambda t: (abs(t[1] - round(x, 4)), t[1]))   # ties go down
    tol = 1.0 if x < 10 else (0.8 if x <= 16 else 1.6)
    if abs(tv - x) > tol + 1e-9: left['font-size: %s (%.1fpx; nearest %s is %+.1f)' % (v, x, tok, tv - x)] += 1; return None
    moves['font-size: %s -> %s (%+.2fpx)' % (v, tok, tv - x)] += 1; return 'var(%s)' % tok
def table(t, prop):
    def f(v):
        k = re.sub(r'(?<![\d.])0(\.\d)', r'\1', v)
        if k in t: moves['%s: %s -> %s' % (prop, v, t[k])] += 1; return 'var(%s)' % t[k]
        if re.search(r'\d', v): left['%s: %s' % (prop, v)] += 1
        return None
    return f
TERM = r'(?=\s*(?:!important)?\s*(?:[;"\'}<`]|$))'
def rx(n): return re.compile(r'(?<![-\w])(' + n + r')(\s*:\s*)([^;"\'}<`$]+?)' + TERM)
RULES = [(rx('font-size'), fs), (rx('letter-spacing'), table(LS, 'letter-spacing')), (rx('line-height'), table(LH, 'line-height'))]
# snap2.py --file model-page.js [--apply]   same rules on a file with no email / landing / page <style>
FILE = sys.argv[sys.argv.index('--file') + 1] if '--file' in sys.argv else 'index.html'
lines = open(ROOT + FILE, encoding='utf-8').read().split('\n')
ex = email_lines(lines) if FILE == 'index.html' else set()
if FILE == 'index.html':
    la = next(i for i, l in enumerate(lines) if '<!-- ════ AUTH / LANDING SCREEN' in l); lb = next(i for i, l in enumerate(lines) if '<!-- ════ UPDATE PRICES MODAL' in l)
else: la = lb = -1
# fences: coupled-number rules, the body root size, input text
text = '\n'.join(lines); fence = set()
a = text.find('<style>'); b = text.find('</style>')
for m in (re.finditer(r'([^{}]+)\{([^{}]*)\}', text[a:b]) if a >= 0 else []):
    sel = m.group(1)
    if re.search(r'\.funfact-row\b|(?<![\w-])body\b|textarea|(?<![\w.#-])input|(?<![\w.#-])select|\.promo-', sel) or 'line-clamp' in m.group(2):
        fence.update(range(text.count('\n', 0, a + m.start(1)), text.count('\n', 0, a + m.end(2)) + 1))
ch = 0
for i, l in enumerate(lines):
    if i in ex or i in fence or la <= i < lb or LANDING.search(l) or CANVAS.search(l) or re.search(r'<(textarea|input|select)\b', l): continue
    n = l
    for r, fn in RULES:
        def rep(m, fn=fn):
            v = m.group(3).strip()
            if '${' in v or 'var(' in v: return m.group(0)
            o = fn(v); return m.group(0) if o is None else m.group(1) + m.group(2) + o
        n = r.sub(rep, n)
    if n != l: ch += 1; lines[i] = n
print('%d lines changed, %d values moved (fenced lines: %d)' % (ch, sum(moves.values()), len(fence)))
print('MOVED'); [print('%4d  %s' % (c, k)) for k, c in sorted(moves.items())]
print('LEFT'); [print('%4d  %s' % (c, k)) for k, c in sorted(left.items())]
if APPLY: open(ROOT + FILE, 'w', encoding='utf-8').write('\n'.join(lines)); print('applied')
