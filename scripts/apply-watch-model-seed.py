#!/usr/bin/env python3
"""Apply scripts/watch-model-seed.json: upsert curated models + aliases,
re-resolve every watches/wishlist row, set facts_key, print coverage.
Idempotent. Usage: python3 scripts/apply-watch-model-seed.py [--dry-run]"""
import json, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
seed = json.loads((ROOT / 'scripts/watch-model-seed.json').read_text())

def q(s):  # SQL string literal
    return "'" + str(s).replace("'", "''") + "'"

stmts = []
for m in seed['models']:
    brand, name = m['brand'].strip(), m['name'].strip()
    refs = '{' + ','.join(m.get('ref_prefixes', [])) + '}'
    specs = json.dumps(m.get('specs', {}))
    stmts.append(f"""
insert into watch_models (brand, name, slug, canonical_key, brand_key, ref_prefixes, specs, facts_key, is_auto)
select {q(brand)}, {q(name)},
       replace(normalize_model_key({q(brand)}, {q(name)}), ' ', '-'),
       normalize_model_key({q(brand)}, {q(name)}),
       trim(regexp_replace(regexp_replace(lower({q(brand)}), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
       {q(refs)}::text[], {q(specs)}::jsonb,
       lower({q(brand)}) || '|' || lower({q(name)}), false
on conflict (canonical_key) do update
  set brand = excluded.brand, name = excluded.name, ref_prefixes = excluded.ref_prefixes,
      specs = excluded.specs, is_auto = false;""")
    for a in m.get('aliases', []):
        stmts.append(f"""
insert into watch_model_aliases (alias_key, model_id)
select {q(a)}, id from watch_models where canonical_key = normalize_model_key({q(brand)}, {q(name)})
on conflict (alias_key) do update set model_id = excluded.model_id;""")

# Re-resolve every row directly (the trigger only fires on brand/name/ref changes).
stmts.append("update watches  set model_id = resolve_watch_model(brand, name, ref);")
stmts.append("update wishlist set model_id = resolve_watch_model(brand, name, ref);")

# facts_key = the pipe-key with the most facts among each model's member watches.
stmts.append("""
update watch_models m set facts_key = sub.model_key from (
  select w.model_id, f.model_key,
         row_number() over (partition by w.model_id order by count(f.id) desc, f.model_key) rn
  from watches w
  join watch_facts f on f.model_key = lower(trim(w.brand)) || '|' || lower(trim(w.name))
  where w.model_id is not null group by w.model_id, f.model_key) sub
where sub.model_id = m.id and sub.rn = 1;""")

stmts.append("""
select (select count(*) from watch_models where merged_into is null) models,
       (select count(*) from watch_models where not is_auto) curated,
       (select count(*) from watches where model_id is not null) linked_watches,
       (select count(*) from watches) total_watches,
       (select sum(c) from (select count(*) c from watches w
          where not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
          group by model_id having count(distinct user_id) >= 2) s) watches_in_shared;""")

sql = '\n'.join(stmts)
if '--dry-run' in sys.argv:
    print(sql); sys.exit(0)
r = subprocess.run(['npx', 'supabase', 'db', 'query', '--linked', sql], cwd=ROOT, capture_output=True, text=True)
print(r.stdout); print(r.stderr, file=sys.stderr); sys.exit(r.returncode)
