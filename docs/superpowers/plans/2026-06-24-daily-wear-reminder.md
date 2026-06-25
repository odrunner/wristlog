# Daily Wear Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An hourly server-side job that, at each user's local 5pm, nudges recently-active loggers who haven't logged today — push to iOS, throttled weekly email to web-only.

**Architecture:** `pg_cron` (hourly) → secret-gated edge function `send-wear-reminders` → calls a `SECURITY DEFINER` SQL RPC `wear_reminder_targets()` (does all per-user local-time/eligibility math in Postgres via `AT TIME ZONE`) → sends APNs push or Resend email → records the send in `wear_reminder_sends`. Reuses the APNs helpers (copied from `send-badge-push`) and the email wrapper/HMAC-unsub (copied from `run-campaign`), per the repo's self-contained-function convention.

**Tech Stack:** Deno edge functions, `deno test`, Postgres (pg_cron, RPC), Resend, APNs, vanilla JS client.

**Spec:** `docs/superpowers/specs/2026-06-24-daily-wear-reminder-design.md`

## Global Constraints

- **Trigger (per user):** local hour `== 17` · `≥1 log` in last 14 days · `no log today` (local date) · opted in (`COALESCE((email_prefs->>'reminders')::bool, true)`).
- **Channel:** iOS `device_tokens` row → `push` (daily); else → `email`, only if no `email`-channel `wear_reminder_sends` row in the last 7 days.
- **Default ON:** absent `email_prefs.reminders` = opted in. Opt-out via email unsubscribe `cat=reminders` and an in-app "Daily reminders" toggle.
- **Push:** sent directly via APNs — **no `notifications` row** (no bell entry). Push title literal `"WRotate"`.
- **Secret-gating:** reuse the existing `CAMPAIGN_TRIGGER_SECRET` + header `x-campaign-secret` (same as `run-campaign`); missing secret → 401, no send.
- **Idempotent:** `wear_reminder_sends (user_id, sent_on)` PK; never two reminders to one user in a day.
- Deno imports: `jsr:@std/assert` (tests), `https://esm.sh/@supabase/supabase-js@2`, `https://deno.land/std@0.177.0/http/server.ts`. Deploy `--no-verify-jwt`. `npm test` (client) stays green. SW bump on the index.html change. Pre-commit hook bumps `APP_VERSION` — expected.
- **DB apply, function deploys, and the cron are GATED to the human** — subagents write code + SQL files + local tests only; no `supabase` commands.

---

### Task 1: SQL — timezone column, send-log table, `wear_reminder_targets()` RPC

**Files:**
- Create: `sql/2026-06-24-wear-reminders.sql`

**Interfaces:**
- Produces (applied later, gated): `profiles.timezone`; `wear_reminder_sends`; RPC `wear_reminder_targets() → TABLE(user_id uuid, email text, channel text, local_today date)`.

- [ ] **Step 1: Write the SQL file**

Create `sql/2026-06-24-wear-reminders.sql`:

```sql
-- Daily wear reminder: timezone capture, send-throttle log, and target selection.

-- 1. Per-user IANA timezone (written by the web client on boot).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT;

-- 2. One row per user per local day they were reminded (idempotency + email throttle).
CREATE TABLE IF NOT EXISTS wear_reminder_sends (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel  text NOT NULL,            -- 'push' | 'email'
  sent_on  date NOT NULL,            -- the user's LOCAL date
  PRIMARY KEY (user_id, sent_on)
);
CREATE INDEX IF NOT EXISTS wear_reminder_sends_email_idx
  ON wear_reminder_sends (user_id, sent_on) WHERE channel = 'email';

-- 3. Who to remind right now (this hourly run), with their channel.
--    SECURITY DEFINER so the service-role edge fn can read auth.users + bypass RLS.
CREATE OR REPLACE FUNCTION wear_reminder_targets()
RETURNS TABLE (user_id uuid, email text, channel text, local_today date)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH cand AS (
    SELECT p.id AS uid,
           (now() AT TIME ZONE p.timezone)::date AS local_today
    FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND EXTRACT(hour FROM now() AT TIME ZONE p.timezone) = 17
      AND EXISTS (SELECT 1 FROM logs l
                  WHERE l.user_id = p.id AND l.created_at >= now() - interval '14 days')
      AND NOT EXISTS (SELECT 1 FROM logs l
                  WHERE l.user_id = p.id
                    AND l.date = ((now() AT TIME ZONE p.timezone)::date)::text)
      AND NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                  WHERE w.user_id = p.id
                    AND w.sent_on = (now() AT TIME ZONE p.timezone)::date)
  )
  SELECT c.uid,
         u.email,
         CASE WHEN EXISTS (SELECT 1 FROM device_tokens d
                           WHERE d.user_id = c.uid AND d.platform = 'ios')
              THEN 'push' ELSE 'email' END AS channel,
         c.local_today
  FROM cand c
  JOIN auth.users u ON u.id = c.uid
  WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
     OR NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                    WHERE w.user_id = c.uid AND w.channel = 'email'
                      AND w.sent_on >= c.local_today - 7);
$$;
```

(`logs.date` is a `'YYYY-MM-DD'` text column, hence the `::date::text` cast. Postgres accepts IANA names in `AT TIME ZONE`, so DST/offsets are handled.)

- [ ] **Step 2: Commit**

```bash
git add sql/2026-06-24-wear-reminders.sql
git commit -m "feat(reminders): SQL for timezone, send-log, and wear_reminder_targets RPC"
```

(Apply is a gated human step — see end of plan. No local DB to test against.)

---

### Task 2: `send-wear-reminders/lib.ts` (helpers + message builders) + deno tests

**Files:**
- Create: `supabase/functions/send-wear-reminders/lib.ts`
- Create: `supabase/functions/send-wear-reminders/lib.test.ts`

**Interfaces:**
- Produces: `buildReminderPush(): {title,body}`; `buildReminderEmail(): {subject,body}`; plus copied APNs helpers (`createAPNsJWT`, `sendPush`, `buildAlertPayload`, `apnsHost`, `apnsDeviceUrl`, `base64UrlEncode`, `base64UrlEncodeBytes`, `stripPemArmor`) and email helpers (`hmacSign`, `unsubUrl`, `buildHtmlEmail`, `timingSafeEqual`).

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/send-wear-reminders/lib.test.ts`:

```ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildReminderEmail, buildReminderPush, buildHtmlEmail, unsubUrl } from "./lib.ts";

Deno.test("buildReminderPush — fixed nudge with WRotate title", () => {
  const m = buildReminderPush();
  assertEquals(m.title, "WRotate");
  assertStringIncludes(m.body, "What did you wear today");
});

Deno.test("buildReminderEmail — subject + body", () => {
  const e = buildReminderEmail();
  assertStringIncludes(e.subject, "wrist");
  assertStringIncludes(e.body, "Log");
});

Deno.test("unsubUrl — carries uid + cat=reminders", () => {
  const u = unsubUrl("https://api.wrotate.com", "uid-1", "sig-1", "reminders");
  assertStringIncludes(u, "uid=uid-1");
  assertStringIncludes(u, "cat=reminders");
});

Deno.test("buildHtmlEmail — wraps subject, body, unsub link", () => {
  const html = buildHtmlEmail("Hi", "Body here", "https://x/unsub");
  assertStringIncludes(html, "Body here");
  assertStringIncludes(html, "https://x/unsub");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test supabase/functions/send-wear-reminders/lib.test.ts`
Expected: FAIL — `./lib.ts` does not exist.

- [ ] **Step 3: Create `lib.ts`**

Create `supabase/functions/send-wear-reminders/lib.ts` with:

(a) **The two new builders:**

```ts
// send-wear-reminders — pure helpers + copied APNs/email utilities (self-contained,
// matching the repo convention: no cross-function imports).

export function buildReminderPush(): { title: string; body: string } {
  return { title: "WRotate", body: "What did you wear today? 🕰️ Log it before the day's out." };
}

export function buildReminderEmail(): { subject: string; body: string } {
  return {
    subject: "What's on your wrist today?",
    body: "Wearing something today? Log it in WRotate before the day's out — it keeps your collection's wear history complete and your streak alive.",
  };
}
```

(b) **APNs helpers — copy VERBATIM** the eight exported functions from
`supabase/functions/send-badge-push/lib.ts`: `buildAlertPayload`, `apnsHost`, `apnsDeviceUrl`,
`base64UrlEncode`, `base64UrlEncodeBytes`, `stripPemArmor`, `createAPNsJWT`, `sendPush`
(and the `const BUNDLE_ID = "com.wrotate.Wrotate";` they depend on). Do NOT copy
`buildBadgePushMessage`.

(c) **Email helpers — copy VERBATIM** from `supabase/functions/run-campaign/lib.ts`:
`buildHtmlEmail(subject, body, unsubUrl)` and `unsubUrl(supabaseUrl, uid, sig, cat = "updates")`.
And copy `hmacSign(uid, cat, key)` and `timingSafeEqual(a, b)` from
`supabase/functions/run-campaign/index.ts` (move them into this `lib.ts` as exported functions).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test supabase/functions/send-wear-reminders/lib.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-wear-reminders/lib.ts supabase/functions/send-wear-reminders/lib.test.ts
git commit -m "feat(send-wear-reminders): lib (APNs+email helpers, reminder copy) + tests"
```

---

### Task 3: `send-wear-reminders/index.ts` (the scheduled function)

**Files:**
- Create: `supabase/functions/send-wear-reminders/index.ts`

**Interfaces:**
- Consumes: Task 2 lib; the `wear_reminder_targets()` RPC (Task 1, applied later).

- [ ] **Step 1: Create `index.ts`**

```ts
// Supabase Edge Function: send-wear-reminders
// pg_cron-triggered hourly. At each user's local 5pm, nudges recently-active
// loggers who haven't logged today — push (iOS) or throttled email (web).
// Deploy with --no-verify-jwt (auth handled here). Secrets: CAMPAIGN_TRIGGER_SECRET,
// APNS_KEY_P8/KEY_ID/TEAM_ID, RESEND_API_KEY, SUPABASE_URL/SERVICE_ROLE_KEY (auto).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  apnsHost, buildHtmlEmail, buildReminderEmail, buildReminderPush,
  createAPNsJWT, hmacSign, sendPush, timingSafeEqual, unsubUrl,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = "WRotate <hello@wrotate.com>";
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_HOST = apnsHost(Deno.env.get("APNS_SANDBOX") === "true");

serve(async (req) => {
  try {
    // Secret-gate (same as run-campaign). Missing secret config → 401 (no send).
    const triggerSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
    const provided = req.headers.get("x-campaign-secret") ?? "";
    if (!triggerSecret || !provided || !timingSafeEqual(provided, triggerSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: targets, error } = await supabase.rpc("wear_reminder_targets");
    if (error) {
      console.error("[send-wear-reminders] target query failed:", error);
      return new Response(JSON.stringify({ error: String(error.message) }), { status: 500 });
    }
    const rows = (targets ?? []) as { user_id: string; email: string; channel: string; local_today: string }[];
    if (!rows.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

    let pushed = 0, emailed = 0, failed = 0;
    let jwt: string | null = null;
    const push = buildReminderPush();
    const mail = buildReminderEmail();

    for (const t of rows) {
      try {
        if (t.channel === "push") {
          const { data: toks } = await supabase.from("device_tokens")
            .select("token").eq("user_id", t.user_id).eq("platform", "ios");
          if (!toks || !toks.length) continue;
          if (!jwt) jwt = await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);
          const results = await Promise.all(
            toks.map((x: { token: string }) => sendPush(x.token, push, jwt!, APNS_HOST)),
          );
          const expired = results.filter((r) => r.status === 410).map((r) => r.token);
          if (expired.length) await supabase.from("device_tokens").delete().in("token", expired);
          if (!results.some((r) => r.success)) continue;
          pushed++;
        } else {
          if (!t.email) continue;
          const sig = await hmacSign(t.user_id, "reminders", SERVICE_KEY);
          const html = buildHtmlEmail(mail.subject, mail.body, unsubUrl(SUPABASE_URL, t.user_id, sig, "reminders"));
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: FROM_EMAIL, to: t.email, subject: mail.subject, html }),
          });
          if (!res.ok) { failed++; continue; }
          emailed++;
        }
        await supabase.from("wear_reminder_sends")
          .upsert({ user_id: t.user_id, channel: t.channel, sent_on: t.local_today }, { onConflict: "user_id,sent_on", ignoreDuplicates: true });
      } catch (e) {
        failed++;
        console.error(`[send-wear-reminders] user ${t.user_id} failed:`, e);
      }
    }

    return new Response(JSON.stringify({ pushed, emailed, failed, candidates: rows.length }), { status: 200 });
  } catch (err) {
    console.error("[send-wear-reminders] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/send-wear-reminders/index.ts`
Expected: no errors. (A pre-existing ambient-type warning about `npm:openai` in the edge-runtime stubs may appear — confirm it reproduces on `send-badge-push/index.ts` too; not introduced here.)

- [ ] **Step 3: Re-run lib tests (unchanged)**

Run: `deno test supabase/functions/send-wear-reminders/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-wear-reminders/index.ts
git commit -m "feat(send-wear-reminders): scheduled function (RPC -> push/email + record)"
```

---

### Task 4: `email-unsubscribe` — support `cat=reminders`

**Files:**
- Modify: `supabase/functions/email-unsubscribe/lib.ts` (`CATEGORY_LABELS` + `applyUnsubscribe`)
- Modify: `supabase/functions/email-unsubscribe/lib.test.ts` (if present; else add a case)

**Interfaces:**
- Consumes: existing `applyUnsubscribe(prefs, cat)` / `CATEGORY_LABELS`.

- [ ] **Step 1: Write the failing test**

In `supabase/functions/email-unsubscribe/lib.test.ts` (create if absent, mirroring the deno test header), add:

```ts
Deno.test("applyUnsubscribe — reminders sets email_prefs.reminders=false", () => {
  assertEquals(applyUnsubscribe({}, "reminders").reminders, false);
});
Deno.test("applyUnsubscribe — all also clears reminders", () => {
  assertEquals(applyUnsubscribe({}, "all").reminders, false);
});
Deno.test("CATEGORY_LABELS has a reminders label", () => {
  assertEquals(typeof CATEGORY_LABELS.reminders, "string");
});
```

(Ensure `applyUnsubscribe` and `CATEGORY_LABELS` are imported at the top from `./lib.ts`.)

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/email-unsubscribe/lib.test.ts`
Expected: FAIL — `reminders` not handled.

- [ ] **Step 3: Implement**

In `supabase/functions/email-unsubscribe/lib.ts`: add `reminders: "Daily reminders",` to `CATEGORY_LABELS`, and in `applyUnsubscribe`, add `prefs.reminders = false;` inside the `cat === "all"` branch (the `else { prefs[cat] = false; }` already handles `cat === "reminders"`).

- [ ] **Step 4: Run to verify it passes**

Run: `deno test supabase/functions/email-unsubscribe/lib.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/email-unsubscribe/
git commit -m "feat(email-unsubscribe): support cat=reminders (Daily reminders)"
```

---

### Task 5: Client — timezone capture + "Daily reminders" toggle

**Files:**
- Modify: `index.html` (timezone capture on boot; `reminders` toggle in the Notifications section ~`index.html:6987`; `saveEmailPref` default ~`index.html:11941`); `sw.js`

**Interfaces:**
- Consumes: `currentUser`, `myProfile`, `db`.

- [ ] **Step 1: Capture timezone on boot**

Find where the profile is loaded after login (e.g. where `myProfile` is set after the profiles fetch ~`index.html:6395`). Immediately after `myProfile` is available, add:

```js
// Capture IANA timezone for server-side daily reminders (writes only when it changes).
try {
  const _tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (_tz && currentUser && myProfile && myProfile.timezone !== _tz) {
    db.from('profiles').update({ timezone: _tz }).eq('id', currentUser.id)
      .then(() => { if (window.myProfile) window.myProfile.timezone = _tz; });
  }
} catch (e) { /* ignore */ }
```

(If `myProfile` doesn't already select `timezone`, that's fine — `myProfile.timezone` is `undefined`, the update fires once, and the local mirror is set.)

- [ ] **Step 2: Add the "Daily reminders" toggle**

In the Notifications section render (after the `${tog('updates','WRotate updates & new features')}` line, ~`index.html:6987`), add a default-on toggle (the generic `tog` treats absent as unchecked, but reminders default to on):

```js
        <div class="toggle-row">
          <span class="toggle-label">Daily reminders</span>
          <label class="toggle-switch">
            <input type="checkbox" ${ep.reminders !== false ? 'checked' : ''} onchange="saveEmailPref('reminders',this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
```

- [ ] **Step 3: Include `reminders` in the saveEmailPref default**

In `saveEmailPref` (~`index.html:11941`), update the fallback default object to include `reminders: true`:

```js
  const prefs = (myProfile && myProfile.email_prefs) ? { ...myProfile.email_prefs } : { comments: true, mentions: true, clubs: false, friends: true, updates: true, reminders: true };
```

- [ ] **Step 4: Bump the SW cache version**

`grep -n "wristlog-v" sw.js`, then increment the number by one in `sw.js`.

- [ ] **Step 5: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS (no JS unit test covers this UI; confirm nothing broke).

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js
git commit -m "feat(reminders): capture timezone on boot + Daily reminders opt-out toggle"
```

---

## Gated production steps (human-run, after code is merged)

Not subagent tasks — the controller runs these only on explicit go-ahead.

- [ ] **G1: Apply the SQL** (`sql/2026-06-24-wear-reminders.sql`): the `timezone` column, `wear_reminder_sends` table, and `wear_reminder_targets()` RPC — via `npx supabase db query --linked`.
- [ ] **G2: Verify the RPC** read-only with a seeded test scenario (a test user with `timezone`, a recent log, none today, opted in, and `EXTRACT(hour ...)=17`) — confirm it targets them with the right channel; confirm it excludes opted-out / logged-today / no-timezone. (Use a transaction + `ROLLBACK`, or query against real state.)
- [ ] **G3: Deploy** `send-wear-reminders` and `email-unsubscribe` with `--no-verify-jwt`; confirm `send-wear-reminders` returns **401 without** `x-campaign-secret` (sends nothing). Do NOT blindly invoke it authenticated against prod.
- [ ] **G4: Schedule** the hourly pg_cron job (mirroring the existing `run-email-campaigns` job) calling `/functions/v1/send-wear-reminders` with the `x-campaign-secret` header, schedule `0 * * * *`.
- [ ] **G5:** Web client (timezone capture + toggle) ships on merge; timezones backfill as users visit; reminders begin flowing at each user's local 5pm.

## Self-Review

**Spec coverage:**
- timezone column + capture → Task 1 (col) + Task 5 (client). ✅
- `wear_reminder_sends` throttle table → Task 1. ✅
- `reminders` pref (default on) + opt-out (email + in-app) → Task 1 (RPC `COALESCE true`), Task 4 (email-unsubscribe), Task 5 (toggle). ✅
- `wear_reminder_targets()` selection (5pm/14d/no-log-today/opted-in/channel/email-throttle/no-double) → Task 1. ✅
- `send-wear-reminders` (secret-gate, RPC, push/email, record, no bell row, 410 cleanup) → Tasks 2-3. ✅
- Hourly cron + secret reuse → Global Constraints + G4. ✅
- Reuse APNs/email helpers per self-contained convention → Task 2. ✅
- Safe smoke (401 without secret; no blind prod invoke) → G3. ✅
- DB/deploy/cron gated → gated section. ✅

**Placeholder scan:** No TBD/TODO. The "copy VERBATIM from X" steps name the exact source functions + files (precise, not vague). All new code shown in full. ✅

**Type/name consistency:** `wear_reminder_targets()` returns `(user_id, email, channel, local_today)` — consumed exactly in Task 3's loop. `buildReminderPush/Email`, `hmacSign`, `unsubUrl`, `buildHtmlEmail`, `createAPNsJWT`, `sendPush`, `apnsHost`, `timingSafeEqual` defined in Task 2, imported in Task 3. `wear_reminder_sends (user_id, channel, sent_on)` columns consistent between Task 1 DDL and Task 3 upsert (`onConflict: "user_id,sent_on"`). `email_prefs.reminders` consistent across RPC / unsubscribe / toggle. Secret `CAMPAIGN_TRIGGER_SECRET` + header `x-campaign-secret` consistent (Task 3 + G4). ✅
