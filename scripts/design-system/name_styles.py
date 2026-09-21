#!/usr/bin/env python3
"""Replace inline style="…" attributes that EXACTLY equal a named decision with its class (phase 4 step 3).

  name_styles.py                       dry run over the whole page
  name_styles.py --lines 2833-3125     only elements starting on those lines
  name_styles.py --apply [...]

An inline style always wins; a class does not. So an element is converted only if NO rule that could apply
to it — by tag, id or any of its classes, with any ancestors, in any state — and that weighs at least as much
as one class, touches any property the named class sets. Everything else stays inline and is listed.
Also skipped: email HTML, the landing screen, buttons and form fields (step 4), elements whose class is built
at runtime, and elements with an id when JS assigns that property through .style.
The classes themselves are appended to design-system.css under "Text styles and layout helpers".
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
sys.path.insert(0, HERE)
from scope import email_lines
APPLY = '--apply' in sys.argv
DO_SNAP = '--snap' in sys.argv
SCOPE = sys.argv[sys.argv.index('--scope') + 1] if '--scope' in sys.argv else None   # admin | not-admin
LINES = None
if '--lines' in sys.argv:
    a, b = sys.argv[sys.argv.index('--lines') + 1].split('-'); LINES = (int(a), int(b))

# name -> declarations. Matching ignores declaration order and whitespace.
NAMED = collections.OrderedDict([
    # text styles
    ('item-title',   'font-size:var(--fs-base);font-weight:var(--fw-semibold);margin-bottom:var(--space-1)'),
    ('body-muted',   'font-size:var(--fs-base);color:var(--muted);line-height:var(--lh-body)'),
    ('note',         'font-size:var(--fs-base);color:var(--muted)'),
    ('note-md',      'font-size:var(--fs-md);color:var(--muted)'),
    ('caption',      'font-size:var(--fs-sm);color:var(--muted)'),
    ('caption-xs',   'font-size:var(--fs-xs);color:var(--muted)'),
    ('text-muted',   'color:var(--muted)'),
    ('text-gold',    'color:var(--gold-text)'),
    ('text-gold-strong', 'color:var(--gold-text);font-weight:var(--fw-semibold)'),
    ('text-danger',  'color:var(--danger-text)'),
    ('text-success', 'color:var(--success-text)'),
    ('divider-top',  'margin:var(--space-3) 0;border-top:1px solid var(--border);padding-top:var(--space-3)'),
    # layout helpers
    ('stack-1',   'margin-bottom:var(--space-1)'),
    ('stack-1-5', 'margin-bottom:var(--space-1-5)'),
    ('stack-2',   'margin-bottom:var(--space-2)'),
    ('stack-2-5', 'margin-bottom:var(--space-2-5)'),
    ('stack-3',   'margin-bottom:var(--space-3)'),
    ('stack-4',   'margin-bottom:var(--space-4)'),
    ('stack-5',   'margin-bottom:var(--space-5)'),
    ('row',         'display:flex;align-items:center;gap:var(--space-2)'),
    ('row-tight',   'display:flex;align-items:center;gap:var(--space-1-5)'),
    ('row-between', 'display:flex;align-items:center;justify-content:space-between'),
    ('grow',        'flex:1'),
    ('grow-clip',   'flex:1;min-width:0'),
])
# Step 4: variants for buttons and form fields. Applied only to those tags; a style may also be one of these
# PLUS one layout helper above (e.g. a full-width button with space below it -> "btn-block stack-2-5").
NAMED_BTN = collections.OrderedDict([
    ('btn-block', 'width:100%'),
    ('btn-grow',  'flex:1'),
    ('btn-xs',    'font-size:var(--fs-sm);padding:var(--space-1) var(--space-2-5)'),
    ('btn-md',    'font-size:var(--fs-base);padding:var(--space-2) var(--space-3)'),
    ('btn-plain', 'background:none;border:none;color:var(--muted);cursor:pointer;padding:var(--space-1)'),
    # tones of the ghost button. Declared for :hover too — inline they also beat `.btn-ghost:hover` (which turns gold).
    ('btn-ghost-gold',   'border-color:var(--gold);color:var(--gold-text)'),
    ('btn-ghost-muted',  'border-color:var(--border);color:var(--muted)'),
    ('btn-ghost-danger', 'border-color:var(--danger);color:var(--danger-text)'),
])
TONES = ['btn-ghost-gold', 'btn-ghost-muted', 'btn-ghost-danger']
# A `.btn` whose style CONTAINS one of these keeps the rest inline and gets the class for this part (exact).
EXTRACT = ['btn-xs', 'btn-md', 'btn-block', 'btn-grow'] + TONES
# --snap: near-matches of a size variant move onto it (VISIBLE: a few px). Reviewed per screen.
SNAP = {('var(--fs-sm)', 'var(--space-1) var(--space-2)'): 'btn-xs', ('var(--fs-sm)', 'var(--space-1) var(--space-3)'): 'btn-xs',
        ('var(--fs-sm)', 'var(--space-0-5) var(--space-2-5)'): 'btn-xs'}
# `.field.field-compact` — two classes, because the page's base rule is `input[type=…]` (one attribute + one tag)
# and a single class would lose to it.
NAMED_FIELD = collections.OrderedDict([
    ('field field-compact', 'width:100%;padding:var(--space-1);border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--surface);color:var(--text)'),
])
SELECTOR = {'field field-compact': '.field.field-compact'}
SELECTOR.update({t: '.%s, .%s:hover' % (t, t) for t in TONES})
LAYOUT = [k for k in NAMED if re.match(r'stack|row|grow', k)]
norm = lambda st: frozenset(re.sub(r'\s*:\s*', ':', re.sub(r'\s+', ' ', d.strip())) for d in st.split(';') if d.strip())
BY_SET = {norm(v): k for k, v in NAMED.items()}
BTN_SET = {norm(v): k for k, v in NAMED_BTN.items()}
for bk, bv in NAMED_BTN.items():
    for lk in LAYOUT:
        if lk.startswith('stack'): BTN_SET[norm(bv) | norm(NAMED[lk])] = bk + ' ' + lk
# Never map onto a class that ALREADY exists (`.btn-sm`): it carries other rules — on phones `.btn-sm` also lowers
# min-height 44 -> 34 — so an "exact" match is not exact. Only classes this tool declares itself are safe.
FIELD_SET = {norm(v): k for k, v in NAMED_FIELD.items()}
ALL_NAMED = collections.OrderedDict(list(NAMED.items()) + list(NAMED_BTN.items()) + list(NAMED_FIELD.items()))
EXISTING = set()
SKIP_TAGS = {'svg', 'path', 'option'}
def lookup(tag, st):
    if tag == 'button': return BTN_SET.get(st)
    if tag in ('input', 'select', 'textarea'): return FIELD_SET.get(st)
    return BY_SET.get(st)

SHORT = {'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'], 'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
         'border': ['border-top', 'border-width', 'border-style', 'border-color'], 'border-top': ['border-top-width', 'border-top-style', 'border-top-color', 'border-width', 'border-style', 'border-color'],
         'font': ['font-size', 'font-weight', 'line-height'], 'flex': ['flex-grow', 'flex-shrink', 'flex-basis'], 'gap': ['row-gap', 'column-gap'],
         'flex-flow': ['flex-direction', 'flex-wrap'], 'place-items': ['align-items', 'justify-items'], 'place-content': ['justify-content', 'align-content'], 'all': []}
def touches(p):
    s = {p} | set(SHORT.get(p, []))
    for k, v in SHORT.items():
        if p in v: s.add(k)
    return s | {'all'}
JS_PROP = {'color': 'color', 'fontWeight': 'font-weight', 'fontSize': 'font-size', 'display': 'display', 'margin': 'margin', 'flex': 'flex'}

src = open(ROOT + 'index.html', encoding='utf-8').read()
lines = src.split('\n')
fenced = email_lines(lines)
la = next(i for i, l in enumerate(lines) if 'id="auth-screen"' in l); lb = next(i for i in range(la + 1, len(lines)) if '<!-- ════' in lines[i])
fenced |= set(range(la, lb))

# every style rule that could compete: page <style> + design-system.css (without the helpers block itself)
ds = open(ROOT + 'design-system.css', encoding='utf-8').read()
MARK = '/* ══ Text styles and layout helpers ══'
ds_rules = ds.split(MARK)[0]
a = src.index('<style>'); b = src.index('</style>')
strip = lambda t: re.sub(r'/\*.*?\*/', '', t, flags=re.S)
ds_css = strip(ds_rules); css = ds_css + '\n' + strip(src[a + 7:b])
rules = []
for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
    in_ds = m.start() < len(ds_css)
    sel = m.group(1).strip()
    if sel.startswith('@') or sel in ('from', 'to') or re.fullmatch(r'[\d.%,\s]+', sel): continue
    props = {d.split(':', 1)[0].strip().lower() for d in m.group(2).split(';') if ':' in d}
    props = {p for p in props if not p.startswith('--')}
    for s in sel.split(','):
        if s.strip(): rules.append((s.strip(), props, in_ds))
def subject(sel): return re.split(r'\s*[>+~]\s*|\s+', sel.strip())[-1]
def spec(sel):
    s = re.sub(r'::?[\w-]+\([^)]*\)', ' :x ', sel)
    return (len(re.findall(r'#[\w-]+', s)), len(re.findall(r'\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+', s)))
def could_match(sel, tag, el_id, classes):
    sub = subject(sel)
    if '::' in sub: return False
    sub = re.sub(r':[\w-]+(\([^)]*\))?', '', sub)
    t = re.match(r'^[a-zA-Z][\w-]*', sub); i = re.search(r'#([\w-]+)', sub); cl = re.findall(r'\.([\w-]+)', sub)
    if t and t.group(0).lower() != tag: return False
    if i and i.group(1) != el_id: return False
    if cl and not i and not (set(cl) & classes): return False      # a missing class may be a state class, but ONE must be there
    return True
# A rule like `.promo-recap-row span` names the element only by tag: it can apply only INSIDE that ancestor.
# The ancestor must then be written somewhere in the element's region — the static block since the last
# `<!-- ════` banner, or the enclosing top-level JS function. If its class/id is nowhere there, it is no rival.
REGION_START = [i for i, l in enumerate(lines) if '<!-- ════' in l or re.match(r'^(async )?function \w+\(|^(const|let|var) \w+ = ', l)]
import bisect
def region_text(ln):
    k = bisect.bisect_right(REGION_START, ln) - 1
    return '\n'.join(lines[REGION_START[k] if k >= 0 else 0:ln + 1])
def ancestor_absent(sel, ln):
    parts = re.split(r'\s*[>+~]\s*|\s+', sel.strip())
    if len(parts) < 2: return False
    names = re.findall(r'[.#]([\w-]+)', ' '.join(parts[:-1]))
    reg = region_text(ln)
    # an ancestor named only by TAG (`nav button:hover`): that tag must be opened in the region
    tags = [c for c in parts[:-1] if re.fullmatch(r'[a-zA-Z][\w-]*', re.sub(r':[\w-]+(\([^)]*\))?', '', c))]
    if any(not re.search(r'<' + re.escape(re.sub(r':.*', '', t)) + r'\b', reg) for t in tags if t.lower() not in ('html', 'body', 'main')): return True
    if not names: return False
    return any(not re.search(r'(?<![\w-])' + re.escape(n) + r'(?![\w-])', reg) for n in names)
def rivals(tag, el_id, classes, props, ln, mine=(0, 1), hover_too=False):
    # The helpers sit LAST in design-system.css and the page's <style> loads after it: a stylesheet rule must
    # weigh MORE than the class to beat it, a page rule only as much.
    want = set().union(*(touches(p) for p in props)); out = []
    for sel, rp, in_ds in rules:
        sp = spec(sel)
        if sp < mine or (in_ds and sp == mine): continue
        if hover_too and in_ds and sp == (0, 2) and ':hover' in sel: continue   # our own :hover copy comes later and ties
        if rp & want and could_match(sel, tag, el_id, classes) and not ancestor_absent(sel, ln): out.append(sel)
    return out
camel = lambda p: re.sub(r'[A-Z]', lambda m: '-' + m.group(0).lower(), p)
def js_props_for(el_id):
    """CSS properties JS assigns through .style on the element with this id ('*' = cssText / setProperty / unknown)."""
    q = re.escape(el_id); out = set()
    names = set(re.findall(r'(\w+)\s*=\s*(?:document\.getElementById|\$|el|byId)\(\s*[\'"]' + q + r'[\'"]\s*\)', src))
    pats = [r'\(\s*[\'"]' + q + r'[\'"]\s*\)\??\.style\.(\w+)'] + [r'\b' + re.escape(n) + r'\??\.style\.(\w+)' for n in names]
    for pat in pats:
        for prop in re.findall(pat, src): out.add('*' if prop in ('cssText', 'setProperty') else camel(prop))
    if re.search(r'[\'"#]' + q + r'[\'"]', src) and not names and not out and re.search(r'querySelector(All)?\([^)]*#' + q, src): out.add('*')
    return out

# Code that FINDS an element by its inline style breaks the moment that style becomes a class
# (2026-09-21: demo mode hid the manual accuracy form through `div[style*="margin-bottom:…"]`).
by_style = [src.count('\n', 0, m.start()) + 1 for m in re.finditer(r'\[style[*^~$|]?=', src)]
if by_style: sys.exit('index.html selects elements by inline style at line(s) %s — give them an id or class first' % by_style)
TAG = re.compile(r'<([a-zA-Z][\w-]*)\b([^<>]*?)\sstyle="([^"\\]*)"([^<>]*?)(/?)>')
stats = collections.Counter(); kept = collections.Counter(); why = collections.defaultdict(collections.Counter); used = collections.Counter()
import scope as _scope
ADMIN_LINES = _scope.admin(lines) if SCOPE else set()
def plan(tag, st, rest):
    """-> (class names, declarations they replace, declarations that stay inline) or None"""
    full = norm(st); name = lookup(tag, full)
    if name: return name, full, frozenset()
    cm = re.search(r'\sclass="([^"]*)"', ' ' + rest)
    if tag == 'button' and not cm and '${' not in st:
        # A classless text/icon button: `.btn-plain` carries the reset plus the DEFAULT colour and padding. A button with
        # its own colour or padding keeps those inline (they still win); one with NO padding or colour would gain the
        # default, so it is left alone.
        d = {x.split(':', 1)[0]: x for x in full}
        if {'background:none', 'border:none', 'cursor:pointer'} <= full and 'padding' in d and 'color' in d:
            gone = {'background:none', 'border:none', 'cursor:pointer'} | ({d['padding'], d['color']} & norm(NAMED_BTN['btn-plain']))
            return 'btn-plain', frozenset(gone), full - gone
        return None
    if tag != 'button' or not cm or 'btn' not in cm.group(1).split() or '${' in st: return None
    names = []; gone = set()
    for k in EXTRACT:
        need = norm(NAMED_BTN[k])
        if need <= full and not (need & gone): names.append(k); gone |= need
    if DO_SNAP and not any(n in ('btn-xs', 'btn-md') for n in names):
        d = {x.split(':', 1)[0]: x.split(':', 1)[1] for x in full}
        k = SNAP.get((d.get('font-size'), d.get('padding')))
        if k: names.append(k); gone |= {'font-size:' + d['font-size'], 'padding:' + d['padding']}
    return (' '.join(names), frozenset(gone), full - gone) if names else None
def convert(m):
    pl = plan(m.group(1).lower(), m.group(3), m.group(2) + m.group(4))
    if not pl: return m.group(0)
    name, replaced, stay = pl
    ln = src.count('\n', 0, m.start())
    if SCOPE and ((ln in ADMIN_LINES) != (SCOPE == 'admin')): return m.group(0)
    if LINES and not (LINES[0] - 1 <= ln <= LINES[1] - 1): return m.group(0)
    tag = m.group(1).lower(); rest = m.group(2) + m.group(4)
    def skip(reason): kept[name] += 1; why[reason][name] += 1; return m.group(0)
    if ln in fenced: return skip('email / landing')
    if tag in SKIP_TAGS: return skip('svg')
    if '${' in rest and re.search(r'\$\{[^}]*\}\s*(?:style|class)|class="[^"]*\$\{', rest): return skip('class built at runtime')
    cm = re.search(r'\sclass="([^"]*)"', ' ' + rest)
    if cm and re.search(r"[^\w\s-]", cm.group(1)): return skip('class built at runtime')
    if re.search(r"\sclass='", ' ' + rest): return skip('class built at runtime')
    classes = set(cm.group(1).split()) if cm else set()
    im = re.search(r'\sid="([^"]*)"', ' ' + rest); el_id = im.group(1) if im else None
    props = {d.split(':')[0] for d in replaced}
    if el_id:
        jp = js_props_for(el_id) if '$' not in el_id else {'*'}
        if '*' in jp or any(touches(p) & jp for p in props): return skip('JS assigns this property on #' + ('…' if '$' in el_id else 'id'))
    tone = any(t in name.split() for t in TONES)
    if tone and 'btn-ghost' not in classes: return skip('tone needs .btn-ghost')
    r = rivals(tag, el_id, classes, props, ln, (0, 2) if name == 'field field-compact' else (0, 1), hover_too=tone)
    if r: return skip('a page rule could override the class: ' + r[0][:40])
    stats[name] += 1; used[name] += 1
    before, after = m.group(2), m.group(4)
    if stay:                                                          # keep the other declarations, in their original order
        keep = [d.strip() for d in m.group(3).split(';') if d.strip() and re.sub(r'\s*:\s*', ':', re.sub(r'\s+', ' ', d.strip())) in stay]
        after = ' style="%s;"' % ';'.join(keep) + after
    if cm:
        new_cls = ' class="%s %s"' % (cm.group(1).strip(), name)
        if re.search(r'\sclass="[^"]*"', before): before = re.sub(r'\sclass="[^"]*"', new_cls, before, 1)
        else: after = re.sub(r'\sclass="[^"]*"', new_cls, after, 1)
        return '<%s%s%s%s>' % (m.group(1), before, after, m.group(5))
    return '<%s%s class="%s"%s%s>' % (m.group(1), before, name, after, m.group(5))
out = TAG.sub(convert, src)
print('converted: %d attributes' % sum(stats.values()))
for k in sorted(set(stats) | set(kept)):
    if stats[k] or kept[k]: print('  .%-18s %4d converted  %4d stay inline' % (k, stats[k], kept[k]))
print('why some stay:')
for reason, c in sorted(why.items(), key=lambda x: -sum(x[1].values())): print('  %4d  %s' % (sum(c.values()), reason))
if not APPLY: sys.exit(0)
open(ROOT + 'index.html', 'w', encoding='utf-8').write(out)
# make sure every class in use is declared (append missing ones, in NAMED order)
block = ds.split(MARK)[1] if MARK in ds else ''
have = {c for sel in re.findall(r'^([^{}\n]+)\{', block, flags=re.M) for c in re.findall(r'\.([\w-]+)', sel)}   # every class any selector names
in_use = {c for m in re.finditer(r'class="([^"]*)"', out) for c in m.group(1).split()}
need = [k for k in ALL_NAMED if set(k.split()) <= in_use and k.split()[-1] not in have and k not in EXISTING]
if need:
    if MARK not in ds:
        ds = ds.rstrip('\n') + ('\n\n' + MARK + '\n   One class per DECISION ("muted body copy", "space below a block"), replacing inline style="…" copies of it.\n'
             '   A class weighs less than the inline style it replaces: scripts/design-system/name_styles.py only converts an\n'
             '   element when no other rule could override the class. Change a decision here and it changes everywhere. */\n')
    ds = ds.rstrip('\n') + '\n' + ''.join('%s { %s; }\n' % (SELECTOR.get(k, '.' + k), ALL_NAMED[k].replace(':', ': ').replace(';', '; ')) for k in need)
    open(ROOT + 'design-system.css', 'w', encoding='utf-8').write(ds)
print('applied; classes added to design-system.css: %s' % (', '.join(need) or 'none'))
