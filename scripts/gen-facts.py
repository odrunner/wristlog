#!/usr/bin/env python3
"""Top up the fun-fact pool for curated watch models to TARGET facts each,
via identify-watch mode:facts with the cron secret (see enrich-models.py).
Usage: python3 scripts/gen-facts.py [--target 4] [--only "Rolex Submariner"]"""
import json, re, subprocess, sys, time, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
FN = 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/identify-watch'
TARGET = int(sys.argv[sys.argv.index('--target') + 1]) if '--target' in sys.argv else 4
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None

def db(sql):
    r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql], cwd=ROOT, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-500:])
    t = r.stdout
    return json.loads(t[t.index('['):t.rindex(']') + 1]) if '"rows"' in t else []

cmd = db("select command from cron.job where jobname = 'send-measure-reminders-hourly';")[0]['command']
secret = re.search(r"'x-campaign-secret'\s*,\s*'([^']+)'", cmd).group(1)
rows = db(f"""select m.id, m.brand, m.name, (select count(*) from watch_facts f where f.model_key = m.facts_key) n
              from watch_models m where not m.is_auto and m.merged_into is null and m.facts_key is not null
              order by m.brand, m.name;""")
if ONLY: rows = [r for r in rows if f"{r['brand']} {r['name']}" == ONLY]
made = fail = 0
for m in rows:
    need = TARGET - int(m['n'])
    for k in range(max(0, need)):
        label = f"{m['brand']} {m['name']}"
        try:
            req = urllib.request.Request(FN, data=json.dumps({'mode': 'facts', 'modelId': m['id']}).encode(),
                                         headers={'Content-Type': 'application/json', 'x-campaign-secret': secret}, method='POST')
            with urllib.request.urlopen(req, timeout=120) as r:
                out = json.loads(r.read())
            if out.get('fact_id'):
                made += 1; print(f"  ✓ {label} +{k + 1}/{need}: {out['fact'][:80]}…")
            else:
                fail += 1; print(f"  ! {label}: not stored {str(out)[:120]}"); break
        except Exception as e:
            fail += 1; print(f"  ! {label}: {e}"); break
        time.sleep(1.5)
print(f"\ndone: {made} facts added, {fail} failures")
