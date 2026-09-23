#!/usr/bin/env python3
"""design-system.css -> tokens.json for the Design System artifact type (flat lists, literal or {alias} values)."""
import re, json, os, sys, collections
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..') + '/'
OUT = sys.argv[1]
css = open(ROOT + 'design-system.css', encoding='utf-8').read().split('/* ── Generated: roles')[0]
def block(sel):
    i = css.index(sel); j = css.index('{', i); d = 0; k = j
    while True:
        if css[k] == '{': d += 1
        elif css[k] == '}':
            d -= 1
            if d == 0: break
        k += 1
    return css[j + 1:k]
def parse(text):
    out = collections.OrderedDict(); pending = ''; buf = None
    for raw in text.split('\n'):
        line = raw.strip()
        if buf is not None:
            if '*/' in line: pending = (buf + ' ' + line[:line.index('*/')]).strip(); buf = None
            else: buf += ' ' + line
            continue
        if line.startswith('/*') and '*/' not in line: buf = line[2:]; continue
        m = re.match(r'/\*(.*?)\*/\s*$', line)
        if m: pending = m.group(1).strip(); continue
        t = re.search(r'/\*(.*?)\*/\s*$', line); trailing = ''
        if t: trailing = t.group(1).strip(); line = line[:t.start()]
        decls = re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', line)
        for n, v in decls:
            note = re.sub(r'\s+', ' ', (trailing or pending)).strip(' -─*')
            out[n] = (v.strip(), note[:400])
        if decls: pending = ''
    return out
light = parse(block(':root, [data-theme="light"]')); dark = parse(block('[data-theme="dark"]'))
def hexes(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]
def resolve(val, table, depth=0):
    """A literal the type accepts: hex / rgba(). color-mix and var() are resolved; alias kept for plain var()."""
    v = val.strip()
    if depth > 6: return None
    m = re.fullmatch(r'var\((--[\w-]+)\)', v)
    if m: return ('alias', m.group(1))
    m = re.fullmatch(r'color-mix\(in srgb, (var\(--[\w-]+\)|#[0-9a-fA-F]{3,8}) (\d+)%, (transparent|black|white)\)', v)
    if m:
        src = m.group(1)
        base = src if src.startswith('#') else table.get(src[4:-1], (None,))[0]
        if base is None: return None
        r = resolve(base, table, depth + 1)
        if r is None or r[0] == 'alias':
            base2 = table.get(r[1], (None,))[0] if r and r[0] == 'alias' else None
            if base2 is None: return None
            r = resolve(base2, table, depth + 1)
        if r is None or r[0] != 'lit': return None
        pct = int(m.group(2)) / 100
        rgb = hexes(r[1]) if r[1].startswith('#') else [int(x) for x in re.findall(r'\d+', r[1])[:3]]
        if m.group(3) == 'transparent': return ('lit', 'rgba(%d,%d,%d,%.2f)' % (rgb[0], rgb[1], rgb[2], pct))
        other = [0, 0, 0] if m.group(3) == 'black' else [255, 255, 255]
        mixed = [round(a * pct + b * (1 - pct)) for a, b in zip(rgb, other)]
        return ('lit', '#%02x%02x%02x' % tuple(mixed))
    if re.fullmatch(r'#[0-9a-fA-F]{3,8}', v) or re.fullmatch(r'rgba?\([\d.,\s]+\)', v): return ('lit', v.lower())
    return None
IS_COLOUR = re.compile(r'#[0-9a-fA-F]{3,8}|rgba?\(|color-mix')
skipped = []
colours = []
for n, (v, note) in light.items():
    if re.match(r'--(space|size|fs|fw|lh|ls|radius|icon|dur|ease|opacity|z|bp|font|header-h|nav-h|shadow|glow|ring)', n): continue
    probe = v if IS_COLOUR.search(v) else (light.get(re.sub(r'var\((--[\w-]+)\)', r'\1', v), ('',))[0] if v.startswith('var(') else '')
    if not IS_COLOUR.search(probe or v): continue
    def val_for(table, raw):
        r = resolve(raw, table)
        if r is None: return None
        return '{%s}' % r[1][2:] if r[0] == 'alias' else r[1]
    lv = val_for(light, v)
    dv = val_for(dark, dark[n][0]) if n in dark else None
    if lv is None: skipped.append((n, v)); continue
    entry = {'name': n[2:], 'value': {'light': lv, 'dark': dv or lv}}
    if note: entry['usage'] = note
    colours.append(entry)
def family(pat, exclude=()):
    out = []
    for n, (v, note) in light.items():
        if not re.match(pat, n) or n in exclude: continue
        val = v.strip()
        if val.startswith('var('):
            val = light.get(re.sub(r'var\((--[\w-]+)\)', r'\1', val), (val,))[0]
        e = {'name': n[2:], 'value': val}
        if note: e['usage'] = note
        out.append(e)
    return out
TYPE_STYLES = [
    ('display', '--fs-4xl', '--lh-tight', 700), ('title', '--fs-2xl', '--lh-tight', 700),
    ('title-sm', '--fs-xl', '--lh-tight', 700), ('lead', '--fs-body', '--lh-snug', 600),
    ('body', '--fs-body', '--lh-body', 400), ('body-app', '--fs-base', '--lh-body', 400),
    ('meta', '--fs-sm', '--lh-snug', 400), ('caption', '--fs-xs', '--lh-snug', 400),
    ('eyebrow', '--fs-2xs', '--lh-none', 600), ('input', '--fs-input', '--lh-snug', 400),
]
tokens = {
    'name': 'WRotate', 'version': 1,
    'color': {'themes': [{'id': 'light', 'name': 'Light'}, {'id': 'dark', 'name': 'Dark'}], 'tokens': colours},
    'type': {
        'families': {'sans': light['--font-sans'][0], 'mono': light['--font-mono'][0]},
        'groups': [
            {'name': 'Text', 'family': 'sans', 'styles': [
                {'name': nm, 'fontSize': light[fs][0], 'lineHeight': light[lh][0], 'fontWeight': w,
                 'usage': light[fs][1][:300] or None} for nm, fs, lh, w in TYPE_STYLES]},
            {'name': 'Mono', 'family': 'mono', 'styles': [
                {'name': 'mono-meta', 'fontSize': light['--fs-sm'][0], 'lineHeight': light['--lh-snug'][0], 'fontWeight': 400,
                 'usage': 'Reference numbers, admin keys, the timegrapher readout.'}]},
        ],
    },
    'spacing': {'note': 'rem, so spacing scales with the text size.', 'tokens': family(r'--space-')},
    'radius': {'tokens': family(r'--radius')},
    'shadow': {'tokens': []},
    'size': {'note': 'px, so boxes and positions do not grow with the text. N x 4px.', 'tokens': family(r'--(size|icon)-')},
    'opacity': {'tokens': family(r'--opacity-')},
    'zIndex': {'note': 'One name per stacking layer, lowest first.', 'tokens': family(r'--z-')},
    'breakpoint': {'note': 'A media query cannot read a variable, so a test enforces this list.', 'tokens': family(r'--bp-')},
}
for e in tokens['type']['groups'][0]['styles']:
    if not e.get('usage'): e.pop('usage', None)
for n, (v, note) in light.items():
    if not re.match(r'--(shadow|glow|ring)', n): continue
    out = v
    for m in set(re.findall(r'color-mix\([^()]*var\([^()]*\)[^()]*\)', out)):
        rr = resolve(m, light)
        if rr and rr[0] == 'lit': out = out.replace(m, rr[1])
    for m in set(re.findall(r'var\((--[\w-]+)\)', out)):
        r = resolve('var(%s)' % m, light)
        base = light.get(m, ('',))[0]
        rr = resolve(base, light) if base else None
        if rr and rr[0] == 'lit': out = out.replace('var(%s)' % m, rr[1])
    if 'var(' in out or 'color-mix' in out: skipped.append((n, v)); continue
    e = {'name': n[2:], 'value': out}
    if note: e['usage'] = note[:400]
    tokens['shadow']['tokens'].append(e)
json.dump(tokens, open(OUT, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print('colours %d · shadows %d · spacing %d · size %d · radius %d · opacity %d · z %d · breakpoints %d'
      % (len(colours), len(tokens['shadow']['tokens']), len(tokens['spacing']['tokens']), len(tokens['size']['tokens']),
         len(tokens['radius']['tokens']), len(tokens['opacity']['tokens']), len(tokens['zIndex']['tokens']), len(tokens['breakpoint']['tokens'])))
if skipped: print('could not be expressed (%d):' % len(skipped), ', '.join(n for n, _ in skipped[:12]))
