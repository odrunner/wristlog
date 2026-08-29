#!/usr/bin/env python3
"""Run the LLM family write-up (identify-watch mode:model) for curated watch
models that have no enrichment yet. Auth = the x-campaign-secret the pg_cron
jobs already use (read from cron.job). Sequential; ~30-60 s per model.
Usage: python3 scripts/enrich-models.py [--all] [--only "Rolex Submariner"] [--limit N]"""
import json, re, subprocess, sys, time, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FN = 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/identify-watch'
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 999
REDO = '--all' in sys.argv

def db(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql], cwd=ROOT, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-500:])
    t = r.stdout
    return json.loads(t[t.index('['):t.rindex(']') + 1]) if '"rows"' in t else []

cmd = db("select command from cron.job where jobname = 'send-measure-reminders-hourly';")[0]['command']
secret = re.search(r"'x-campaign-secret'\s*,\s*'([^']+)'", cmd).group(1)
where = "not is_auto and merged_into is null" + ("" if REDO else " and enriched_at is null")
rows = db(f"select id, brand, name from watch_models where {where} order by brand, name;")
if ONLY: rows = [r for r in rows if f"{r['brand']} {r['name']}" == ONLY]
rows = rows[:LIMIT]
ok = fail = 0
for i, m in enumerate(rows, 1):
    label = f"{m['brand']} {m['name']}"
    t0 = time.time()
    try:
        req = urllib.request.Request(FN, data=json.dumps({'mode': 'model', 'modelId': m['id']}).encode(),
                                     headers={'Content-Type': 'application/json', 'x-campaign-secret': secret}, method='POST')
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read())
        if out.get('_stored'):
            ok += 1; print(f"  ✓ [{i}/{len(rows)}] {label} — {len(out.get('refs_by_era') or [])} refs, {len(out.get('calibers_by_era') or [])} calibers ({time.time()-t0:.0f}s)")
        else:
            fail += 1; print(f"  ! [{i}/{len(rows)}] {label} — not stored: {str(out)[:160]}")
    except Exception as e:
        body = getattr(e, 'read', lambda: b'')()
        fail += 1; print(f"  ! [{i}/{len(rows)}] {label} — {e} {body[:160] if body else ''}")
    time.sleep(2)
print(f"\ndone: {ok} enriched, {fail} failed")
