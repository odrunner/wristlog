# Daily Watch Fun Fact — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a rotating, one-line trivia "fun fact" about the watch someone is wearing — fresh each new wear-day for that user, frozen onto the resulting post, tappable by any viewer.

**Architecture:** A lazy-growing, shared, capped-at-10 fact pool per watch model. Facts accumulate on demand via the existing `identify-watch` edge function (new `mode: 'facts'`, Gemini 2.5 Pro + Google Search). Two SECURITY DEFINER RPCs (`pick_watch_fact`, `commit_watch_fact`) own the per-user cursor + daily-gate + append logic; the client orchestrates pick → (generate if needed) → commit at log time. The chosen fact id is written onto `logs.fact_id`.

**Tech Stack:** Vanilla JS (single `index.html`), Supabase Postgres (RPCs via `supabase db query --linked`), Deno edge functions, Vitest (unit), Playwright (E2E), Gemini 2.5 Pro.

## Global Constraints

- Product name is **WRotate** in all user-facing copy (never "WristLog" / "wristlog" — that is only the SW cache name). (memory: product_name)
- No frameworks; vanilla JS only. No `confirm()`/`alert()` — use the existing `toast()` / inline UI. (CLAUDE.md Code Style)
- Never hardcode account UUIDs; internal accounts live in the `internal_accounts` table. (CLAUDE.md)
- Deploy RPCs with `npx supabase db query --linked` (migration push does not work — remote-only migrations). Deploy edge functions with `npx supabase functions deploy identify-watch --no-verify-jwt`, then run `npm run test:smoke`. (CLAUDE.md)
- Any Supabase table queried from client JS **must** have a SELECT policy for the user role, or it returns empty silently. Prefer SECURITY DEFINER RPCs. (CLAUDE.md)
- Bump the SW cache version (`sw.js` → next `wristlog-vNN`) on every HTML/JS change. (CLAUDE.md)
- Fact pool is keyed by **model** (`lower(trim(brand)) || '|' || lower(trim(name))`), not reference. Cap is **10**. No backfill of existing posts — forward-only. (spec)
- UAT only with testuser / testuser2, private/followers/close-friends visibility only — never touch real users' data. (CLAUDE.md, memory: no_test_actions_on_real_data)

---

## File Structure

- `sql/2026-07-20-watch-fun-facts.sql` — **create**: `watch_facts` + `watch_fact_progress` tables, `logs.fact_id` column, RLS policies, `pick_watch_fact` + `commit_watch_fact` RPCs. The single source of truth for the DB side; re-runnable (`create table if not exists`, `create or replace function`).
- `supabase/functions/identify-watch/lib.ts` — **modify**: add `buildFactsPrompt`, extend `normalizeMode` to include `"facts"`.
- `supabase/functions/identify-watch/lib.test.ts` — **modify**: Deno tests for the above.
- `supabase/functions/identify-watch/index.ts` — **modify**: add the `mode === "facts"` branch.
- `index.html` — **modify**: `logToRow`/`rowToLog` (fact_id), `saveLog` orchestration + delight reveal, `FEED_LOG_COLS` + feed enrichment + `renderFeedCard` "Did you know?" affordance, Help page + What's New copy.
- `wrotate_test.js` — **modify**: export a small pure helper `funFactCardHTML` used by both `index.html` and unit tests.
- `tests/watch-fun-fact.test.js` — **create**: Vitest coverage for the client rendering + wiring.
- `sw.js` — **modify**: cache version bump.

---

## Task 1: Database schema — tables, column, RLS

**Files:**
- Create: `sql/2026-07-20-watch-fun-facts.sql`

**Interfaces:**
- Produces: table `watch_facts(id uuid, model_key text, position int, fact text, created_at timestamptz)`; table `watch_fact_progress(user_id uuid, model_key text, last_position int, last_wear_date date, current_fact_id uuid, updated_at timestamptz)`; column `logs.fact_id uuid`.

- [ ] **Step 1: Write the schema SQL**

Create `sql/2026-07-20-watch-fun-facts.sql` with the tables/column/RLS (RPCs are added in Tasks 4–5, appended to this same file):

```sql
-- Daily Watch Fun Fact — shared lazy fact pool + per-user cursor.

create table if not exists public.watch_facts (
  id         uuid primary key default gen_random_uuid(),
  model_key  text not null,
  position   int  not null,
  fact       text not null,
  created_at timestamptz not null default now(),
  unique (model_key, position)
);
create index if not exists watch_facts_model_key_idx on public.watch_facts (model_key);

create table if not exists public.watch_fact_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  model_key       text not null,
  last_position   int  not null default -1,
  last_wear_date  date,
  current_fact_id uuid references public.watch_facts(id),
  updated_at      timestamptz not null default now(),
  primary key (user_id, model_key)
);

alter table public.logs add column if not exists fact_id uuid references public.watch_facts(id);

-- RLS: facts are shared, non-sensitive → readable by any authenticated user.
alter table public.watch_facts enable row level security;
drop policy if exists watch_facts_select on public.watch_facts;
create policy watch_facts_select on public.watch_facts
  for select to authenticated using (true);
-- No INSERT/UPDATE/DELETE policy: writes happen only via SECURITY DEFINER RPCs.

-- RLS: a user sees/writes only their own cursor (RPCs also enforce auth.uid()).
alter table public.watch_fact_progress enable row level security;
drop policy if exists watch_fact_progress_own on public.watch_fact_progress;
create policy watch_fact_progress_own on public.watch_fact_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply it to the remote DB**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker" && npx supabase db query --linked --file sql/2026-07-20-watch-fun-facts.sql`
Expected: no error output (statements return empty result sets).

- [ ] **Step 3: Verify the schema landed**

Run:
```bash
npx supabase db query --linked "
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('watch_facts','watch_fact_progress');
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='logs' AND column_name='fact_id';
SELECT polname FROM pg_policy WHERE polrelid='public.watch_facts'::regclass;
"
```
Expected: both tables listed, `fact_id` present, `watch_facts_select` policy present.

- [ ] **Step 4: Commit**

```bash
git add sql/2026-07-20-watch-fun-facts.sql
git commit -m "feat(facts): schema for daily watch fun facts (pool + cursor + logs.fact_id)"
```

---

## Task 2: Edge function — `mode: 'facts'` generation

**Files:**
- Modify: `supabase/functions/identify-watch/lib.ts`
- Modify: `supabase/functions/identify-watch/lib.test.ts`
- Modify: `supabase/functions/identify-watch/index.ts`

**Interfaces:**
- Consumes: request body `{ mode: 'facts', watchInfo: {brand, model, reference?}, context?: {specs?, background?}, existingFacts?: string[] }`.
- Produces: `buildFactsPrompt(info, existingFacts: string[]): string`; `normalizeMode(...)` now also returns `"facts"`; edge response `{ fact: string, _engine: 'gemini' }` (HTTP 200) or an error object mirroring enhance.

- [ ] **Step 1: Write failing Deno tests**

Add to `supabase/functions/identify-watch/lib.test.ts` (and add `buildFactsPrompt` to its import list at the top):

```ts
// ── normalizeMode: facts ──
Deno.test("normalizeMode — recognizes facts mode", () => {
  assertEquals(normalizeMode("facts"), "facts");
});

// ── buildFactsPrompt ──
Deno.test("buildFactsPrompt — includes brand/model and asks for one distinct fact", () => {
  const p = buildFactsPrompt({ brand: "Omega", model: "Speedmaster" }, []);
  assertStringIncludes(p, "Omega");
  assertStringIncludes(p, "Speedmaster");
  assertStringIncludes(p, '"fact"');
});

Deno.test("buildFactsPrompt — lists existing facts to avoid repeating", () => {
  const p = buildFactsPrompt({ brand: "Rolex", model: "Submariner" }, [
    "It debuted in 1953.",
  ]);
  assertStringIncludes(p, "It debuted in 1953.");
  assertStringIncludes(p, "already been used");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker/supabase/functions/identify-watch" && deno test lib.test.ts`
Expected: FAIL — `buildFactsPrompt` is not exported / `normalizeMode` returns `"identify"` for `"facts"`.

- [ ] **Step 3: Extend `normalizeMode` and add `buildFactsPrompt` in `lib.ts`**

Replace the `normalizeMode` body:

```ts
export function normalizeMode(mode: unknown): "detect" | "enhance" | "identify" | "facts" {
  return mode === "detect" ? "detect"
    : mode === "enhance" ? "enhance"
    : mode === "facts" ? "facts"
    : "identify";
}
```

Add after `buildEnhancePrompt`:

```ts
// Build the facts-mode prompt: one distinct, interesting, verifiable trivia fact.
export function buildFactsPrompt(info: WatchInfo, existingFacts: string[]): string {
  const { brand, model, reference } = info;
  const usedBlock = existingFacts.length
    ? `\nThese facts have already been used — do NOT repeat, rephrase, or overlap with any of them:\n${existingFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`
    : "";
  return `You are writing a single "fun fact" for a watch enthusiast about this watch model:
Brand: ${brand}
Model: ${model}
${reference ? `Reference: ${reference}` : ""}
${usedBlock}
Use search to find the single most interesting, genuinely surprising, and VERIFIABLE fact about this model that a knowledgeable collector would enjoy — history, design heritage, records, notable wearers, engineering quirks, or cultural moments.

Rules:
- Exactly ONE fact, ONE sentence, museum-placard tone. No preamble, no "Did you know", no citations, no emoji.
- It must be about the watch MODEL (not a specific owner). Must be true — if unsure, pick a safer well-documented fact.
- It must be clearly distinct from any already-used fact listed above.
- Prefer the most interesting fact first; only reach for smaller details once the obvious ones are used.

Return JSON only:
{"fact": "one-sentence fact here"}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker/supabase/functions/identify-watch" && deno test lib.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Add the `facts` branch in `index.ts`**

Add `buildFactsPrompt` to the import block from `./lib.ts`. Then insert this branch immediately after the enhance branch closes (after the enhance block's final `}` around line 211, before `if (!image)`):

```ts
    // ── FACTS MODE: one distinct trivia fact about the watch model ──
    if (mode === "facts" && watchInfo) {
      const { brand, model, reference } = watchInfo;
      if (!brand || !model) {
        await logAttempt(null, "facts_no_info");
        return new Response(JSON.stringify({ error: "Brand and model required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      if (!GEMINI_API_KEY) {
        await logAttempt(null, "facts_no_gemini_key");
        return new Response(JSON.stringify({ error: "Facts not available" }), {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const existingFacts: string[] = Array.isArray(watchInfo.existingFacts) ? watchInfo.existingFacts : [];
      const factsPrompt = buildFactsPrompt({ brand, model, reference }, existingFacts);
      const parts: any[] = [{ text: factsPrompt }];

      const MAX_RETRIES = 3;
      let lastErr = "";
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), 45000);
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: abort.signal,
              body: JSON.stringify({
                contents: [{ parts }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
              }),
            }
          );
          clearTimeout(timer);
          if (resp.ok) {
            const result = await resp.json();
            const candidate = result.candidates?.[0];
            const finishReason = candidate?.finishReason || "unknown";
            const textParts = (candidate?.content?.parts ?? [])
              .filter((p: any) => p.text).map((p: any) => p.text).join("");
            if (finishReason === "RECITATION" || finishReason === "SAFETY") {
              lastErr = `blocked_${finishReason}`; continue;
            }
            const parsed = extractJson(textParts);
            if (parsed && typeof parsed.fact === "string" && parsed.fact.trim()) {
              await logAttempt(1, null);
              return new Response(JSON.stringify({ fact: parsed.fact.trim(), _engine: "gemini" }), {
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
              });
            }
            lastErr = `parse_fail(${finishReason})`;
          } else {
            const errText = await resp.text();
            lastErr = `gemini_${resp.status}:${errText.slice(0, 120)}`;
            if (resp.status === 429) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          }
        } catch (e: any) {
          lastErr = `exception:${e.message}`;
        }
      }
      await logAttempt(null, `facts_failed:${lastErr.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: "facts_temporary" }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
```

- [ ] **Step 6: Type-check the function**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker/supabase/functions/identify-watch" && deno check index.ts`
Expected: no errors.

- [ ] **Step 7: Deploy and smoke-test**

Run:
```bash
cd "/Users/ozgurdogan/Documents/Claude project/watch tracker"
npx supabase functions deploy identify-watch --no-verify-jwt
npm run test:smoke
```
Expected: deploy succeeds; smoke tests pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/identify-watch/lib.ts supabase/functions/identify-watch/lib.test.ts supabase/functions/identify-watch/index.ts
git commit -m "feat(facts): add mode:'facts' generation to identify-watch"
```

---

## Task 3: GATE — real-batch quality sign-off

**No code.** The user explicitly wants to see real generated facts before we build the surfaces. Do not proceed to Task 4 until the user approves the tone/quality.

- [ ] **Step 1: Generate real facts for the top 10 models**

Pull the top models and, for each, call the deployed edge function repeatedly, feeding prior results back as `existingFacts` to grow a pool of up to 10 (simulating the real loop). Use the test user's auth. Example driver (run from the repo root; requires a valid access token via `authedFetch`-equivalent — an anon/test JWT):

```bash
npx supabase db query --linked "
SELECT lower(trim(w.brand))||' | '||lower(trim(w.name)) AS model, w.brand, w.name, count(*) c
FROM logs l JOIN watches w ON w.id=l.watch_id
WHERE l.watch_id IS NOT NULL AND coalesce(l.use_case,'')<>'measurement' AND trim(coalesce(w.brand,''))<>''
GROUP BY 1,2,3 ORDER BY c DESC LIMIT 10;"
```

Then for each model, POST `{mode:'facts', watchInfo:{brand,model}, existingFacts:[...accumulated]}` to `${SUPABASE_URL}/functions/v1/identify-watch` ten times, accumulating each returned `fact` into `existingFacts` for the next call. (A short throwaway Node/curl script in the scratchpad is fine — do not commit it.)

- [ ] **Step 2: Present the results to the user**

Show, per model, the 10 facts in generation order. Explicitly ask: *tone OK? do facts stay interesting to #10? any accuracy problems?* Adjust `buildFactsPrompt` (Task 2) and redeploy if needed, then re-run this gate.

- [ ] **Step 3: Get explicit approval**

Do not start Task 4 until the user says the quality is good.

---

## Task 4: RPC — `pick_watch_fact`

**Files:**
- Modify: `sql/2026-07-20-watch-fun-facts.sql` (append)

**Interfaces:**
- Produces: `pick_watch_fact(p_brand text, p_name text, p_wear_date date) returns json`. Returns `{ "fact_id": uuid|null, "fact": text|null, "needs_generation": bool, "existing_facts": text[] }`. Computes `model_key` internally. Operates on `auth.uid()`.

- [ ] **Step 1: Append the RPC to the SQL file**

```sql
create or replace function public.pick_watch_fact(
  p_brand text, p_name text, p_wear_date date
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_prog  public.watch_fact_progress%rowtype;
  v_pool  int;
  v_next  int;
  v_serve int;
  v_fact  public.watch_facts%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_prog from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if not found then
    v_prog.last_position := -1;
    v_prog.last_wear_date := null;
    v_prog.current_fact_id := null;
  end if;

  -- Same-day re-wear: return the already-chosen fact, no advance, no generation.
  if v_prog.last_wear_date = p_wear_date and v_prog.current_fact_id is not null then
    select * into v_fact from public.watch_facts where id = v_prog.current_fact_id;
    return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                             'needs_generation', false, 'existing_facts', '[]'::json);
  end if;

  select count(*) into v_pool from public.watch_facts where model_key = v_key;
  v_next := v_prog.last_position + 1;

  -- Need a new fact: user has consumed the whole pool and pool is below the cap.
  if v_next >= v_pool and v_pool < 10 then
    return json_build_object(
      'fact_id', null, 'fact', null, 'needs_generation', true,
      'existing_facts', coalesce(
        (select json_agg(f.fact order by f.position) from public.watch_facts f where f.model_key = v_key),
        '[]'::json));
  end if;

  -- Otherwise serve an existing fact. Below cap: position = v_next. At cap: wrap.
  v_serve := case when v_pool > 0 then v_next % v_pool else 0 end;
  select * into v_fact from public.watch_facts where model_key = v_key and position = v_serve;

  update public.watch_fact_progress
    set last_position = v_next, last_wear_date = p_wear_date,
        current_fact_id = v_fact.id, updated_at = now()
    where user_id = v_uid and model_key = v_key;
  if not found then
    insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, p_wear_date, v_fact.id);
  end if;

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                           'needs_generation', false, 'existing_facts', '[]'::json);
end $$;

grant execute on function public.pick_watch_fact(text, text, date) to authenticated;
```

- [ ] **Step 2: Apply it**

Run: `npx supabase db query --linked --file sql/2026-07-20-watch-fun-facts.sql`
Expected: no error.

- [ ] **Step 3: Test — first-ever wear needs generation (empty pool)**

Pick a real test-user UUID first: `npx supabase db query --linked "SELECT id FROM auth.users WHERE email='test@wrotate.com';"`. Then:

```bash
npx supabase db query --linked "
SELECT set_config('request.jwt.claims', '{\"sub\":\"<TEST_UUID>\"}', true);
SELECT public.pick_watch_fact('ZzTestBrand','ZzTestModel', current_date);"
```
Expected: `needs_generation` = true, `fact_id` null, `existing_facts` = `[]`.

- [ ] **Step 4: Test — serving + same-day gate**

Seed two facts, then verify pick serves position 0, and a same-day second call returns the SAME fact:

```bash
npx supabase db query --linked "
INSERT INTO watch_facts(model_key,position,fact) VALUES
 ('zztestbrand|zztestmodel',0,'Fact zero.'),('zztestbrand|zztestmodel',1,'Fact one.')
 ON CONFLICT DO NOTHING;
DELETE FROM watch_fact_progress WHERE model_key='zztestbrand|zztestmodel';
SELECT set_config('request.jwt.claims', '{\"sub\":\"<TEST_UUID>\"}', true);
SELECT public.pick_watch_fact('ZzTestBrand','ZzTestModel', current_date);   -- expect Fact zero
SELECT public.pick_watch_fact('ZzTestBrand','ZzTestModel', current_date);   -- SAME (Fact zero), needs_generation false
SELECT public.pick_watch_fact('ZzTestBrand','ZzTestModel', current_date + 1); -- Fact one (new day advances)
SELECT public.pick_watch_fact('ZzTestBrand','ZzTestModel', current_date + 2); -- needs_generation true (consumed both, pool<10)
"
```
Expected: exactly as annotated. Clean up: `DELETE FROM watch_facts WHERE model_key='zztestbrand|zztestmodel'; DELETE FROM watch_fact_progress WHERE model_key='zztestbrand|zztestmodel';`

- [ ] **Step 5: Commit**

```bash
git add sql/2026-07-20-watch-fun-facts.sql
git commit -m "feat(facts): pick_watch_fact RPC (cursor + daily gate + cap wrap)"
```

---

## Task 5: RPC — `commit_watch_fact`

**Files:**
- Modify: `sql/2026-07-20-watch-fun-facts.sql` (append)

**Interfaces:**
- Consumes: called by the client only after `pick_watch_fact` returned `needs_generation: true` and the edge function produced a fresh fact.
- Produces: `commit_watch_fact(p_brand text, p_name text, p_wear_date date, p_fact text) returns json` → `{ "fact_id": uuid, "fact": text }`. Race-safe: inserts at `last_position+1` with `ON CONFLICT DO NOTHING`, then serves whatever fact occupies that slot.

- [ ] **Step 1: Append the RPC**

```sql
create or replace function public.commit_watch_fact(
  p_brand text, p_name text, p_wear_date date, p_fact text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_key  text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last int;
  v_next int;
  v_fact public.watch_facts%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_fact is null or length(trim(p_fact)) = 0 then raise exception 'empty fact'; end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;
  v_next := v_last + 1;

  -- Race-safe append: if a concurrent wearer already filled this slot, keep theirs.
  insert into public.watch_facts(model_key, position, fact)
    values (v_key, v_next, trim(p_fact))
    on conflict (model_key, position) do nothing;

  select * into v_fact from public.watch_facts where model_key = v_key and position = v_next;

  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, p_wear_date, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position = v_next, last_wear_date = p_wear_date,
        current_fact_id = v_fact.id, updated_at = now();

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact);
end $$;

grant execute on function public.commit_watch_fact(text, text, date, text) to authenticated;
```

- [ ] **Step 2: Apply it**

Run: `npx supabase db query --linked --file sql/2026-07-20-watch-fun-facts.sql`
Expected: no error.

- [ ] **Step 3: Test — commit appends and advances cursor**

```bash
npx supabase db query --linked "
DELETE FROM watch_facts WHERE model_key='zztestbrand|zztestmodel';
DELETE FROM watch_fact_progress WHERE model_key='zztestbrand|zztestmodel';
SELECT set_config('request.jwt.claims', '{\"sub\":\"<TEST_UUID>\"}', true);
SELECT public.commit_watch_fact('ZzTestBrand','ZzTestModel', current_date, 'Generated fact A.');  -- position 0
SELECT position, fact FROM watch_facts WHERE model_key='zztestbrand|zztestmodel';                 -- one row, pos 0
SELECT last_position, current_fact_id IS NOT NULL AS has_cur FROM watch_fact_progress WHERE model_key='zztestbrand|zztestmodel';  -- 0, true
"
```
Expected: fact stored at position 0; cursor `last_position` = 0. Clean up the `zztest*` rows afterward.

- [ ] **Step 4: Commit**

```bash
git add sql/2026-07-20-watch-fun-facts.sql
git commit -m "feat(facts): commit_watch_fact RPC (race-safe append + cursor advance)"
```

---

## Task 6: Client — log-time orchestration + delight reveal

**Files:**
- Modify: `index.html` (`logToRow` ~6620, `rowToLog` ~6632, `saveLog` ~16208)
- Modify: `wrotate_test.js`
- Create: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `pick_watch_fact`, `commit_watch_fact` RPCs (Tasks 4–5); edge `mode:'facts'` (Task 2); existing `db`, `authedFetch`/`db.rpc`, `toast`, `escHtml`, `SUPABASE_URL`.
- Produces: `logEntry.factId` set on the wear log; `logToRow`/`rowToLog` round-trip `factId ↔ fact_id`; global `async function attachFunFact(logEntry, watch)`; `funFactCardHTML({fact})` exported from `wrotate_test.js`; delight reveal after logging.

- [ ] **Step 1: Write failing unit tests**

Create `tests/watch-fun-fact.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { funFactCardHTML } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('funFactCardHTML', () => {
  it('returns empty string when no fact', () => {
    expect(funFactCardHTML({ fact: '' })).toBe('');
    expect(funFactCardHTML({ fact: null })).toBe('');
  });
  it('renders the fact text escaped', () => {
    const out = funFactCardHTML({ fact: 'Made in 1953 <b>x</b>' });
    expect(out).toContain('Made in 1953');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>x</b>');
  });
});

describe('fun-fact wiring in index.html', () => {
  it('logToRow round-trips fact_id', () => {
    expect(html).toMatch(/fact_id:\s*l\.factId/);
  });
  it('rowToLog reads fact_id', () => {
    expect(html).toMatch(/factId:\s*r\.fact_id/);
  });
  it('saveLog attaches a fun fact for wear logs', () => {
    expect(html).toContain('attachFunFact(');
  });
  it('pick/commit RPCs are called by name', () => {
    expect(html).toContain("pick_watch_fact");
    expect(html).toContain("commit_watch_fact");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker" && npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL — `funFactCardHTML` not exported; strings absent.

- [ ] **Step 3: Add `funFactCardHTML` to `wrotate_test.js`**

`wrotate_test.js` exports pure helpers shared with `index.html`. Add:

```js
export function funFactCardHTML({ fact }) {
  if (!fact || !String(fact).trim()) return '';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<div class="funfact-card"><span class="funfact-bulb">💡</span><span class="funfact-text">${esc(fact)}</span></div>`;
}
```

- [ ] **Step 4: Add the matching `funFactCardHTML` in `index.html`**

Place it next to the other card-render helpers (near `boxPapersHTML`). Use the existing `escHtml`:

```js
function funFactCardHTML({ fact }) {
  if (!fact || !String(fact).trim()) return '';
  return `<div class="funfact-card"><span class="funfact-bulb">💡</span><span class="funfact-text">${escHtml(fact)}</span></div>`;
}
```

Add minimal CSS near the shared card styles (`/* ── SHARED CARD STYLES ... ── */`):

```css
.funfact-card{display:flex;gap:.5rem;align-items:flex-start;background:var(--badge-bg);border:.5px solid var(--badge-border);border-radius:8px;padding:.5rem .6rem;font-size:.8rem;line-height:1.45;color:var(--fg);}
.funfact-bulb{flex:0 0 auto;}
.funfact-text{color:var(--muted);}
```

- [ ] **Step 5: Round-trip `factId` in `logToRow` / `rowToLog`**

In `logToRow` add to the returned object: `fact_id: l.factId || null,`
In `rowToLog` add: `factId: r.fact_id || null,`

- [ ] **Step 6: Add `attachFunFact` and call it from `saveLog`**

Add the helper (near `saveLog`):

```js
// Pick or generate a daily fun fact for a wear log, persist logEntry.factId, and
// return the fact text (or '' on any failure — must never block logging).
async function attachFunFact(logEntry, watch) {
  try {
    if (!watch || !watch.brand || !watch.name || !currentUser) return '';
    const brand = watch.brand, name = watch.name, ref = watch.ref || '';
    const { data: picked, error: pErr } = await db.rpc('pick_watch_fact',
      { p_brand: brand, p_name: name, p_wear_date: logEntry.date });
    if (pErr || !picked) return '';
    let factId = picked.fact_id, factText = picked.fact;
    if (picked.needs_generation) {
      const resp = await authedFetch(`${SUPABASE_URL}/functions/v1/identify-watch`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'facts',
          watchInfo: { brand, model: name, reference: ref, existingFacts: picked.existing_facts || [] } }),
      });
      if (!resp.ok) return '';
      const gen = await resp.json();
      if (!gen || !gen.fact) return '';
      const { data: committed, error: cErr } = await db.rpc('commit_watch_fact',
        { p_brand: brand, p_name: name, p_wear_date: logEntry.date, p_fact: gen.fact });
      if (cErr || !committed) return '';
      factId = committed.fact_id; factText = committed.fact;
    }
    if (!factId) return '';
    logEntry.factId = factId;
    markDirty('logs', logEntry.id);
    save();
    return factText || '';
  } catch (e) {
    console.error('[funfact] attach failed:', e && e.message);
    return '';
  }
}
```

Wire it into `saveLog`, after `save();` (line ~16246) and before `closeTrackModal()`. Only for genuine wear logs (a watch is always selected in `saveLog` — `selWatchId`). Capture the fact to reveal after the modal closes:

```js
  const _factWatch = watches.find(x => x.id === selWatchId) || null;
  const _factText = await attachFunFact(logEntry, _factWatch);
```

Then after `toast(isUpdate ? 'Wear log updated!' : 'Wear logged!');`, add the delight reveal (non-blocking, only when a fact came back):

```js
  if (_factText) toast('💡 ' + _factText, 'info', 6000);
```

(If `toast` does not accept a duration arg, use the existing signature — check `function toast(` — and fall back to the default; the fact is short.)

- [ ] **Step 7: Run unit tests**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker" && npx vitest run tests/watch-fun-fact.test.js`
Expected: PASS.

- [ ] **Step 8: Manual UAT (testuser + testuser2)**

On the local dev server (http://192.168.1.246:3000), log in as testuser, log a wear of one watch with **private** visibility. Confirm:
- The 💡 delight toast appears with a fact.
- Log the same watch again same day → no error (same fact, no new generation).
- Change the wear date to tomorrow, log again → different fact.
Verify in DB: `SELECT position,fact FROM watch_facts WHERE model_key=...;` grows only when expected; `SELECT last_position,current_fact_id FROM watch_fact_progress WHERE user_id=<testuser>;` advances.

- [ ] **Step 9: Commit**

```bash
git add index.html wrotate_test.js tests/watch-fun-fact.test.js
git commit -m "feat(facts): log-time fun-fact orchestration + delight reveal"
```

---

## Task 7: Feed — freeze fact on post + "Did you know?" affordance

**Files:**
- Modify: `index.html` (`FEED_LOG_COLS` ~10167, feed enrichment ~10358-10375, `renderFeedCard` ~10786)
- Modify: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `logs.fact_id`, `watch_facts` (SELECT policy from Task 1); `funFactCardHTML` (Task 6).
- Produces: `item.fact` (fact text) on each enriched feed item; a collapsed, tappable fun-fact block on wear-post cards; `toggleFunFact(el)` global.

- [ ] **Step 1: Add failing tests**

Append to `tests/watch-fun-fact.test.js`:

```js
describe('feed fun-fact rendering', () => {
  it('FEED_LOG_COLS includes fact_id', () => {
    expect(html).toMatch(/const FEED_LOG_COLS = '[^']*fact_id[^']*'/);
  });
  it('feed enrichment fetches watch_facts by id', () => {
    expect(html).toMatch(/from\('watch_facts'\)\.select\([^)]*\)\.in\('id'/);
  });
  it('renderFeedCard emits a tappable fun-fact block', () => {
    expect(html).toContain('toggleFunFact(');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL on the three new assertions.

- [ ] **Step 3: Add `fact_id` to `FEED_LOG_COLS`**

Change line ~10167 to include `fact_id`:

```js
const FEED_LOG_COLS = 'id, user_id, watch_id, club_id, photo_url, notes, use_case, date, created_at, visibility, moderation_status, location, badge_refs, fact_id';
```

- [ ] **Step 4: Fetch fact text during feed enrichment**

In the enrichment block (~10358), alongside `watchIds`, collect fact ids and add a fetch to the `Promise.all`. After `const watchIds = ...`:

```js
    const factIds = [...new Set(rawLogs.filter(l => l.fact_id).map(l => l.fact_id))];
```

Add a 5th promise to the `Promise.all([...])` (after the comments query):

```js
      factIds.length
        ? db.from('watch_facts').select('id, fact').in('id', factIds)
        : Promise.resolve({ data: [] }),
```

Update the destructuring to capture it: `const [watchResult, profileResult, likesResult, commentResult, factResult] = await withTimeout(Promise.all([...`. Then build the map and assign, next to `watchMap`:

```js
    const factMap = {};
    (factResult.data || []).forEach(f => factMap[f.id] = f.fact);
```

Where items are assigned `item.watch` / `item.profile`, also set: `item.fact = it.fact_id ? (factMap[it.fact_id] || '') : '';` (match the exact enrichment loop variable used nearby).

- [ ] **Step 5: Render the collapsed affordance in `renderFeedCard`**

In `renderFeedCard`, only for wear-posts (an `item.watch` exists), after the watch chip block (~10904), insert a tappable, collapsed fun-fact row (nothing renders when `item.fact` is empty):

```js
        ${item.fact ? `<div class="funfact-wrap">
          <button type="button" class="funfact-toggle" onclick="toggleFunFact(this)" aria-expanded="false">💡 Did you know?</button>
          <div class="funfact-body" hidden>${funFactCardHTML({ fact: item.fact })}</div>
        </div>` : ''}
```

Add `toggleFunFact` near the other feed helpers:

```js
function toggleFunFact(btn) {
  const body = btn.parentElement.querySelector('.funfact-body');
  if (!body) return;
  const open = !body.hasAttribute('hidden');
  if (open) { body.setAttribute('hidden',''); btn.setAttribute('aria-expanded','false'); }
  else { body.removeAttribute('hidden'); btn.setAttribute('aria-expanded','true'); }
}
```

Add CSS by the `.funfact-card` rule:

```css
.funfact-wrap{margin-top:.4rem;}
.funfact-toggle{background:none;border:0;color:var(--badge-accent);font:inherit;font-size:.78rem;font-weight:500;cursor:pointer;padding:.15rem 0;}
.funfact-body{margin-top:.35rem;}
```

- [ ] **Step 6: Run unit tests + full suite**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker" && npx vitest run tests/watch-fun-fact.test.js && npm test`
Expected: PASS (new file + full 970-test suite green).

- [ ] **Step 7: E2E mocked + manual cross-account UAT**

Run: `npm run test:e2e`
Expected: pass. Then on the dev server: as testuser, open the feed, find the wear-post from Task 6 — confirm "💡 Did you know?" expands to the fact. Log in as testuser2 (mutual close friend) and confirm testuser2 sees the **same** frozen fact on that post (they should, via `logs.fact_id`).

- [ ] **Step 8: Commit**

```bash
git add index.html tests/watch-fun-fact.test.js
git commit -m "feat(facts): freeze fact on post + tappable 'Did you know?' on feed cards"
```

---

## Task 8: SW cache bump + in-app docs

**Files:**
- Modify: `sw.js`
- Modify: `index.html` (Help page + What's New section)

- [ ] **Step 1: Bump the SW cache version**

In `sw.js`, increment the cache constant to the next `wristlog-vNN` (read the current value first; do not guess the number).

- [ ] **Step 2: Add Help + What's New copy**

In the Help/in-app guide (near the Enhance help copy ~index.html:2381) add a short line describing the daily fun fact. In the "What's New" section add a dated entry. Use the WRotate voice, "we" (team voice), no founder name (memory: email_voice — applies to user-facing copy generally). Example What's New line:

```
Daily fun facts — every watch you wear now surfaces a fresh trivia fact, and your posts show a tappable "Did you know?" so others can learn something too.
```

- [ ] **Step 3: Run full suite**

Run: `cd "/Users/ozgurdogan/Documents/Claude project/watch tracker" && npm test && npm run test:e2e`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add sw.js index.html
git commit -m "chore(facts): SW cache bump + Help/What's New for daily fun facts"
```

---

## Rollout note

Deploy is `git push origin main` (auto-deploys). Test locally first. The edge function is already deployed in Task 2. No backfill: existing posts have `fact_id = null` and simply show no fact; facts begin accruing as users log new wears.

## Self-Review Notes

- **Spec coverage:** engine (Tasks 4–5), data model (Task 1), generation + `mode:'facts'` (Task 2), cold-model/failure fallback = `attachFunFact` returns `''` and never blocks logging (Task 6), daily boundary (Task 4 same-day gate), both surfaces (Task 6 delight + Task 7 post card), model-key keying + cap 10 + no backfill (Tasks 1/4/5 + rollout note), quality gate (Task 3), testing + SW bump + docs (Tasks 6–8). All covered.
- **Naming consistency:** `factId` (JS) ↔ `fact_id` (DB) via `logToRow`/`rowToLog`; RPCs `pick_watch_fact` / `commit_watch_fact`; helpers `attachFunFact`, `funFactCardHTML`, `toggleFunFact`, `item.fact`, `factMap`/`factIds` — used identically across tasks.
- **Open items intentionally deferred to implementation:** exact enrichment loop variable name in Task 7 Step 4 (match the nearby `item`/`it` used for `watch`/`profile`); confirm `toast` signature before passing a duration in Task 6 Step 6.
