#!/usr/bin/env python3
"""Buttons, lossless pass. For every <button> whose class uses the .btn system and that carries an inline style:
  (a) drop inline declarations that restate what its classes already give (same property, same value)
  (b) replace an inline padding + font-size pair that equals a size variant (.btn-md / .btn-xs) with that class.
      .btn-sm is not offered: on phones it also lowers min-height 44 -> 32, so it would not be lossless.
Skips buttons near a container that styles its buttons by context (an inline style beats that rule; a class may not),
buttons in email HTML, and ${...} values.   buttons_pass.py [--apply]
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv
EMAIL = [('const FUNFACT_CARD_HTML', 'function renderDevFlags'), ('function imgSnippet', 'function updateBroadcastPreview'),
         ('function buildFinalBroadcastHtml', 'const BROADCAST_DRAFTS_KEY'), ('function buildCampaignEmailHtml', 'async function createCampaign')]
CONTEXT = re.compile(r'promo-slot-actions|save-bar|wl-actions|modal-actions|wpm-actions|notif-follow-actions|landing-auth|login-prompt-modal')
css = re.sub(r'/\*[\s\S]*?\*/', '', open(ROOT + 'design-system.css').read())
css = re.sub(r'@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', '', css)            # base rules only
RULES = {}                                                                      # '.btn-ghost' -> {prop: value}, in source order
for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
    for s in [x.strip() for x in sel.split(',')]:
        if re.fullmatch(r'\.btn(-[a-z]+)*', s):
            d = RULES.setdefault(s, {})
            for decl in body.split(';'):
                if ':' in decl: k, v = decl.split(':', 1); d[k.strip()] = re.sub(r'\s+', ' ', v.strip())
ORDER = [s for s in RULES]                                                      # later rules win on equal specificity
def given(classes):
    out = {}
    for s in ORDER:
        if s[1:] in classes: out.update(RULES[s])
    return out
def expand(d):                                                                  # padding shorthand -> 4 sides
    out = {}
    for k, v in d.items():
        if k == 'padding':
            p = v.split()
            if len(p) == 1: p = p * 4
            elif len(p) == 2: p = p * 2
            elif len(p) == 3: p = [p[0], p[1], p[2], p[1]]
            for side, val in zip(('top', 'right', 'bottom', 'left'), p): out['padding-' + side] = val
        else: out[k] = v
    return out
VARIANTS = {c: expand(RULES['.' + c]) for c in ('btn-md', 'btn-xs')}
L = open(ROOT + 'index.html').read().split('\n'); fence = set()
for a, b in EMAIL:
    i = next(k for k, l in enumerate(L) if l.startswith(a)); j = next(k for k in range(i + 1, len(L)) if L[k].startswith(b)); fence |= set(range(i, j))
stats = collections.Counter(); skipped = collections.Counter()
BTN = re.compile(r'<button\b[^>]*>')
for i, l in enumerate(L):
    if i in fence or '<button' not in l: continue
    def fix(m):
        tag = m.group(0)
        cm = re.search(r'class=(\\?["\'])([^"\']*)\1', tag); sm = re.search(r'style=(\\?["\'])((?:(?!\1).)*)\1', tag)
        if not cm or not sm: return tag
        classes = cm.group(2).split()
        if 'btn' not in classes: return tag
        if any(CONTEXT.search(L[k]) for k in range(max(0, i - 6), min(len(L), i + 2))): skipped['near a context rule'] += 1; return tag
        decls = [d.strip() for d in sm.group(2).split(';') if d.strip()]
        base = expand(given(classes)); keep = []
        for d in decls:
            k, v = [x.strip() for x in d.split(':', 1)]
            if '${' in d: keep.append(d); continue
            ex = expand({k: re.sub(r'\s+', ' ', v)})
            if all(base.get(kk) == vv for kk, vv in ex.items()): stats['redundant ' + k] += 1; continue
            keep.append(d)
        # (b) a padding + font-size pair equal to a size variant
        kd = {x.split(':', 1)[0].strip(): x.split(':', 1)[1].strip() for x in keep if ':' in x}
        if 'padding' in kd and 'font-size' in kd and not any(c in classes for c in ('btn-sm', 'btn-xs', 'btn-md')):
            pair = expand({'padding': kd['padding'], 'font-size': kd['font-size']})
            for c, vd in VARIANTS.items():
                if all(vd.get(k) == v for k, v in pair.items()):
                    keep = [x for x in keep if x.split(':', 1)[0].strip() not in ('padding', 'font-size')]
                    classes.append(c); stats['-> ' + c] += 1; break
        new_cls = cm.group(0).replace(cm.group(2), ' '.join(classes))
        tag2 = tag.replace(cm.group(0), new_cls)
        q = sm.group(1)
        tag2 = tag2.replace(sm.group(0), ('style=%s%s%s' % (q, ';'.join(keep) + ';', q)) if keep else '').replace('  ', ' ').replace(' >', '>')
        return tag2
    n = BTN.sub(fix, l)
    if n != l: L[i] = n; stats['buttons changed'] += 1
print(dict(stats)); print('skipped:', dict(skipped))
if APPLY: open(ROOT + 'index.html', 'w').write('\n'.join(L)); print('applied')
