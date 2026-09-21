#!/usr/bin/env python3
"""Move the shared component rules from index.html's <style> block into design-system.css.

  move_components.py            dry run: what would move, and every cascade-order conflict
  move_components.py --apply

design-system.css loads BEFORE the page's own <style>. A moved rule therefore loses any tie it
used to win by coming later. A tie needs: same specificity, same element, same property, different
value, and the other rule sitting ABOVE the moved one today. Those are detected from every
class="…" combination in the file (static markup and JS templates); a rule with a conflict stays put.
"""
import re, sys, os, itertools, collections
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..') + '/'
APPLY = '--apply' in sys.argv

# A rule moves when EVERY selector's subject starts from one of these.
COMPONENT = re.compile(r'^\.(btn(-primary|-ghost|-danger|-sm|-icon|-ic|-label|-label-full|-label-short|-loading)?|card|card-label|chip|chips|pill|pill-muted|'
                       r'modal|modal-title|modal-actions|modal-close|modal-section[\w-]*|overlay|eyebrow|eyebrow-muted|empty|empty-icon|empty-text|empty-sub|'
                       r'form-group|form-row|form-row-3|field-error|field-error-msg|tag-pill|table-wrap|hidden)(?![\w-])')
KEEP_OUT = re.compile(r'#auth-screen|[.#]landing|[.#]auth-|\.avatar\b|\.promo-|\.funfact')

src = open(ROOT + 'index.html', encoding='utf-8').read()
a = src.index('<style>') + len('<style>'); b = src.index('</style>')
css = src[a:b]
blank = lambda m: re.sub(r'[^\n]', ' ', m.group(0))
nocom = re.sub(r'/\*.*?\*/', blank, css, flags=re.S)

# ── parse into top-level items: plain rules, and @media blocks holding rules ──
items = []; i = 0; n = len(nocom)
while i < n:
    m = re.compile(r'\s*([^{}]+?)\s*\{').match(nocom, i)
    if not m: break
    head = m.group(1).strip(); j = m.end(); depth = 1
    while depth and j < n:
        depth += (nocom[j] == '{') - (nocom[j] == '}'); j += 1
    items.append(dict(head=head, start=m.start(1), end=j, body=nocom[m.end():j - 1])); i = j

def subject(sel):
    return re.split(r'\s*[>+~]\s*|\s+', sel.strip())[-1]
# Global rules that must travel WITH the components so their order relative to them is unchanged.
ALSO = {':focus-visible'}
def is_component(selector_list):
    sels = [s.strip() for s in selector_list.split(',') if s.strip()]
    if all(s in ALSO for s in sels): return True
    if any(KEEP_OUT.search(s) for s in sels): return False
    return bool(sels) and all(COMPONENT.match(re.sub(r'^\[data-theme="\w+"\]\s+', '', s).split()[0]) and COMPONENT.match(subject(s)) or
                              (len(s.split()) == 1 and COMPONENT.match(s)) for s in sels)
def spec(sel):
    s = re.sub(r'::?[\w-]+\([^)]*\)', ' :x ', sel)
    return (len(re.findall(r'#[\w-]+', s)), len(re.findall(r'\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+', s)), len(re.findall(r'(?:^|[\s>+~])([a-zA-Z][\w-]*)', s)))
def decls(body):
    out = {}
    for d in body.split(';'):
        if ':' in d:
            k, v = d.split(':', 1); out[k.strip().lower()] = re.sub(r'\s+', ' ', v.strip())
    return out
SHORT = {'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], 'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
         'border': ['border-width', 'border-style', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left'],
         'background': ['background-color', 'background-image'], 'font': ['font-size', 'font-weight', 'font-family', 'line-height'],
         'gap': ['row-gap', 'column-gap'], 'transition': ['transition-duration', 'transition-property'], 'flex': ['flex-grow', 'flex-shrink', 'flex-basis']}
def touches(p):
    s = {p} | set(SHORT.get(p, []))
    for k, v in SHORT.items():
        if p in v: s.add(k)
    return s

# flatten to rules with a source position and a moved flag
rules = []
for it in items:
    if it['head'].startswith('@media'):
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', it['body']):
            rules.append(dict(sel=m.group(1).strip(), body=m.group(2), pos=it['start'] + m.start(), media=it['head'], item=it))
    elif it['head'].startswith('@'):
        continue
    else:
        rules.append(dict(sel=it['head'], body=it['body'], pos=it['start'], media=None, item=it))
for r in rules: r['move'] = is_component(r['sel']); r['d'] = decls(r['body'])

# ── conflict detection from class co-occurrence ──
combos = collections.Counter()
for m in re.finditer(r'class=\\?["\']([^"\'\\]*)', src):
    cl = frozenset(c for c in re.sub(r'\$\{[^}]*\}', ' ', m.group(1)).split() if re.fullmatch(r'[\w-]+', c))
    if len(cl) > 1: combos[cl] += 1
# classes added at runtime next to a component class: classList.add('x') cannot be seen statically, so treat
# every class that appears in a selector TOGETHER with a component class as co-occurring (e.g. `.btn.loading`).
# Classes added at runtime cannot be seen in class="…" strings: treat each as a possible partner of ANY component.
RUNTIME = set(re.findall(r"classList\.(?:add|toggle|replace)\(\s*['\"]([\w-]+)", src))
# `el.className = 'a b'` REPLACES the element's classes, so it is a complete class set, not an addition.
for m in re.findall(r"className\s*=\s*['\"`]([\w -]+)", src):
    cl = frozenset(m.split())
    if len(cl) > 1: combos[cl] += 1
def classes_of(sel): return set(re.findall(r'\.([\w-]+)', subject(sel)))
by_class = collections.defaultdict(list)
for r in rules:
    for s in r['sel'].split(','):
        for c in classes_of(s): by_class[c].append((r, s.strip()))
conflicts = []
for r in rules:
    if not r['move']: continue
    for s in r['sel'].split(','):
        s = s.strip(); mine = classes_of(s)
        # every set of classes that could really be on an element carrying `mine`
        possible = [mine | RUNTIME] + [set(cl) | RUNTIME for cl in combos if mine <= set(cl) | RUNTIME and mine & set(cl)]
        for q in rules:
            if q['move'] or q['pos'] > r['pos']: continue                  # only rules ABOVE today can start winning
            for qs in q['sel'].split(','):
                qs = qs.strip(); theirs = classes_of(qs)
                if '::' in subject(qs): continue                              # a pseudo-ELEMENT is a different box, never a rival
                if theirs and theirs <= mine: continue
                if spec(qs) != spec(s): continue
                # ALL of the rival's classes must fit on one element (a class-less rival — [attr], :pseudo — always fits)
                if theirs and not any(theirs <= poss for poss in possible): continue
                # tag / id in the rival's subject must not contradict ours
                tq = re.match(r'^[a-zA-Z][\w-]*', subject(qs)); tm = re.match(r'^[a-zA-Z][\w-]*', subject(s))
                if tq and tm and tq.group(0) != tm.group(0): continue
                for p, v in r['d'].items():
                    for p2, v2 in q['d'].items():
                        if p2 in touches(p) and v2 != v:
                            conflicts.append((r, s, q, qs, p, v, p2, v2))
bad = {id(c[0]) for c in conflicts}
print('rules in the stylesheet: %d | component rules: %d | with a cascade-order conflict (stay put): %d'
      % (len(rules), sum(r['move'] for r in rules), len(bad)))
seen = set()
for r, s, q, qs, p, v, p2, v2 in conflicts:
    k = (s, qs, p)
    if k in seen: continue
    seen.add(k); print('  CONFLICT  %-34s %s: %s   <- above it today:  %-30s %s: %s' % (s[:34], p, v[:26], qs[:30], p2, v2[:26]))

movers = [r for r in rules if r['move'] and id(r) not in bad]
print('moving: %d rules (%d inside @media)' % (len(movers), sum(1 for r in movers if r['media'])))
if not APPLY: sys.exit(0)

# ── build the block for design-system.css, in source order, and cut from index.html ──
out = []; cuts = []
for it in items:
    if it['head'].startswith('@media'):
        inner = [(m, r) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', it['body'])
                 for r in movers if r['item'] is it and r['pos'] == it['start'] + m.start()]
        if not inner: continue
        body_off = it['end'] - 1 - len(it['body'])
        out.append(it['head'] + ' {\n' + ''.join('  ' + re.sub(r'\s+', ' ', css[body_off + m.start():body_off + m.end()]).strip() + '\n' for m, _ in inner) + '}')
        for m, _ in inner: cuts.append((body_off + m.start(), body_off + m.end()))
    else:
        r = next((r for r in movers if r['item'] is it and not r['media']), None)
        if not r: continue
        out.append(css[it['start']:it['end']].strip()); cuts.append((it['start'], it['end']))
new_css = css
for s, e in sorted(cuts, reverse=True):
    new_css = new_css[:s] + new_css[e:]
new_css = re.sub(r'\n[ \t]*\n[ \t]*\n+', '\n\n', new_css)
open(ROOT + 'index.html', 'w', encoding='utf-8').write(src[:a] + new_css + src[b:])
ds = open(ROOT + 'design-system.css', encoding='utf-8').read().rstrip('\n')
ds += ('\n\n/* ══ Components ══\n   Shared building blocks, moved here from index.html on 2026-09-20 so that every page that links this\n'
       '   file can use them. Order matters: this file loads before a page\'s own <style>, so a page rule of equal\n'
       '   weight wins. scripts/design-system/move_components.py checks that before moving anything. */\n\n' + '\n'.join(out) + '\n')
open(ROOT + 'design-system.css', 'w', encoding='utf-8').write(ds)
print('applied: %d rules -> design-system.css' % len(movers))
