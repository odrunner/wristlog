# Watch Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canonical era-spanning watch-model entities (`watch_models`) tied to every user watch, powering an in-app "Also owned by" row and a public model page.

**Architecture:** A `watch_models` table + alias table, populated by a SECURITY DEFINER resolver invoked from `BEFORE INSERT/UPDATE` triggers on `watches`/`wishlist` (zero client changes for resolution). All privacy gating lives in one `model_owners` RPC that mirrors the client showcase rules. Public page = static `w/index.html` (like `p/`, `profile/`) reading one anon-callable RPC.

**Tech Stack:** Vanilla JS (no frameworks), Supabase Postgres (SQL via `npx supabase db query --linked`), Playwright mocked E2E, vitest unit tests.

**Spec:** `docs/superpowers/specs/2026-08-23-watch-database-design.md`

## Global Constraints

- Models are **era-spanning families**; refs route, never create. Sibling lines separate (Submariner ≠ Submariner Date).
- Who-else is **count-always, names-gated** (spec §Decisions 3).
- `watch_facts.model_key` format is `lower(trim(brand)) || '|' || lower(trim(name))` (pipe-separated) — `watch_models.facts_key` must use this exact format.
- Every new export in `wrotate_test.js` needs tests hitting its branches (`npm run test:coverage`, branches ≥ 94%) — run before every push, plus `npm run test:functions`.
- Bump `sw.js` cache version (`wristlog-vNN`) on every HTML/JS/CSS change.
- New RPCs need `NOTIFY pgrst, 'reload schema';` after creation.
- Exclude `internal_accounts` from all counts/lists via `NOT EXISTS` — never hardcode UUIDs.
- Admin-only surfaces ship without asking; user-visible surfaces (Tasks 6–7) get tested locally first, and the user pushes/deploys per normal flow.
- UAT only with testuser/test2@wrotate.com; never post publicly from them.
- Friend/follower semantics (from index.html:8656/9634): *follower* = viewer follows owner (`follows` row); *friend* = follower AND an accepted `friend_requests` row in either direction.
- Watch IDs are TEXT, user IDs are uuid. `watches.watch_privacy` values: NULL (inherit), 'public', 'followers', 'friends', 'private'. `profiles.collection_visibility` values seen in prod: 'public', 'followers', 'friends', 'private' (treat unknown/'friends_only' like 'followers' for gating, matching index.html:8730).

---

### Task 1: Pure helpers — normalisation, slug, fact teaser

**Files:**
- Modify: `wrotate_test.js` (append new exports at end)
- Test: `tests/watch-models.test.js` (new)

**Interfaces:**
- Produces: `normalizeModelKey(brand, name) -> string` (space-separated canonical key, e.g. `'rolex submariner date'`), `modelSlug(brand, name) -> string` (e.g. `'rolex-submariner-date'`), `factTeaser(fact, max = 140) -> string`, `MODEL_FILLER_TOKENS` (array). Task 2's SQL `normalize_model_key` MUST produce byte-identical output to `normalizeModelKey`; Task 3's seed script and Task 7's page import these.

- [ ] **Step 1: Write the failing tests** — create `tests/watch-models.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { normalizeModelKey, modelSlug, factTeaser, MODEL_FILLER_TOKENS } from '../wrotate_test.js';

describe('normalizeModelKey', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalizeModelKey('  Rolex ', ' Submariner  Date ')).toBe('rolex submariner date');
  });
  it('strips punctuation to spaces (GMT-Master II == GMT Master II)', () => {
    expect(normalizeModelKey('Rolex', 'GMT-Master II')).toBe('rolex gmt master ii');
    expect(normalizeModelKey('Rolex', 'GMT Master II')).toBe('rolex gmt master ii');
  });
  it('drops filler tokens (Oyster Perpetual, Cosmograph)', () => {
    expect(normalizeModelKey('Rolex', 'Oyster Perpetual Datejust 41')).toBe('rolex datejust 41');
    expect(normalizeModelKey('Rolex', 'Cosmograph Daytona')).toBe('rolex daytona');
  });
  it('never strips numbers (Datejust 41 != Datejust 36)', () => {
    expect(normalizeModelKey('Rolex', 'Datejust 41')).not.toBe(normalizeModelKey('Rolex', 'Datejust 36'));
  });
  it('folds auto -> automatic, then drops automatic as filler', () => {
    expect(normalizeModelKey('Hamilton', 'Khaki Field Auto')).toBe('hamilton khaki field');
    expect(normalizeModelKey('Hamilton', 'Khaki Field Automatic')).toBe('hamilton khaki field');
    expect(normalizeModelKey('Hamilton', 'Khaki Field Mechanical')).toBe('hamilton khaki field mechanical');
  });
  it('de-dupes brand typed into the name field', () => {
    expect(normalizeModelKey('Rolex', 'Rolex Submariner')).toBe('rolex submariner');
  });
  it('keeps sibling lines separate', () => {
    expect(normalizeModelKey('Rolex', 'Submariner Date')).toBe('rolex submariner date');
    expect(normalizeModelKey('Rolex', 'Explorer II')).toBe('rolex explorer ii');
  });
  it('empty/nullish inputs -> empty string', () => {
    expect(normalizeModelKey('', 'Submariner')).toBe('');
    expect(normalizeModelKey('Rolex', '')).toBe('');
    expect(normalizeModelKey(null, undefined)).toBe('');
  });
});

describe('modelSlug', () => {
  it('is the key with dashes', () => {
    expect(modelSlug('Rolex', 'Oyster Perpetual Datejust 41')).toBe('rolex-datejust-41');
  });
  it('empty when key is empty', () => { expect(modelSlug('', '')).toBe(''); });
});

describe('factTeaser', () => {
  it('returns first sentence with ellipsis when more follows', () => {
    expect(factTeaser('It dove deep. It also flew high.')).toBe('It dove deep. …');
  });
  it('returns whole single-sentence fact unchanged', () => {
    expect(factTeaser('It dove deep.')).toBe('It dove deep.');
  });
  it('hard-caps overlong first sentences at max with ellipsis', () => {
    const long = 'A'.repeat(200) + '. More.';
    const t = factTeaser(long);
    expect(t.length).toBeLessThanOrEqual(140);
    expect(t.endsWith('…')).toBe(true);
  });
  it('handles no terminal punctuation and empty input', () => {
    expect(factTeaser('no period here')).toBe('no period here');
    expect(factTeaser('')).toBe('');
    expect(factTeaser(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- tests/watch-models.test.js`. Expected: FAIL, `normalizeModelKey` not exported.

- [ ] **Step 3: Implement** — append to `wrotate_test.js`:

```js
// ══════════════════════════════════════════
//  WATCH MODELS — canonical model keys (mirrors SQL normalize_model_key —
//  keep the two byte-identical; the SQL copy lives in sql/2026-08-23-watch-models.sql)
// ══════════════════════════════════════════

// Filler tokens dropped from names: marketing prefixes that fragment families.
// Conservative on purpose — sibling lines (Date, II, Pro) must survive. The
// alias table, not this list, handles model-specific folding.
export const MODEL_FILLER_TOKENS = ['oyster perpetual', 'cosmograph', 'co axial', 'master chronometer', 'automatic'];

function cleanToken(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeModelKey(brand, name) {
  const b = cleanToken(brand);
  let n = cleanToken(name);
  if (!b || !n) return '';
  if (n === b || n.startsWith(b + ' ')) n = n.slice(b.length).trim(); // brand typed into name
  n = (' ' + n + ' ').replace(/ auto /g, ' automatic ');
  for (const f of MODEL_FILLER_TOKENS) n = n.split(' ' + f + ' ').join(' ');
  n = n.replace(/\s+/g, ' ').trim();
  return n ? b + ' ' + n : b;
}

export function modelSlug(brand, name) {
  return normalizeModelKey(brand, name).replace(/ /g, '-');
}

// First sentence of a fun fact for the public model page — full facts are an in-app perk.
export function factTeaser(fact, max = 140) {
  const t = String(fact || '').trim();
  if (!t) return '';
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  let s = (m ? m[0] : t).trim();
  const truncated = s.length < t.length;
  if (s.length > max) return s.slice(0, max - 2).trimEnd() + ' …';
  return truncated ? s + ' …' : s;
}
```

- [ ] **Step 4: Run tests + coverage** — `npm test -- tests/watch-models.test.js` then `npm run test:coverage`. Expected: PASS, branch threshold holds. If coverage dips, add tests for the uncovered branch (do not lower thresholds).

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/watch-models.test.js
git commit -m "feat: watch-model key normalisation, slug, fact teaser helpers"
```

---

### Task 2: Schema + resolver + triggers (dark, server-side)

**Files:**
- Create: `sql/2026-08-23-watch-models.sql`

**Interfaces:**
- Consumes: JS normalisation semantics from Task 1 (must match exactly).
- Produces: tables `watch_models`, `watch_model_aliases`; `watches.model_id` / `wishlist.model_id` (uuid, nullable); functions `normalize_model_key(text,text) -> text`, `resolve_watch_model(text,text,text) -> uuid`; triggers `trg_watches_model_id`, `trg_wishlist_model_id`. Tasks 3–7 depend on all of these names.

- [ ] **Step 1: Write the SQL file** — `sql/2026-08-23-watch-models.sql`:

```sql
-- Watch database: canonical era-spanning model families.
-- Spec: docs/superpowers/specs/2026-08-23-watch-database-design.md

create table if not exists public.watch_models (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  name          text not null,
  slug          text not null unique,
  canonical_key text not null unique,
  brand_key     text not null,
  ref_prefixes  text[] not null default '{}',
  specs         jsonb not null default '{}'::jsonb,
  hero_image    text,
  facts_key     text,
  is_auto       boolean not null default true,
  merged_into   uuid references public.watch_models(id),
  created_at    timestamptz not null default now()
);

create table if not exists public.watch_model_aliases (
  alias_key text primary key,
  model_id  uuid not null references public.watch_models(id)
);

alter table public.watches  add column if not exists model_id uuid references public.watch_models(id);
alter table public.wishlist add column if not exists model_id uuid references public.watch_models(id);
create index if not exists watches_model_id_idx  on public.watches(model_id);
create index if not exists wishlist_model_id_idx on public.wishlist(model_id);

-- World-readable (the model page is anonymous); writes only via definer fns / service role.
alter table public.watch_models       enable row level security;
alter table public.watch_model_aliases enable row level security;
drop policy if exists watch_models_read on public.watch_models;
create policy watch_models_read on public.watch_models for select to anon, authenticated using (true);
drop policy if exists watch_model_aliases_read on public.watch_model_aliases;
create policy watch_model_aliases_read on public.watch_model_aliases for select to anon, authenticated using (true);

-- ── Normalisation: MUST stay byte-identical to normalizeModelKey() in wrotate_test.js ──
create or replace function public.normalize_model_key(p_brand text, p_name text)
returns text language plpgsql immutable as $$
declare
  v_b text := trim(regexp_replace(regexp_replace(lower(coalesce(p_brand,'')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_n text := trim(regexp_replace(regexp_replace(lower(coalesce(p_name,'')),  '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_f text;
begin
  if v_b = '' or v_n = '' then return ''; end if;
  if v_n = v_b or v_n like v_b || ' %' then
    v_n := trim(substr(v_n, length(v_b) + 1));
  end if;
  v_n := ' ' || v_n || ' ';
  v_n := replace(v_n, ' auto ', ' automatic ');
  foreach v_f in array array['oyster perpetual','cosmograph','co axial','master chronometer','automatic'] loop
    v_n := replace(v_n, ' ' || v_f || ' ', ' ');
  end loop;
  v_n := trim(regexp_replace(v_n, '\s+', ' ', 'g'));
  if v_n = '' then return v_b; end if;
  return v_b || ' ' || v_n;
end $$;

-- ── Resolver: alias hit → ref routing → auto-create. Never returns a tombstone. ──
create or replace function public.resolve_watch_model(p_brand text, p_name text, p_ref text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_key    text := public.normalize_model_key(p_brand, p_name);
  v_bkey   text := trim(regexp_replace(regexp_replace(lower(coalesce(p_brand,'')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));
  v_ref    text := regexp_replace(lower(coalesce(p_ref,'')), '[^a-z0-9]+', '', 'g');
  v_id     uuid;
  v_merged uuid;
  v_n      int;
begin
  if v_key = '' then return null; end if;

  select model_id into v_id from public.watch_model_aliases where alias_key = v_key;

  -- Ref routing only when the name found no home: same brand, unique prefix match.
  if v_id is null and v_ref <> '' then
    select count(distinct m.id), min(m.id::text)::uuid into v_n, v_id
      from public.watch_models m
     where m.merged_into is null and m.brand_key = v_bkey
       and exists (select 1 from unnest(m.ref_prefixes) rp where v_ref like rp || '%');
    if v_n <> 1 then v_id := null; end if;
  end if;

  if v_id is null then
    insert into public.watch_models (brand, name, slug, canonical_key, brand_key, facts_key, is_auto)
    values (trim(p_brand), trim(p_name), replace(v_key, ' ', '-'), v_key, v_bkey,
            lower(trim(p_brand)) || '|' || lower(trim(p_name)), true)
    on conflict (canonical_key) do update set canonical_key = excluded.canonical_key
    returning id into v_id;
    insert into public.watch_model_aliases (alias_key, model_id)
    values (v_key, v_id) on conflict (alias_key) do nothing;
  end if;

  -- Chase merges to the surviving row (bounded: merge chains are admin-made and short).
  loop
    select merged_into into v_merged from public.watch_models where id = v_id;
    exit when v_merged is null;
    v_id := v_merged;
  end loop;
  return v_id;
end $$;

-- ── Triggers: every insert/edit resolves, covering web adds, photo-identify, admin edits ──
create or replace function public.set_watch_model_id()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.model_id := public.resolve_watch_model(new.brand, new.name, new.ref);
  return new;
end $$;

drop trigger if exists trg_watches_model_id on public.watches;
create trigger trg_watches_model_id before insert or update of brand, name, ref
  on public.watches for each row execute function public.set_watch_model_id();
drop trigger if exists trg_wishlist_model_id on public.wishlist;
create trigger trg_wishlist_model_id before insert or update of brand, name, ref
  on public.wishlist for each row execute function public.set_watch_model_id();

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply** — `npx supabase db query --linked --file sql/2026-08-23-watch-models.sql`. Expected: success, no errors. (Remote-only migrations mean direct apply, not `db push` — per CLAUDE.md.)

- [ ] **Step 3: Verify resolver behaviour with live SQL** (read-modify-rollback, touches no real rows):

```bash
npx supabase db query --linked "
begin;
select normalize_model_key('Rolex','Oyster Perpetual Datejust 41') = 'rolex datejust 41' as norm_ok;
select resolve_watch_model('Rolex','Submariner', null) as sub1 \gset
-- same name, different punctuation → same model
select resolve_watch_model('rolex','submariner', null) = resolve_watch_model('Rolex','SUBMARINER', null) as same_ok;
-- sibling line stays separate
select resolve_watch_model('Rolex','Submariner Date', null) <> resolve_watch_model('Rolex','Submariner', null) as sibling_ok;
rollback;"
```

Expected: `norm_ok`, `same_ok`, `sibling_ok` all true. (If `\gset` is unsupported by the CLI runner, drop that line — it is illustrative; the two boolean checks are the assertions.)

- [ ] **Step 4: Verify JS/SQL parity** on the live distinct keys:

```bash
npx supabase db query --linked "select brand, name from watches group by 1,2 limit 2000;" > /private/tmp/claude-501/-Users-ozgurdogan-Documents-Claude-project-watch-tracker/06700ed0-7e28-4506-81e3-553e584f39d2/scratchpad/keys.json
node --input-type=module -e "
import { normalizeModelKey } from './wrotate_test.js';
import { readFileSync } from 'fs';
const t = readFileSync('/private/tmp/claude-501/-Users-ozgurdogan-Documents-Claude-project-watch-tracker/06700ed0-7e28-4506-81e3-553e584f39d2/scratchpad/keys.json','utf8');
const rows = JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']')+1));
console.log(JSON.stringify(rows.map(r => [r.brand, r.name, normalizeModelKey(r.brand, r.name)])));
" > /private/tmp/claude-501/-Users-ozgurdogan-Documents-Claude-project-watch-tracker/06700ed0-7e28-4506-81e3-553e584f39d2/scratchpad/js-keys.json
```

Then spot-check ≥20 rows against `select brand, name, normalize_model_key(brand, name) from watches group by 1,2 limit 2000;` — every key must match exactly. Any mismatch = fix one side until byte-identical (this parity is a Global Constraint).

- [ ] **Step 5: Commit**

```bash
git add sql/2026-08-23-watch-models.sql
git commit -m "feat: watch_models schema, resolver, triggers (dark)"
```

---

### Task 3: Curated seed + backfill

**Files:**
- Create: `scripts/watch-model-seed.json`
- Create: `scripts/apply-watch-model-seed.py`

**Interfaces:**
- Consumes: `resolve_watch_model`, `normalize_model_key` (Task 2).
- Produces: every `watches`/`wishlist` row has `model_id` set; curated models exist with aliases/ref_prefixes/specs; `facts_key` points at the dominant fact pool. Task 4's admin list and Task 5's RPC read these rows.

- [ ] **Step 1: Export the live keys to work from**

```bash
npx supabase db query --linked "
select w.brand, w.name, w.ref, count(*) n, count(distinct w.user_id) owners
from watches w
where not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
group by 1,2,3 order by owners desc, n desc;" > /private/tmp/claude-501/-Users-ozgurdogan-Documents-Claude-project-watch-tracker/06700ed0-7e28-4506-81e3-553e584f39d2/scratchpad/live-keys.json
```

- [ ] **Step 2: Author `scripts/watch-model-seed.json`.** Work through every key with `owners >= 2` (≈98 keys) plus any obvious single-owner variants of those families. Group them into curated models. The authoring rules (these implement the spec's decisions — follow them literally):
  - One entry per **family**: canonical `brand` + `name` (display casing), `aliases` = every live normalised key that belongs to it (values must be `normalizeModelKey` outputs), `ref_prefixes` = normalised (lowercase alphanumeric) reference prefixes seen in the export for that family, `specs` = family-level only (`type`, `size`, `water_resistance`, `movement` as free-text ranges), `facts` are NOT in the seed (facts stay in `watch_facts`).
  - Sibling lines separate: `Submariner` and `Submariner Date` are two entries; `Explorer` / `Explorer II`; `Seamaster` / `Seamaster Diver 300M`; `Speedmaster` / `Speedmaster Professional`.
  - Vague keys fold INTO a family only when unambiguous for that brand ("rolex gmt" → GMT-Master II; "rolex daytona" → Daytona). When genuinely ambiguous, leave the key out — it becomes its own auto model and admin merges later.
  - Never invent a model no live key points to.
  Example of the shape (real entries, to be extended):

```json
{
  "models": [
    {
      "brand": "Rolex", "name": "Submariner",
      "aliases": ["rolex submariner", "rolex submariner no date"],
      "ref_prefixes": ["5513", "5512", "14060", "114060", "124060"],
      "specs": { "type": "Dive watch", "size": "40–41mm", "water_resistance": "300m", "movement": "Various in-house calibers across eras" }
    },
    {
      "brand": "Rolex", "name": "Submariner Date",
      "aliases": ["rolex submariner date"],
      "ref_prefixes": ["1680", "16610", "16800", "116610", "126610"],
      "specs": { "type": "Dive watch", "size": "40–41mm", "water_resistance": "300m", "movement": "Various in-house calibers across eras" }
    }
  ]
}
```

- [ ] **Step 3: Write `scripts/apply-watch-model-seed.py`** — renders the JSON to SQL and pipes it through the CLI. No LLM calls, idempotent (safe to re-run after seed edits):

```python
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
       normalize_model_key({q(brand)}, ''),
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
```

- [ ] **Step 4: Dry-run, review, apply** — `python3 scripts/apply-watch-model-seed.py --dry-run | head -50` (eyeball the SQL), then run without the flag. Expected final row: `linked_watches` = `total_watches`, `watches_in_shared` ≥ 347 (the pre-project exact-key baseline — the whole point is beating it; report the number).

- [ ] **Step 5: Sanity queries** — top models by owners must look like the known list (Submariner ≈ 23+ owners):

```bash
npx supabase db query --linked "
select m.brand, m.name, m.is_auto, count(distinct w.user_id) owners
from watch_models m join watches w on w.model_id = m.id
where not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
group by 1,2,3 order by owners desc limit 15;"
```

Also verify no tombstones are referenced: `select count(*) from watches w join watch_models m on m.id = w.model_id where m.merged_into is not null;` → 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/watch-model-seed.json scripts/apply-watch-model-seed.py
git commit -m "feat: curated watch-model seed + backfill script (applied to prod)"
```

---

### Task 4: Admin "Models" tab (merge / rename / curate)

**Files:**
- Create: `sql/2026-08-23-watch-models-admin.sql`
- Modify: `index.html` (admin tab strip ~line 3623; new panel near the other `admin-tab-*` panels ~3636; JS near the other admin loaders), `sw.js` (cache bump)

**Interfaces:**
- Consumes: `watch_models`, `watch_model_aliases` (Tasks 2–3).
- Produces: RPCs `admin_watch_models()`, `admin_merge_watch_models(p_src uuid, p_dst uuid)`, `admin_update_watch_model(p_id uuid, p_name text, p_slug text, p_specs jsonb, p_hero text, p_curated boolean)`. Client fns `loadAdminModels()`, `adminMergeModels()`, `adminEditModel(id)`, `adminSaveModel(id)` (uses existing `escAttr`/`escHtml`/`toast`).

- [ ] **Step 1: Write the admin SQL** — `sql/2026-08-23-watch-models-admin.sql`. Every function starts with the repo's standard admin gate (pattern from `sql/2026-06-27-featured-post.sql:96`):

```sql
create or replace function public.admin_watch_models()
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  return coalesce((select json_agg(row_to_json(t)) from (
    select m.id, m.brand, m.name, m.slug, m.is_auto, m.specs, m.hero_image, m.ref_prefixes,
           (select count(*) from watch_model_aliases a where a.model_id = m.id) aliases,
           count(distinct w.user_id) owners, count(w.id) watches
    from watch_models m
    left join watches w on w.model_id = m.id
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
    where m.merged_into is null
    group by m.id order by owners desc, watches desc, m.brand, m.name) t), '[]'::json);
end $$;

create or replace function public.admin_merge_watch_models(p_src uuid, p_dst uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  if p_src = p_dst then raise exception 'src = dst'; end if;
  if exists (select 1 from watch_models where id = p_dst and merged_into is not null) then
    raise exception 'destination is a tombstone';
  end if;
  update watch_model_aliases set model_id = p_dst where model_id = p_src;
  update watches  set model_id = p_dst where model_id = p_src;
  update wishlist set model_id = p_dst where model_id = p_src;
  update watch_models set ref_prefixes = (
      select coalesce(array_agg(distinct rp), '{}') from (
        select unnest(ref_prefixes) rp from watch_models where id in (p_src, p_dst)) u)
    where id = p_dst;
  update watch_models d set facts_key = s.facts_key
    from watch_models s where d.id = p_dst and s.id = p_src and d.facts_key is null;
  update watch_models set merged_into = p_dst where id = p_src;
end $$;

create or replace function public.admin_update_watch_model(
  p_id uuid, p_name text default null, p_slug text default null,
  p_specs jsonb default null, p_hero text default null, p_curated boolean default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'forbidden';
  end if;
  update watch_models set
    name       = coalesce(p_name, name),
    slug       = coalesce(p_slug, slug),
    specs      = coalesce(p_specs, specs),
    hero_image = coalesce(p_hero, hero_image),
    is_auto    = coalesce(not p_curated, is_auto)
  where id = p_id;
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply + smoke the gate** — apply with `--file`; then verify the gate rejects non-admins:

```bash
npx supabase db query --linked "select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where username = 'testuser'), 'role', 'authenticated')::text, true); select admin_watch_models();"
```

Expected: `forbidden` error. Then as the admin user's UUID: returns JSON array with Submariner near the top.

- [ ] **Step 3: Add the admin UI** in `index.html`. (a) Tab chip after the `dev` chip at ~3632: `<button type="button" class="chip" data-tab="models" role="tab" aria-selected="false" aria-controls="admin-tab-models" onclick="switchAdminTab('models')">Models</button>`. (b) Panel div alongside the others: 

```html
<div id="admin-tab-models" class="admin-tab" role="tabpanel" style="display:none;">
  <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap;">
    <input id="adm-merge-src" placeholder="merge: src slug" style="flex:1;min-width:130px;">
    <input id="adm-merge-dst" placeholder="into: dst slug" style="flex:1;min-width:130px;">
    <button class="chip" onclick="adminMergeModels()">Merge</button>
    <label style="font-size:.75rem;color:var(--muted);"><input type="checkbox" id="adm-models-auto-only" onchange="loadAdminModels()"> auto only</label>
  </div>
  <div id="admin-models-list" style="font-size:.8rem;">Loading…</div>
</div>
```

(c) JS beside the other admin loaders — `switchAdminTab` lazy-loads per tab; wire `models` the same way the `traffic` tab is wired (find `switchAdminTab` and add a `models` branch calling `loadAdminModels()`):

```js
let _adminModels = [];
async function loadAdminModels() {
  const el = document.getElementById('admin-models-list');
  const { data, error } = await db.rpc('admin_watch_models');
  if (error) { el.textContent = 'Failed: ' + error.message; return; }
  _adminModels = data || [];
  const autoOnly = document.getElementById('adm-models-auto-only').checked;
  const rows = _adminModels.filter(m => !autoOnly || m.is_auto);
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <tr style="color:var(--muted);text-align:left;"><th>Model</th><th>Slug</th><th>Own</th><th>W</th><th></th></tr>` +
    rows.map(m => `<tr style="border-top:0.5px solid var(--border);">
      <td>${escHtml(m.brand)} ${escHtml(m.name)}${m.is_auto ? ' <span style="color:var(--muted);">(auto)</span>' : ''}</td>
      <td style="color:var(--muted);">${escHtml(m.slug)}</td>
      <td>${m.owners}</td><td>${m.watches}</td>
      <td style="white-space:nowrap;">${m.is_auto ? `<button class="chip" onclick="adminCurateModel('${m.id}')">Curate</button>` : ''}
        <button class="chip" onclick="adminEditModel('${m.id}')">Edit</button></td>
    </tr>
    <tr id="adm-model-edit-${m.id}" style="display:none;"><td colspan="5" style="padding:.4rem 0;">
      <input id="adm-mn-${m.id}" value="${escAttr(m.name)}" placeholder="name" style="width:30%;">
      <input id="adm-ms-${m.id}" value="${escAttr(m.slug)}" placeholder="slug" style="width:30%;">
      <input id="adm-mh-${m.id}" value="${escAttr(m.hero_image || '')}" placeholder="hero image URL" style="width:26%;">
      <button class="chip" onclick="adminSaveModel('${m.id}')">Save</button>
    </td></tr>`).join('') + '</table>';
}
function adminEditModel(id) {
  const tr = document.getElementById('adm-model-edit-' + id);
  tr.style.display = tr.style.display === 'none' ? '' : 'none';
}
async function adminSaveModel(id) {
  const val = k => document.getElementById('adm-' + k + '-' + id).value.trim();
  const { error } = await db.rpc('admin_update_watch_model', {
    p_id: id, p_name: val('mn') || null, p_slug: val('ms') || null, p_hero: val('mh') || null });
  if (error) { toast('Save failed: ' + error.message, 'error'); return; }
  toast('Saved'); loadAdminModels();
}
async function adminMergeModels() {
  const src = _adminModels.find(m => m.slug === document.getElementById('adm-merge-src').value.trim());
  const dst = _adminModels.find(m => m.slug === document.getElementById('adm-merge-dst').value.trim());
  if (!src || !dst) { toast('Unknown slug', 'error'); return; }
  const { error } = await db.rpc('admin_merge_watch_models', { p_src: src.id, p_dst: dst.id });
  if (error) { toast('Merge failed: ' + error.message, 'error'); return; }
  toast(`Merged ${src.slug} → ${dst.slug}`); loadAdminModels();
}
async function adminCurateModel(id) {
  const { error } = await db.rpc('admin_update_watch_model', { p_id: id, p_curated: true });
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  loadAdminModels();
}
```

- [ ] **Step 4: Bump SW cache** — `sw.js` `wristlog-vNN` → NN+1. Run `npm test && npm run test:e2e`. Expected: all pass (no existing e2e covers the new tab; the suite guards regressions).

- [ ] **Step 5: Verify on local dev** — open http://localhost:3000 admin → Models tab: list renders, Submariner near top; merge two throwaway auto models created from test-account watches (testuser only), confirm counts fold and the tombstone drops out of the list.

- [ ] **Step 6: Commit + push** (admin-only surface — ships without asking once tests pass; run `npm run test:coverage && npm run test:functions` before push per CI gate)

```bash
git add sql/2026-08-23-watch-models-admin.sql index.html sw.js
git commit -m "admin: watch-models tab — list, merge, curate (Phase 1 complete, dark)"
git push origin main
```

---

### Task 5: `model_owners` RPC — the one privacy gate

**Files:**
- Create: `sql/2026-08-23-model-owners.sql`

**Interfaces:**
- Consumes: `watch_models`, `watches.model_id`; `follows(follower_id, following_id)`; `friend_requests(initiator_id, target_id, status)`; `profiles(collection_visibility)`; `logs(watch_id, photo_url, visibility, created_at)`.
- Produces: `model_owners(p_model_id uuid) -> json` shaped `{"total_owners": int, "era_min": text|null, "era_max": text|null, "visible": [{"user_id","username","display_name","avatar_url","photo","year"}]}`. Called by Task 6 (authed) and Task 7's `model_page` (anon). Gating semantics (Global Constraints): count everyone; name only owners whose collection+watch the viewer may see.

- [ ] **Step 1: Write the SQL** — `sql/2026-08-23-model-owners.sql`:

```sql
-- Who-else-owns-this: count-always, names-gated. Mirrors the client showcase
-- gates (index.html ~8724): collection_visibility × watch_privacy × relationship.
create or replace function public.model_owners(p_model_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_viewer uuid := auth.uid();
begin
  return (
  with owner_watches as (
    select w.id, w.user_id, w.image, w.watch_privacy, w.year_range, w.purchase_date
    from watches w
    where w.model_id = p_model_id
      and not exists (select 1 from internal_accounts ia where ia.user_id = w.user_id)
  ),
  owners as (select distinct user_id from owner_watches),
  rels as (
    select o.user_id,
      (v_viewer is not null and exists (select 1 from follows f
          where f.follower_id = v_viewer and f.following_id = o.user_id)) as is_follower
    from owners o
  ),
  rels2 as (
    select r.user_id, r.is_follower,
      (r.is_follower and exists (select 1 from friend_requests fr
          where fr.status = 'accepted'
            and ((fr.initiator_id = v_viewer and fr.target_id = r.user_id)
              or (fr.initiator_id = r.user_id and fr.target_id = v_viewer)))) as is_friend
    from rels r
  ),
  gated as (
    select r.user_id, r.is_follower, r.is_friend,
           coalesce(p.collection_visibility, 'followers') as cv,
           p.username, p.display_name, p.avatar_url
    from rels2 r join profiles p on p.id = r.user_id
    where r.user_id is distinct from v_viewer
      and not (coalesce(p.collection_visibility, 'followers') = 'private')
      and not (coalesce(p.collection_visibility, 'followers') in ('followers', 'friends_only') and not r.is_follower)
      and not (coalesce(p.collection_visibility, 'followers') = 'friends' and not r.is_friend)
  ),
  visible_watches as (
    select ow.*, g.username, g.display_name, g.avatar_url, g.is_follower, g.is_friend
    from owner_watches ow join gated g on g.user_id = ow.user_id
    where case
      when g.is_friend   then coalesce(ow.watch_privacy, 'x') <> 'private'
      when g.is_follower then ow.watch_privacy in ('public', 'followers') or ow.watch_privacy is null
      else                    ow.watch_privacy = 'public' or ow.watch_privacy is null
    end
  ),
  per_owner as (
    select vw.user_id, vw.username, vw.display_name, vw.avatar_url,
      (select coalesce(
        (select l.photo_url from logs l
          where l.watch_id in (select id from visible_watches v2 where v2.user_id = vw.user_id)
            and l.user_id = vw.user_id and l.photo_url is not null
            and case
              when vw.is_friend   then l.visibility <> 'private'
              when vw.is_follower then l.visibility in ('public', 'followers')
              else                     l.visibility = 'public'
            end
          order by l.created_at desc limit 1),
        max(vw2.image))
       from visible_watches vw2 where vw2.user_id = vw.user_id) as photo,
      min(coalesce(substring(vw.year_range from '\d{4}'), left(vw.purchase_date, 4))) as year
    from visible_watches vw
    group by vw.user_id, vw.username, vw.display_name, vw.avatar_url, vw.is_follower, vw.is_friend
  )
  select json_build_object(
    'total_owners', (select count(*) from owners),
    'era_min', (select min(coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)))
                  from owner_watches where coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)) ~ '^\d{4}$'),
    'era_max', (select max(coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)))
                  from owner_watches where coalesce(substring(year_range from '\d{4}'), left(purchase_date, 4)) ~ '^\d{4}$'),
    'visible', coalesce((select json_agg(row_to_json(po)) from per_owner po), '[]'::json)));
end $$;

grant execute on function public.model_owners(uuid) to anon;
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply** with `--file`, then run the gate matrix test. One transaction, all fixtures rolled back, using the two test accounts (mutual close friends — so also seed a synthetic stranger-owned watch):

```bash
npx supabase db query --linked "
begin;
-- fixture: one fresh model owned by testuser (public watch), testuser2 (private watch), and a stranger (default-privacy watch, public collection)
insert into watches (id, user_id, brand, name, watch_privacy)
  select 'tst-mo-1', id, 'PlanTest', 'Gate Watch', 'public' from profiles where username = 'testuser';
insert into watches (id, user_id, brand, name, watch_privacy)
  select 'tst-mo-2', id, 'PlanTest', 'Gate Watch', 'private' from profiles where username = 'testuser2';
insert into watches (id, user_id, brand, name, watch_privacy)
  select 'tst-mo-3', id, 'PlanTest', 'Gate Watch', null from profiles
  where collection_visibility = 'public'
    and not exists (select 1 from internal_accounts ia where ia.user_id = profiles.id)
    and username not in ('testuser','testuser2') limit 1;
-- anon viewer: count = 3, visible = only the public-collection stranger + testuser? testuser's own
-- collection_visibility decides — record BOTH the count and each username returned:
select set_config('request.jwt.claims', '', true);
select set_config('role', 'anon', true);
select model_owners((select model_id from watches where id = 'tst-mo-1'));
-- viewer = testuser (friend of testuser2): total 3; testuser2 NOT visible (explicit-private watch);
-- own row excluded from visible
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from profiles where username = 'testuser'), 'role', 'authenticated')::text, true);
select model_owners((select model_id from watches where id = 'tst-mo-1'));
rollback;"
```

Expected assertions (verify by reading the JSON): both calls report `total_owners: 3`; anon `visible` contains no explicitly-private watch owner and no follower-gated owner; testuser's call excludes testuser (self) and excludes testuser2 (private watch beats friendship); the stranger with public collection + null watch_privacy appears in both. If any assertion fails, fix the RPC — not the test.

- [ ] **Step 3: Check the plan gates against the client one more time** — re-read index.html:8724-8740 side by side with the `gated`/`visible_watches` CTEs. Every branch must correspond. (This is the drift the spec centralises away — get it right once.)

- [ ] **Step 4: Commit**

```bash
git add sql/2026-08-23-model-owners.sql
git commit -m "feat: model_owners RPC — count-always names-gated privacy in one place"
```

---

### Task 6: "Also owned by" row in the watch edit modal

**Files:**
- Modify: `index.html` — watches select-list (~7801), row→watch mapper (~7715), watch-modal HTML (~5063 block, after the identity strip), `openEditWatch` (~23150), What's New + Help (features only)
- Modify: `sw.js` (cache bump)
- Test: `e2e/model-owners.mock.spec.js` (new)

**Interfaces:**
- Consumes: `model_owners` RPC (Task 5) via `db.rpc('model_owners', { p_model_id })`; `viewUserProfile(userId)` (existing, index.html:14383) for avatar taps; `escHtml`, `toast`, `profileInitials` (existing helpers).
- Produces: `loadModelOwnersRow(w)` + container `#wm-also-owned` inside the modal.

- [ ] **Step 1: Write the failing e2e test** — `e2e/model-owners.mock.spec.js`, following the pattern of `e2e/fact-modal.mock.spec.js` (import `mockSupabase` from `./helpers.js`; it stubs `**/rest/v1/**` so add routes BEFORE calling it if helpers registers a catch-all — match the ordering used by `e2e/broadcast-queue-list.mock.spec.js`):

```js
import { test, expect } from '@playwright/test';
import { mockSupabase, login } from './helpers.js';

test('watch edit modal shows Also owned by row from model_owners', async ({ page }) => {
  await mockSupabase(page, {
    watches: [{ id: 'w1', brand: 'Rolex', name: 'Submariner', model_id: 'm-1', color: '#c9a84c' }],
  });
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      total_owners: 4, era_min: '1988', era_max: '2024',
      visible: [
        { user_id: 'u2', username: 'steve', display_name: 'Steve', avatar_url: null, photo: null, year: '2001' },
        { user_id: 'u3', username: 'ana', display_name: 'Ana', avatar_url: null, photo: null, year: '2024' },
      ],
    }),
  }));
  await login(page);
  await page.click('[data-nav="collection"]');
  await page.click('.card-edit-btn');                       // open edit modal for w1
  const row = page.locator('#wm-also-owned');
  await expect(row).toContainText('Also owned by 3 other members'); // 4 total minus viewer
  await row.click();
  await expect(page.locator('#wm-owners-sheet')).toContainText('Steve');
});

test('sole owner shows rare-bird copy, no sheet', async ({ page }) => {
  await mockSupabase(page, {
    watches: [{ id: 'w1', brand: 'Rolex', name: 'Submariner', model_id: 'm-1', color: '#c9a84c' }],
  });
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 1, era_min: null, era_max: null, visible: [] }),
  }));
  await login(page);
  await page.click('[data-nav="collection"]');
  await page.click('.card-edit-btn');
  await expect(page.locator('#wm-also-owned')).toContainText("You're the only one on WRotate with this one");
});
```

Adjust `mockSupabase`/`login` option names and the collection-nav selector to what `e2e/helpers.js` actually exports (read it first) — the assertions and routes above are the contract; the harness calls must match the existing helper API. If `mockSupabase` has no `watches` passthrough, register the `**/rest/v1/watches*` route explicitly after it, as `e2e/helpers.js:91` does.

- [ ] **Step 2: Run to verify failure** — `npx playwright test e2e/model-owners.mock.spec.js`. Expected: FAIL (`#wm-also-owned` not found).

- [ ] **Step 3: Implement.** (a) Add `model_id` to the collection select list at index.html:7801 (append `,model_id` inside the `.select('...')` string). (b) In the row→watch mapper at ~7715 add `modelId: r.model_id ?? null,`. Do NOT add model_id to the watch→row insert mapper (~7686) — the trigger owns it. (c) In the watch-modal HTML, directly after the `#edit-identity-strip` closing `</div>`, add:

```html
<div id="wm-also-owned" style="display:none;margin:0 0 12px;padding:9px 12px;border:0.5px solid var(--border);border-radius:8px;font-size:.8rem;cursor:pointer;" role="button" tabindex="0"></div>
<div id="wm-owners-sheet" style="display:none;margin:0 0 12px;padding:4px 0;"></div>
```

(d) JS — add next to `openEditWatch` and call `loadModelOwnersRow(w)` at the end of `openEditWatch` (also reset both divs to `display:none` at the top of `openEditWatch` and in `closeWatchModal` so stale rows never flash):

```js
async function loadModelOwnersRow(w) {
  const row = document.getElementById('wm-also-owned');
  const sheet = document.getElementById('wm-owners-sheet');
  row.style.display = 'none'; sheet.style.display = 'none'; sheet.innerHTML = '';
  if (!w.modelId || !currentUser) return;
  const { data, error } = await db.rpc('model_owners', { p_model_id: w.modelId });
  if (error || !data) return;
  const others = (data.total_owners || 0) - 1; // viewer is always one of the owners here
  if (others <= 0) {
    row.textContent = "You're the only one on WRotate with this one — rare bird.";
    row.style.cursor = 'default';
    row.style.display = '';
    return;
  }
  const vis = data.visible || [];
  const stack = vis.slice(0, 3).map(o =>
    `<span class="feed-user-avatar" style="width:22px;height:22px;font-size:.6rem;display:inline-flex;align-items:center;justify-content:center;margin-right:-6px;border:1.5px solid var(--card);">${o.avatar_url ? `<img src="${escHtml(o.avatar_url)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="">` : profileInitials(o)}</span>`).join('');
  row.innerHTML = `${stack}<span style="margin-left:${vis.length ? '12px' : '0'};">Also owned by <b>${others}</b> other member${others === 1 ? '' : 's'}${data.era_min && data.era_max && data.era_min !== data.era_max ? ` <span style="color:var(--muted);">· examples from ${escHtml(data.era_min)} to ${escHtml(data.era_max)}</span>` : ''}</span>`;
  row.style.display = '';
  row.onclick = () => {
    if (!vis.length) { toast(`${others} member${others === 1 ? '' : 's'} own this — none visible to you`); return; }
    const open = sheet.style.display !== 'none';
    sheet.style.display = open ? 'none' : '';
    if (open) return;
    sheet.innerHTML = vis.map(o => `
      <div style="display:flex;align-items:center;gap:.6rem;padding:6px 2px;cursor:pointer;" onclick="closeWatchModal();viewUserProfile('${escHtml(o.user_id)}')">
        ${o.photo ? `<img src="${escHtml(o.photo)}" style="width:34px;height:34px;border-radius:8px;object-fit:cover;" alt="">` : `<span class="feed-user-avatar" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;">${profileInitials(o)}</span>`}
        <div><div style="font-weight:500;">${escHtml(o.display_name || o.username || '')}</div>
        <div style="font-size:.7rem;color:var(--muted);">@${escHtml(o.username || '')}${o.year ? ' · ' + escHtml(o.year) : ''}</div></div>
      </div>`).join('');
  };
}
```

(Check `profileInitials`'s real signature at its definition before using — it is called as `profileInitials(n.actor)` at index.html:11228 with an object; pass the owner object.)

- [ ] **Step 4: Run the new e2e + full suites** — `npx playwright test e2e/model-owners.mock.spec.js` → PASS; then `npm test && npm run test:e2e`. Expected: all green.

- [ ] **Step 5: Bump SW cache** (`sw.js` NN+1) and add a What's New entry (features only): "See who else has your watch — open any watch in your collection to see how many members own the same model, with owners you can visit." Update the Help page section for Collection accordingly.

- [ ] **Step 6: Local UAT with both test accounts** — on http://localhost:3000: testuser opens a watch that testuser2 also owns (add matching brand/name watches on both test accounts if none exist — test-owned data only). Verify: count shown; friend's watch visible per its privacy; flipping testuser2's watch to private hides them from the sheet but not the count.

- [ ] **Step 7: Commit** (user-visible — commit, then hand to the user to deploy)

```bash
git add index.html sw.js e2e/model-owners.mock.spec.js
git commit -m "feat: Also owned by — model owners row in watch detail (Phase 2)"
```

---

### Task 7: Public model page `/w/?m=<slug>`

**Files:**
- Create: `w/index.html`
- Create: `sql/2026-08-23-model-page.sql`

**Interfaces:**
- Consumes: `model_owners` (Task 5), `watch_models`, `watch_facts`, `factTeaser` logic (Task 1 — inlined, the page has no module imports).
- Produces: `model_page(p_slug text) -> json` (anon-callable) shaped `{"model": {brand,name,slug,specs,hero_image}, "teasers": [text], "owners": <model_owners json>}`; page URL `https://wrotate.com/w/?m=rolex-submariner`.

- [ ] **Step 1: Write `model_page` RPC** — `sql/2026-08-23-model-page.sql` (needed because `watch_facts` SELECT is authenticated-only; the definer bypasses that for teasers only):

```sql
create or replace function public.model_page(p_slug text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_m public.watch_models%rowtype;
begin
  select * into v_m from watch_models where slug = p_slug and merged_into is null;
  if v_m.id is null then return null; end if;
  return json_build_object(
    'model', json_build_object('brand', v_m.brand, 'name', v_m.name, 'slug', v_m.slug,
                               'specs', v_m.specs, 'hero_image', v_m.hero_image),
    'teasers', coalesce((select json_agg(f.teaser order by f.position)
        from (select coalesce((regexp_match(fact, '^.*?[.!?](?=\s|$)'))[1], left(fact, 140)) as teaser, position
              from watch_facts where model_key = v_m.facts_key
              order by position limit 3) f), '[]'::json),
    'owners', public.model_owners(v_m.id));
end $$;

grant execute on function public.model_page(text) to anon;
notify pgrst, 'reload schema';
```

Apply with `--file`, then verify anon: `curl -s "https://api.wrotate.com/rest/v1/rpc/model_page" -X POST -H "apikey: <anon key from p/index.html>" -H "Content-Type: application/json" -d '{"p_slug":"rolex-submariner"}'` → JSON with model + 3 teaser strings. The RPC truncates to the first sentence server-side (regexp above; 140-char fallback) and the page appends the ellipsis — full fact text must never leave the server on this endpoint.

- [ ] **Step 2: Build `w/index.html`** by copying `profile/index.html`'s skeleton (same CSP meta, same `design-system.css` link, same supabase-js CDN + `createClient` block with the anon key and `https://api.wrotate.com`). Body structure:

```html
<div class="page" id="page">
  <div id="loading">Loading…</div>
  <div id="notfound" style="display:none;">This model page doesn't exist (yet).</div>
  <div id="model" style="display:none;">
    <img id="m-hero" style="max-width:180px;border-radius:12px;display:none;" alt="">
    <h1 id="m-title"></h1>
    <div id="m-specs" style="color:var(--muted);font-size:.85rem;"></div>
    <div id="m-era" style="font-size:.8rem;margin-top:.3rem;"></div>
    <div id="m-facts" style="margin-top:1rem;"></div>
    <div id="m-owners" style="margin-top:1rem;"></div>
    <a href="https://wrotate.com" class="cta">Track yours on WRotate</a>
  </div>
</div>
<script>
  const params = new URLSearchParams(location.search);
  const slug = (params.get('m') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  async function load() {
    if (!slug) return show('notfound');
    const { data, error } = await db.rpc('model_page', { p_slug: slug });
    if (error || !data) return show('notfound');
    const m = data.model, o = data.owners || { total_owners: 0, visible: [] };
    document.title = `${m.brand} ${m.name} — WRotate`;
    if (m.hero_image) { const h = document.getElementById('m-hero'); h.src = m.hero_image; h.style.display = ''; }
    document.getElementById('m-title').textContent = `${m.brand} ${m.name}`;
    document.getElementById('m-specs').textContent =
      Object.values(m.specs || {}).filter(Boolean).join(' · ');
    if (o.era_min && o.era_max) document.getElementById('m-era').textContent =
      o.era_min === o.era_max ? '' : `Members own examples from ${o.era_min} to ${o.era_max}`;
    document.getElementById('m-facts').innerHTML = (data.teasers || []).map(t =>
      `<div class="fact-teaser">💡 ${esc(t)} …</div>`).join('');
    const vis = o.visible || [];
    document.getElementById('m-owners').innerHTML =
      `<h2 style="font-size:1rem;">Owned by ${o.total_owners} member${o.total_owners === 1 ? '' : 's'}</h2>` +
      vis.map(u => `<a href="/profile/?u=${encodeURIComponent(u.username)}" class="owner-card">
         ${u.photo ? `<img src="${esc(u.photo)}" alt="">` : ''}<span>${esc(u.display_name || u.username)}</span></a>`).join('');
    show('model');
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function show(id) { for (const x of ['loading', 'notfound', 'model']) document.getElementById(x).style.display = x === id ? '' : 'none'; }
  load();
</script>
```

Style `.fact-teaser`, `.owner-card`, `.cta` inline in a `<style>` block using `design-system.css` tokens only (no token re-declaration — Global Constraint from CLAUDE.md). Add `<meta name="robots" content="index,follow">` and static OG tags (`og:title` set at runtime is fine to skip — crawlers get the generic tags; dynamic OG is out of scope per spec).

- [ ] **Step 3: Verify locally** — `http://localhost:3000/w/?m=rolex-submariner` (anon, logged out): hero/title/specs render, exactly 3 one-sentence teasers with "…", owner grid shows only public-collection owners, count shows all. Unknown slug → not-found state. Check the browser console for CSP violations (the copied CSP must allow supabase + jsdelivr only).

- [ ] **Step 4: Confirm no full facts leak** — view-source / network tab: the `model_page` response must contain only first sentences (server-truncated per Step 1).

- [ ] **Step 5: Commit** (user-visible — commit, then hand to the user to deploy; after any future email links to these pages, remember the `/open` CTA rule)

```bash
git add w/index.html sql/2026-08-23-model-page.sql
git commit -m "feat: public model page /w/?m=<slug> (Phase 3)"
```

---

## Execution notes

- Tasks 1–4 = Phase 1 (dark + admin). Task 4 ends with a push (admin-only). Tasks 6 and 7 are user-visible: local test + UAT, commit, and let the user decide when to push each.
- After each working day: Help page + What's New already handled in Task 6 (features only — the schema and admin tab do NOT get entries).
- Backlog explicitly out of scope (spec §Out of scope): stats, clubs, value caching, badges, autocomplete, wishlist counts, sitemap entries.
