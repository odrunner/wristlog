# Onboarding Email Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A behavior-aware 3-email onboarding drip (day 2/5/9: add watch → start streak → measure), each skipped per-user if already done, with the copy editable in the admin Campaigns tab.

**Architecture:** Reuse the existing `run-campaign` drip engine. Add one nullable `email_campaigns.skip_if_done` column; in `run-campaign`, after the signup-window + eligibility filter, drop users who already did the action (query `watches`/`logs`/`timegrapher_results` for the candidate IDs). A pure deno-tested helper does the filter; `index.ts` does the query. Expose `skip_if_done` in the admin campaign editor. Seed 3 paused rows the user edits/activates.

**Tech Stack:** Deno edge function (`run-campaign`), `deno test`, vanilla JS admin UI in `index.html`, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-06-22-onboarding-email-sequence-design.md`

## Global Constraints

- **`skip_if_done` values:** `null` (send to all — today's behavior), `'has_watch'` → `watches`, `'has_log'` → `logs`, `'has_measurement'` → `timegrapher_results`. Unknown value → treated as `null` (no skip), never "drop everyone".
- **Skip runs AFTER** `filterEligible` (internal/opt-out) and **BEFORE** the `email_campaign_sends` dedup; it only reduces recipients, never re-sends.
- **Fail safe:** if the skip query errors, **skip the whole campaign for this run** (log + `continue`), matching the existing send-history fail-safe — never send unfiltered.
- All `skip` tables match on `user_id`. Candidate sets are small (one signup-day cohort).
- Deno imports: `jsr:@std/assert` for tests. Deno deploy uses `--no-verify-jwt`. `run-campaign` is **not** in `npm run test:smoke`.
- Admin UI is in `index.html`; bump `sw.js` (`wristlog-vNN`) for the HTML/JS change. Pre-commit hook auto-bumps `APP_VERSION` — expected; leave it.
- Product name `WRotate`. No change to other campaigns, `send-broadcast`, dedup, or opt-out paths.
- The DB column add + seeding 3 rows + `run-campaign` deploy are **gated to the human** (see end). Subagents do code + local tests only; no `supabase` commands.

---

### Task 1: Pure skip helpers + deno tests

**Files:**
- Modify: `supabase/functions/run-campaign/lib.ts` (add `KNOWN_SKIPS`, `skipTable`, `dropDone`)
- Modify: `supabase/functions/run-campaign/lib.test.ts` (tests)

**Interfaces:**
- Produces: `skipTable(skipKey: string | null | undefined): string | null`; `dropDone<T extends {id:string}>(users: T[], doneIds: Iterable<string>): T[]`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/run-campaign/lib.test.ts` (the file imports from `./lib.ts` with `jsr:@std/assert` — add `skipTable, dropDone` to that import):

```ts
Deno.test("skipTable maps known keys to tables", () => {
  assertEquals(skipTable("has_watch"), "watches");
  assertEquals(skipTable("has_log"), "logs");
  assertEquals(skipTable("has_measurement"), "timegrapher_results");
});

Deno.test("skipTable returns null for null/empty/unknown (never drops everyone)", () => {
  assertEquals(skipTable(null), null);
  assertEquals(skipTable(undefined), null);
  assertEquals(skipTable(""), null);
  assertEquals(skipTable("has_bogus"), null);
});

Deno.test("dropDone removes users whose id is in doneIds, keeps the rest", () => {
  const users = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assertEquals(dropDone(users, ["b"]), [{ id: "a" }, { id: "c" }]);
  assertEquals(dropDone(users, new Set(["a", "c"])), [{ id: "b" }]);
  assertEquals(dropDone(users, []), users);
  assertEquals(dropDone(users, ["a", "b", "c"]), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test supabase/functions/run-campaign/lib.test.ts`
Expected: FAIL — `skipTable`/`dropDone` not exported.

- [ ] **Step 3: Implement in `lib.ts`**

Add to `supabase/functions/run-campaign/lib.ts`:

```ts
// Behavior-aware skip: which table proves a user already did the action.
// Unknown/empty → null (no skip), so a typo can never drop the whole cohort.
export const KNOWN_SKIPS: Record<string, string> = {
  has_watch: "watches",
  has_log: "logs",
  has_measurement: "timegrapher_results",
};

export function skipTable(skipKey: string | null | undefined): string | null {
  if (!skipKey) return null;
  return KNOWN_SKIPS[skipKey] ?? null;
}

export function dropDone<T extends { id: string }>(
  users: T[],
  doneIds: Iterable<string>,
): T[] {
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds);
  return users.filter((u) => !done.has(u.id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test supabase/functions/run-campaign/lib.test.ts`
Expected: PASS (all, including the pre-existing lib tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/run-campaign/lib.ts supabase/functions/run-campaign/lib.test.ts
git commit -m "feat(run-campaign): skipTable + dropDone helpers for behavior-aware skip"
```

---

### Task 2: Wire the skip into `run-campaign/index.ts`

**Files:**
- Modify: `supabase/functions/run-campaign/index.ts` (import helpers; apply skip in the per-campaign loop)

**Interfaces:**
- Consumes: `skipTable`, `dropDone` from Task 1; `campaign.skip_if_done` (present because the campaigns fetch uses `.select("*")`).

- [ ] **Step 1: Import the helpers**

In `supabase/functions/run-campaign/index.ts`, add `skipTable` and `dropDone` to the existing import from `./lib.ts` (which already imports `signupWindow, filterEligible, splitAlreadySent`, etc.).

- [ ] **Step 2: Apply the skip after `filterEligible`, before the send-history dedup**

Locate this block (the eligible filter + its empty check, ~`index.ts:127-133`):

```ts
      // Filter: not internal, not unsubscribed from updates, not already sent
      let users = filterEligible(eligible || [], internalIds);

      if (!users.length) {
        console.log(`[run-campaign] "${name}": no eligible users in window`);
        results[name] = { sent: 0, skipped: 0, failed: 0 };
        continue;
      }
```

Immediately AFTER that block, insert:

```ts
      // Behavior-aware skip: drop users who already did the campaign's target action.
      const skipTbl = skipTable(campaign.skip_if_done);
      if (skipTbl) {
        const { data: doneRows, error: doneErr } = await supabase
          .from(skipTbl)
          .select("user_id")
          .in("user_id", users.map((u) => u.id));
        if (doneErr) {
          // Fail safe: never send unfiltered. Skip this campaign this run; retry next day.
          console.error(`[run-campaign] "${name}": skip query (${skipTbl}) failed — skipping:`, doneErr);
          results[name] = { sent: 0, skipped: users.length, failed: 0 };
          continue;
        }
        users = dropDone(users, (doneRows || []).map((r) => r.user_id));
        if (!users.length) {
          console.log(`[run-campaign] "${name}": all eligible already did the action`);
          results[name] = { sent: 0, skipped: 0, failed: 0 };
          continue;
        }
      }
```

(`campaign` is the loop variable; `skip_if_done` rides in via `.select("*")` — no change to the campaigns fetch.)

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/run-campaign/index.ts`
Expected: no type errors. (If `campaign` is implicitly typed and `.skip_if_done` errors, read the campaign destructure at ~`index.ts:106` and add `skip_if_done` there, or access via `campaign.skip_if_done` with the existing typing — keep it compiling.)

- [ ] **Step 4: Re-run the lib tests (unchanged) to confirm nothing broke**

Run: `deno test supabase/functions/run-campaign/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/run-campaign/index.ts
git commit -m "feat(run-campaign): apply behavior-aware skip_if_done filter (fail-safe)"
```

---

### Task 3: `skip_if_done` control in the admin Campaigns editor

**Files:**
- Modify: `index.html` — campaign card render in `loadCampaigns()` (~`index.html:14715`), `saveCampaign()` (~`14808`), `createCampaign()` (~`14788`)
- Modify: `sw.js` (cache bump)

**Interfaces:**
- Consumes: `c.skip_if_done` on campaign rows; `db.from('email_campaigns')`.

- [ ] **Step 1: Add the dropdown to the campaign card**

In `loadCampaigns()`'s `cardHtml`, immediately after the Delay `draft-form-row` (the `camp-delay-${c.id}` block, ~`index.html:14715-14718`) and before the buttons row, insert:

```js
      <div class="draft-form-row" style="margin-bottom:.4rem;">
        <label>Skip if user already…</label>
        <select id="camp-skip-${c.id}" style="font-size:.82rem;">
          <option value="" ${!c.skip_if_done ? 'selected' : ''}>Don't skip — send to everyone</option>
          <option value="has_watch" ${c.skip_if_done === 'has_watch' ? 'selected' : ''}>Has added a watch</option>
          <option value="has_log" ${c.skip_if_done === 'has_log' ? 'selected' : ''}>Has logged activity</option>
          <option value="has_measurement" ${c.skip_if_done === 'has_measurement' ? 'selected' : ''}>Has measured a watch</option>
        </select>
      </div>
```

- [ ] **Step 2: Persist it in `saveCampaign()`**

In `saveCampaign(id)`, after the `if (delayEl) update.delay_days = ...` line and before the `if (!subject || !body_html)` guard, add:

```js
  const skipEl = document.getElementById('camp-skip-' + id);
  if (skipEl) update.skip_if_done = skipEl.value || null;
```

- [ ] **Step 3: Default it in `createCampaign()`**

In `createCampaign()`'s `db.from('email_campaigns').insert({...})`, add `skip_if_done: null,` to the inserted object (a new campaign is a plain send-to-all by default).

- [ ] **Step 4: Bump the SW cache version**

`grep -n "wristlog-v" sw.js`, then increment the number by one in `sw.js`.

- [ ] **Step 5: Run the unit suite (regression — no JS test covers this UI, but confirm nothing broke)**

Run: `npm test`
Expected: PASS (1162). (The admin editor isn't unit-tested; correctness is verified via UAT in the gated phase.)

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js
git commit -m "feat(admin): skip_if_done dropdown in the campaign editor"
```

---

## Gated production steps (human-run, after the code is merged)

Not subagent tasks — the controller runs these only on explicit go-ahead, then hands off to the user for self-serve activation.

- [ ] **G1: Add the column** (additive, safe):

```bash
npx supabase db query --linked "ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS skip_if_done TEXT;"
```

- [ ] **G2: Seed the 3 paused onboarding rows** (draft copy; `is_active=false`; user edits/activates in admin). Example for row 1 (repeat for 2 & 3 with their `delay_days`/`skip_if_done`/copy from the spec):

```bash
npx supabase db query --linked "INSERT INTO email_campaigns (name, subject, body_html, delay_days, is_active, campaign_type, skip_if_done) VALUES ('Onboarding 1 — Add a watch', 'Add your first watch', '<draft html>', 2, false, 'drip', 'has_watch');"
```

- [ ] **G3: Deploy** `npx supabase functions deploy run-campaign --no-verify-jwt`. (Not covered by `npm run test:smoke`; verify via the admin **Send Test to Me** and **Run Now** buttons.)

- [ ] **G4: Hand off** — user opens admin → Campaigns: edits copy, sends a test, pauses "3 things", sets each row's skip dropdown (pre-seeded), and toggles the 3 Active when ready.

## Self-Review

**Spec coverage:**
- `skip_if_done` column (additive, null=current) → G1 + Global Constraints. ✅
- Per-user skip after eligibility, before dedup, fail-safe → Task 2. ✅
- Skip sources `watches`/`logs`/`timegrapher_results` → Task 1 `KNOWN_SKIPS`. ✅
- Unknown value → no skip (defensive) → Task 1 `skipTable`. ✅
- Admin editor `skip_if_done` dropdown + save + create default → Task 3. ✅
- 3 seeded paused rows, user-activated; "3 things" paused by user → G2/G4. ✅
- No change to dedup/opt-out/other campaigns → only additive code paths. ✅
- SW bump → Task 3 Step 4. ✅

**Placeholder scan:** `<draft html>` in G2 is a human-run seed value (copy from the spec's draft table), not a code placeholder; all code steps are complete. ✅

**Type/name consistency:** `skipTable(skipKey) → string|null` and `dropDone(users, doneIds) → users` defined in Task 1, consumed in Task 2; `KNOWN_SKIPS` keys (`has_watch`/`has_log`/`has_measurement`) match the admin dropdown values (Task 3) and the seed `skip_if_done` (G2). DOM ids `camp-skip-${id}` consistent between render (Step 1) and save (Step 2). ✅
