#!/usr/bin/env python3
"""Sizes onto one ladder (4px steps to 96px, 20px steps above, so nothing moves more than 10px): every px/rem length in width/height/min-/max-/flex-basis/inset/top/right/bottom/left
becomes var(--size-N), N x 4px. Off-ladder values move to the nearest step (ties -> the more-used neighbour).
Never: email HTML, @media lines (breakpoints), canvas code, ${...} values, %, em, vw/vh.
  swap_sizes.py [--apply]
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv
FILES = ['index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'privacy.html', 'terms.html', 'open.html', 'model-page.js', 'design-system.css']
EMAIL = [('const FUNFACT_CARD_HTML', 'function renderDevFlags'), ('function imgSnippet', 'function updateBroadcastPreview'),
         ('function buildFinalBroadcastHtml', 'const BROADCAST_DRAFTS_KEY'), ('function buildCampaignEmailHtml', 'async function createCampaign')]
STEPS = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24,                 # 1px .. 96px
         30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 140,   # 120px .. 560px, every 20px
         170, 180, 215, 290,                                                                                 # 680 / 720 / 860 / 1160px
         2499.75]                                                                                            # 9999px: 'no limit' / off-screen
PX = {s * 4: s for s in STEPS}
def name(s): return '--size-' + ({0.25: 'px', 2499.75: 'max'}.get(s) or str(s).replace('.5', '-5').replace('.0', ''))
RX = re.compile(r'(?<![-\w])((?:min-|max-)?(?:width|height)|flex-basis|inset|top|right|bottom|left)(\s*:\s*)([^;"\'}<`]+)')
LEN = re.compile(r'(?<![\w.#-])(-?)(\d*\.?\d+)(px|rem)\b')
use = collections.Counter(); lines_by_file = {}
for f in FILES:
    L = open(ROOT + f, encoding='utf-8').read().split('\n'); fence = set()
    if f == 'index.html':
        for a, b in EMAIL:
            i = next(k for k, l in enumerate(L) if l.startswith(a)); j = next(k for k in range(i + 1, len(L)) if L[k].startswith(b)); fence |= set(range(i, j))
    lines_by_file[f] = (L, fence)
    for i, l in enumerate(L):
        if i in fence or '@media' in l or re.search(r'fillStyle|strokeStyle|getContext|ctx\.', l): continue
        for m in RX.finditer(l):
            if '${' in m.group(3): continue
            for s, n, u in LEN.findall(m.group(3)):
                v = round(float(n) * (16 if u == 'rem' else 1), 3)
                if v: use[v] += 1
def step(v):
    if v in PX: return PX[v]
    below = max([p for p in PX if p < v], default=None); above = min([p for p in PX if p > v], default=None)
    if below is None: return PX[above]
    if above is None: return PX[below]
    db, da = v - below, above - v
    if db != da: return PX[below] if db < da else PX[above]
    return PX[below] if use[below] >= use[above] else PX[above]
def comment_mask(f, text):
    """Per character: True inside a comment (CSS /* */ in the stylesheet and <style> blocks, <!-- -->, JS //)."""
    m = [False] * len(text)
    def mark(a, b):
        for k in range(a, b): m[k] = True
    css_regions = [(0, len(text))] if f.endswith('.css') else [(x.start(1), x.end(1)) for x in re.finditer(r'<style[^>]*>([\s\S]*?)</style>', text)]
    for a, b in css_regions:
        for c in re.finditer(r'/\*[\s\S]*?\*/', text[a:b]): mark(a + c.start(), a + c.end())
    for c in re.finditer(r'<!--[\s\S]*?-->', text): mark(c.start(), c.end())
    if not f.endswith('.css'):
        for c in re.finditer(r'(?m)(?:^|(?<=[\s;{}(),]))//[^\n]*', text):
            if not m[c.start()]: mark(c.start(), c.end())
    return m
moves = collections.Counter(); kept = collections.Counter(); total = 0
for f, (L, fence) in lines_by_file.items():
    changed = 0; text = '\n'.join(L); mask = comment_mask(f, text); starts = []; pos = 0
    for l in L: starts.append(pos); pos += len(l) + 1
    for i, l in enumerate(L):
        if i in fence or '@media' in l or re.search(r'fillStyle|strokeStyle|getContext|ctx\.|rotate\(45deg\)|promo-tag-notch|partial::after', l): continue
        def rep(m):
            if '${' in m.group(3) or mask[starts[i] + m.start()]: return m.group(0)
            def one(x):
                v = round(float(x.group(2)) * (16 if x.group(3) == 'rem' else 1), 3)
                if not v: return x.group(0)
                s = step(v); t = 'var(%s)' % name(s)
                if m.group(1) in ('top', 'right', 'bottom', 'left', 'inset') and abs(s * 4 - v) > 2:   # a position: never moved far
                    kept['%s %g' % (m.group(1), v)] += 1; return x.group(0)
                moves['%g -> %g' % (v, s * 4)] += 1
                return 'calc(-1 * %s)' % t if x.group(1) else t
            return m.group(1) + m.group(2) + LEN.sub(one, m.group(3))
        n = RX.sub(rep, l)
        if n != l: L[i] = n; changed += 1
    total += changed
    if APPLY and changed: open(ROOT + f, 'w', encoding='utf-8').write('\n'.join(L))
    if changed: print('%-20s %4d lines' % (f, changed))
exact = sum(n for k, n in moves.items() if k.split(' -> ')[0] == k.split(' -> ')[1])
print('\nexact: %d   moved: %d' % (exact, sum(moves.values()) - exact))
for k, n in sorted(moves.items(), key=lambda x: float(x[0].split()[0])):
    a, b = k.split(' -> ')
    if a != b: print('%4d  %6spx -> %s' % (n, a, b))
print('\npositions kept (off the ladder by >2px):', dict(kept))
print('\ntokens: ' + ' '.join('%s: %gpx;' % (name(s), s * 4) for s in STEPS))
if APPLY: print('\napplied')
