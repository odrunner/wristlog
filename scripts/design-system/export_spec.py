#!/usr/bin/env python3
"""Writes docs/design/design-system.md: every token with its light/dark value and the reason it exists, the
components and roles, and the rules a redesign has to respect. Generated from design-system.css so it cannot
drift.  export_spec.py
"""
import re, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
css = open(ROOT + 'design-system.css', encoding='utf-8').read()
MARK = '/* ── Generated: roles and single-purpose classes ── */'
hand, generated = css.split(MARK)

def block(sel):
    i = hand.index(sel); j = hand.index('{', i); d = 0; k = j
    while True:
        if hand[k] == '{': d += 1
        elif hand[k] == '}':
            d -= 1
            if d == 0: break
        k += 1
    return hand[j + 1:k]

def tokens(text):
    """token -> (value, note). The note is the whole comment above the declaration, or the one beside it."""
    out = collections.OrderedDict(); pending = ''; buf = None
    for raw in text.split('\n'):
        line = raw.strip()
        if buf is not None:                                                    # inside a multi-line comment
            if '*/' in line: buf += ' ' + line[:line.index('*/')]; pending = buf; buf = None
            else: buf += ' ' + line
            continue
        if line.startswith('/*') and '*/' not in line: buf = line[2:]; continue
        m = re.match(r'/\*(.*?)\*/\s*$', line)
        if m: pending = m.group(1); continue
        trailing = ''
        t = re.search(r'/\*(.*?)\*/\s*$', line)
        if t: trailing = t.group(1); line = line[:t.start()]
        decls = re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', line)
        for name, val in decls:
            note = (trailing or pending).strip()
            note = re.sub(r'\s+', ' ', note).strip(' -─*')
            if len(note) > 200: note = note[:197].rsplit(' ', 1)[0] + '…'
            out[name] = (val.strip(), note)
        if decls: pending = ''
    return out

SRC = ''.join(open(ROOT + f, encoding='utf-8').read() for f in
              ('index.html', 'model-page.js', 'p/index.html', 'profile/index.html', 'w/index.html', 'open.html', 'design-system.css'))
def uses(name):
    return len(re.findall(re.escape('var(' + name) + r'[,)]', SRC)) + len(re.findall(r"ds(?:Token|Color)\('" + re.escape(name) + "'", SRC))

light = tokens(block(':root, [data-theme="light"]'))
dark = tokens(block('[data-theme="dark"]'))
promo = tokens(block('.promo-tag, .promo-band, .promo-recap {'))
GROUPS = [
    ('Surfaces and text', r'^--(bg|surface|surface2|hover|overlay-bg|border|text|muted|fg)$'),
    ('Brand gold', r'^--(gold|gold-text|gold-lt|gold-dim|accent|ring|on-gold)$'),
    ('Feedback', r'^--(danger|danger-text|danger-fill|success|success-text|error|verified|status-|chip-warn|streak-frozen)'),
    ('Fixed inks', r'^--(white|black|scrim|paper|cream|sand)$'),
    ('Tags, ranks, visibility', r'^--(tag-|rating|medal-|vis-)'),
    ('Watch colours (saved with a watch)', r'^--watch-'),
    ('Charts', r'^--(chart-|uc-)'),
    ('Timegrapher instrument', r'^--tg-'),
    ('Badges and achievements', r'^--badge-'),
    ('Demo mode and previews', r'^--(demo-|email-canvas)'),
    ('Sign-in buttons (brand rules)', r'^--(google-|apple-)'),
]
SCALES = [
    ('Type sizes', r'^--fs-'), ('Type weights', r'^--fw-'), ('Line heights', r'^--lh-'), ('Letter spacing', r'^--ls-'),
    ('Fonts', r'^--font-'), ('Spacing (rem, scales with text)', r'^--space-'), ('Sizes (px, boxes and positions)', r'^--size-'),
    ('Icon sizes', r'^--icon-'), ('Corner radius', r'^--radius'), ('Shadows and glow', r'^--(shadow|glow)'),
    ('Motion', r'^--(dur-|ease-)'), ('Opacity', r'^--opacity-'), ('Breakpoints', r'^--bp-'), ('Layers (z-index)', r'^--z-'),
]
def table(names, title, show_dark=True):
    rows = []
    for n in names:
        v, note = light[n]
        d = dark.get(n, ('', ''))[0]
        cell = f'`{d}`' if d and d != v else ('same' if show_dark else '')
        u = uses(n)
        rows.append(f'| `{n}` | `{v}` | {cell} | {u} | {note} |' if show_dark else f'| `{n}` | `{v}` | {u} | {note} |')
    head = ('| Token | Light | Dark | Uses | What it is for |\n|---|---|---|---|---|' if show_dark
            else '| Token | Value | Uses | What it is for |\n|---|---|---|---|')
    return f'\n### {title}\n\n{head}\n' + '\n'.join(rows) + '\n'

used = set(); out = []
for title, pat in GROUPS:
    names = [n for n in light if re.search(pat, n) and n not in used]
    used |= set(names)
    if names: out.append(table(names, title))
colour_tables = ''.join(out)
scale_tables = ''
for title, pat in SCALES:
    names = [n for n in light if re.search(pat, n) and n not in used]
    used |= set(names)
    if names: scale_tables += table(names, title, show_dark=False)
leftover = [n for n in light if n not in used]
if leftover: scale_tables += table(leftover, 'Everything else', show_dark=False)

# components (hand-written rules after the token blocks) and roles (generated block)
comp = []
for m in re.finditer(r'(?m)^(\.[^{\n]+)\{([^}]*)\}', hand):
    sel = m.group(1).strip(); body = re.sub(r'\s+', ' ', re.sub(r'/\*.*?\*/', '', m.group(2), flags=re.S)).strip()
    if sel.startswith('.promo'): continue
    comp.append((sel, body))
roles = [(m.group(1), re.sub(r'\s+', ' ', m.group(2)).strip())
         for m in re.finditer(r'^\.([\w-]+)(?:\.[\w-]+)+\s*\{([^}]*)\}', generated, re.M)]
ROLE_NAMES = ['text-meta', 'text-caption', 'text-caption-xs', 'text-secondary', 'text-body', 'text-body-lg', 'text-default',
              'text-alert', 'row', 'row-tight', 'row-between', 'row-center', 'row-start', 'row-start-lg', 'row-inline',
              'panel', 'title-lg', 'img-cover', 'img-avatar', 'badge-body']
role_rows = '\n'.join(f'| `.{n}` | {dict(roles).get(n, "")} |' for n in ROLE_NAMES if n in dict(roles))
comp_rows = '\n'.join('| `%s` | %s |' % (s, b if len(b) <= 150 else b[:147].rsplit(' ', 1)[0] + ' …') for s, b in comp if b)
promo_rows = '\n'.join(f'| `{n}` | `{v}` | {note}' + ' |' for n, (v, note) in promo.items() if not n.startswith(('--promo-fs', '--promo-ls', '--promo-lh', '--promo-radius')))

doc = open(ROOT + 'docs/design/spec-intro.md', encoding='utf-8').read()
doc = doc.replace('<!--COLOURS-->', colour_tables).replace('<!--SCALES-->', scale_tables)
doc = doc.replace('<!--ROLES-->', role_rows).replace('<!--COMPONENTS-->', comp_rows).replace('<!--PROMO-->', promo_rows)
open(ROOT + 'docs/design/design-system.md', 'w', encoding='utf-8').write(doc)
print('wrote docs/design/design-system.md —', len(doc.split('\n')), 'lines,',
      len(light), 'light tokens,', len(dark), 'dark overrides,', len(comp), 'component rules,', len(ROLE_NAMES), 'roles')
