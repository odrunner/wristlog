#!/usr/bin/env python3
"""Hand-typed button sizes -> the named ones. .btn (10/16) · .btn-md (8/12) · .btn-sm (6/12) · .btn-xs (4/10),
each with its own font size. The button's vertical padding picks the step; the font comes with it.
Buttons inside a container that styles its buttons by context keep what they have (a class would lose to it).
  button_sizes_pass.py [--apply]
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv
MARK = '/* ── Generated: roles and single-purpose classes ── */'
CTX = re.compile(r'promo-slot-actions|save-bar|wl-actions|wpm-actions|notif-follow-actions|landing-auth|login-prompt-modal|wishlist-modal')
PX = {'0': 0, 'var(--space-0-5)': 2, 'var(--space-1)': 4, 'var(--space-1-5)': 6, 'var(--space-2)': 8,
      'var(--space-2-5)': 10, 'var(--space-3)': 12, 'var(--space-3-5)': 14, 'var(--space-4)': 16}
gen = open(ROOT + 'design-system.css', encoding='utf-8').read().split(MARK)[1]
rules = {m.group(1): [d.strip() for d in m.group(2).split(';') if d.strip()]
         for m in re.finditer(r'^\.([\w-]+)(?:\.[\w-]+)*\s*\{([^}]*)\}', gen, re.M)}
SIZE_PROPS = ('padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'font-size')
L = open(ROOT + 'index.html', encoding='utf-8').read().split('\n')
moves = collections.Counter(); who = collections.defaultdict(list)
for i, l in enumerate(L):
    def fix(m):
        tag = m.group(0)
        cm = re.search(r'class=(\\?["\'])([^"\']*)\1', tag)
        if not cm or 'btn' not in cm.group(2).split(): return tag
        if any(CTX.search(L[k]) for k in range(max(0, i - 6), min(len(L), i + 2))): return tag
        classes = cm.group(2).split()
        owned = [c for c in classes if any(d.split(':')[0].strip() in SIZE_PROPS for d in rules.get(c, []))]
        if not owned: return tag
        vert = next((d.split(':', 1)[1].strip() for c in owned for d in rules.get(c, []) if d.startswith('padding-top')), None)
        if vert is None or vert not in PX: return tag
        v = PX[vert]
        small = any(c in classes for c in ('btn-sm', 'btn-xs'))             # already a small button
        # .btn-sm lowers min-height 44 -> 32 on phones (tap targets, audit U4), so a full-size button never
        # becomes one: it goes to .btn-md (8/12), which keeps 44.
        target = ('btn-xs' if v <= 4 else 'btn-sm') if small else ('btn-md' if v <= 8 else 'btn')
        classes = [c for c in classes if c not in owned and c not in ('btn-xs', 'btn-sm', 'btn-md')]
        if target != 'btn': classes.insert(classes.index('btn') + 1, target)
        moves['%s -> %s' % (vert, target)] += 1
        idm = re.search(r'id=\\?["\']([^"\']+)', tag) or re.search(r'onclick=\\?["\']([^"\'(]+)', tag)
        who[target].append(idm.group(1) if idm else '?')
        return tag.replace(cm.group(0), cm.group(0).replace(cm.group(2), ' '.join(classes)))
    L[i] = re.sub(r'<button\b[^<>]*>', fix, l)
print('buttons resized:', sum(moves.values())); [print('  %3d  %s' % (n, k)) for k, n in moves.most_common()]
for t, ids in who.items(): print('  %s: %s' % (t, ', '.join(ids[:6])))
if APPLY: open(ROOT + 'index.html', 'w', encoding='utf-8').write('\n'.join(L)); print('applied')
