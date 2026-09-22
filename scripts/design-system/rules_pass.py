#!/usr/bin/env python3
"""Rule-based pass (2026-09-22): the last small figures become tokens. Each move is either exact or within the
snap rules already used (<=1px spacing, <=.02em tracking, a few ms of motion). Fenced: email HTML, the landing
screen, promo cards, the fun-fact clamp, canvas.   rules_pass.py [--apply]"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
sys.path.insert(0, HERE); import scope
APPLY = '--apply' in sys.argv
FILES = ['index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'model-page.js']
Z = {'1': '--z-raised', '2': '--z-raised-2', '3': '--z-raised-3', '10': '--z-dropdown', '20': '--z-card-menu'}
LS = {'.06em': '--ls-tight', '.05em': '--ls-tight', '.5px': '--ls-tight', '.01em': '--ls-snug', '.02em': '--ls-snug', '1px': '--ls-eyebrow'}
RAD = {'1px', '2px', '3px'}
DUR = {'.1s': '--dur-fast', '.12s': '--dur-fast', '.25s': '--dur-base', '.35s': '--dur-slow', '.5s': '--dur-xslow'}
SHADOW = {'0 0 6px var(--success)': '--glow-success',
          '0 0 0 3px color-mix(in srgb, var(--tag-type) 20%, transparent)': '--shadow-ring-tag',
          '0 0 0 3px color-mix(in srgb, var(--tg-ink) 25%, transparent)': '--shadow-ring-win',
          '0 0 0 9999px color-mix(in srgb, var(--black) 50%, transparent)': '--shadow-mask',
          '0 8px 32px color-mix(in srgb, var(--black) 15%, transparent), 0 0 12px rgba(184,149,42,0.06)': '--shadow-toast'}
moves = collections.Counter()
def fences(f, lines):
    if f != 'index.html': return set()
    out = scope.email_lines(lines)
    la = next(i for i, l in enumerate(lines) if 'id="auth-screen"' in l); lb = next(i for i in range(la + 1, len(lines)) if '<!-- ════' in lines[i])
    return out | set(range(la, lb)) | scope._css(lines, re.compile(r'#auth-screen|[.#]landing|[.#]auth-|\.btn-google|\.btn-apple|[.#]promo|\.funfact'))
def sub(rx, fn, l):
    return re.sub(rx, fn, l)
for f in FILES:
    lines = open(ROOT + f, encoding='utf-8').read().split('\n'); fence = fences(f, lines); ch = 0
    for i, l in enumerate(lines):
        if i in fence or re.search(r'fillStyle|strokeStyle|getContext|promo', l, re.I): continue
        n = l
        def z(m):
            v = m.group(2).strip()
            if v in Z: moves['z-index %s -> %s' % (v, Z[v])] += 1; return m.group(1) + 'var(%s)' % Z[v]
            return m.group(0)
        n = re.sub(r'(z-index\s*:\s*)(\d+)(?=\s*[;"\'}`])', z, n)
        def ls(m):
            v = m.group(2).strip()
            if v in LS: moves['letter-spacing %s -> %s' % (v, LS[v])] += 1; return m.group(1) + 'var(%s)' % LS[v]
            return m.group(0)
        n = re.sub(r'(letter-spacing\s*:\s*)(-?[.\d]+(?:em|px))(?=\s*[;"\'}`])', ls, n)
        def rad(m):
            parts = m.group(2).split(); out = []
            if '${' in m.group(2): return m.group(0)
            for p in parts:
                if p in RAD: out.append('var(--radius-hair)'); moves['radius %s -> --radius-hair' % p] += 1
                else: out.append(p)
            return m.group(1) + ' '.join(out) if out != parts else m.group(0)
        n = re.sub(r'(border-radius\s*:\s*)([^;"\'}`]+?)(?=\s*[;"\'}`])', rad, n)
        def tr(m):
            v = m.group(2); w = v
            for k, t in DUR.items(): w = re.sub(r'(?<![\d.])' + re.escape(k) + r'(?![\d])', 'var(%s)' % t, w)
            w = w.replace('cubic-bezier(.4,0,.2,1)', 'var(--ease-standard)')
            if w != v: moves['transition timing -> --dur-*'] += 1
            return m.group(1) + w
        n = re.sub(r'((?<![-\w])transition\s*:\s*)([^;"\'}`]+)', tr, n)
        for k, t in SHADOW.items():
            if k in n: n = n.replace(k, 'var(%s)' % t); moves['box-shadow -> %s' % t] += 1
        if n != l: lines[i] = n; ch += 1
    if APPLY and ch: open(ROOT + f, 'w', encoding='utf-8').write('\n'.join(lines))
    if ch: print('%-20s %d lines' % (f, ch))
for k, v in sorted(moves.items()): print('%4d  %s' % (v, k))
if APPLY: print('applied')
