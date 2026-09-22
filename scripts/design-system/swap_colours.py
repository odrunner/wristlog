#!/usr/bin/env python3
"""Lossless colour swap: a literal becomes var(--token) only where the token has EXACTLY that value in BOTH
themes, and only in a CSS context — a <style> rule, a style="…" attribute, or an el.style.x = '…' assignment.
Never: email HTML, the landing screen (+ .btn-google/.btn-apple), canvas code, SVG attributes, data (the avatar
palette, default watch colour), <meta>.   swap_colours.py [--apply]
"""
import re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
sys.path.insert(0, HERE); import scope
APPLY = '--apply' in sys.argv
# literal -> token. Every one is identical in light and dark (tests/design-system-tokens.test.js SHARED_* or the new constants).
MAP = {'#fff': '--white', '#ffffff': '--white', '#000': '--black', '#000000': '--black',
       '#818cf8': '--tag-type', '#4caf7d': '--success', '#e05555': '--danger',
       '#4ade80': '--tg-ink', '#0a1a12': '--tg-bg', '#22c55e': '--status-good', '#eab308': '--status-warn', '#ef4444': '--status-bad',
       '#a78bfa': '--vis-friends', '#d9a441': '--warn'}
src = open(ROOT + 'index.html', encoding='utf-8').read(); lines = src.split('\n')
fenced = scope.email_lines(lines)
la = next(i for i, l in enumerate(lines) if 'id="auth-screen"' in l); lb = next(i for i in range(la + 1, len(lines)) if '<!-- ════' in lines[i])
fenced |= set(range(la, lb)) | scope._css(lines, re.compile(r'#auth-screen|[.#]landing|[.#]auth-|\.btn-google|\.btn-apple'))
a = src.index('<style>'); b = src.index('</style>')
HEX = re.compile(r'(?<![&\w])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b')
# --alpha: rgba(r,g,b,a) whose r,g,b equal a shared token -> color-mix(in srgb, var(--tok) A%, transparent).
# Renders identically (the mix of an opaque colour with transparent in sRGB is that colour at alpha A).
RGB_TOK = {'255,255,255': '--white', '0,0,0': '--black', '129,140,248': '--tag-type', '76,175,125': '--success', '224,85,85': '--danger',
           '74,222,128': '--tg-ink', '34,197,94': '--status-good', '234,179,8': '--status-warn', '239,68,68': '--status-bad', '167,139,250': '--vis-friends'}
RGBA = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0?\.\d+|1|0)\s*\)')
ALPHA = '--alpha' in sys.argv
def pct(a):
    v = float(a) * 100; return ('%g' % v)
def context(pos, line):
    if a < pos < b: return 'css'
    # inside a style="…" / style=\"…\" attribute value on this line?
    ls = pos - len(line) if False else None
    return None
out = []; last = 0; n = {}; skipped = {}
def repl_for(m):
    if ALPHA:
        base = ','.join(m.group(1, 2, 3)); tok = RGB_TOK.get(base)
        return tok, 'color-mix(in srgb, var(%s) %s%%, transparent)' % (tok, pct(m.group(4))) if tok else None
    tok = MAP.get(m.group(0).lower()); return tok, ('var(%s)' % tok if tok else None)
for m in (RGBA if ALPHA else HEX).finditer(src):
    v = m.group(0).lower(); tok, rep = repl_for(m)
    if not tok: continue
    ln = src.count('\n', 0, m.start()); line = lines[ln]; col = m.start() - (src.rfind('\n', 0, m.start()) + 1)
    before = line[:col]
    ctx = None
    if a < m.start() < b: ctx = 'css'
    elif re.search(r'style=\\?["\'][^"\']*$', before): ctx = 'inline'
    elif re.search(r'\.style\.\w+\s*=\s*[^;]*[\'"`][^\'"`]*$', before) or re.search(r'\.style\.\w+\s*=\s*[^;]*\?\s*[^:]*:?\s*[\'"]$', before): ctx = 'js-style'
    reason = None
    if ctx is None: reason = 'not a CSS context (svg/meta/data/canvas/text)'
    elif ln in fenced: reason = 'email or landing'
    elif re.search(r'fillStyle|strokeStyle|shadowColor|addColorStop', line): reason = 'canvas'
    elif re.search(r'--[\w-]+\s*:\s*[^;]*$', before): reason = 'token declaration'
    elif ctx == 'js-style' and re.search(r'\|\|\s*[\'"]$', before): reason = 'data fallback (|| literal)'
    if reason: skipped.setdefault(reason, {}).setdefault(v, 0); skipped[reason][v] += 1; continue
    n.setdefault((ctx, v), 0); n[(ctx, v)] += 1
    out.append(src[last:m.start()] + rep); last = m.end()
out.append(src[last:]); new = ''.join(out)
print('swaps: %d' % sum(n.values()))
for (ctx, v), c in sorted(n.items(), key=lambda x: -x[1]): print('  %4d %-9s %s' % (c, ctx, v))
print('left alone:'); [print('  %-45s %s' % (r, ' '.join('%s×%d' % kv for kv in sorted(d.items(), key=lambda x: -x[1])))) for r, d in skipped.items()]
if APPLY: open(ROOT + 'index.html', 'w', encoding='utf-8').write(new); print('applied')
