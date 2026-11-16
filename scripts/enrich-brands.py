#!/usr/bin/env python3
"""Write the brand-page story (identify-watch mode:brand) for brand_pages rows that
have none yet: description, history, founded, country. Auth = the x-campaign-secret
from ~/.config/wrotate/supabase.env, same as enrich-models.py. Sequential, ~30-60 s each.
After a run: node scripts/gen-sitemap.mjs (writes the /b/<slug>/ pages), then commit.
Usage: python3 scripts/enrich-brands.py [--all] [--only Rolex] [--limit N]"""
import json, pathlib, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
FN = 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/identify-watch'
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 999
REDO = '--all' in sys.argv

def db(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', '--read-only', sql], cwd=ROOT, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-500:])
    t = r.stdout
    return json.loads(t[t.index('{'):]).get('rows', [])

def campaign_secret():
    p = pathlib.Path.home() / '.config/wrotate/supabase.env'
    for line in p.read_text().splitlines():
        if line.startswith('CAMPAIGN_TRIGGER_SECRET='):
            return line.split('=', 1)[1].strip().strip('"')
    raise SystemExit(f'CAMPAIGN_TRIGGER_SECRET missing from {p}')

secret = campaign_secret()
rows = db("select id, brand from brand_pages" + ("" if REDO else " where history is null") + " order by brand;")
if ONLY: rows = [r for r in rows if r['brand'] == ONLY]
rows = rows[:LIMIT]
ok = fail = 0
for i, b in enumerate(rows, 1):
    t0 = time.time()
    try:
        req = urllib.request.Request(FN, data=json.dumps({'mode': 'brand', 'brandId': b['id']}).encode(),
                                     headers={'Content-Type': 'application/json', 'x-campaign-secret': secret}, method='POST')
        with urllib.request.urlopen(req, timeout=200) as r:
            out = json.loads(r.read())
        if out.get('_stored'):
            ok += 1
            print(f"  ok [{i}/{len(rows)}] {b['brand']} - {out.get('founded') or '?'}, {out.get('country') or '?'}, "
                  f"{len(out.get('history') or '')} chars ({time.time()-t0:.0f}s)")
        else:
            fail += 1; print(f"  !  [{i}/{len(rows)}] {b['brand']} - not stored: {str(out)[:160]}")
    except Exception as e:
        body = getattr(e, 'read', lambda: b'')()
        fail += 1; print(f"  !  [{i}/{len(rows)}] {b['brand']} - {e} {body[:160] if body else ''}")
    time.sleep(2)
print(f"\ndone: {ok} written, {fail} failed")
