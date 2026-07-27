# Login Fun-Fact Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a returning user one real fun fact about their own watch, once ever, when they haven't logged a wear that day — with the next fact conditional on logging.

**Architecture:** A new `peek_watch_fact` SECURITY DEFINER RPC serves the next unseen fact and advances the user's cursor *without* stamping a wear date, so a later wear log still yields a different fact. The client adds a pure eligibility gate (mirrored and unit-tested), a watch picker, and a modal that copies `maybePromptFirstWear`'s deferred, never-stacking open pattern. A new `active_users` segment on the existing `prewarm_facts` action keeps facts instantly available so the modal never shows a spinner.

**Tech Stack:** Vanilla JS (no frameworks), Supabase Postgres RPCs, Deno edge functions, Vitest for unit tests, Playwright for mocked E2E.

**Spec:** `docs/superpowers/specs/2026-07-27-login-fun-fact-modal-design.md`

## Global Constraints

- **Vanilla JS only.** No frameworks, no new dependencies.
- **No `confirm()` / `alert()`.** Custom inline UI only.
- **Bump the SW cache version** (`sw.js` → `wristlog-vNN`) on every HTML/JS change. Current: `wristlog-v953`.
- **Mirrored functions must be byte-identical.** Any function defined in both `index.html` and `wrotate_test.js` must be registered in `tests/mirror-drift.test.js` under `VERBATIM` and match after whitespace/comment stripping.
- **RPCs are deployed with `npx supabase db query --linked --file <path>`**, not migration push. Every new RPC file ends with `notify pgrst, 'reload schema';`.
- **Edge functions deploy with `--no-verify-jwt`**, followed by `npm run test:smoke`.
- **Never show a spinner or an error for this modal.** Every failure path is "show nothing, stay eligible" (spec: Error handling).
- **"Wear" means `isWearEntry`** — `watch_id` set and `use_case <> 'measurement'`.
- Run `npm test` before every commit. Full pre-push check: `npm test && npm run test:e2e`.

---

## File Structure

| File | Responsibility |
|---|---|
| `sql/2026-07-27-peek-watch-fact.sql` | **Create.** The `peek_watch_fact` RPC. |
| `sql/2026-07-27-active-users-segment.sql` | **Create.** `active_users_with_watches()` segment RPC for prewarming. |
| `supabase/functions/run-campaign/index.ts` | **Modify.** Add `active_users` to `prewarmFacts`'s segment switch. |
| `wrotate_test.js` | **Modify.** Add `shouldShowFactModal` + `pickFactModalWatch` (pure, mirrored); add `createdAt` to `rowToWatch`. |
| `tests/fact-modal.test.js` | **Create.** Unit tests for both pure functions. |
| `tests/mirror-drift.test.js` | **Modify.** Register the two new mirrors as VERBATIM. |
| `index.html` | **Modify.** Watches select + `rowToWatch` (`created_at`), modal markup, the two mirrored functions, `maybeShowFactModal()`, and three call sites. |
| `e2e/fact-modal.mock.spec.js` | **Create.** Mocked E2E for appearance, suppression, and the CTA. |
| `sw.js` | **Modify.** Cache version bump. |

---

### Task 1: `peek_watch_fact` RPC

Serves the next unseen fact and advances the cursor, leaving `last_wear_date` NULL so a later wear log advances again.

**Files:**
- Create: `sql/2026-07-27-peek-watch-fact.sql`

**Interfaces:**
- Consumes: existing tables `watch_facts (model_key, position, fact)`, `watch_fact_progress (user_id, model_key, last_position, last_wear_date, current_fact_id)`.
- Produces: `peek_watch_fact(p_brand text, p_name text) returns json` → `{ fact_id uuid|null, fact text|null, needs_generation boolean }`. Called inline by `maybeShowFactModal()` in Task 5.

- [ ] **Step 1: Write the RPC file**

Create `sql/2026-07-27-peek-watch-fact.sql`:

```sql
-- Next unseen fact for the login modal.
--
-- pick_watch_fact() cannot be reused here: it stamps last_wear_date = today and
-- has a same-day branch that returns the already-chosen fact. Calling it on app
-- open would make a wear log later the same day replay the identical fact,
-- breaking the "log a wear to unlock the next one" promise the modal makes.
--
-- This advances the cursor but deliberately leaves last_wear_date NULL, so the
-- next wear log advances again and yields a genuinely different fact.
--
-- Returns needs_generation = true and WRITES NOTHING when the pool holds nothing
-- new for the model. The caller skips the modal rather than waiting on a ~10-15s
-- grounded generation.
create or replace function public.peek_watch_fact(p_brand text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last  int;
  v_pool  int;
  v_next  int;
  v_serve int;
  v_fact  public.watch_facts%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_brand), '') = '' or coalesce(trim(p_name), '') = '' then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;

  select count(*) into v_pool from public.watch_facts where model_key = v_key;
  v_next := v_last + 1;

  -- Nothing new to show without generating. Write nothing; the caller skips.
  if v_pool = 0 or (v_next >= v_pool and v_pool < 10) then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  -- At the 10-fact cap, wrap like pick_watch_fact does.
  v_serve := v_next % v_pool;
  select * into v_fact from public.watch_facts
    where model_key = v_key and position = v_serve;
  if v_fact.id is null then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  -- last_wear_date stays NULL on purpose: the next wear log must advance again.
  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, null, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position   = v_next,
        last_wear_date  = null,
        current_fact_id = v_fact.id,
        updated_at      = now();

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact, 'needs_generation', false);
end $$;

revoke execute on function public.peek_watch_fact(text, text) from public, anon;
grant execute on function public.peek_watch_fact(text, text) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Deploy the RPC**

Run:
```bash
cd "/Users/ozgurdogan/Documents/Claude project/watch tracker"
npx supabase db query --linked --file sql/2026-07-27-peek-watch-fact.sql
```
Expected: a JSON result with an empty `rows` array and no error.

- [ ] **Step 3: Verify it advances the cursor and leaves last_wear_date NULL**

The test user is `e0af1615-b151-4260-b6bd-c23e497efa6d` (test@wrotate.com). Pick a model that has ≥2 pooled facts so the peek and the following pick differ.

Run:
```bash
npx supabase db query --linked "
select model_key, count(*) from watch_facts group by 1 having count(*) >= 2 limit 3;"
```
Note one `model_key` — it is `lower(brand)|lower(name)`, so `rolex|turnograph` means brand `Rolex`, name `Turnograph`.

Then run, substituting that brand/name:
```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', '{\"sub\":\"e0af1615-b151-4260-b6bd-c23e497efa6d\"}', true);
delete from watch_fact_progress where user_id='e0af1615-b151-4260-b6bd-c23e497efa6d' and model_key='rolex|turnograph';
select peek_watch_fact('Rolex','Turnograph') as peeked;
select last_position, last_wear_date, current_fact_id is not null as has_fact
  from watch_fact_progress
 where user_id='e0af1615-b151-4260-b6bd-c23e497efa6d' and model_key='rolex|turnograph';"
```
Expected: `peeked.needs_generation` is `false` with a non-null `fact`; the progress row shows `last_position = 0`, `last_wear_date = null`, `has_fact = true`.

- [ ] **Step 4: Verify a following wear log yields a DIFFERENT fact**

This is the whole reason the RPC exists. Run:
```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', '{\"sub\":\"e0af1615-b151-4260-b6bd-c23e497efa6d\"}', true);
select peek_watch_fact('Rolex','Turnograph')->>'fact' as peeked_fact;
select pick_watch_fact('Rolex','Turnograph', current_date)->>'fact' as logged_fact;"
```
Expected: `peeked_fact` and `logged_fact` are **different strings**. If they are identical, the `last_wear_date = null` write is wrong — fix before continuing.

- [ ] **Step 5: Verify an exhausted pool writes nothing**

Run:
```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', '{\"sub\":\"e0af1615-b151-4260-b6bd-c23e497efa6d\"}', true);
select peek_watch_fact('NoSuchBrand','NoSuchModel') as empty_pool;
select count(*) as rows_written from watch_fact_progress
 where user_id='e0af1615-b151-4260-b6bd-c23e497efa6d' and model_key='nosuchbrand|nosuchmodel';"
```
Expected: `empty_pool.needs_generation` is `true`, `fact` is null, and `rows_written` is `0`.

- [ ] **Step 6: Verify unauthenticated calls raise**

Run:
```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', '', true);
select peek_watch_fact('Rolex','Turnograph');"
```
Expected: an error containing `not authenticated`.

- [ ] **Step 7: Clean up the test cursor**

Run:
```bash
npx supabase db query --linked "
delete from watch_fact_progress
 where user_id='e0af1615-b151-4260-b6bd-c23e497efa6d' and model_key='rolex|turnograph';"
```
Expected: no error.

- [ ] **Step 8: Commit**

```bash
git add sql/2026-07-27-peek-watch-fact.sql
git commit -m "feat: peek_watch_fact RPC for the login fun-fact modal

Serves the next unseen fact and advances the cursor without stamping a
wear date, so a wear log later the same day still yields a different fact.
pick_watch_fact could not be reused: its same-day branch would replay the
identical fact and break the modal's own promise.

Returns needs_generation and writes nothing when the pool is exhausted, so
the modal is skipped rather than waiting on a ~10-15s generation."
```

---

### Task 2: `active_users` prewarm segment

Keeps facts instantly available so the modal never has to skip for lack of a warm pool.

**Files:**
- Create: `sql/2026-07-27-active-users-segment.sql`
- Modify: `supabase/functions/run-campaign/index.ts` (the `prewarmFacts` segment switch, ~line 596)

**Interfaces:**
- Consumes: `fun_fact_vars(uuid[])` and the existing `prewarmFacts(supabase, limit, segment)` helper.
- Produces: `active_users_with_watches(p_days integer default 30) returns table(user_id uuid)`; and the `run-campaign` action `{"prewarm_facts": N, "segment": "active_users"}`.

- [ ] **Step 1: Write the segment RPC**

Create `sql/2026-07-27-active-users-segment.sql`:

```sql
-- Users the login fun-fact modal can fire for: signed in recently and owning at
-- least one usable watch. Used only to prewarm the shared fact pool so the modal
-- never has to skip for want of a warm fact.
create or replace function public.active_users_with_watches(p_days integer default 30)
returns table (user_id uuid)
language sql
security definer
set search_path = public, auth
as $$
  select u.id
  from auth.users u
  where u.last_sign_in_at > now() - make_interval(days => p_days)
    and not exists (select 1 from internal_accounts ia where ia.user_id = u.id)
    and exists (
      select 1 from watches w
      where w.user_id = u.id
        and trim(coalesce(w.brand, '')) <> ''
        and trim(coalesce(w.name, ''))  <> ''
    );
$$;

revoke execute on function public.active_users_with_watches(integer) from public, anon;
grant execute on function public.active_users_with_watches(integer) to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Deploy and sanity-check the segment**

Run:
```bash
npx supabase db query --linked --file sql/2026-07-27-active-users-segment.sql
npx supabase db query --linked "
select count(*) as active_with_watches,
       count(*) filter (where fact is not null) as fact_ready,
       count(*) filter (where fact is null) as needs_generation
from active_users_with_watches(30) a
join lateral (select * from fun_fact_vars(array[a.user_id])) f on true;"
```
Expected: `active_with_watches` around 79, with most in `needs_generation` before prewarming.

- [ ] **Step 3: Add the segment to `prewarmFacts`**

In `supabase/functions/run-campaign/index.ts`, replace these two lines inside `prewarmFacts` (~line 599):

```ts
  const rpc = segment === "winback" ? "one_and_done_winback_users" : "never_logged_users";
  const args = segment === "winback" ? { p_churn_days: 14 } : { p_min_age_days: 4 };
```

with:

```ts
  // "active_users" warms the pool for the login fun-fact modal, which is gated on
  // a fact being instantly available and skips rather than showing a spinner.
  const rpc = segment === "winback" ? "one_and_done_winback_users"
            : segment === "active_users" ? "active_users_with_watches"
            : "never_logged_users";
  const args = segment === "winback" ? { p_churn_days: 14 }
             : segment === "active_users" ? { p_days: 30 }
             : { p_min_age_days: 4 };
```

- [ ] **Step 4: Type-check**

Run:
```bash
cd supabase/functions/run-campaign && deno check index.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c "^TS"
```
Expected: `5`. That is the pre-existing baseline in this file (unrelated `ProfileRow`/`Profile` variance). Any number above 5 means the change introduced an error — fix it.

- [ ] **Step 5: Deploy and smoke test**

Run:
```bash
cd "/Users/ozgurdogan/Documents/Claude project/watch tracker"
npx supabase functions deploy run-campaign --no-verify-jwt
npm run test:smoke
```
Expected: deploy succeeds; smoke test reports `6 passed, 0 failed`.

- [ ] **Step 6: Dry-run the new segment**

The trigger secret lives in the pg_cron job definition. Extract it without printing it:

```bash
npx supabase db query --linked "select command from cron.job where jobname='run-email-campaigns';" > /tmp/cj.txt
python3 -c "
import re,json
raw=open('/tmp/cj.txt').read()
d=json.loads(raw[raw.index('{'):raw.rindex('}')+1])
m=re.search(r'x-campaign-secret[^a-zA-Z0-9]+([A-Za-z0-9_\-]{16,})', d['rows'][0]['command'])
open('/tmp/s.txt','w').write(m.group(1))"
SECRET=$(cat /tmp/s.txt)
curl -s -X POST "https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/run-campaign" \
  -H "x-campaign-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"prewarm_facts": 0, "segment": "active_users"}'
```
Expected: JSON like `{"segment":"active_users","audience_models":N,"already_covered":M,"attempted":0,"generated":0,"failed":0,"remaining":...}`. `attempted` must be `0` — limit 0 is a dry run.

- [ ] **Step 7: Prewarm for real, in batches**

Run repeatedly until `remaining` is `0` (each call takes ~2 minutes):
```bash
SECRET=$(cat /tmp/s.txt)
curl -s -X POST "https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/run-campaign" \
  -H "x-campaign-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"prewarm_facts": 40, "segment": "active_users"}'
```
Expected: `generated` climbs and `remaining` falls to 0. Each fact is committed to `watch_facts` as it is generated, so a failed call loses no earlier work and re-running only picks up what is still uncovered.

- [ ] **Step 8: Confirm coverage, then delete the secret file**

```bash
npx supabase db query --linked "
select count(*) as active_with_watches,
       count(*) filter (where fact is not null) as fact_ready
from active_users_with_watches(30) a
join lateral (select * from fun_fact_vars(array[a.user_id])) f on true;"
rm -f /tmp/s.txt /tmp/cj.txt
```
Expected: `fact_ready` equals `active_with_watches` (or within a handful, for models where generation genuinely failed).

- [ ] **Step 9: Commit**

```bash
git add sql/2026-07-27-active-users-segment.sql supabase/functions/run-campaign/index.ts
git commit -m "feat: active_users prewarm segment for the login fun-fact modal

The modal is gated on a fact being instantly available and skips rather
than showing a spinner, so the pool has to be warm before it ships. This
segment covers everyone who signed in within 30 days and owns a usable
watch."
```

---

### Task 3: Pure gate + watch picker (mirrored)

Two pure functions, added to `wrotate_test.js` first so the tests can import them.

**Files:**
- Modify: `wrotate_test.js`
- Create: `tests/fact-modal.test.js`
- Modify: `tests/mirror-drift.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `shouldShowFactModal({ loggedIn, isDemo, watchCount, loggedToday, alreadyShown, factReady }) → boolean`
  - `pickFactModalWatch(watches, logs) → watch|null` where `watches` is `[{id, brand, name, createdAt}]` and `logs` is `[{watchId, useCase}]`.
  - Both are copied byte-identically into `index.html` in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `tests/fact-modal.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { shouldShowFactModal, pickFactModalWatch } from '../wrotate_test.js';

const OK = {
  loggedIn: true, isDemo: false, watchCount: 2,
  loggedToday: false, alreadyShown: false, factReady: true,
};

describe('shouldShowFactModal', () => {
  it('shows when every condition is met', () => {
    expect(shouldShowFactModal(OK)).toBe(true);
  });

  it('never shows in demo mode', () => {
    expect(shouldShowFactModal({ ...OK, isDemo: true })).toBe(false);
  });

  it('never shows when signed out', () => {
    expect(shouldShowFactModal({ ...OK, loggedIn: false })).toBe(false);
  });

  it('never shows without a watch — there is no personal fact to give', () => {
    expect(shouldShowFactModal({ ...OK, watchCount: 0 })).toBe(false);
  });

  it('does not nudge someone who already logged a wear today', () => {
    expect(shouldShowFactModal({ ...OK, loggedToday: true })).toBe(false);
  });

  it('is once ever, so a prior showing suppresses it', () => {
    expect(shouldShowFactModal({ ...OK, alreadyShown: true })).toBe(false);
  });

  it('skips rather than showing a spinner when no fact is ready', () => {
    expect(shouldShowFactModal({ ...OK, factReady: false })).toBe(false);
  });
});

describe('pickFactModalWatch', () => {
  const w = (id, brand, name, createdAt) => ({ id, brand, name, createdAt });

  it('picks the most-worn watch', () => {
    const watches = [w('a', 'Seiko', 'SKX007', '2026-01-01'), w('b', 'Rolex', 'Explorer', '2026-02-01')];
    const logs = [
      { watchId: 'a', useCase: 'unspecified' },
      { watchId: 'b', useCase: 'unspecified' },
      { watchId: 'b', useCase: 'unspecified' },
    ];
    expect(pickFactModalWatch(watches, logs).id).toBe('b');
  });

  it('breaks a tie on wear count by most recently added', () => {
    const watches = [w('a', 'Seiko', 'SKX007', '2026-01-01'), w('b', 'Rolex', 'Explorer', '2026-02-01')];
    const logs = [{ watchId: 'a', useCase: 'unspecified' }, { watchId: 'b', useCase: 'unspecified' }];
    expect(pickFactModalWatch(watches, logs).id).toBe('b');
  });

  it('falls back to most recently added when there are no wears at all', () => {
    // The lapsed / never-logged case — the majority of the audience.
    const watches = [w('a', 'Seiko', 'SKX007', '2026-01-01'), w('b', 'Rolex', 'Explorer', '2026-02-01')];
    expect(pickFactModalWatch(watches, []).id).toBe('b');
  });

  it('ignores measurement entries when counting wears', () => {
    const watches = [w('a', 'Seiko', 'SKX007', '2026-02-01'), w('b', 'Rolex', 'Explorer', '2026-01-01')];
    const logs = [
      { watchId: 'b', useCase: 'measurement' },
      { watchId: 'b', useCase: 'measurement' },
      { watchId: 'a', useCase: 'unspecified' },
    ];
    expect(pickFactModalWatch(watches, logs).id).toBe('a');
  });

  it('excludes watches missing a brand or a name — a fact is keyed on both', () => {
    const watches = [w('a', 'Seiko', '', '2026-03-01'), w('b', '  ', 'Explorer', '2026-02-01'), w('c', 'Rolex', 'Explorer', '2026-01-01')];
    expect(pickFactModalWatch(watches, []).id).toBe('c');
  });

  it('returns null when nothing qualifies', () => {
    expect(pickFactModalWatch([], [])).toBe(null);
    expect(pickFactModalWatch([w('a', 'Seiko', '', '2026-01-01')], [])).toBe(null);
    expect(pickFactModalWatch(null, null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run tests/fact-modal.test.js
```
Expected: FAIL — `shouldShowFactModal is not a function` (the import resolves but the export does not exist).

- [ ] **Step 3: Add both functions to `wrotate_test.js`**

Insert immediately **before** the line `// ── Wear leaderboard ───────────────────────────────────────────────────────` in `wrotate_test.js`:

```js
// ── Login fun-fact modal ───────────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-07-27-login-fun-fact-modal-design.md
// Fun facts are only reachable after logging a wear, so the people who most
// need the nudge never see one. This shows one, once, to a user who hasn't
// logged that day. factReady is false when the fact would need a ~10-15s
// generation — we skip entirely rather than show a spinner.
export function shouldShowFactModal({ loggedIn, isDemo, watchCount, loggedToday, alreadyShown, factReady }) {
  return !!loggedIn && !isDemo && (watchCount || 0) >= 1 && !loggedToday && !alreadyShown && !!factReady;
}

// Which watch to feature: most-worn, tie-broken by most recently added, falling
// back to most recently added when there are no wears at all — the lapsed and
// never-logged case, which is most of the audience. Mirrors how the emails pick
// (pickFeaturedWatch), so the same person sees a consistent "their watch"
// across channels. Measurement shares are not wears and don't count.
export function pickFactModalWatch(watches, logs) {
  const usable = (watches || []).filter(w => w && (w.brand || '').trim() && (w.name || '').trim());
  if (!usable.length) return null;
  const wearCount = new Map();
  for (const l of (logs || [])) {
    if (!l || !l.watchId || l.useCase === 'measurement') continue;
    wearCount.set(l.watchId, (wearCount.get(l.watchId) || 0) + 1);
  }
  return usable.slice().sort((a, b) => {
    const d = (wearCount.get(b.id) || 0) - (wearCount.get(a.id) || 0);
    if (d !== 0) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  })[0];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx vitest run tests/fact-modal.test.js
```
Expected: PASS — 14 tests.

- [ ] **Step 5: Register the mirrors in the drift guard**

In `tests/mirror-drift.test.js`, find the `VERBATIM` array and the line:

```js
  'shouldPromptFirstWear', 'hasWornToday', 'shouldRevealBadges', 'shouldShowPushPrimer',
  'fillCampaignTokens', 'unresolvedCampaignTokens',
];
```

Replace it with:

```js
  'shouldPromptFirstWear', 'hasWornToday', 'shouldRevealBadges', 'shouldShowPushPrimer',
  'fillCampaignTokens', 'unresolvedCampaignTokens',
  'shouldShowFactModal', 'pickFactModalWatch',
];
```

- [ ] **Step 6: Confirm the guard fails until `index.html` has the copies**

Run:
```bash
npx vitest run tests/mirror-drift.test.js
```
Expected: FAIL — the two functions exist in `wrotate_test.js` but not yet in `index.html`. This proves the guard is actually watching them. Task 4 makes it pass.

- [ ] **Step 7: Commit**

```bash
git add wrotate_test.js tests/fact-modal.test.js tests/mirror-drift.test.js
git commit -m "test: gate and watch picker for the login fun-fact modal

shouldShowFactModal covers each gate independently; pickFactModalWatch
prefers most-worn, falls back to newest added for the never-logged case
that is most of the audience, and ignores measurement shares. Registered
VERBATIM so the index.html copies cannot drift.

The mirror guard fails until the index.html copies land in the next task."
```

---

### Task 4: Modal markup and the mirrored copies in `index.html`

**Files:**
- Modify: `index.html` (watches select ~line 6833; `rowToWatch` ~line 6731; modal markup after the push-primer modal ~line 5332; functions near `maybePromptFirstWear` ~line 11075)
- Modify: `wrotate_test.js` (`rowToWatch` — VERBATIM mirror, must stay byte-identical)
- Modify: `sw.js`

**Interfaces:**
- Consumes: `shouldShowFactModal` / `pickFactModalWatch` (byte-identical copies of Task 3), `funFactCardHTML({ fact })` (existing, ~line 19962), `escHtml`.
- Produces: DOM node `#fact-modal`; functions `openFactModal(watch, factText)` and `closeFactModal()`, used by Task 5. Also adds `watch.createdAt` to the client watch object, which `pickFactModalWatch` sorts on.

- [ ] **Step 0a: Fetch `created_at` for watches**

`pickFactModalWatch` tie-breaks on `createdAt`, but the client never fetches it — without this the tie-break silently compares `undefined` and the "most recently added" fallback (which is the *majority* path, since most of the audience has no wears) degrades to arbitrary order.

In `index.html` line ~6833, the watches select begins `select('id,brand,name,ref,movement,...`. Change the start of that string to include `created_at`:

```js
    _q(db.from('watches').select('id,created_at,brand,name,ref,movement,price,purchase_date,color,image,url,tags,straps,owner,market_price,market_price_date,market_price_src,watch_charts_url,price_history,warranty_expiry,has_box,has_papers,insurance,insured_value,insurance_notes,receipts,watch_privacy,elo_rating,year_range,movement_type,caliber,case_material,case_diameter,case_length,case_thickness,weight,water_resistance,crystal_type,gender,origin,description,background,functions,bph').eq('user_id', uid)),
```

- [ ] **Step 0b: Map it in `rowToWatch` — in BOTH copies**

`rowToWatch` is a VERBATIM mirror. Edit it in `index.html` (~line 6731) **and** `wrotate_test.js`, identically. Change the first mapped line from:

```js
    id: r.id, brand: r.brand||'', name: r.name||'', ref: r.ref||'',
```

to:

```js
    id: r.id, createdAt: r.created_at||null, brand: r.brand||'', name: r.name||'', ref: r.ref||'',
```

Then confirm the mirror still matches:

```bash
npx vitest run tests/mirror-drift.test.js
```
Expected: the `rowToWatch` VERBATIM check passes (the `shouldShowFactModal` / `pickFactModalWatch` checks still fail until Step 2 — that is expected here).

- [ ] **Step 1: Add the modal markup**

In `index.html`, immediately after the closing `</div>` of `#push-primer-modal` (~line 5332, just before the `<script>` tag that follows), insert:

```html
<div id="fact-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="fact-modal-title">
  <div class="modal" style="max-width:360px;">
    <div class="modal-title" id="fact-modal-title" style="justify-content:center;">Did you know?</div>
    <div id="fact-modal-eyebrow" style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);margin:.5rem 0 .4rem;text-align:center;"></div>
    <div id="fact-modal-card" style="margin-bottom:.9rem;"></div>
    <div style="font-size:.82rem;color:var(--muted);line-height:1.5;margin-bottom:1.1rem;text-align:center;">You get a new one every day you wear it.</div>
    <button class="btn btn-primary" style="width:100%;margin-bottom:.5rem;" onclick="factModalLogNow()">Log this watch</button>
    <button class="btn btn-ghost" style="width:100%;color:var(--muted);" onclick="closeFactModal()">Maybe later</button>
  </div>
</div>
```

- [ ] **Step 2: Add the mirrored functions and open/close helpers**

In `index.html`, immediately **before** the line `// ── First wear-log onboarding prompt ─────────────────────────────────────────` (~line 10944), insert:

```js
// ── Login fun-fact modal ─────────────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-07-27-login-fun-fact-modal-design.md
// Fun facts are only reachable after logging a wear, so the users who most need
// the nudge never see one: of 91 users who signed in over 30 days, 23 logged a
// wear and 56 owned a watch but logged nothing. Shows one real fact about their
// own watch, once ever, when they haven't logged that day.
const FACT_MODAL_KEY = 'wrotate_fact_modal_shown';

// Keyed PER USER, matching _firstWearKey(): two accounts on one device each get
// their own decision.
function _factModalKey() {
  return currentUser ? FACT_MODAL_KEY + '_' + currentUser.id : FACT_MODAL_KEY;
}

let _factModalPending = false;   // a check is already scheduled — don't stack timers
let _factModalWatchId = null;    // the watch the open modal is about

// VERBATIM mirror of wrotate_test.js — keep byte-identical (see mirror-drift.test.js).
function shouldShowFactModal({ loggedIn, isDemo, watchCount, loggedToday, alreadyShown, factReady }) {
  return !!loggedIn && !isDemo && (watchCount || 0) >= 1 && !loggedToday && !alreadyShown && !!factReady;
}

// VERBATIM mirror of wrotate_test.js — keep byte-identical (see mirror-drift.test.js).
function pickFactModalWatch(watches, logs) {
  const usable = (watches || []).filter(w => w && (w.brand || '').trim() && (w.name || '').trim());
  if (!usable.length) return null;
  const wearCount = new Map();
  for (const l of (logs || [])) {
    if (!l || !l.watchId || l.useCase === 'measurement') continue;
    wearCount.set(l.watchId, (wearCount.get(l.watchId) || 0) + 1);
  }
  return usable.slice().sort((a, b) => {
    const d = (wearCount.get(b.id) || 0) - (wearCount.get(a.id) || 0);
    if (d !== 0) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  })[0];
}

function openFactModal(watch, factText) {
  const card = document.getElementById('fact-modal-card');
  const eyebrow = document.getElementById('fact-modal-eyebrow');
  if (!card || !eyebrow || !watch || !factText) return;
  _factModalWatchId = watch.id;
  eyebrow.textContent = `💡 Fun fact · ${watch.brand} ${watch.name}`;
  card.innerHTML = funFactCardHTML({ fact: factText });
  document.getElementById('fact-modal').classList.remove('hidden');
  if (window.posthog) posthog.capture('fact_modal_shown', { watch_id: watch.id });
}

function closeFactModal() {
  document.getElementById('fact-modal')?.classList.add('hidden');
}

function factModalLogNow() {
  const id = _factModalWatchId;
  closeFactModal();
  if (window.posthog) posthog.capture('fact_modal_log_clicked', { watch_id: id });
  if (id) openTrackModal(id);
}
```

- [ ] **Step 3: Verify the mirror guard now passes**

Run:
```bash
npx vitest run tests/mirror-drift.test.js
```
Expected: PASS — 4 tests. If it fails with a drift message, the `index.html` copies differ from `wrotate_test.js`; copy them again exactly (the guard strips whitespace and comments, so only real code differences matter).

- [ ] **Step 4: Bump the SW cache version**

Run:
```bash
sed -i '' "s/wristlog-v953/wristlog-v954/" sw.js
grep -m1 "wristlog-v" sw.js
```
Expected: `const CACHE = 'wristlog-v954';`

- [ ] **Step 5: Run the full unit suite**

Run:
```bash
npm test
```
Expected: all files pass, including `tests/fact-modal.test.js` and `tests/mirror-drift.test.js`.

- [ ] **Step 6: Commit**

```bash
git add index.html wrotate_test.js sw.js
git commit -m "feat: fun-fact modal markup and gate

Adds the modal, the per-user once-ever key, and byte-identical copies of
shouldShowFactModal / pickFactModalWatch. Reuses funFactCardHTML so the
card is visually identical to the fact shown on a wear log and in the
email. Not wired to any trigger yet — that is the next task.

Also fetches and maps watches.created_at, which the client never had.
pickFactModalWatch tie-breaks on it, and 'most recently added' is the
majority path since most of the audience has no wears at all — without it
that fallback would have silently degraded to arbitrary order.

SW cache v954."
```

---

### Task 5: Wire the trigger

**Files:**
- Modify: `index.html` (add `maybeShowFactModal` next to the Task 4 block; add three call sites at ~11115, ~18134, ~22350)

**Interfaces:**
- Consumes: `shouldShowFactModal`, `pickFactModalWatch`, `openFactModal` (Task 4); `peek_watch_fact` (Task 1); globals `currentUser`, `_isDemoMode`, `watches`, `logs`, `todayStr()`, `isWearEntry()`, `db`.
- Produces: `maybeShowFactModal()` — safe to call from any render.

- [ ] **Step 1: Add the trigger function**

In `index.html`, immediately after `factModalLogNow()` from Task 4, insert:

```js
// Catch-all: called from the main renders. Copies maybePromptFirstWear's deferred
// open — re-check eligibility after a beat, and bail if any overlay is already up
// so this can never stack on the badge reveal, push primer, or add-watch sheet.
// (`.overlay:not(.hidden)` already covers #af2-sheet, which carries the same
// class; the explicit af2 check mirrors maybePromptFirstWear rather than diverge.)
//
// Every failure path is "show nothing, stay eligible": the once-ever key is
// written only when the modal actually renders, so being bumped just means the
// user becomes eligible again next session.
function maybeShowFactModal() {
  if (_factModalPending) return;
  if (!_factModalPreCheck()) return;
  _factModalPending = true;
  setTimeout(async () => {
    _factModalPending = false;
    try {
      if (!_factModalPreCheck()) return;
      if (document.querySelector('.overlay:not(.hidden)')) return;   // something else is up
      const af2 = document.getElementById('af2-sheet');
      if (af2 && !af2.classList.contains('hidden')) return;
      if (_firstWearPending) return;                                 // first-wear prompt owns this session

      const watch = pickFactModalWatch(watches, logs);
      if (!watch) return;

      const { data, error } = await db.rpc('peek_watch_fact',
        { p_brand: watch.brand, p_name: watch.name });
      // needs_generation means the pool has nothing new; the RPC wrote nothing.
      // Skip silently and stay eligible rather than wait ~10-15s on a spinner.
      if (error || !data || data.needs_generation || !data.fact) return;

      if (!shouldShowFactModal(_factModalState(true))) return;       // re-check after the await
      localStorage.setItem(_factModalKey(), '1');                    // once ever, per user
      openFactModal(watch, data.fact);
    } catch (e) {
      console.error('[factmodal] skipped:', e && e.message);         // never surfaces to the user
    }
  }, 600);
}

// Cheap synchronous gate, used before scheduling and again inside the timer.
// factReady is unknown until the RPC answers, so it is asserted true here and
// re-evaluated for real once the fact is in hand.
function _factModalState(factReady) {
  return {
    loggedIn: !!currentUser,
    isDemo: _isDemoMode,
    watchCount: (watches || []).length,
    loggedToday: (logs || []).some(l => l && l.date === todayStr() && isWearEntry(l)),
    alreadyShown: localStorage.getItem(_factModalKey()) === '1',
    factReady: !!factReady,
  };
}

function _factModalPreCheck() {
  return shouldShowFactModal(_factModalState(true));
}
```

- [ ] **Step 2: Add the three call sites**

In `index.html`, each of lines ~11115, ~18134 and ~22350 currently reads:

```js
  maybePromptFirstWear();
```

Change **each** of the three to:

```js
  maybePromptFirstWear();
  maybeShowFactModal();
```

Verify all three landed:
```bash
grep -c "maybeShowFactModal();" index.html
```
Expected: `4` — the function definition plus three call sites.

- [ ] **Step 3: Run the unit suite**

Run:
```bash
npm test
```
Expected: all pass. The mirror guard still passes because `maybeShowFactModal` and its helpers live only in `index.html` (they touch DOM and globals, so they are not mirrored).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: wire the fun-fact modal trigger

Deferred open copied from maybePromptFirstWear: re-checks eligibility
after a beat and bails if any overlay is up, so it can never stack on the
badge reveal, push primer, or add-watch sheet. Eligibility is re-checked
after the RPC await too, since the user can log a wear while it is in
flight.

The once-ever key is written only when the modal actually renders, so
being bumped by another overlay leaves the user eligible next session."
```

---

### Task 6: Mocked E2E

**Files:**
- Create: `e2e/fact-modal.mock.spec.js`

**Interfaces:**
- Consumes: `maybeShowFactModal`, `openFactModal`, `#fact-modal`, `db.rpc('peek_watch_fact')`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing E2E spec**

Create `e2e/fact-modal.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

// Drives maybeShowFactModal directly with stubbed globals. The point is the
// gating and the CTA, not the sign-in path — which other specs already cover.
async function setup(page, { logs = [], alreadyShown = false, needsGeneration = false, overlayOpen = false } = {}) {
  await page.goto('/');
  await page.evaluate(({ logs, alreadyShown, needsGeneration, overlayOpen }) => {
    window.currentUser = { id: 'u1' };
    window._isDemoMode = false;
    window.watches = [
      { id: 'w1', brand: 'Seiko', name: 'SKX007', createdAt: '2026-01-01' },
      { id: 'w2', brand: 'Rolex', name: 'Explorer', createdAt: '2026-02-01' },
    ];
    window.logs = logs;
    localStorage.removeItem('wrotate_fact_modal_shown_u1');
    if (alreadyShown) localStorage.setItem('wrotate_fact_modal_shown_u1', '1');

    window.__rpcCalls = [];
    window.db.rpc = async (name, args) => {
      window.__rpcCalls.push({ name, args });
      if (name === 'peek_watch_fact') {
        return needsGeneration
          ? { data: { fact_id: null, fact: null, needs_generation: true }, error: null }
          : { data: { fact_id: 'f1', fact: 'A genuinely interesting fact about this watch.', needs_generation: false }, error: null };
      }
      return { data: null, error: null };
    };

    window.__trackOpened = null;
    window.openTrackModal = (id) => { window.__trackOpened = id; };

    if (overlayOpen) document.getElementById('push-primer-modal').classList.remove('hidden');
  }, { logs, alreadyShown, needsGeneration, overlayOpen });
}

const visible = (page) => page.evaluate(() =>
  !document.getElementById('fact-modal').classList.contains('hidden'));

test.describe('Login fun-fact modal (mocked)', () => {
  test('appears for an eligible user, featuring the most recently added watch', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(true);
    // No wears at all → falls back to newest added (w2, the Rolex).
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'peek_watch_fact'));
    expect(call.args).toEqual({ p_brand: 'Rolex', p_name: 'Explorer' });
    await expect(page.locator('#fact-modal-eyebrow')).toContainText('Rolex Explorer');
    await expect(page.locator('#fact-modal-card')).toContainText('A genuinely interesting fact');
  });

  test('features the most-worn watch when wears exist', async ({ page }) => {
    await setup(page, { logs: [
      { watchId: 'w1', date: '2020-01-01', useCase: 'unspecified' },
      { watchId: 'w1', date: '2020-01-02', useCase: 'unspecified' },
      { watchId: 'w2', date: '2020-01-03', useCase: 'unspecified' },
    ] });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'peek_watch_fact'));
    expect(call.args).toEqual({ p_brand: 'Seiko', p_name: 'SKX007' });
  });

  test('does not appear when another overlay is already open', async ({ page }) => {
    await setup(page, { overlayOpen: true });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
    // And it stays eligible — the once-ever key must not have been written.
    expect(await page.evaluate(() => localStorage.getItem('wrotate_fact_modal_shown_u1'))).toBe(null);
  });

  test('does not appear once already shown', async ({ page }) => {
    await setup(page, { alreadyShown: true });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
  });

  test('does not appear for someone who already logged a wear today', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      window.logs = [{ watchId: 'w1', date: todayStr(), useCase: 'unspecified' }];
    });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
  });

  test('skips silently rather than showing a spinner when no fact is ready', async ({ page }) => {
    await setup(page, { needsGeneration: true });
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
    // Stays eligible for a later session once the pool is warm.
    expect(await page.evaluate(() => localStorage.getItem('wrotate_fact_modal_shown_u1'))).toBe(null);
  });

  test('"Log this watch" opens the track modal for that watch', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    await page.click('#fact-modal button.btn-primary');
    expect(await page.evaluate(() => window.__trackOpened)).toBe('w2');
    expect(await visible(page)).toBe(false);
  });

  test('"Maybe later" closes it and it does not return', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    await page.click('#fact-modal button.btn-ghost');
    expect(await visible(page)).toBe(false);
    await page.evaluate(() => maybeShowFactModal());
    await page.waitForTimeout(900);
    expect(await visible(page)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
npm run test:e2e -- e2e/fact-modal.mock.spec.js
```
Expected: this should now PASS, because Tasks 4 and 5 already landed the implementation. If any test fails, the failure is a real defect in Task 4/5 — fix the implementation, not the test. Most likely causes: the once-ever key being written before the modal renders, or the overlay check running before the `await`.

- [ ] **Step 3: Run the whole E2E suite**

Run:
```bash
npm run test:e2e
```
Expected: all pass. Note two specs in this suite are known to flake intermittently near a UTC day boundary (`worn today` badge and the `tg_piezo` source selector). If one fails, re-run that single spec to confirm before treating it as a regression.

- [ ] **Step 4: Commit**

```bash
git add e2e/fact-modal.mock.spec.js
git commit -m "test: mocked E2E for the login fun-fact modal

Covers appearance and watch selection, the three suppression paths
(overlay open, already shown, already logged today), the
needs_generation skip, and both CTAs. Asserts the once-ever key is NOT
written on the skip paths — being bumped must leave the user eligible."
```

---

### Task 7: Verify against real data, then ship

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm the pool is warm enough to matter**

Run:
```bash
npx supabase db query --linked "
select count(*) as active_with_watches,
       count(*) filter (where fact is not null) as fact_ready,
       round(100.0 * count(*) filter (where fact is not null) / nullif(count(*),0)) as pct_ready
from active_users_with_watches(30) a
join lateral (select * from fun_fact_vars(array[a.user_id])) f on true;"
```
Expected: `pct_ready` at or near 100. If it is low, re-run Task 2 Step 7 — shipping with a cold pool means most users silently get nothing.

- [ ] **Step 2: Exercise the real path in the running app**

The dev server runs at `http://localhost:3000`. Sign in as testuser and confirm the modal renders with a real fact from the real RPC:

```bash
cat > /tmp/verify-fact-modal.mjs <<'EOF'
import { chromium } from '/Users/ozgurdogan/Documents/Claude project/watch tracker/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('[page error]', e.message));
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const c = window.__DEV_CREDS__;
  await db.auth.signInWithPassword({ email: c.email, password: c.password });
});
await page.waitForTimeout(3000);
const out = await page.evaluate(async () => {
  const w = pickFactModalWatch(watches, logs);
  if (!w) return { error: 'no usable watch' };
  const { data, error } = await db.rpc('peek_watch_fact', { p_brand: w.brand, p_name: w.name });
  return { watch: `${w.brand} ${w.name}`, error: error?.message, data };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
EOF
node /tmp/verify-fact-modal.mjs
```
Expected: a real watch label and `data.needs_generation === false` with a non-empty `fact`. An RLS or grant problem would show as an error here rather than in the mocked tests.

- [ ] **Step 3: Reset the test user's cursor**

Step 2 advanced testuser's cursor for that model. Undo it:
```bash
npx supabase db query --linked "
delete from watch_fact_progress where user_id='e0af1615-b151-4260-b6bd-c23e497efa6d';"
rm -f /tmp/verify-fact-modal.mjs
```

- [ ] **Step 4: Full pre-push check**

Run:
```bash
npm test && npm run test:e2e
```
Expected: 1500+ unit tests and 160+ mocked E2E all pass.

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Confirm the deploy is live**

Run:
```bash
until curl -s "https://wrotate.com/sw.js?cb=$RANDOM" | grep -q "wristlog-v955"; do sleep 5; done
curl -s "https://wrotate.com/?cb=$RANDOM" | grep -c "maybeShowFactModal"
```
Expected: the loop exits (production serving v955) and the grep reports `4`.

---

## Post-Ship

Per the spec's Rollout section, measure the share of the 56 no-log watch owners who log a wear within 7 days of first seeing the modal:

```sql
select count(*) filter (where seen) as saw_modal,
       count(*) filter (where seen and logged_after) as logged_within_7d
from ( /* join fact_modal_shown PostHog events against logs.created_at */ ) t;
```

The `fact_modal_shown` and `fact_modal_log_clicked` PostHog events added in Task 4 are the data source. Note this needs the PostHog query key described in `reference_posthog_analytics` — see `docs/` for how to read PostHog (team 358845, HogQL via `@current`).
