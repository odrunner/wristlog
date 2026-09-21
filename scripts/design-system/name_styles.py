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
norm = lambda st: frozenset(re.sub(r'\s*:\s*', ':', re.sub(r'\s+', ' ', d.strip())) for d in st.split(';') if d.strip())
BY_SET = {norm(v): k for k, v in NAMED.items()}
SKIP_TAGS = {'button', 'input', 'select', 'textarea', 'svg', 'path', 'option'}

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
css = re.sub(r'/\*.*?\*/', '', ds_rules + '\n' + src[a + 7:b], flags=re.S)
rules = []
for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
    sel = m.group(1).strip()
    if sel.startswith('@') or sel in ('from', 'to') or re.fullmatch(r'[\d.%,\s]+', sel): continue
    props = {d.split(':', 1)[0].strip().lower() for d in m.group(2).split(';') if ':' in d}
    props = {p for p in props if not p.startswith('--')}
    for s in sel.split(','):
        if s.strip(): rules.append((s.strip(), props))
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
    if len(parts) < 2 or re.search(r'[.#\[]', re.sub(r':[\w-]+(\([^)]*\))?', '', parts[-1])): return False
    names = re.findall(r'[.#]([\w-]+)', ' '.join(parts[:-1]))
    if not names: return False
    reg = region_text(ln)
    return any(not re.search(r'(?<![\w-])' + re.escape(n) + r'(?![\w-])', reg) for n in names)
def rivals(tag, el_id, classes, props, ln):
    want = set().union(*(touches(p) for p in props)); out = []
    for sel, rp in rules:
        if spec(sel) < (0, 1): continue                              # a bare tag rule loses to any class
        if rp & want and could_match(sel, tag, el_id, classes) and not ancestor_absent(sel, ln): out.append(sel)
    return out
js_assigned = {JS_PROP[m] for m in re.findall(r'\.style\.([a-zA-Z]+)\s*=[^=]', src) if m in JS_PROP}

TAG = re.compile(r'<([a-zA-Z][\w-]*)\b([^<>]*?)\sstyle="([^"\\]*)"([^<>]*?)(/?)>')
stats = collections.Counter(); kept = collections.Counter(); why = collections.defaultdict(collections.Counter); used = collections.Counter()
def convert(m):
    name = BY_SET.get(norm(m.group(3)))
    if not name: return m.group(0)
    ln = src.count('\n', 0, m.start())
    if LINES and not (LINES[0] - 1 <= ln <= LINES[1] - 1): return m.group(0)
    tag = m.group(1).lower(); rest = m.group(2) + m.group(4)
    def skip(reason): kept[name] += 1; why[reason][name] += 1; return m.group(0)
    if ln in fenced: return skip('email / landing')
    if tag in SKIP_TAGS: return skip('button or field (step 4)')
    if '${' in rest and re.search(r'\$\{[^}]*\}\s*(?:style|class)|class="[^"]*\$\{', rest): return skip('class built at runtime')
    cm = re.search(r'\sclass="([^"]*)"', ' ' + rest)
    if cm and re.search(r"[^\w\s-]", cm.group(1)): return skip('class built at runtime')
    if re.search(r"\sclass='", ' ' + rest): return skip('class built at runtime')
    classes = set(cm.group(1).split()) if cm else set()
    im = re.search(r'\sid="([^"]*)"', ' ' + rest); el_id = im.group(1) if im else None
    props = {d.split(':')[0] for d in norm(m.group(3))}
    if el_id and (props & js_assigned or '$' in el_id): return skip('has an id and JS assigns this property')
    r = rivals(tag, el_id, classes, props, ln)
    if r: return skip('a page rule could override the class: ' + r[0][:40])
    stats[name] += 1; used[name] += 1
    before, after = m.group(2), m.group(4)
    if cm:
        new_cls = ' class="%s %s"' % (cm.group(1).strip(), name)
        if re.search(r'\sclass="[^"]*"', before): before = re.sub(r'\sclass="[^"]*"', new_cls, before, 1)
        else: after = re.sub(r'\sclass="[^"]*"', new_cls, after, 1)
        return '<%s%s%s%s>' % (m.group(1), before, after, m.group(5))
    return '<%s%s class="%s"%s%s>' % (m.group(1), before, name, after, m.group(5))
out = TAG.sub(convert, src)
print('converted: %d attributes' % sum(stats.values()))
for k in NAMED:
    if stats[k] or kept[k]: print('  .%-18s %4d converted  %4d stay inline' % (k, stats[k], kept[k]))
print('why some stay:')
for reason, c in sorted(why.items(), key=lambda x: -sum(x[1].values())): print('  %4d  %s' % (sum(c.values()), reason))
if not APPLY: sys.exit(0)
open(ROOT + 'index.html', 'w', encoding='utf-8').write(out)
# make sure every class in use is declared (append missing ones, in NAMED order)
block = ds.split(MARK)[1] if MARK in ds else ''
have = set(re.findall(r'^\.([\w-]+) \{', block, flags=re.M))
in_use = {c for m in re.finditer(r'class="([^"]*)"', out) for c in m.group(1).split()}
need = [k for k in NAMED if k in in_use and k not in have]
if need:
    if MARK not in ds:
        ds = ds.rstrip('\n') + ('\n\n' + MARK + '\n   One class per DECISION ("muted body copy", "space below a block"), replacing inline style="…" copies of it.\n'
             '   A class weighs less than the inline style it replaces: scripts/design-system/name_styles.py only converts an\n'
             '   element when no other rule could override the class. Change a decision here and it changes everywhere. */\n')
    ds = ds.rstrip('\n') + '\n' + ''.join('.%s { %s; }\n' % (k, NAMED[k].replace(':', ': ').replace(';', '; ')) for k in need)
    open(ROOT + 'design-system.css', 'w', encoding='utf-8').write(ds)
print('applied; classes added to design-system.css: %s' % (', '.join(need) or 'none'))
