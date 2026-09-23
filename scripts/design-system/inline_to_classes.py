#!/usr/bin/env python3
"""Inline styles -> classes. Every static design declaration in a style="" becomes a class:
  - a ROLE class where a whole pattern repeats (.text-meta, .row, ...), so a redesign is one edit
  - otherwise a token-named single-purpose class (.u-mb-3 = margin-bottom: var(--space-3))
Values computed at runtime (${...}) and behavioural props (display, position, overflow...) stay inline.
The generated rules are written LAST in design-system.css with a doubled selector, so a class wins exactly
where the inline style used to.
  inline_to_classes.py [--apply] [--templates]      (default: static markup only)
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv; TEMPLATES = '--templates' in sys.argv
BEH = {'display', 'visibility', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'overflow', 'overflow-x', 'overflow-y', 'pointer-events', 'transform', 'clip', 'z-index'}
SKIP_IDS = ('ptr-indicator', 'crop-img', 'af2-crop-img')                       # JS reads these back with parseFloat(el.style.x)
EMAIL = [('const FUNFACT_CARD_HTML', 'function renderDevFlags'), ('function imgSnippet', 'function updateBroadcastPreview'),
         ('function buildFinalBroadcastHtml', 'const BROADCAST_DRAFTS_KEY'), ('function buildCampaignEmailHtml', 'async function createCampaign')]
ROLES = {                                                                      # exact declaration set -> role class
  'color:var(--muted);font-size:var(--fs-sm)': 'text-meta',
  'color:var(--muted);font-size:var(--fs-xs)': 'text-caption',
  'color:var(--muted);font-size:var(--fs-base)': 'text-secondary',
  'color:var(--muted);font-size:var(--fs-base);line-height:var(--lh-body)': 'text-body',
  'color:var(--muted);font-size:var(--fs-md);line-height:var(--lh-body)': 'text-body-lg',
  'align-items:center;display:flex;gap:var(--space-2)': 'row',
  'align-items:center;display:flex;gap:var(--space-1-5)': 'row-tight',
  'align-items:center;display:flex;justify-content:space-between': 'row-spread',
}
SIDE = {'top': 't', 'right': 'r', 'bottom': 'b', 'left': 'l'}
ABBR = {'font-size': 'fs', 'font-weight': 'fw', 'color': 'c', 'background': 'bg', 'gap': 'gap', 'border-radius': 'r',
        'line-height': 'lh', 'letter-spacing': 'ls', 'width': 'w', 'height': 'h', 'max-width': 'maxw', 'max-height': 'maxh',
        'min-width': 'minw', 'min-height': 'minh', 'text-align': 'ta', 'white-space': 'ws', 'cursor': 'cur', 'object-fit': 'of',
        'text-transform': 'tt', 'font-family': 'ff', 'opacity': 'op', 'align-items': 'items', 'justify-content': 'justify',
        'flex-direction': 'fd', 'flex-wrap': 'fw-', 'flex': 'flex', 'flex-shrink': 'shrink', 'flex-grow': 'grow',
        'text-overflow': 'to', 'border': 'bd', 'border-top': 'bdt', 'border-bottom': 'bdb', 'border-left': 'bdl',
        'border-right': 'bdr', 'border-color': 'bdc', 'border-top-color': 'bdtc', 'box-shadow': 'sh', 'font-style': 'fst',
        'vertical-align': 'va', 'word-break': 'wb', 'text-decoration': 'td', 'resize': 'rs', 'table-layout': 'tl',
        'grid-template-columns': 'cols', 'grid-column': 'col', 'border-collapse': 'bc', 'font-variant-numeric': 'fvn',
        'object-position': 'op-', 'aspect-ratio': 'ar', 'accent-color': 'ac', 'transition': 'tr', 'animation': 'anim',
        'text-shadow': 'tsh', 'backdrop-filter': 'bf', 'text-wrap': 'tw', '-webkit-line-clamp': 'clamp',
        '-webkit-box-orient': 'boxor', '-webkit-overflow-scrolling': 'ovs', 'background-size': 'bgs', 'background-position': 'bgp'}
def slug(v):
    v = v.strip()
    m = re.fullmatch(r'color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)', v)
    if m: v = 'mix-%s-%s' % (m.group(1), m.group(2))
    v = re.sub(r'var\(--(?:space|size|fs|fw|lh|ls|radius|opacity|z)-?', '', v)
    v = re.sub(r'var\(--', '', v).replace(')', '')
    v = v.replace('%', 'pct').replace('.', 'p').replace('/', '-').replace(',', '-')
    v = re.sub(r'[^A-Za-z0-9-]+', '-', v).strip('-').lower()
    return re.sub(r'-+', '-', v)
def parts(val):
    """Split a shorthand on top-level spaces. None when the value has unbalanced brackets."""
    out, cur, depth = [], '', 0
    for ch in val:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ' ' and depth == 0:
            if cur: out.append(cur); cur = ''
        else: cur += ch
    if cur: out.append(cur)
    return None if depth or not out or len(out) > 4 else out

def cls_for(prop, val):
    if prop in ('margin', 'padding'):
        p = parts(val)                                                     # 'calc(-1 * var(--x))' is ONE part
        if p is None: return None
        if len(p) == 1: p = p * 4
        elif len(p) == 2: p = p * 2
        elif len(p) == 3: p = [p[0], p[1], p[2], p[1]]
        out = []
        for side, v in zip(('top', 'right', 'bottom', 'left'), p):
            out.append(cls_for(prop + '-' + side, v)[0])
        return out
    m = re.fullmatch(r'(margin|padding)-(top|right|bottom|left)', prop)
    if m:
        return [('u-%s%s-%s' % (m.group(1)[0], SIDE[m.group(2)], slug(val)), '%s: %s' % (prop, val))]
    return [('u-%s-%s' % (ABBR.get(prop, slug(prop)), slug(val)), '%s: %s' % (prop, val))]

# Rules that select by id outrank any class, so a declaration an id rule also sets has to stay inline
# (that is how it behaved before: the inline style won). Collected from every page's CSS.
def id_rule_targets():
    out = collections.defaultdict(set)                                      # token (id or class) -> props an id-bearing rule sets
    for f in ('design-system.css', 'index.html', 'p/index.html', 'profile/index.html', 'w/index.html', 'open.html'):
        src = open(ROOT + f, encoding='utf-8').read()
        if not f.endswith('.css'): src = '\n'.join(re.findall(r'<style[^>]*>([\s\S]*?)</style>', src))
        src = re.sub(r'/\*[\s\S]*?\*/', '', src)
        for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', src):
            if '#' not in sel: continue
            props = {d.split(':')[0].strip().lower() for d in body.split(';') if ':' in d}
            for tok in re.findall(r'[#.]([A-Za-z][\w-]*)', sel): out[tok] |= props
    return out
ID_RULES = id_rule_targets()

# Which ids are ancestors of each static tag: a rule like '#watch-modal input' also outranks a class.
from html.parser import HTMLParser
class Ancestors(HTMLParser):
    VOID = {'br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'polygon', 'use', 'col', 'area'}
    def __init__(self): super().__init__(convert_charrefs=False); self.stack = []; self.at = {}
    def handle_starttag(self, tag, attrs):
        d = dict(attrs); self.at[self.getpos()] = set(self.stack)
        if tag not in self.VOID: self.stack.append(d.get('id') or '')
    def handle_startendtag(self, tag, attrs): self.at[self.getpos()] = set(self.stack)
    def handle_endtag(self, tag):
        if tag not in self.VOID and self.stack: self.stack.pop()
def ancestor_ids(src):
    p = Ancestors()
    try: p.feed(src)
    except Exception: pass
    return {k: {x for x in v if x} for k, v in p.at.items()}


FILES = ['index.html', 'model-page.js', 'p/index.html', 'profile/index.html', 'w/index.html', 'open.html']
rules = {}; used = collections.Counter(); stats = collections.Counter(); skipped = collections.Counter()
def convert(text, fname):
    ANC = ancestor_ids(text) if not fname.endswith('.js') else {}
    lines = text.split('\n'); fence = set()
    if fname == 'index.html':
        for a, b in EMAIL:
            i = next(k for k, l in enumerate(lines) if l.startswith(a)); j = next(k for k in range(i + 1, len(lines)) if lines[k].startswith(b)); fence |= set(range(i, j))
    out = []
    for i, line in enumerate(lines):
        if i in fence or 'style=' not in line: out.append(line); continue
        is_template = '`' in line or '${' in line or fname.endswith('.js')
        if is_template and not TEMPLATES: out.append(line); continue
        if (not is_template) and TEMPLATES: out.append(line); continue
        def fix(m):
            q, body = m.group(1), m.group(2)
            tag = m.group(0)
            if any(s in tag for s in SKIP_IDS): skipped['JS reads the style back'] += 1; return tag
            sm = re.search(r'style=(\\?["\'])((?:(?!\1).)*)\1', tag)
            if not sm: return tag
            decls = [d.strip() for d in sm.group(2).split(';') if d.strip()]
            keep, add = [], []
            statics = {}
            for d in decls:
                if ':' not in d or '${' in d or d.strip().startswith('--') or re.search(r"['\"`]\s*\+|\+\s*['\"`]", d): keep.append(d); continue
                k, v = [x.strip() for x in d.split(':', 1)]
                if k.lower() in BEH or not v: keep.append(d); continue
                statics[k.lower()] = re.sub(r'\s+', ' ', v)
            idm = re.search(r'id=(\\?["\'])([^"\']*)\1', tag); cm0 = re.search(r'class=(\\?["\'])([^"\']*)\1', tag)
            toks = ([idm.group(2)] if idm else []) + (cm0.group(2).split() if cm0 else []) + sorted(ANC.get((i + 1, m.start()), ()))
            for k in list(statics):
                sides = [k] + (['%s-%s' % (k, x) for x in SIDE] if k in ('margin', 'padding') else ([k.rsplit('-', 1)[0]] if k.rsplit('-', 1)[0] in ('margin', 'padding', 'border') else []))
                if any(any(p in ID_RULES.get(t, ()) for p in sides) for t in toks):
                    keep.append('%s: %s' % (k, statics.pop(k))); skipped['an id rule sets it'] += 1
            key = ';'.join('%s:%s' % (k, v) for k, v in sorted(statics.items()))
            if key in ROLES:
                add.append(ROLES[key]); rules.setdefault(ROLES[key], [('%s: %s' % (k, v)) for k, v in sorted(statics.items())]); used[ROLES[key]] += 1
                statics = {}
            for k, v in statics.items():
                made = cls_for(k, v)
                if made is None: keep.append('%s: %s' % (k, v)); skipped['value could not be split safely'] += 1; continue
                for name, decl in made:
                    add.append(name); rules.setdefault(name, []); 
                    if decl not in rules[name]: rules[name].append(decl)
                    used[name] += 1
            if not add: return tag
            stats['elements'] += 1
            cm = re.search(r'class=(\\?["\'])([^"\']*)\1', tag)
            if cm:
                new_tag = tag.replace(cm.group(0), cm.group(0).replace(cm.group(2), (cm.group(2) + ' ' + ' '.join(add)).strip()))
            else:
                new_tag = tag.replace(sm.group(0), 'class=%s%s%s %s' % (sm.group(1), ' '.join(add), sm.group(1), sm.group(0)))
            new_style = ('style=%s%s%s' % (sm.group(1), ';'.join(keep) + ';', sm.group(1))) if keep else ''
            new_tag = re.sub(r'\s*' + re.escape(sm.group(0)), (' ' + new_style) if new_style else '', new_tag, count=1)
            return new_tag
        out.append(re.sub(r'<[a-zA-Z][^<>]*style=(\\?["\'])((?:(?!\1).)*)\1[^<>]*>', fix, line))
    return '\n'.join(out)
changed = {}
for f in FILES:
    src = open(ROOT + f, encoding='utf-8').read()
    new = convert(src, f)
    if new != src: changed[f] = new
print('elements converted:', stats['elements'], '| classes:', len(rules), '| skipped:', dict(skipped))
print('roles used:', {k: used[k] for k in ROLES.values() if used[k]})
print('single-use classes:', sum(1 for k, n in used.items() if n == 1))
if APPLY:
    for f, new in changed.items(): open(ROOT + f, 'w', encoding='utf-8').write(new)
    css = open(ROOT + 'design-system.css', encoding='utf-8').read()
    MARK = '/* ── Generated: roles and single-purpose classes ── */'
    block = [MARK, "/* Written by scripts/design-system/inline_to_classes.py. Doubled selector so a class lands with the same", "   weight the inline style it replaced had: the name is repeated so it outranks a page's own rules (their",
             "   <style> block is parsed after this file), while still yielding to an !important rule, as an inline style did.",
             "   Roles first: change one to restyle every place that uses it. */"]
    for name in sorted(rules, key=lambda n: (0 if n in ROLES.values() else 1, n)):
        sel = '.{0}.{0}.{0}'.format(name)
        block.append('%s { %s }' % (sel, '; '.join(rules[name]) + ';'))
    css = css.split(MARK)[0].rstrip() + '\n\n' + '\n'.join(block) + '\n'
    open(ROOT + 'design-system.css', 'w', encoding='utf-8').write(css)
    print('applied')
