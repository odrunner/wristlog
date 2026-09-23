#!/usr/bin/env python3
"""Ingredient classes -> roles. Names come from the app where it already has one (.row, .row-tight, .row-between);
a new name is only invented when the existing class means something else (.text-danger is colour only).

Ingredient classes -> roles. An element that says "grey text at the small size" says it as .text-meta, so
restyling every piece of secondary text is one edit. A role is defined as exactly the declarations it replaces,
so nothing moves. Unused single-purpose classes are pruned afterwards.
  roles_pass.py [--apply]
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv
MARK = '/* ── Generated: roles and single-purpose classes ── */'
FILES = ['index.html', 'model-page.js', 'p/index.html', 'profile/index.html', 'w/index.html', 'open.html']
ROLES = {                                                                      # role -> the declarations it stands for
  'text-meta':        ['color: var(--muted)', 'font-size: var(--fs-sm)'],
  'text-secondary':   ['color: var(--muted)', 'font-size: var(--fs-base)'],
  'text-caption':     ['color: var(--muted)', 'font-size: var(--fs-xs)'],
  'text-caption-xs':  ['color: var(--muted)', 'font-size: var(--fs-2xs)'],
  'text-body':        ['color: var(--muted)', 'font-size: var(--fs-base)', 'line-height: var(--lh-body)'],
  'text-body-lg':     ['color: var(--muted)', 'font-size: var(--fs-md)', 'line-height: var(--lh-body)'],
  'text-default':     ['color: var(--text)', 'font-size: var(--fs-base)'],
  'text-alert':       ['color: var(--danger-text)', 'font-size: var(--fs-base)'],   # .text-danger already exists (colour only)
  'row':              ['display: flex', 'align-items: center', 'gap: var(--space-2)'],
  'row-tight':        ['display: flex', 'align-items: center', 'gap: var(--space-1-5)'],
  'row-between':      ['display: flex', 'align-items: center', 'justify-content: space-between'],  # the app's own name
  'row-center':       ['display: flex', 'align-items: center', 'justify-content: center'],
  'row-start':        ['display: flex', 'align-items: flex-start', 'gap: var(--space-2)'],
}
css = open(ROOT + 'design-system.css', encoding='utf-8').read()
head, gen = css.split(MARK)
rules = {}
for m in re.finditer(r'^\.([\w-]+)(?:\.[\w-]+)*\s*\{([^}]*)\}', gen, re.M):
    rules[m.group(1)] = [d.strip() for d in m.group(2).split(';') if d.strip()]
REPEAT = max(len(re.findall(r'\.', m.group(0))) for m in re.finditer(r'^(?:\.[\w-]+)+(?=\s*\{)', gen, re.M))
provider = {}                                                                  # a single-declaration class -> its declaration
for name, decls in rules.items():
    if len(decls) == 1 and name not in ROLES: provider[name] = decls[0]
order = sorted(ROLES, key=lambda r: -len(ROLES[r]))
applied = collections.Counter(); files_out = {}
for f in FILES:
    src = open(ROOT + f, encoding='utf-8').read()
    def fix(m):
        q, raw = m.group(1), m.group(2)
        classes = raw.split()
        if not any(c in provider or c in ROLES for c in classes): return m.group(0)
        for role in order:
            want = ROLES[role]
            have = {}
            for c in classes:
                d = provider.get(c)
                if d in want and d not in have: have[d] = c
            if len(have) != len(want) or role in classes: continue
            classes = [c for c in classes if c not in have.values()]
            classes.insert(0, role); applied[role] += 1
        new = ' '.join(classes)
        return m.group(0) if new == raw else 'class=%s%s%s' % (q, new, q)
    out = re.sub(r'class=(\\?["\'])([^"\'<>]*)\1', fix, src)
    if out != src: files_out[f] = out
print('roles applied:', dict(applied.most_common()), '=', sum(applied.values()), 'elements')
if APPLY:
    for f, t in files_out.items(): open(ROOT + f, 'w', encoding='utf-8').write(t)
    body = '\n'.join(open(ROOT + f, encoding='utf-8').read() for f in FILES)
    used = set(re.findall(r'[\w-]+', ' '.join(re.findall(r'class=\\?["\']([^"\'<>]*)["\']', body))))
    for r, d in ROLES.items(): rules[r] = d
    keep = {n: d for n, d in rules.items() if n in used}
    dropped = sorted(set(rules) - set(keep))
    block = [MARK,
             "/* Written by scripts/design-system/inline_to_classes.py + roles_pass.py. The name repeats so a class",
             "   lands with the weight the inline style it replaced had, while still yielding to !important.",
             "   Roles first: change one to restyle every place that uses it. */"]
    for name in sorted(keep, key=lambda n: (0 if n in ROLES else 1, n)):
        block.append('%s { %s }' % (('.%s' % name) * REPEAT, '; '.join(keep[name]) + ';'))
    open(ROOT + 'design-system.css', 'w', encoding='utf-8').write(head.rstrip() + '\n\n' + '\n'.join(block) + '\n')
    print('classes: %d kept, %d pruned' % (len(keep), len(dropped)))
    print('applied')
