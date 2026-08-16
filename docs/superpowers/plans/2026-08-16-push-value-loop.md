# Push Value Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make push worth having (watch-specific wear reminders, re-measure/drift reminders built from unsaved measurements, one-tap repeat logging, unsaved readings surfaced in-app), then make push reachable (provisional authorization + deferred hard ask in the post-2.5 iOS build).

**Architecture:** A DB trigger captures every measurement `session_summary` into a queryable `measurement_sessions` table (server-side, no bulk reads). Web JS reads it for "Unsaved readings" and re-measure copy. Two edge functions send push (existing `send-wear-reminders` gets watch-specific copy; new `send-measure-reminders` sends re-measure/drift). The web layer gains a one-tap "Log it" banner and `openPushRoute()`. The native build swaps the cold ask for `.provisional`, adds a generic route fallback, and reports token app-version so payload routes only go to builds that can handle them.

**Tech Stack:** Vanilla JS in `index.html` (pure helpers mirrored in `wrotate_test.js`, vitest), Postgres SQL in `sql/` deployed with `npx supabase db query --linked --file`, Deno edge functions under `supabase/functions/`, Swift in `ios/Wrotate/Wrotate/`.

**Spec:** `docs/superpowers/specs/2026-08-16-push-value-loop-design.md`

## Global Constraints
- Phases A–D are web/DB/edge and must work on every current iOS build and on the web. Phase E is native and rides the build after 2.5 (version **2.6**, `_iosAppVersion = '2.6'`).
- No push payload may carry a `w.route` the shipped native switch (`post|profile|club|badges|bell`) can't handle, unless the token row's `app_version >= 2.6` (Task 15). Unknown routes on old builds open the bell.
- Never bulk-read `timegrapher_tick_logs` through PostgREST. Backfill runs server-side, one week per statement.
- Bump `sw.js` `CACHE = 'wristlog-vNNNN'` on every `index.html` change. Run `npm test` before every commit. Deploy edge functions with `--no-verify-jwt`, then `npm run test:smoke`.
- Help / What's New: features only (Unsaved readings, Log-again banner, re-measure reminders). Never bug fixes.
- Copy uses "we". Email CTAs link to `https://wrotate.com/open`.
- Internal accounts (`internal_accounts` table) are excluded from every reminder RPC.
- Deploying SQL that changes an RPC's return type: `DROP FUNCTION` first. After any new RPC: `NOTIFY pgrst, 'reload schema';`.

---

## Phase A — capture measurement sessions

### Task 1: `measurement_sessions` table + trigger + backfill + RPC

**Files:**
- Create: `sql/2026-08-16-measurement-sessions.sql`
- Test: `tests/measurement-sessions-sql.test.js`

**Interfaces:**
- Produces: table `measurement_sessions(id bigserial, session_id text unique, user_id uuid, watch_id uuid, rate numeric, converged bool, stop_reason text, algo text, amplitude int, duration_sec int, created_at timestamptz, saved_result_id uuid, dismissed_at timestamptz)`; RPC `unsaved_measurement_sessions(p_watch uuid) RETURNS SETOF measurement_sessions` (own rows, converged, unsaved, undismissed, last 30 d, not within 5 min of an existing `timegrapher_results` row for the same watch).

- [ ] **Step 1: Write the failing test**

```js
// tests/measurement-sessions-sql.test.js
// Guards sql/2026-08-16-measurement-sessions.sql, deployed straight to Supabase.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-16-measurement-sessions.sql'), 'utf8');

describe('measurement_sessions capture', () => {
  it('trigger only fires on session_summary rows and never blocks the log insert', () => {
    expect(sql).toMatch(/WHEN \(NEW\.messages LIKE '\{"type":"session_summary"%'\)/);
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(sql).toMatch(/RETURN NEW;/);
  });
  it('trigger function is SECURITY DEFINER (tick-log inserts run as anon)', () => {
    const i = sql.indexOf('capture_measurement_session()');
    expect(sql.slice(i, i + 400)).toMatch(/SECURITY DEFINER/);
  });
  it('one row per session', () => {
    expect(sql).toMatch(/session_id\s+text\s+UNIQUE/);
    expect(sql).toMatch(/ON CONFLICT \(session_id\) DO NOTHING/);
  });
  it('RLS: users read + update only their own rows, nobody inserts from the client', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FOR SELECT USING \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/FOR UPDATE USING \(auth\.uid\(\) = user_id\)/);
    expect(sql).not.toMatch(/FOR INSERT/);
  });
  it('unsaved RPC excludes sessions within 5 minutes of a saved reading on the same watch', () => {
    const i = sql.indexOf('unsaved_measurement_sessions');
    const body = sql.slice(i);
    expect(body).toMatch(/interval '5 minutes'/);
    expect(body).toMatch(/saved_result_id IS NULL/);
    expect(body).toMatch(/dismissed_at IS NULL/);
    expect(body).toMatch(/converged/);
    expect(body).toMatch(/interval '30 days'/);
  });
  it('backfill is chunked by week and parses with regex, not a jsonb cast of the whole row', () => {
    expect(sql).toMatch(/generate_series/);
    expect(sql).toMatch(/substring\(t\.messages from '"native_rate":\(-\?\[0-9.\]\+\)'\)/);
    expect(sql).not.toMatch(/messages::jsonb/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/measurement-sessions-sql.test.js`
Expected: FAIL — ENOENT on the sql file.

- [ ] **Step 3: Write the SQL**

```sql
-- sql/2026-08-16-measurement-sessions.sql
-- Every measurement (saved or not) writes ONE {"type":"session_summary",...} row into
-- timegrapher_tick_logs. 75% of converged sessions are never saved to timegrapher_results,
-- so this captures the summary into a queryable table at write time. Regex parsing, not
-- ::jsonb — the summary carries tick_data arrays; we only want eight scalars.

CREATE TABLE IF NOT EXISTS measurement_sessions (
  id              bigserial PRIMARY KEY,
  session_id      text UNIQUE,
  user_id         uuid NOT NULL,
  watch_id        uuid,
  rate            numeric,
  converged       boolean NOT NULL DEFAULT false,
  stop_reason     text,
  algo            text,
  amplitude       integer,
  duration_sec    integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  saved_result_id uuid,
  dismissed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS measurement_sessions_user_watch_idx ON measurement_sessions (user_id, watch_id, created_at DESC);

ALTER TABLE measurement_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ms_select_own ON measurement_sessions;
CREATE POLICY ms_select_own ON measurement_sessions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS ms_update_own ON measurement_sessions;
CREATE POLICY ms_update_own ON measurement_sessions FOR UPDATE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION capture_measurement_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO measurement_sessions (session_id, user_id, watch_id, rate, converged, stop_reason, algo, amplitude, duration_sec, created_at)
  VALUES (
    NEW.session_id,
    substring(NEW.messages from '"user_id":"([0-9a-f-]{36})"')::uuid,
    substring(NEW.messages from '"watch_id":"([0-9a-f-]{36})"')::uuid,
    substring(NEW.messages from '"native_rate":(-?[0-9.]+)')::numeric,
    COALESCE(substring(NEW.messages from '"converged":(true|false)') = 'true', false),
    substring(NEW.messages from '"stop_reason":"([a-z_]+)"'),
    substring(NEW.messages from '"algo":"([a-z_]+)"'),
    substring(NEW.messages from '"amplitude":([0-9]+)')::integer,
    substring(NEW.messages from '"duration_sec":([0-9]+)')::integer,
    NEW.created_at
  )
  ON CONFLICT (session_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a parse problem block the tick-log insert the client is waiting on.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_measurement_session ON timegrapher_tick_logs;
CREATE TRIGGER trg_capture_measurement_session
  AFTER INSERT ON timegrapher_tick_logs
  FOR EACH ROW WHEN (NEW.messages LIKE '{"type":"session_summary"%')
  EXECUTE FUNCTION capture_measurement_session();

-- Unsaved, converged sessions on one watch for the calling user (RLS applies).
-- A session within 5 minutes of a saved reading on the same watch is treated as saved
-- (pre-existing rows have no saved_result_id link).
CREATE OR REPLACE FUNCTION unsaved_measurement_sessions(p_watch uuid)
RETURNS SETOF measurement_sessions LANGUAGE sql STABLE AS $$
  SELECT s.* FROM measurement_sessions s
  WHERE s.user_id = auth.uid() AND s.watch_id = p_watch
    AND s.converged AND s.rate IS NOT NULL
    AND s.saved_result_id IS NULL AND s.dismissed_at IS NULL
    AND s.created_at > now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM timegrapher_results r
                    WHERE r.user_id = s.user_id AND r.watch_id = s.watch_id
                      AND r.created_at BETWEEN s.created_at - interval '5 minutes' AND s.created_at + interval '5 minutes')
  ORDER BY s.created_at DESC LIMIT 10;
$$;

NOTIFY pgrst, 'reload schema';

-- Backfill: last 90 days, one week per statement (run each in turn; each is idempotent).
-- Runs INSIDE Postgres — this is not the PostgREST bulk read that caused the 2026-08-13 outage.
DO $$
DECLARE wk timestamptz;
BEGIN
  FOR wk IN SELECT generate_series(date_trunc('week', now() - interval '90 days'), date_trunc('week', now()), interval '1 week') LOOP
    INSERT INTO measurement_sessions (session_id, user_id, watch_id, rate, converged, stop_reason, algo, amplitude, duration_sec, created_at)
    SELECT t.session_id,
      substring(t.messages from '"user_id":"([0-9a-f-]{36})"')::uuid,
      substring(t.messages from '"watch_id":"([0-9a-f-]{36})"')::uuid,
      substring(t.messages from '"native_rate":(-?[0-9.]+)')::numeric,
      COALESCE(substring(t.messages from '"converged":(true|false)') = 'true', false),
      substring(t.messages from '"stop_reason":"([a-z_]+)"'),
      substring(t.messages from '"algo":"([a-z_]+)"'),
      substring(t.messages from '"amplitude":([0-9]+)')::integer,
      substring(t.messages from '"duration_sec":([0-9]+)')::integer,
      t.created_at
    FROM timegrapher_tick_logs t
    WHERE t.created_at >= wk AND t.created_at < wk + interval '1 week'
      AND t.messages LIKE '{"type":"session_summary"%'
      AND substring(t.messages from '"user_id":"([0-9a-f-]{36})"') IS NOT NULL
    ON CONFLICT (session_id) DO NOTHING;
  END LOOP;
END $$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/measurement-sessions-sql.test.js` — Expected: PASS.

- [ ] **Step 5: Deploy and verify against production**

Run: `npx supabase db query --linked --file sql/2026-08-16-measurement-sessions.sql`
Then verify:
```
npx supabase db query --linked "SELECT count(*), count(*) FILTER (WHERE converged) conv, count(distinct user_id) users FROM measurement_sessions"
```
Expected: roughly ≥5,000 rows / ≥2,000 converged / ≥200 users (60-day figures were 4,118 / 1,652 / 204).
Verify the trigger with a synthetic row for testuser (`test@wrotate.com`, look up its uuid in `profiles`), then delete it:
```
npx supabase db query --linked "INSERT INTO timegrapher_tick_logs (session_id, messages) VALUES ('plan-check-1', '{\"type\":\"session_summary\",\"user_id\":\"<TESTUSER_UUID>\",\"watch_id\":null,\"native_rate\":-2.4,\"stop_reason\":\"converged\",\"converged\":true,\"algo\":\"tg\",\"amplitude\":301,\"duration_sec\":17}'); SELECT session_id, rate, converged FROM measurement_sessions WHERE session_id='plan-check-1';"
npx supabase db query --linked "DELETE FROM measurement_sessions WHERE session_id='plan-check-1'; DELETE FROM timegrapher_tick_logs WHERE session_id='plan-check-1';"
```
Expected: one row, rate -2.4, converged true.
Verify the RPC as testuser: `SELECT set_config('request.jwt.claims', '{"sub":"<TESTUSER_UUID>"}', true); SELECT count(*) FROM unsaved_measurement_sessions('<any watch uuid owned by testuser>');` — returns without error.

- [ ] **Step 6: Commit**

```bash
git add sql/2026-08-16-measurement-sessions.sql tests/measurement-sessions-sql.test.js
git commit -m "db: capture every measurement session_summary into measurement_sessions (trigger + backfill + unsaved RPC)"
```

---

## Phase B — Unsaved readings in the app

### Task 2: "Unsaved readings" block on the watch accuracy panel + link saves to sessions

**Files:**
- Modify: `index.html` — `loadTgHistory()` (~line 30382), `persistMsrReading()` (~line 32151), add three functions after `deleteTgResult`
- Modify: `wrotate_test.js` — add `unsavedReadingLabel`
- Modify: `sw.js` — bump `CACHE`
- Test: `tests/unsaved-readings.test.js`

**Interfaces:**
- Consumes: RPC `unsaved_measurement_sessions(p_watch)` (Task 1); table `measurement_sessions` update policy.
- Produces: `unsavedReadingLabel(row, now)` → `{ rateStr, dateStr, ampStr }`; `keepUnsavedReading(sessionRowId)`, `dismissUnsavedReading(sessionRowId)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unsaved-readings.test.js
import { describe, it, expect } from 'vitest';
import { unsavedReadingLabel } from '../wrotate_test.js';

describe('unsavedReadingLabel', () => {
  const now = new Date('2026-08-16T12:00:00');
  it('formats a positive rate with sign and one decimal', () => {
    const l = unsavedReadingLabel({ rate: 6.24, amplitude: 301, created_at: '2026-08-14T09:00:00Z' }, now);
    expect(l.rateStr).toBe('+6.2 s/d');
    expect(l.ampStr).toBe('Amp: 301°');
  });
  it('formats a negative rate and no amplitude', () => {
    const l = unsavedReadingLabel({ rate: -2, amplitude: null, created_at: '2026-08-14T09:00:00Z' }, now);
    expect(l.rateStr).toBe('-2.0 s/d');
    expect(l.ampStr).toBe('');
  });
  it('says Today / Yesterday / N days ago', () => {
    expect(unsavedReadingLabel({ rate: 1, created_at: '2026-08-16T08:00:00' }, now).dateStr).toBe('Today');
    expect(unsavedReadingLabel({ rate: 1, created_at: '2026-08-15T08:00:00' }, now).dateStr).toBe('Yesterday');
    expect(unsavedReadingLabel({ rate: 1, created_at: '2026-08-10T08:00:00' }, now).dateStr).toBe('6 days ago');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unsaved-readings.test.js` — Expected: FAIL, `unsavedReadingLabel` is not exported.

- [ ] **Step 3: Add the pure helper to `wrotate_test.js` (export) and identically to `index.html` (no export), next to `hasWornToday`**

```js
// Label for one unsaved measurement session row (measurement_sessions).
export function unsavedReadingLabel(row, now = new Date()) {
  const r = Number(row.rate);
  const rateStr = (r > 0 ? '+' : r < 0 ? '-' : '') + Math.abs(r).toFixed(1) + ' s/d';
  const ampStr = row.amplitude ? 'Amp: ' + row.amplitude + '°' : '';
  const d = new Date(row.created_at);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const dateStr = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff + ' days ago';
  return { rateStr, dateStr, ampStr };
}
```

- [ ] **Step 4: Wire it into `loadTgHistory()` in `index.html`**

Right after `const listEl = document.getElementById('tg-history-list');` add a sibling container lookup and, at the END of `loadTgHistory` (after `updateAccuracySummary();` in the success path AND in the "No readings yet." early return, before `return`), call `loadUnsavedReadings()`. Simplest: replace the two `updateAccuracySummary(); return;` / trailing `updateAccuracySummary();` with `updateAccuracySummary(); loadUnsavedReadings();`. Then add after `deleteTgResult`:

```js
// ── Unsaved readings — converged sessions that were never saved (measurement_sessions) ──
async function loadUnsavedReadings() {
  let box = document.getElementById('tg-unsaved-box');
  const listEl = document.getElementById('tg-history-list');
  if (!box && listEl) { box = document.createElement('div'); box.id = 'tg-unsaved-box'; listEl.parentNode.insertBefore(box, listEl); }
  if (!box) return;
  if (!currentUser || _isDemoMode || !_tgWatchId) { box.innerHTML = ''; return; }
  const { data, error } = await db.rpc('unsaved_measurement_sessions', { p_watch: _tgWatchId });
  if (error || !data || !data.length) { box.innerHTML = ''; return; }
  box._rows = data;
  box.innerHTML = `<div style="margin:.35rem 0 .6rem;padding:.55rem .7rem;border:1px dashed var(--border);border-radius:var(--radius-sm);">
    <div style="font-size:.72rem;font-weight:600;color:var(--gold-text);letter-spacing:.04em;text-transform:uppercase;margin-bottom:.3rem;">Unsaved readings (${data.length})</div>
    ${data.map(r => { const l = unsavedReadingLabel(r); return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.3rem 0;font-size:.8rem;">
      <div><span style="font-weight:600;">${l.rateStr}</span>${l.ampStr ? `<span style="color:var(--muted);margin-left:.4rem;">${l.ampStr}</span>` : ''}<span style="color:var(--muted);margin-left:.4rem;font-size:.72rem;">${l.dateStr}</span></div>
      <div style="display:flex;gap:.6rem;align-items:center;">
        <button onclick="keepUnsavedReading(${r.id})" style="background:var(--gold);color:#fff;border:none;border-radius:6px;padding:.25rem .6rem;font-size:.72rem;font-weight:600;cursor:pointer;min-height:32px;">Keep</button>
        <button onclick="dismissUnsavedReading(${r.id})" aria-label="Dismiss" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;min-height:32px;">✕</button>
      </div></div>`; }).join('')}
  </div>`;
}
async function keepUnsavedReading(rowId) {
  if (demoGuard()) return;
  const box = document.getElementById('tg-unsaved-box');
  const r = box?._rows?.find(x => x.id === rowId);
  if (!r) return;
  const { data: ins, error } = await db.from('timegrapher_results').insert({
    user_id: currentUser.id, watch_id: r.watch_id, rate: r.rate, beat_error: null,
    bph: null, source: 'auto', notes: null, amplitude: r.amplitude, duration_seconds: r.duration_sec,
    tick_count: null, rate_std: null, position: null, tick_data: null,
  }).select('id').single();
  if (error) { toast('Could not save — ' + error.message, 'error'); return; }
  await db.from('measurement_sessions').update({ saved_result_id: ins.id }).eq('id', rowId);
  toast('Reading saved!');
  if (window.posthog) posthog.capture('accuracy_reading_saved', { source: 'auto', from: 'unsaved_readings' });
  loadTgHistory();
}
async function dismissUnsavedReading(rowId) {
  if (demoGuard()) return;
  await db.from('measurement_sessions').update({ dismissed_at: new Date().toISOString() }).eq('id', rowId);
  loadUnsavedReadings();
}
```

Check `bph` column nullability first: `SELECT is_nullable FROM information_schema.columns WHERE table_name='timegrapher_results' AND column_name='bph'`. If NOT NULL, use `bph: 28800` and read the session's bph — add `bph integer` to the Task 1 table/trigger/backfill (`substring(... '"bph":([0-9]+)')`) before shipping this task.

- [ ] **Step 5: Link a normal save to its session in `persistMsrReading()`**

Change the insert to `.select('id').single()` and after the `if (error) …` line add:
```js
    if (_tgDebugSessionId && data?.id) {
      db.from('measurement_sessions').update({ saved_result_id: data.id }).eq('session_id', _tgDebugSessionId).then(() => {});
    }
```
(`const { data, error } = await db.from('timegrapher_results').insert({...}).select('id').single();`)

- [ ] **Step 6: Bump `sw.js` CACHE, run tests**

`sed -i '' "s/wristlog-v1091/wristlog-v1092/" sw.js` (use the current number +1). Run: `npm test` — Expected: all pass, including the new file.

- [ ] **Step 7: UAT on the local dev server with testuser** — open a watch that has unsaved sessions (query `SELECT watch_id, count(*) FROM unsaved_measurement_sessions(...)` as testuser to find one, or insert a synthetic session row for a testuser watch as in Task 1 Step 5), confirm the block renders, Keep creates a `timegrapher_results` row and the block shrinks, ✕ hides the row and it stays hidden after reload.

- [ ] **Step 8: Help + What's New entry** — in the Timegrapher section of Help: "**Unsaved readings** — measurements you ran but didn't save appear above a watch's history for 30 days. Tap Keep to add one to the history." Add a matching What's New line for August.

- [ ] **Step 9: Commit**

```bash
git add index.html wrotate_test.js sw.js tests/unsaved-readings.test.js
git commit -m "measure: surface unsaved converged readings on the watch accuracy panel (Keep / dismiss); link saves to their session"
```

---

## Phase C — watch-specific reminders + one-tap "Log it" banner

### Task 3: reminder targets return the last-worn watch; push/email copy names it

**Files:**
- Create: `sql/2026-08-16-wear-reminder-last-watch.sql`
- Modify: `supabase/functions/send-wear-reminders/lib.ts` (`buildReminderPush`, `buildReminderEmail`), `supabase/functions/send-wear-reminders/index.ts` (call sites), `supabase/functions/send-wear-reminders/lib.test.ts`

**Interfaces:**
- Produces: `wear_reminder_targets()` now returns `(user_id uuid, email text, channel text, local_today date, last_watch_id uuid, last_brand text, last_name text)`; `buildReminderPush(w?: {brand: string; name: string} | null)`, `buildReminderEmail(w?)` same shape.

- [ ] **Step 1: Failing Deno tests** — replace the two existing `buildReminderPush`/`buildReminderEmail` tests in `lib.test.ts` with:

```ts
Deno.test("buildReminderPush — names the last-worn watch when known", () => {
  const m = buildReminderPush({ brand: "Omega", name: "Seamaster" });
  assertEquals(m.title, "WRotate");
  assertEquals(m.body, "Wearing the Omega Seamaster again today? Tap to log it — or pick another watch.");
});
Deno.test("buildReminderPush — generic nudge when no watch is known", () => {
  assertStringIncludes(buildReminderPush(null).body, "What did you wear today");
  assertStringIncludes(buildReminderPush().body, "What did you wear today");
});
Deno.test("buildReminderEmail — names the watch, keeps the generic subject", () => {
  const e = buildReminderEmail({ brand: "Omega", name: "Seamaster" });
  assertStringIncludes(e.subject, "wrist");
  assertStringIncludes(e.body, "Omega Seamaster");
  assertStringIncludes(buildReminderEmail(null).body, "Log");
});
```
Run: `deno test --allow-read supabase/functions/send-wear-reminders/` — Expected: FAIL (arity / body mismatch).

- [ ] **Step 2: Implement in `lib.ts`**

```ts
export type LastWatch = { brand: string; name: string } | null | undefined;
const watchLabel = (w: LastWatch) => w ? [w.brand, w.name].filter(Boolean).join(" ").trim() : "";

export function buildReminderPush(w?: LastWatch): { title: string; body: string } {
  const label = watchLabel(w);
  if (label) return { title: "WRotate", body: `Wearing the ${label} again today? Tap to log it — or pick another watch.` };
  return { title: "WRotate", body: "What did you wear today? 🕰️ Log it before the day's out." };
}

export function buildReminderEmail(w?: LastWatch): { subject: string; body: string } {
  const label = watchLabel(w);
  return {
    subject: "What's on your wrist today?",
    body: label
      ? `Wearing the ${label} again today? Log it in WRotate before the day's out — or pick whatever's on your wrist. It keeps your wear history complete and your streak alive.`
      : "Wearing something today? Log it in WRotate before the day's out — it keeps your collection's wear history complete and your streak alive.",
  };
}
```
Escape `label` for HTML in the email path: in `index.ts` the body goes into `buildHtmlEmail`; add `const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));` and pass `{ brand: esc(t.last_brand ?? ''), name: esc(t.last_name ?? '') }` for email only (push is plain text — pass raw).

- [ ] **Step 3: SQL — replace the RPC**

```sql
-- sql/2026-08-16-wear-reminder-last-watch.sql
-- Adds the last-worn watch to each target so the reminder can name it.
DROP FUNCTION IF EXISTS wear_reminder_targets();
CREATE OR REPLACE FUNCTION wear_reminder_targets()
RETURNS TABLE (user_id uuid, email text, channel text, local_today date, last_watch_id uuid, last_brand text, last_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH valid AS MATERIALIZED (
    -- (verbatim from sql/2026-06-24-wear-reminders.sql)
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
  ),
  cand AS (
    -- (verbatim from sql/2026-06-24-wear-reminders.sql — copy the whole cand CTE unchanged)
    ...
  ),
  lastw AS (
    SELECT DISTINCT ON (l.user_id) l.user_id, w.id AS watch_id, w.brand, w.name
    FROM logs l JOIN watches w ON w.id = l.watch_id
    WHERE l.user_id IN (SELECT uid FROM cand)
    ORDER BY l.user_id, l.date DESC, l.created_at DESC
  )
  SELECT c.uid, u.email,
         CASE WHEN EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios') THEN 'push' ELSE 'email' END,
         c.local_today, lw.watch_id, lw.brand, lw.name
  FROM cand c
  JOIN auth.users u ON u.id = c.uid
  LEFT JOIN lastw lw ON lw.user_id = c.uid
  WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
     OR NOT EXISTS (SELECT 1 FROM wear_reminder_sends w WHERE w.user_id = c.uid AND w.channel = 'email' AND w.sent_on >= c.local_today - 7);
$$;
NOTIFY pgrst, 'reload schema';
```
Copy the `cand` CTE from `sql/2026-06-24-wear-reminders.sql` verbatim (do not retype it). Verify columns: `logs.date` is TEXT — `ORDER BY l.date DESC` still sorts ISO dates correctly.

- [ ] **Step 4: Wire `index.ts`** — change the row type to include the three new fields, and inside the loop replace the shared `push`/`mail` with per-target: `const lw = t.last_brand || t.last_name ? { brand: t.last_brand ?? '', name: t.last_name ?? '' } : null; const push = buildReminderPush(lw); const mail = buildReminderEmail(lw && { brand: esc(lw.brand), name: esc(lw.name) });` (delete the two pre-loop constants).

- [ ] **Step 5: Tests + deploy + verify**

`deno test --allow-read supabase/functions/send-wear-reminders/` → PASS. `npm test` → PASS.
Deploy SQL: `npx supabase db query --linked --file sql/2026-08-16-wear-reminder-last-watch.sql`. Verify the RPC returns the new columns without error: `npx supabase db query --linked "SELECT * FROM wear_reminder_targets() LIMIT 3"` (may be empty at this hour — that's fine; no error is the check). Deploy: `npx supabase functions deploy send-wear-reminders --no-verify-jwt` then `npm run test:smoke`.

- [ ] **Step 6: Commit**

```bash
git add sql/2026-08-16-wear-reminder-last-watch.sql supabase/functions/send-wear-reminders/
git commit -m "reminders: name the last-worn watch in the wear reminder push and email"
```

### Task 4: one-tap "Log it" banner (Track + foreground after 5 pm)

**Files:**
- Modify: `index.html` — `#reminder-banner` markup (~line 3412), `renderTrack()` (~19870), `visibilitychange` handler (~32562), boot after data load; add `maybeShowLogAgainBanner()`; `wrotate_test.js` + `index.html` pure `logAgainCandidate()`
- Modify: `sw.js`
- Test: `tests/log-again.test.js`

**Interfaces:**
- Produces: `logAgainCandidate({ logs, watches, today, hour, minHour = 17, lookbackDays = 14 })` → watch object or `null`; `maybeShowLogAgainBanner(force = false)`; `openPushRoute(route, id)` stub for `'track'` (Task 12 extends).

- [ ] **Step 1: Failing test**

```js
// tests/log-again.test.js
import { describe, it, expect } from 'vitest';
import { logAgainCandidate } from '../wrotate_test.js';
const watches = [{ id: 'w1', brand: 'Omega', name: 'Seamaster' }, { id: 'w2', brand: 'Seiko', name: 'SKX' }];
const base = { watches, today: '2026-08-16', hour: 18 };
describe('logAgainCandidate', () => {
  it('returns the most recently worn watch when nothing is logged today', () => {
    const logs = [{ watchId: 'w2', date: '2026-08-10' }, { watchId: 'w1', date: '2026-08-15' }];
    expect(logAgainCandidate({ ...base, logs }).id).toBe('w1');
  });
  it('is null before 5pm', () => {
    const logs = [{ watchId: 'w1', date: '2026-08-15' }];
    expect(logAgainCandidate({ ...base, logs, hour: 16 })).toBeNull();
  });
  it('is null when something is already logged today', () => {
    const logs = [{ watchId: 'w1', date: '2026-08-15' }, { watchId: 'w2', date: '2026-08-16' }];
    expect(logAgainCandidate({ ...base, logs })).toBeNull();
  });
  it('is null when the last log is older than 14 days', () => {
    const logs = [{ watchId: 'w1', date: '2026-07-20' }];
    expect(logAgainCandidate({ ...base, logs })).toBeNull();
  });
  it('is null when the last-worn watch no longer exists', () => {
    const logs = [{ watchId: 'gone', date: '2026-08-15' }];
    expect(logAgainCandidate({ ...base, logs })).toBeNull();
  });
});
```
Run: `npx vitest run tests/log-again.test.js` → FAIL (not exported).

- [ ] **Step 2: Pure helper (both files, next to `hasWornToday`)**

```js
// Which watch to offer as a one-tap "wearing it again?" log. Same audience rule as the
// server-side reminder: a log in the last `lookbackDays`, none today, and it's past `minHour`.
export function logAgainCandidate({ logs, watches, today, hour, minHour = 17, lookbackDays = 14 }) {
  if (hour < minHour) return null;
  if ((logs || []).some(l => l.date === today)) return null;
  const cutoff = new Date(today + 'T00:00:00'); cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const recent = (logs || []).filter(l => l.date && l.date >= cutoffStr && l.date < today).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!recent.length) return null;
  return (watches || []).find(w => w.id === recent[0].watchId) || null;
}
```

- [ ] **Step 3: Banner markup** — replace the body of `#reminder-banner` with:

```html
  <div id="reminder-banner" class="reminder-banner hidden" role="status">
    <div class="reminder-banner-icon"><!-- keep existing svg --></div>
    <div class="reminder-banner-body">
      <div class="reminder-banner-title" id="logagain-title">Wearing it again today?</div>
      <div style="display:flex;gap:.5rem;margin-top:.45rem;flex-wrap:wrap;">
        <button class="btn btn-primary" id="logagain-yes" style="min-height:36px;padding:.3rem .9rem;font-size:.8rem;">Log it</button>
        <button class="btn" id="logagain-other" style="min-height:36px;padding:.3rem .9rem;font-size:.8rem;" onclick="dismissReminder(); nav(document.querySelector('nav button[data-page=\'track\']'));">Different watch</button>
      </div>
    </div>
    <button class="reminder-banner-close" onclick="dismissReminder()" title="Dismiss" aria-label="Dismiss">✕</button>
  </div>
```

- [ ] **Step 4: Controller** — next to `showReminderBanner`:

```js
// One-tap "wearing it again?" — shown on Track and on foreground after 5pm local when the
// user has a log in the last 14 days and none today. Dismissal lasts the day (session).
function maybeShowLogAgainBanner(force = false, watchId = null) {
  if (!currentUser || _isDemoMode) return;
  const today = todayStr();
  if (!force && safeSS.get('wl_logagain_dismissed') === today) return;
  const cand = watchId ? watches.find(w => w.id === watchId) : logAgainCandidate({ logs, watches, today, hour: new Date().getHours() });
  if (!cand || hasWornToday(logs, cand.id, today)) return;
  const label = [cand.brand, cand.name].filter(Boolean).join(' ');
  document.getElementById('logagain-title').textContent = `Wearing the ${label} again today?`;
  document.getElementById('logagain-yes').onclick = () => { dismissReminder(); quickLog(cand.id); };
  showReminderBanner();
}
```
Update `dismissReminder()` to store today's date: `safeSS.set('wl_logagain_dismissed', todayStr());` (replace the `'1'`). Confirm `safeSS` exists (it is used by the old code); `watches` items carry `brand`/`name` (they do — see `logsForWatch`/`quickLog` usage). Call sites: at the end of `renderTrack(force)` add `maybeShowLogAgainBanner();`; in the `visibilitychange` visible branch, after the notification-poll resume block, add `if (currentUser) maybeShowLogAgainBanner();`; and add a minimal `function openPushRoute(route, id) { if (route === 'track') { nav(document.querySelector('nav button[data-page="track"]')); maybeShowLogAgainBanner(true, id || null); return; } if (typeof openNotifPanel === 'function') openNotifPanel(); }` next to it (Task 12 extends it).

- [ ] **Step 5: Tests, SW bump, UAT**

`npm test` → PASS. Bump `sw.js`. UAT with testuser on the dev server: with a log dated yesterday and none today, set the Mac clock past 5pm or temporarily call `maybeShowLogAgainBanner(true)` from the console — banner names the watch; "Log it" creates today's log and hides the banner; ✕ keeps it hidden after tab switches; "Different watch" lands on Track.

- [ ] **Step 6: Help + What's New** — Track section: "**Log it again** — after 5 pm, if you haven't logged today, Track offers yesterday's watch as a one-tap log." What's New line for August.

- [ ] **Step 7: Commit**

```bash
git add index.html wrotate_test.js sw.js tests/log-again.test.js
git commit -m "track: one-tap 'wearing it again?' banner after 5pm; openPushRoute('track') lands on it"
```

---

## Phase D — re-measure / drift push

### Task 5: `measure_reminder_sends` + `measure_reminder_targets()` RPC

**Files:**
- Create: `sql/2026-08-16-measure-reminders.sql`
- Test: `tests/measure-reminders-sql.test.js`

**Interfaces:**
- Produces: table `measure_reminder_sends(user_id uuid, watch_id uuid, sent_on date, PRIMARY KEY (user_id, sent_on))`; RPC `measure_reminder_targets()` → `(user_id uuid, watch_id uuid, brand text, name text, rate numeric, measured_at timestamptz, prior_rate numeric, prior_at timestamptz, local_today date)`.

- [ ] **Step 1: Failing test**

```js
// tests/measure-reminders-sql.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-16-measure-reminders.sql'), 'utf8');
describe('measure_reminder_targets', () => {
  it('push-only, local noon, opted-in, not internal, not suspended', () => {
    expect(sql).toMatch(/device_tokens/);
    expect(sql).toMatch(/= 12/);
    expect(sql).toMatch(/email_prefs->>'reminders'/);
    expect(sql).toMatch(/internal_accounts/);
    expect(sql).toMatch(/is_suspended/);
  });
  it('picks a watch measured 21–60 days ago with no session since, at most one reminder per 30 days', () => {
    expect(sql).toMatch(/interval '21 days'/);
    expect(sql).toMatch(/interval '60 days'/);
    expect(sql).toMatch(/interval '30 days'/);
    expect(sql).toMatch(/measure_reminder_sends/);
  });
  it('prior reading is at least 14 days before the last one', () => {
    expect(sql).toMatch(/interval '14 days'/);
  });
  it('is SECURITY DEFINER and reloads the schema', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
```
Run → FAIL (ENOENT).

- [ ] **Step 2: SQL**

```sql
-- sql/2026-08-16-measure-reminders.sql
CREATE TABLE IF NOT EXISTS measure_reminder_sends (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  watch_id uuid,
  sent_on  date NOT NULL,
  PRIMARY KEY (user_id, sent_on)
);

-- Who gets a re-measure nudge in THIS hourly run: local hour 12, push-capable,
-- one watch per user whose last converged session is 21–60 days old with nothing since,
-- and no measure reminder in the last 30 days.
CREATE OR REPLACE FUNCTION measure_reminder_targets()
RETURNS TABLE (user_id uuid, watch_id uuid, brand text, name text, rate numeric, measured_at timestamptz,
               prior_rate numeric, prior_at timestamptz, local_today date)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = p.id AND d.platform = 'ios')
  ),
  now_users AS (
    SELECT v.id, (now() AT TIME ZONE v.timezone)::date AS local_today
    FROM valid v
    WHERE EXTRACT(hour FROM now() AT TIME ZONE v.timezone) = 12
      AND NOT EXISTS (SELECT 1 FROM measure_reminder_sends m
                      WHERE m.user_id = v.id AND m.sent_on > (now() AT TIME ZONE v.timezone)::date - 30)
  ),
  last_conv AS (
    SELECT DISTINCT ON (s.user_id) s.user_id, s.watch_id, s.rate, s.created_at
    FROM measurement_sessions s
    WHERE s.user_id IN (SELECT id FROM now_users)
      AND s.converged AND s.rate IS NOT NULL AND s.watch_id IS NOT NULL
      AND s.created_at BETWEEN now() - interval '60 days' AND now() - interval '21 days'
      AND NOT EXISTS (SELECT 1 FROM measurement_sessions s2
                      WHERE s2.user_id = s.user_id AND s2.watch_id = s.watch_id
                        AND s2.created_at > now() - interval '21 days')
    ORDER BY s.user_id, s.created_at DESC
  ),
  prior AS (
    SELECT lc.user_id, p.rate AS prior_rate, p.created_at AS prior_at
    FROM last_conv lc
    JOIN LATERAL (
      SELECT s.rate, s.created_at FROM measurement_sessions s
      WHERE s.user_id = lc.user_id AND s.watch_id = lc.watch_id AND s.converged AND s.rate IS NOT NULL
        AND s.created_at < lc.created_at - interval '14 days'
      ORDER BY s.created_at DESC LIMIT 1
    ) p ON true
  )
  SELECT lc.user_id, lc.watch_id, w.brand, w.name, lc.rate, lc.created_at,
         pr.prior_rate, pr.prior_at, nu.local_today
  FROM last_conv lc
  JOIN now_users nu ON nu.id = lc.user_id
  JOIN watches w ON w.id = lc.watch_id AND w.user_id = lc.user_id
  LEFT JOIN prior pr ON pr.user_id = lc.user_id;
$$;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Test, deploy, dry-check**

`npx vitest run tests/measure-reminders-sql.test.js` → PASS. Deploy: `npx supabase db query --linked --file sql/2026-08-16-measure-reminders.sql`. Check the candidate pool ignoring the hour gate, to know the audience size before Task 6 sends anything:
```
npx supabase db query --linked "WITH x AS (SELECT s.user_id, s.watch_id, max(s.created_at) last FROM measurement_sessions s WHERE s.converged AND s.watch_id IS NOT NULL GROUP BY 1,2) SELECT count(*) FROM x WHERE last BETWEEN now()-interval '60 days' AND now()-interval '21 days' AND EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id=x.user_id)"
```
Record the number in the commit message.

- [ ] **Step 4: Commit**

```bash
git add sql/2026-08-16-measure-reminders.sql tests/measure-reminders-sql.test.js
git commit -m "db: measure_reminder_targets() + measure_reminder_sends — re-measure candidates from measurement_sessions"
```

### Task 6: `send-measure-reminders` edge function + hourly cron

**Files:**
- Create: `supabase/functions/send-measure-reminders/index.ts`, `lib.ts`, `lib.test.ts`
- Modify: `scripts/smoke-test-functions.js` (add a 401 check without the secret)
- Modify: `CLAUDE.md` (pg_cron list) 

**Interfaces:**
- Consumes: RPC `measure_reminder_targets()` (Task 5).
- Produces: `buildMeasurePush(t: { brand: string; name: string; rate: number; measured_at: string; prior_rate: number | null; prior_at: string | null }, now?: Date)` → `{ title, body }`; POST body `{"dry_run": true}` returns `{ candidates: [...] }` without sending.

- [ ] **Step 1: Failing Deno tests**

```ts
// supabase/functions/send-measure-reminders/lib.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildMeasurePush, fmtRate } from "./lib.ts";

Deno.test("fmtRate — sign and one decimal", () => {
  assertEquals(fmtRate(6.24), "+6.2 s/d");
  assertEquals(fmtRate(-2), "-2.0 s/d");
  assertEquals(fmtRate(0), "0.0 s/d");
});

Deno.test("buildMeasurePush — first reminder: re-measure to see if it's holding", () => {
  const m = buildMeasurePush({ brand: "Omega", name: "Speedmaster", rate: 6.24, measured_at: "2026-07-20T10:00:00Z", prior_rate: null, prior_at: null });
  assertEquals(m.title, "WRotate");
  assertEquals(m.body, "You measured your Omega Speedmaster at +6.2 s/d on Jul 20. Re-measure to see if it's holding.");
});

Deno.test("buildMeasurePush — with a prior reading: drift vs month", () => {
  const m = buildMeasurePush({ brand: "Omega", name: "Speedmaster", rate: 6.2, measured_at: "2026-07-20T10:00:00Z", prior_rate: 2.2, prior_at: "2026-06-05T10:00:00Z" });
  assertEquals(m.body, "Your Omega Speedmaster is running +6.2 s/d — 4.0 s/d faster than in June. Tap to re-measure.");
});

Deno.test("buildMeasurePush — faster / unchanged wording", () => {
  assertStringIncludes(buildMeasurePush({ brand: "A", name: "B", rate: -1, measured_at: "2026-07-20T10:00:00Z", prior_rate: 3, prior_at: "2026-06-05T10:00:00Z" }).body, "4.0 s/d slower than in June");
  assertStringIncludes(buildMeasurePush({ brand: "A", name: "B", rate: 3.04, measured_at: "2026-07-20T10:00:00Z", prior_rate: 3, prior_at: "2026-06-05T10:00:00Z" }).body, "same as in June");
});
```
Run: `deno test --allow-read supabase/functions/send-measure-reminders/` → FAIL.

- [ ] **Step 2: `lib.ts`** — copy `apnsHost`, `apnsDeviceUrl`, `createAPNsJWT`, `sendPush`, `buildAlertPayload`, `timingSafeEqual` VERBATIM from `supabase/functions/send-wear-reminders/lib.ts` (repo convention: no cross-function imports), then add:

```ts
export function fmtRate(r: number): string {
  const s = r > 0 ? "+" : r < 0 ? "-" : "";
  return `${s}${Math.abs(r).toFixed(1)} s/d`;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function buildMeasurePush(t: { brand: string; name: string; rate: number; measured_at: string; prior_rate: number | null; prior_at: string | null }): { title: string; body: string } {
  const label = [t.brand, t.name].filter(Boolean).join(" ").trim() || "watch";
  const rate = Number(t.rate);
  if (t.prior_rate == null || !t.prior_at) {
    const d = new Date(t.measured_at);
    return { title: "WRotate", body: `You measured your ${label} at ${fmtRate(rate)} on ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}. Re-measure to see if it's holding.` };
  }
  // A more positive rate means the watch runs FASTER (+6.2 vs +2.2 → "4.0 s/d faster").
  const delta = rate - Number(t.prior_rate);
  const mon = FULL[new Date(t.prior_at).getUTCMonth()];
  const cmp = Math.abs(delta) < 0.1 ? `same as in ${mon}` : `${Math.abs(delta).toFixed(1)} s/d ${delta > 0 ? "faster" : "slower"} than in ${mon}`;
  return { title: "WRotate", body: `Your ${label} is running ${fmtRate(rate)} — ${cmp}. Tap to re-measure.` };
}
```
Sanity: +6.2 vs +2.2 is 4.0 s/d **faster**; −1 vs +3 is 4.0 s/d **slower** — the Step 1 assertions encode exactly that.

- [ ] **Step 3: `index.ts`** — mirror `send-wear-reminders/index.ts` structure: secret gate → `supabase.rpc("measure_reminder_targets")` → if `body.dry_run` return `{ candidates: rows.map(r => ({ user_id: r.user_id, watch_id: r.watch_id, message: buildMeasurePush(r).body })) }` with no sends → else per row: fetch `device_tokens` (`platform='ios'`), `sendPush(token, buildMeasurePush(r), jwt, host)`, delete 410 tokens, on any success upsert `measure_reminder_sends { user_id, watch_id, sent_on: local_today }` (`onConflict: "user_id,sent_on", ignoreDuplicates: true`). **No `w` object in the payload** (Global Constraints) — Task 15 adds it. Return `{ pushed, failed, candidates }`.

- [ ] **Step 4: Tests, deploy, dry run, cron**

`deno test --allow-read supabase/functions/send-measure-reminders/` → PASS. Add to `scripts/smoke-test-functions.js` a check `send-measure-reminders (no secret → 401)` next to the existing send-wear-reminders check (copy its shape). Deploy: `npx supabase functions deploy send-measure-reminders --no-verify-jwt`; `npm run test:smoke` → PASS.
Dry run (secret from `CAMPAIGN_TRIGGER_SECRET`, visible in the cron commands): `curl -s -X POST https://api.wrotate.com/functions/v1/send-measure-reminders -H "x-campaign-secret: $SECRET" -H 'content-type: application/json' -d '{"dry_run":true}'` — expect a JSON list; read two messages for sanity (**this is a read; sending needs the user's go-ahead per CLAUDE.md**).
Schedule (after the user confirms sends may start): `npx supabase db query --linked "SELECT cron.schedule('send-measure-reminders-hourly', '10 * * * *', \$\$SELECT net.http_post(url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-measure-reminders', headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret','<SECRET>'), body := '{}'::jsonb) AS request_id;\$\$)"`. Add the job to the pg_cron list in `CLAUDE.md`.

- [ ] **Step 5: Help + What's New** — Timegrapher section: "**Re-measure reminders** — a few weeks after you measure a watch we send one push suggesting you check it again, and once there are two readings, how it has drifted. Off with the Daily reminders toggle." (Confirm the in-app toggle writes `email_prefs.reminders` — it does; the RPC honours it.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-measure-reminders/ scripts/smoke-test-functions.js CLAUDE.md index.html sw.js
git commit -m "push: re-measure / drift reminders from measurement_sessions (send-measure-reminders, hourly at local noon)"
```

---

## Phase E — native (post-2.5 build → 2.6)

### Task 7: bump versions together

**Files:** `ios/Wrotate/Wrotate.xcodeproj/project.pbxproj` (`MARKETING_VERSION = 2.6` ×2, `CURRENT_PROJECT_VERSION = 1` ×2), `ios/Wrotate/Wrotate/WebView.swift:139` (`window._iosAppVersion = '2.6'`), test `tests/ios-version-sync.test.js` if it exists (grep `_iosAppVersion` under `tests/`; update the expected value).

- [ ] Edit, `npm test`, commit: `git commit -m "ios: version 2.6 (provisional push build) — MARKETING_VERSION + _iosAppVersion together"`.

### Task 8: provisional at sign-in, distinct status, full ask on demand, token app-version

**Files:**
- Modify: `ios/Wrotate/Wrotate/PushManager.swift` — `statusString`, `requestPermissionAndRegister`, `handleSignIn`, `storeToken`
- Create: `sql/2026-08-16-device-tokens-app-version.sql`
- Test: `tests/push-provisional-native.test.js` (source-text guard, like `tests/push-primer-*.test.js` pattern — read the Swift file and assert)

- [ ] **Step 1: Failing test**

```js
// tests/push-provisional-native.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pm = readFileSync(join(root, 'ios/Wrotate/Wrotate/PushManager.swift'), 'utf8');
describe('2.6 push authorization', () => {
  it('sign-in asks provisionally (no OS dialog)', () => {
    expect(pm).toMatch(/func handleSignIn[\s\S]*requestPermissionAndRegister\(full: false\)/);
  });
  it('provisional ask includes .provisional; full ask does not', () => {
    expect(pm).toMatch(/full \? \[\.alert, \.badge, \.sound\] : \[\.alert, \.badge, \.sound, \.provisional\]/);
  });
  it('reports provisional as its own status', () => {
    expect(pm).toMatch(/case \.provisional: return "provisional"/);
  });
  it('token row carries the app version', () => {
    expect(pm).toMatch(/"app_version": /);
  });
});
```

- [ ] **Step 2: Swift**

```swift
static func statusString(_ s: UNAuthorizationStatus) -> String {
    switch s {
    case .authorized, .ephemeral: return "authorized"
    case .provisional: return "provisional"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
}

/// full=false: provisional — iOS grants silently, notifications deliver quietly with
/// its own Keep / Turn Off buttons. full=true: the one-shot OS dialog (only ever called
/// after the user has acted on a quiet notification — see JS maybeDeferredPushAsk).
func requestPermissionAndRegister(full: Bool = true, completion: ((String) -> Void)? = nil) {
    let opts: UNAuthorizationOptions = full ? [.alert, .badge, .sound] : [.alert, .badge, .sound, .provisional]
    UNUserNotificationCenter.current().requestAuthorization(options: opts) { granted, error in
        if let error = error { print("[WRotate] Push permission error: \(error.localizedDescription)") }
        if granted { DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() } }
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            completion?(PushManager.statusString(settings.authorizationStatus))
        }
    }
}

func handleSignIn(userId: String, accessToken: String? = nil) {
    currentUserId = userId
    userAccessToken = accessToken
    requestPermissionAndRegister(full: false)
}
```
In `storeToken` add `"app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""` to `body`. Rewrite the long comment above `handleSignIn` to describe provisional (delete the 2.5 cold-ask rationale; keep one line pointing at the field data: primer 2/52, cold ask 28%).

- [ ] **Step 3: SQL** — `ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS app_version text;` in `sql/2026-08-16-device-tokens-app-version.sql`; deploy with `db query`. Check the existing device_tokens INSERT policy allows the new column (column-level grants are not used — it will).

- [ ] **Step 4:** `npm test` → PASS. Commit: `git commit -m "ios(2.6): provisional push at sign-in, distinct provisional status, app_version on device_tokens"`.

### Task 9: native route fallback + opened-from-push flag + notification-settings deep link

**Files:** `ios/Wrotate/Wrotate/ContentView.swift` (`dispatchPendingNotification`), `ios/Wrotate/Wrotate/WebView.swift` (`openAppSettings` handler ~line 363), test `tests/push-provisional-native.test.js` (extend)

- [ ] **Step 1: Extend the test**

```js
const cv = readFileSync(join(root, 'ios/Wrotate/Wrotate/ContentView.swift'), 'utf8');
const wv = readFileSync(join(root, 'ios/Wrotate/Wrotate/WebView.swift'), 'utf8');
it('unknown routes fall through to JS openPushRoute and mark the session as opened from push', () => {
  expect(cv).toMatch(/window\._openedFromPush=true/);
  expect(cv).toMatch(/openPushRoute\('\\\(pending\.route\)','\\\(id\)'\)/);
});
it('settings deep link opens the app notification pane on iOS 15.4+', () => {
  expect(wv).toMatch(/openNotificationSettingsURLString/);
});
```

- [ ] **Step 2: Swift** — in `dispatchPendingNotification` replace the `default:` branch with:

```swift
default:
    // Unknown / new routes are resolved in JS so a new notification type never
    // needs an App Store build. JS falls back to the bell itself.
    js = "if(typeof openPushRoute==='function') openPushRoute('\(pending.route)','\(id)'); else if(typeof openNotifPanel==='function') openNotifPanel();"
```
and prefix every branch's dispatch with the flag: change the final line to `webViewRef?.evaluateJavaScript("window._openedFromPush=true;" + js, completionHandler: nil)`. Note `pending.route` came from the payload — it is only ever interpolated inside a single-quoted JS literal, so sanitize it the same way `id` is (`filter { $0.isLetter || $0.isNumber || $0 == "_" }`) in PushManager `didReceive` before storing.
In `WebView.swift` `openAppSettings`: 
```swift
let str = (#available(iOS 15.4, *)) ? UIApplication.openNotificationSettingsURLString : UIApplication.openSettingsURLString
if let url = URL(string: str) { UIApplication.shared.open(url) }
```
(`#available` cannot be used inline like that in Swift — write it as `var str = UIApplication.openSettingsURLString; if #available(iOS 15.4, *) { str = UIApplication.openNotificationSettingsURLString }`.)

- [ ] **Step 3:** `npm test` → PASS. Commit: `git commit -m "ios(2.6): route unknown push routes through JS openPushRoute; notification-settings deep link"`.

### Task 10: `push_auth_status` logging RPC

**Files:** Create `sql/2026-08-16-push-auth-status.sql`; test `tests/push-auth-status-sql.test.js`

- [ ] SQL:
```sql
CREATE TABLE IF NOT EXISTS push_auth_status (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL,           -- notDetermined | provisional | authorized | denied
  app_version text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE push_auth_status ENABLE ROW LEVEL SECURITY;  -- no client policies: written via RPC, read by admin RPCs only
CREATE OR REPLACE FUNCTION record_push_auth_status(p_status text, p_app_version text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO push_auth_status (user_id, status, app_version)
  SELECT auth.uid(), p_status, p_app_version WHERE auth.uid() IS NOT NULL
    AND p_status IN ('notDetermined','provisional','authorized','denied')
  ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, app_version = EXCLUDED.app_version, updated_at = now();
$$;
NOTIFY pgrst, 'reload schema';
```
Test asserts the four statuses, `SECURITY DEFINER`, `ON CONFLICT (user_id) DO UPDATE`, `NOTIFY pgrst`. Deploy; verify with `set_config('request.jwt.claims', ...)` as testuser: `SELECT record_push_auth_status('provisional','2.6'); SELECT * FROM push_auth_status WHERE user_id='<TESTUSER>';` then delete the row. Commit: `db: push_auth_status + record_push_auth_status() for day-30 opt-in decay`.

### Task 11: web — remove the primer, add deferred hard ask, settings row states, status logging

**Files:**
- Modify: `index.html` — delete `#push-primer-modal` markup (~line 6062) and the primer JS block (`PUSH_PRIMER_STATE` … `pushPrimerDismiss`, ~13402–13446) but KEEP `_pushBridge`, `_pushPrimerAvailable` (rename to `_pushBridgeAvailable`, min version stays `'2.3'`), `onPushAuthStatus`, `renderPushSettingRow`; remove `maybeShowPushPrimer()` call sites (grep); update `renderPushSettingRow` for `'provisional'`; add `maybeDeferredPushAsk()`; call `record_push_auth_status` in `onPushAuthStatus`.
- Modify: `wrotate_test.js` — delete `shouldShowPushPrimer`, add `shouldDeferredPushAsk`
- Modify/Delete: tests referencing `shouldShowPushPrimer` (grep `tests/`) → replace with `tests/deferred-push-ask.test.js`
- Modify: `sw.js`

- [ ] **Step 1: Failing test**

```js
// tests/deferred-push-ask.test.js
import { describe, it, expect } from 'vitest';
import { shouldDeferredPushAsk } from '../wrotate_test.js';
const ok = { authStatus: 'provisional', openedFromPush: true, iosVersion: '2.6', asked: false };
describe('shouldDeferredPushAsk', () => {
  it('asks once, only on provisional, only when the app was opened from a notification, only on 2.6+', () => {
    expect(shouldDeferredPushAsk(ok)).toBe(true);
    expect(shouldDeferredPushAsk({ ...ok, authStatus: 'authorized' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, authStatus: 'denied' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, authStatus: 'notDetermined' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, openedFromPush: false })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, iosVersion: '2.5' })).toBe(false);
    expect(shouldDeferredPushAsk({ ...ok, asked: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Pure helper (both files)** — uses `iosAtLeast` (already in both files):

```js
// The one-shot OS dialog is spent only after the user has ACTED on a quiet (provisional)
// notification — tapped one, then logged a wear or finished a measurement. Never at sign-in.
export function shouldDeferredPushAsk({ authStatus, openedFromPush, iosVersion, asked }) {
  if (asked) return false;
  if (authStatus !== 'provisional') return false;
  if (!openedFromPush) return false;
  return iosAtLeast(iosVersion, '2.6');
}
```

- [ ] **Step 3: `index.html` glue**

```js
const PUSH_HARD_ASKED = 'wr_push_hard_asked';
function maybeDeferredPushAsk() {
  if (!_pushBridge()) return;
  const ok = shouldDeferredPushAsk({ authStatus: window._pushAuthStatus || 'notDetermined', openedFromPush: !!window._openedFromPush, iosVersion: window._iosAppVersion, asked: safeLS.get(PUSH_HARD_ASKED) === '1' });
  if (!ok) return;
  safeLS.set(PUSH_HARD_ASKED, '1');
  try { _pushBridge().postMessage({ action: 'requestPushPermission' }); } catch (_) {}
}
```
Call `maybeDeferredPushAsk()` at the end of `quickLog()` (after the toast), in `saveLog()` after its success toast, and in `persistMsrReading()` after `toast('Reading saved!')`. In `onPushAuthStatus(status)` add: `if (currentUser && !_isDemoMode) db.rpc('record_push_auth_status', { p_status: status, p_app_version: window._iosAppVersion || null }).then(() => {});`. In `renderPushSettingRow`, treat `'provisional'` as label `On (quiet)` with a button `Deliver prominently` whose onclick posts `requestPushPermission`; `'denied'` keeps `Off — turn on in Settings` posting `openAppSettings`.

- [ ] **Step 4:** delete primer markup/JS/tests; `npm test` → PASS (fix any test that imported `shouldShowPushPrimer`); bump `sw.js`; UAT on the dev server in a desktop browser: no bridge → nothing happens, no console errors. Commit: `push: retire the in-app primer; deferred one-shot ask after acting on a quiet notification; settings row knows 'provisional'; log OS status`.

### Task 12: `openPushRoute` — `measure` route with the watch preselected

**Files:** `index.html` (`openPushRoute` from Task 4), `sw.js`

- [ ] Extend:
```js
function openPushRoute(route, id) {
  if (route === 'track') { nav(document.querySelector('nav button[data-page="track"]')); maybeShowLogAgainBanner(true, id || null); return; }
  if (route === 'measure') {
    openMeasureModal();
    if (id) setTimeout(() => { const sel = document.getElementById('msr-watch-select'); if (sel && [...sel.options].some(o => o.value === id)) { sel.value = id; sel.dispatchEvent(new Event('change')); } }, 300);
    return;
  }
  if (typeof openNotifPanel === 'function') openNotifPanel();
}
```
Verify `msr-watch-select` is populated by `openMeasureInline` before 300 ms (read `openMeasureInline`; if it fills the select synchronously on nav, drop the timeout). Add to `tests/push-route.test.js` a source-text assertion that `openPushRoute` handles `'track'` and `'measure'`. `npm test`, bump SW, commit: `push: openPushRoute('measure') opens the timegrapher with the watch preselected`.

### Task 13: TestFlight UAT for 2.6, then submit

- [ ] Sync source to the MacBook Pro (`reference_rsync_ios` memory), build, install via TestFlight on a device with WRotate **deleted first** (fresh install = fresh authorization state). Verify: sign-in shows **no** dialog; Settings → WRotate → Notifications shows "Deliver Quietly"; `device_tokens` gets a row with `app_version='2.6'`; `push_auth_status` row says `provisional`; send yourself a wear reminder from the dry-run path (`{"dry_run": false}` cannot target one user — instead insert a `device_tokens` row for testuser and call the function during testuser's local 5 pm, or temporarily point the RPC at a fixed hour on a **branch**, never production); tapping the quiet notification opens Track with the banner; logging then triggers the OS dialog once; choosing Allow flips `push_auth_status` to `authorized`. Update `~/.claude/.../project_ios_update.md` memory with the 2.6 build state.

### Task 14: after 2.6 is approved — routes in payloads for 2.6+ tokens

**Files:** `supabase/functions/send-wear-reminders/index.ts`, `supabase/functions/send-measure-reminders/index.ts`, both `lib.ts` (`sendPush` gains an optional `extra` object merged into the payload root), tests

- [ ] `buildAlertPayload(message, extra?: Record<string, unknown>)` → `{ aps: {...}, ...(extra ?? {}) }`. In both senders, select `token, app_version` and pass `extra = iosAtLeast(app_version, '2.6') ? { w: { route: 'track'|'measure', id: watch_id, uid: user_id } } : undefined` per token (copy the `iosAtLeast` comparison into `lib.ts` as `versionAtLeast(a, b)` with a Deno test: `'2.6' ≥ '2.6'`, `'2.10' ≥ '2.6'`, `'2.5' < '2.6'`, `'' < '2.6'`). Deploy both, smoke test, commit: `push: ship w.route to 2.6+ devices only`.

---

## Self-review notes
- Spec §1 → Task 8; §2 → Tasks 3, 4, 14; §3 → Tasks 5, 6, 14; §4 → Tasks 1, 2; §5 → Task 11; §6 → Task 9 + 11; §7 → Task 11. Metrics: opt-in → `device_tokens.app_version` + `push_auth_status` (Tasks 8, 10); ≥3 logs → existing `logs`; saved/converged → `measurement_sessions.saved_result_id`; re-measure → `measure_reminder_sends` vs `measurement_sessions` within 48 h.
- Order of shipping: A → B → C → D can each go live independently (each has its own SW bump/deploy). E is one native build; Task 14 waits for approval.
- Open item to check while executing Task 2: `timegrapher_results.bph` nullability (see the note in Task 2 Step 4).
