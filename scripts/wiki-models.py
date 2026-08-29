#!/usr/bin/env python3
"""Wikipedia/Commons pass for curated watch models.
For each curated watch_models row: find the family's Wikipedia article, store
the article URL + lead extract (LLM grounding), and — only when the lead image
is CC/public-domain — set hero_image + hero_credit (never overwrites a hero an
admin set manually). Idempotent. Usage: python3 scripts/wiki-models.py [--dry-run] [--only "Rolex Submariner"]"""
import json, re, subprocess, sys, time, urllib.parse, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {'User-Agent': 'WRotate/1.0 (https://wrotate.com; ozgurdogan@gmail.com)'}
DRY = '--dry-run' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None

def db(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql], cwd=ROOT, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-500:])
    t = r.stdout
    return json.loads(t[t.index('['):t.rindex(']') + 1]) if '"rows"' in t else []

def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15).read())

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

BAD_TITLE = re.compile(r'\((film|novel|song|album|band|disambiguation)\)|^List of', re.I)

def summary(title):
    try:
        s = get('https://en.wikipedia.org/api/rest_v1/page/summary/' + urllib.parse.quote(title.replace(' ', '_')))
        return s if s.get('type') == 'standard' else None
    except Exception:
        return None

def is_watch_page(s):
    blob = (s.get('description', '') + ' ' + s.get('extract', '')).lower()
    return 'watch' in blob or 'wristwatch' in blob or 'chronograph' in blob or 'timepiece' in blob

def find_article(brand, name):
    """Direct title candidates first (exact, hyphen→space), then a search whose
    title must START with the brand and mention the model's first word."""
    cands = [f'{brand} {name}', f'{brand} {name}'.replace('-', ' '), f'{brand} {name.split()[0]}']
    seen = set()
    for c in cands:
        if c in seen: continue
        seen.add(c)
        s = summary(c)
        if s and not BAD_TITLE.search(s['title']) and is_watch_page(s):
            return s['title']
    r = get('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch='
            + urllib.parse.quote(f'{brand} {name} watch'))
    bl, first = brand.lower(), name.lower().split()[0]
    for hit in r['query']['search']:
        t = hit['title']; tl = t.lower()
        if tl.startswith(bl) and first in tl and not BAD_TITLE.search(t):
            s = summary(t)
            if s and is_watch_page(s):
                return t
    return None

def commons_license(file_title):
    """extmetadata for the article's lead image: (license short name, artist, ok-to-use)."""
    r = get('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles='
            + urllib.parse.quote(file_title))
    pages = r.get('query', {}).get('pages', {})
    for p in pages.values():
        md = (p.get('imageinfo') or [{}])[0].get('extmetadata', {})
        lic = md.get('LicenseShortName', {}).get('value', '')
        artist = re.sub(r'<[^>]+>', '', md.get('Artist', {}).get('value', '')).strip()
        ok = bool(re.match(r'^(CC|Public domain|CC0)', lic, re.I)) and 'NC' not in lic and 'ND' not in lic
        return lic, artist, ok
    return '', '', False

rows = db("select id, brand, name, hero_image, wiki_url from watch_models where not is_auto and merged_into is null order by brand, name;")
if ONLY: rows = [r for r in rows if f"{r['brand']} {r['name']}" == ONLY]
found = imgs = 0
for m in rows:
    label = f"{m['brand']} {m['name']}"
    try:
        title = find_article(m['brand'], m['name'])
        if not title:
            print(f"  – {label}: no article")
            if not DRY and m['wiki_url']:
                db(f"update watch_models set wiki_url = null, wiki_extract = null where id = '{m['id']}';")
            continue
        s = get('https://en.wikipedia.org/api/rest_v1/page/summary/' + urllib.parse.quote(title.replace(' ', '_')))
        if s.get('type') != 'standard':
            print(f"  – {label}: '{title}' not a standard page"); continue
        extract = s.get('extract', '').strip()
        url = s.get('content_urls', {}).get('desktop', {}).get('page', '')
        found += 1
        sets = [f"wiki_url = {q(url)}", f"wiki_extract = {q(extract[:1500])}"]
        note = ''
        if not m['hero_image'] and s.get('originalimage'):
            img = s['originalimage']['source'].split('?')[0]  # REST adds utm_ query params
            fname = 'File:' + urllib.parse.unquote(img.rsplit('/', 1)[-1])
            lic, artist, ok = commons_license(fname)
            if ok:
                credit = f"Photo: {artist or 'Wikimedia Commons'} · {lic} (Wikimedia Commons)"
                sets += [f"hero_image = {q(img)}", f"hero_credit = {q(credit)}"]
                imgs += 1; note = f" · hero ({lic})"
            else:
                note = f" · image skipped ({lic or 'no license'})"
        print(f"  ✓ {label} → {title}{note}")
        if not DRY:
            db(f"update watch_models set {', '.join(sets)} where id = '{m['id']}';")
        time.sleep(0.2)
    except Exception as e:
        print(f"  ! {label}: {e}")
print(f"\n{len(rows)} curated · {found} articles · {imgs} licensed hero images{' (dry run)' if DRY else ''}")
