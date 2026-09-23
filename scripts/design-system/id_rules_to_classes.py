#!/usr/bin/env python3
"""CSS that styles by id -> the same rule on a class. An id outranks every class, so an id rule forces any
element it touches to keep its inline styles. The id stays (JS uses it); the element also gets a class of the
same name, and the rule selects that class.
  id_rules_to_classes.py [--apply]
"""
import re, sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..') + '/'
APPLY = '--apply' in sys.argv
DESIGN = re.compile(r'(color|background|font|padding|margin|border|gap|width|height|line-height|letter-spacing|opacity|box-shadow|text-align|radius|flex|grid|align|justify)')
def css_of(f, text):
    return [(m.start(1), m.end(1)) for m in re.finditer(r'<style[^>]*>([\s\S]*?)</style>', text)] if not f.endswith('.css') else [(0, len(text))]
ids = collections.Counter(); files = {}
for f in ('design-system.css', 'index.html'):
    text = open(ROOT + f, encoding='utf-8').read(); files[f] = text
    for a, b in css_of(f, text):
        block = re.sub(r'/\*[\s\S]*?\*/', lambda m: ' ' * len(m.group(0)), text[a:b])
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', block):
            sel = m.group(1).strip()
            if '#' not in sel or sel.startswith('@'): continue
            if not any(DESIGN.search(d.split(':')[0]) for d in m.group(2).split(';') if ':' in d): continue
            for i in re.findall(r'#([\w-]+)', sel): ids[i] += 1
TARGET = sorted(ids)
print('ids styled by CSS:', len(TARGET), TARGET)
changed = {}
for f, text in files.items():
    out = []; last = 0
    for a, b in css_of(f, text):
        block = text[a:b]
        for i in TARGET: block = re.sub(r'#%s\b(?![\w-])' % re.escape(i), '.%s' % i, block)
        out.append(text[last:a]); out.append(block); last = b
    out.append(text[last:]); changed[f] = ''.join(out)
# every element that has one of those ids also gets it as a class
html = changed['index.html']
added = collections.Counter()
def add_class(m):
    tag, idv = m.group(0), m.group(2)
    if idv not in TARGET: return tag
    cm = re.search(r'class=(\\?["\'])([^"\']*)\1', tag)
    if cm:
        if idv in cm.group(2).split(): return tag
        added[idv] += 1
        return tag.replace(cm.group(0), cm.group(0).replace(cm.group(2), (cm.group(2) + ' ' + idv).strip()))
    added[idv] += 1
    q = m.group(1)
    return tag.replace(m.group(0)[m.group(0).index('id=' + q):][:len('id=') + len(idv) + 2 * len(q)],
                       'id=%s%s%s class=%s%s%s' % (q, idv, q, q, idv, q))
html = re.sub(r'<[a-zA-Z][^<>]*\bid=(\\?["\'])([\w-]+)\1[^<>]*>', add_class, html)
changed['index.html'] = html
print('classes added to elements:', sum(added.values()), dict(added))
if APPLY:
    for f, t in changed.items(): open(ROOT + f, 'w', encoding='utf-8').write(t)
    print('applied')
