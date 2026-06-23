# Badge-Earned Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every earned badge through the in-app bell inbox and one (batched) iOS push, with the bell entry tapping through to the badge wall.

**Architecture:** Badges are awarded client-side in `checkAndAwardBadges()`. After the award pass, the client inserts one `badge_earned` notification row per badge (for the bell) and makes a single call to a new `send-badge-push` edge function (one push for N badges). The insert webhook (`send-push`) is taught to skip `badge_earned` via `buildMessage` returning `null`, so the per-badge rows never each fire a push. No email (badge type is absent from the email category map). No iOS-app change.

**Tech Stack:** Vanilla JS (`index.html` + `wrotate_test.js` test mirror), Supabase Postgres + RLS, Deno edge functions (APNs), vitest (unit), Playwright (E2E mocked), deno test (edge-fn unit).

**Spec:** `docs/superpowers/specs/2026-06-22-badge-earned-notifications-design.md`

## Global Constraints

- Product name in all user-facing copy is **`WRotate`** (never "WristLog"). Push title literal is `"WRotate"`.
- Edge functions deploy with `npx supabase functions deploy <name> --no-verify-jwt`; run `npm run test:smoke` after every deploy.
- Bump the SW cache version in `sw.js` (`wristlog-vNN`) on every HTML/JS change.
- `notifications` INSERT RLS policy is `WITH CHECK (auth.uid() IS NOT NULL)` — any authenticated user may insert any row; self-inserts with `actor_id = null` are allowed (verified against `sql/security-hardening.sql:210-212`).
- New notification type string is exactly `badge_earned`.
- Deno tests: `deno test supabase/functions/<fn>/` (or `npm run test:functions`). Unit tests: `npm test` (vitest). Pre-commit hook auto-bumps `APP_VERSION` in `index.html` — expected, leave it.
- No hardcoded UUIDs in JS/SQL beyond what already exists.

---

### Task 1: Add `badge_earned` to the `notifications` type constraint

**Files:**
- Modify: `sql/friends_migration.sql:89-98` (the `notifications_type_check` definition)
- Remote DB: apply via `npx supabase db query --linked`

**Interfaces:**
- Produces: the DB now accepts `type = 'badge_earned'` inserts; later tasks rely on this.

- [ ] **Step 1: Read the current constraint**

Run: `grep -n "notifications_type_check" -A12 sql/friends_migration.sql`
Confirm the `CHECK (type IN (...))` list ends with `'system'` and does **not** contain `badge_earned`.

- [ ] **Step 2: Add `badge_earned` to the source SQL**

In `sql/friends_migration.sql`, change the last line of the type list from:

```sql
    'system'  -- for brand additions and other auto-generated notifications
```

to:

```sql
    'system',  -- for brand additions and other auto-generated notifications
    'badge_earned'  -- earned achievement badges (self-generated, actor_id null)
```

- [ ] **Step 3: Apply the constraint change to the remote DB**

Run:

```bash
npx supabase db query --linked "ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check; ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('follow','follow_request','follow_accepted','like','comment','comment_also','mention','comment_like','club_join_request','club_join_accepted','club_invite','club_promoted','friend_code_entered','friends_now','friend_request','friend_accepted','system','badge_earned'));"
```

Expected: `ALTER TABLE` success, no error.

- [ ] **Step 4: Verify the constraint accepts the new type AND self-insert RLS works**

Get the test user id, then exercise the policy inside a rolled-back transaction so no data persists:

```bash
TESTID=$(npx supabase db query --linked "SELECT id FROM auth.users WHERE email='test@wrotate.com';" | tr -d '[:space:]' | grep -oE '[0-9a-f-]{36}')
npx supabase db query --linked "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$TESTID\",\"role\":\"authenticated\"}', true); INSERT INTO notifications (user_id, type, actor_id, ref_id, is_read) VALUES ('$TESTID','badge_earned',NULL,'1',false); SELECT 'insert-ok' AS result; ROLLBACK;"
```

Expected: a row `insert-ok` (no constraint violation, no RLS denial). If this fails with an RLS error, stop — the design's client-insert assumption is broken; fall back to a `SECURITY DEFINER` RPC for the insert (out of plan scope, escalate).

- [ ] **Step 5: Commit**

```bash
git add sql/friends_migration.sql
git commit -m "feat(db): allow badge_earned notification type"
```

---

### Task 2: `send-push` ignores `badge_earned` (no push from the insert webhook)

**Files:**
- Modify: `supabase/functions/send-push/lib.ts:21-54` (`buildMessage`)
- Test: `supabase/functions/send-push/lib.test.ts`

**Interfaces:**
- Produces: `buildMessage('badge_earned', name)` returns `null`. `send-push/index.ts:166-170` already does `if (!message) return { skipped }`, so a `badge_earned` insert sends no push. No `index.ts` change.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/send-push/lib.test.ts`:

```ts
Deno.test("buildMessage returns null for badge_earned (webhook must not push badges)", () => {
  assertEquals(buildMessage("badge_earned", "Anyone"), null);
});
```

(`buildMessage` and `assertEquals` are already imported at the top of the file — confirm; if `buildMessage` is not imported, add it to the existing import from `./lib.ts`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/send-push/lib.test.ts`
Expected: FAIL — the `badge_earned` case currently hits `default` and returns a generic message object, not `null`.

- [ ] **Step 3: Add the case**

In `supabase/functions/send-push/lib.ts`, inside `buildMessage`'s `switch`, immediately before `default:`, add:

```ts
    case "badge_earned":
      // Badges are pushed by the send-badge-push function (batched), not the insert webhook.
      return null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/send-push/lib.test.ts`
Expected: PASS (all tests in file green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-push/lib.ts supabase/functions/send-push/lib.test.ts
git commit -m "feat(send-push): skip badge_earned so it never pushes from the webhook"
```

---

### Task 3: `send-badge-push` edge function (one batched push)

**Files:**
- Create: `supabase/functions/send-badge-push/lib.ts`
- Create: `supabase/functions/send-badge-push/lib.test.ts`
- Create: `supabase/functions/send-badge-push/index.ts`

**Interfaces:**
- Consumes: caller's `Authorization` bearer token (the user's access token), request body `{ badgeNames: string[] }`.
- Produces: deployed function `send-badge-push`; sends **one** APNs alert to the authenticated caller's iOS device tokens. `buildBadgePushMessage(badgeNames: string[]): { title: string; body: string } | null`.

- [ ] **Step 1: Write the failing test for the pure message builder**

Create `supabase/functions/send-badge-push/lib.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert";
import { buildBadgePushMessage } from "./lib.ts";

Deno.test("buildBadgePushMessage: empty -> null", () => {
  assertEquals(buildBadgePushMessage([]), null);
});

Deno.test("buildBadgePushMessage: single badge names it", () => {
  assertEquals(buildBadgePushMessage(["First Watch"]), {
    title: "WRotate",
    body: 'You earned the "First Watch" badge 🏅',
  });
});

Deno.test("buildBadgePushMessage: multiple badges are counted", () => {
  assertEquals(buildBadgePushMessage(["First Watch", "Five in the Box", "Ten in the Box"]), {
    title: "WRotate",
    body: "You earned 3 badges! 🏅",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/send-badge-push/lib.test.ts`
Expected: FAIL — `./lib.ts` does not exist yet.

- [ ] **Step 3: Create `lib.ts` with the builder + self-contained APNs helpers**

Create `supabase/functions/send-badge-push/lib.ts`:

```ts
// send-badge-push — pure logic + APNs helpers (self-contained; mirrors send-push's
// stable APNs code intentionally — see spec "Accepted tradeoff").

const BUNDLE_ID = "com.wrotate.Wrotate";

// Badge name list -> single APNs message. null when there is nothing to send.
export function buildBadgePushMessage(
  badgeNames: string[],
): { title: string; body: string } | null {
  if (!badgeNames || badgeNames.length === 0) return null;
  const title = "WRotate";
  if (badgeNames.length === 1) {
    return { title, body: `You earned the "${badgeNames[0]}" badge 🏅` };
  }
  return { title, body: `You earned ${badgeNames.length} badges! 🏅` };
}

export function buildAlertPayload(message: { title: string; body: string }) {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      badge: 1,
    },
  };
}

export function apnsHost(useSandbox: boolean): string {
  return useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

export function apnsDeviceUrl(host: string, token: string): string {
  return `${host}/3/device/${token}`;
}

export function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return base64UrlEncode(String.fromCharCode(...bytes));
}

export function stripPemArmor(pem: string): string {
  return pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
}

// Build an ES256 APNs JWT from the .p8 key material.
export async function createAPNsJWT(
  keyP8: string,
  keyId: string,
  teamId: string,
): Promise<string> {
  const header = { alg: "ES256", kid: keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: teamId, iat: now };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = stripPemArmor(keyP8);
  const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${signingInput}.${sigB64}`;
}

// Send one push to a single device token.
export async function sendPush(
  token: string,
  message: { title: string; body: string },
  jwt: string,
  host: string,
): Promise<{ token: string; success: boolean; status: number }> {
  const url = apnsDeviceUrl(host, token);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildAlertPayload(message)),
    });
    return { token, success: response.ok, status: response.status };
  } catch (_err) {
    return { token, success: false, status: 0 };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/send-badge-push/lib.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the function entrypoint `index.ts`**

Create `supabase/functions/send-badge-push/index.ts`:

```ts
// Supabase Edge Function: send-badge-push
// Called BY THE CLIENT (not a webhook) once after a badge-award pass.
// Authenticates the caller, then sends ONE APNs push summarizing the badges
// they just earned. A user can only push to themselves.
//
// Required Supabase secrets: APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto).
// Deploy with --no-verify-jwt (auth is handled here).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsHost, buildBadgePushMessage, createAPNsJWT, sendPush } from "./lib.ts";

const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const USE_SANDBOX = Deno.env.get("APNS_SANDBOX") === "true";
const APNS_HOST = apnsHost(USE_SANDBOX);

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Identify the caller from their token (they can only push to themselves).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const badgeNames: string[] = Array.isArray(body?.badgeNames) ? body.badgeNames : [];
    const message = buildBadgePushMessage(badgeNames);
    if (!message) {
      return new Response(JSON.stringify({ skipped: "no badges" }), { status: 200 });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: tokens } = await admin
      .from("device_tokens")
      .select("token")
      .eq("user_id", user.id)
      .eq("platform", "ios");

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no device tokens" }), { status: 200 });
    }

    const jwt = await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);
    const results = await Promise.all(
      tokens.map((t: { token: string }) => sendPush(t.token, message, jwt, APNS_HOST)),
    );

    // Clean up Apple-rejected (410) tokens.
    const expired = results.filter((r) => r.status === 410).map((r) => r.token);
    if (expired.length > 0) {
      await admin.from("device_tokens").delete().in("token", expired);
    }

    return new Response(
      JSON.stringify({
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        cleaned: expired.length,
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error("[send-badge-push] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 6: Type-check the function**

Run: `deno check supabase/functions/send-badge-push/index.ts`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-badge-push/
git commit -m "feat(send-badge-push): new edge function for batched badge push"
```

(Deploy + smoke happens in Task 6 alongside the client wiring.)

---

### Task 4: Test-mirror helpers in `wrotate_test.js`

**Files:**
- Modify: `wrotate_test.js:1014-1033` (`notificationBody`) and after `notificationOpensProfile` (`:1062-1065`)
- Test: `tests/notifications.test.js`

**Interfaces:**
- Produces (mirrors of production logic added to `index.html` in Task 5):
  - `notificationBody(type, actorName, opts = {})` — `opts.badgeName` used for `badge_earned`.
  - `buildBadgeNotificationRows(badges, userId)` → `Array<{ user_id, type:'badge_earned', actor_id:null, ref_id:string, is_read:false }>`.
  - `notificationOpensBadgeWall(type)` → boolean.
  - `badges` items have shape `{ ref:number, name:string }` (matches `BADGE_REGISTRY`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/notifications.test.js` (import line at top already imports from `../wrotate_test.js` — add the three names to that import):

```js
import {
  // ...existing imports...
  notificationBody,
  buildBadgeNotificationRows,
  notificationOpensBadgeWall,
} from '../wrotate_test.js';

describe('badge_earned notifications', () => {
  it('renders the badge name in the body', () => {
    expect(notificationBody('badge_earned', null, { badgeName: 'First Watch' }))
      .toBe('You earned the First Watch badge 🏅');
  });

  it('falls back when the badge name is unknown', () => {
    expect(notificationBody('badge_earned', null, {}))
      .toBe('You earned a new badge 🏅');
  });

  it('builds one self-addressed, actor-less row per badge', () => {
    const rows = buildBadgeNotificationRows(
      [{ ref: 1, name: 'First Watch' }, { ref: 20, name: 'Five in the Box' }],
      'user-123',
    );
    expect(rows).toEqual([
      { user_id: 'user-123', type: 'badge_earned', actor_id: null, ref_id: '1', is_read: false },
      { user_id: 'user-123', type: 'badge_earned', actor_id: null, ref_id: '20', is_read: false },
    ]);
  });

  it('routes badge taps to the badge wall, not posts/clubs/profiles', () => {
    expect(notificationOpensBadgeWall('badge_earned')).toBe(true);
    expect(notificationOpensBadgeWall('follow')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- notifications`
Expected: FAIL — `buildBadgeNotificationRows`/`notificationOpensBadgeWall` are not exported; `notificationBody` ignores `opts`.

- [ ] **Step 3: Add the `badge_earned` case to `notificationBody`**

In `wrotate_test.js`, change the signature and add the case:

```js
export function notificationBody(type, actorName, opts = {}) {
  const nm = actorName || 'Someone';
  switch (type) {
    // ...existing cases unchanged...
    case 'badge_earned':
      return opts.badgeName
        ? `You earned the ${opts.badgeName} badge 🏅`
        : 'You earned a new badge 🏅';
    default:                     return '';
  }
}
```

- [ ] **Step 4: Add the two new helpers**

In `wrotate_test.js`, immediately after `notificationOpensProfile` (ends at line ~1065), add:

```js
/**
 * Returns true for types that tap-navigate to the badge wall.
 */
export function notificationOpensBadgeWall(type) {
  return type === 'badge_earned';
}

/**
 * Build the bell-inbox rows for a set of newly-earned badges.
 * Self-addressed (recipient = earner) and actor-less, like 'system'.
 * badges: [{ ref, name }]. ref_id is the badge ref as a string.
 */
export function buildBadgeNotificationRows(badges, userId) {
  return (badges || []).map(b => ({
    user_id: userId,
    type: 'badge_earned',
    actor_id: null,
    ref_id: String(b.ref),
    is_read: false,
  }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- notifications`
Expected: PASS (new describe block green, existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add wrotate_test.js tests/notifications.test.js
git commit -m "test: badge_earned notification body, rows, and tap routing"
```

---

### Task 5: Wire production `index.html` (render + tap + insert + push) and bump SW

**Files:**
- Modify: `index.html:8844` (body ternary), `index.html:8878-8882` (tap routing), `index.html:8885` (avatar), `index.html:5387` (award pass), and add `notifyBadgesEarned` + `buildBadgeNotificationRows` near the badge code (~`index.html:5194`)
- Modify: `sw.js` (cache version bump)

**Interfaces:**
- Consumes: `BADGE_BY_REF` (existing, `index.html:~5010`), `currentUser`, `db`, `openBadgeWall()` (`index.html:5088`), `showBadgeToast()` (`index.html:5054`).
- Produces: production parity with the Task 4 mirrors.

- [ ] **Step 1: Add the production `buildBadgeNotificationRows` + `notifyBadgesEarned` helpers**

In `index.html`, immediately after `awardBadge` (ends at `index.html:5194`), add:

```js
// Build self-addressed, actor-less bell rows for newly-earned badges (mirror of wrotate_test.js).
function buildBadgeNotificationRows(badges, userId) {
  return (badges || []).map(b => ({
    user_id: userId,
    type: 'badge_earned',
    actor_id: null,
    ref_id: String(b.ref),
    is_read: false,
  }));
}

// Fire-and-forget: insert one bell row per badge, then ONE batched push. Never blocks the UI.
async function notifyBadgesEarned(badges) {
  if (!currentUser || !badges || !badges.length) return;
  try {
    await db.from('notifications').insert(buildBadgeNotificationRows(badges, currentUser.id));
  } catch (e) { console.warn('[Badges] notif insert failed:', e?.message); }
  try {
    await db.functions.invoke('send-badge-push', { body: { badgeNames: badges.map(b => b.name) } });
  } catch (e) { console.warn('[Badges] push invoke failed:', e?.message); }
}
```

- [ ] **Step 2: Call it from the award pass**

In `index.html:5387`, replace:

```js
  if (newlyEarned.length > 0) showBadgeToast(newlyEarned);
```

with:

```js
  if (newlyEarned.length > 0) {
    showBadgeToast(newlyEarned);
    notifyBadgesEarned(newlyEarned);
  }
```

- [ ] **Step 3: Render the badge body text**

In `index.html:8844`, change the end of the `body` ternary from:

```js
               : n.type === 'system'               ? (n.ref_id ? `Your requested brand "${escHtml(n.ref_id)}" has been added to WRotate!` : 'System notification') : '';
```

to:

```js
               : n.type === 'system'               ? (n.ref_id ? `Your requested brand "${escHtml(n.ref_id)}" has been added to WRotate!` : 'System notification')
               : n.type === 'badge_earned'         ? (BADGE_BY_REF[Number(n.ref_id)]?.name ? `You earned the ${BADGE_BY_REF[Number(n.ref_id)].name} badge 🏅` : 'You earned a new badge 🏅') : '';
```

- [ ] **Step 4: Route the tap to the badge wall**

In `index.html:8880`, the `notifClick` chain — add a `badge_earned` branch. Change:

```js
      : (n.type === 'club_join_accepted' || n.type === 'club_promoted') ? `toggleNotifPanel();openClubDetail('${n.ref_id}')`
      : `viewUserProfile('${n.actor_id}')`;
```

to:

```js
      : (n.type === 'club_join_accepted' || n.type === 'club_promoted') ? `toggleNotifPanel();openClubDetail('${n.ref_id}')`
      : n.type === 'badge_earned' ? `toggleNotifPanel();openBadgeWall()`
      : `viewUserProfile('${n.actor_id}')`;
```

- [ ] **Step 5: Give badge rows a medal avatar (no broken profile link)**

`badge_earned` rows have no actor, so the default avatar (`profileInitials(n.actor)` + `viewUserProfile('null')`) is wrong. In `index.html:8883-8885`, replace the `return` template's avatar `<div>` so it is conditional. Change:

```js
    return `
      <div class="notif-item ${n.is_read ? '' : 'notif-unread'}" id="notif-${n.id}" onclick="${notifClick}">
        <div class="feed-user-avatar" style="width:36px;height:36px;font-size:.76rem;flex-shrink:0;cursor:pointer;" onclick="event.stopPropagation();toggleNotifPanel();viewUserProfile('${n.actor_id}')">${profileInitials(n.actor)}</div>
```

to:

```js
    const avatarHtml = n.type === 'badge_earned'
      ? `<div class="feed-user-avatar" style="width:36px;height:36px;font-size:1.1rem;flex-shrink:0;display:flex;align-items:center;justify-content:center;">🏅</div>`
      : `<div class="feed-user-avatar" style="width:36px;height:36px;font-size:.76rem;flex-shrink:0;cursor:pointer;" onclick="event.stopPropagation();toggleNotifPanel();viewUserProfile('${n.actor_id}')">${profileInitials(n.actor)}</div>`;
    return `
      <div class="notif-item ${n.is_read ? '' : 'notif-unread'}" id="notif-${n.id}" onclick="${notifClick}">
        ${avatarHtml}
```

- [ ] **Step 6: Bump the SW cache version**

Run: `grep -n "wristlog-v" sw.js` to find the current version, then increment it by one (e.g. `wristlog-v47` → `wristlog-v48`) in `sw.js`.

- [ ] **Step 7: Run the full unit suite (regression)**

Run: `npm test`
Expected: PASS (970+ tests, including the Task 4 additions).

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat(badges): bell entry + batched push when a badge is earned"
```

---

### Task 6: E2E mocked coverage, deploy, smoke

**Files:**
- Modify/Create: an E2E spec under `e2e/` covering the bell entry (follow the nearest existing notification E2E pattern; if none, create `e2e/badge-notifications.spec.js`)
- Modify: `supabase/functions/send-email/lib.ts:6-19` (clarifying comment only)

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Add the email-exclusion comment (documentation, no behavior change)**

In `supabase/functions/send-email/lib.ts`, inside `TYPE_TO_CATEGORY`, near the existing `like`/`comment_like` exclusion note, add:

```ts
  // NOTE: badge_earned is intentionally excluded — badges go to the bell + push only, never email.
```

- [ ] **Step 2: Write the E2E mocked test**

Inspect an existing notification E2E (`grep -rln "notif" e2e/`). Mirror its Supabase route-mocking to seed one `badge_earned` row (`type:'badge_earned'`, `actor_id:null`, `ref_id:'1'`, `is_read:false`), open the bell, and assert:
- the panel shows text containing `You earned the First Watch badge`;
- clicking the row opens the badge wall (the badge-wall modal/container becomes visible).

Write the spec following that file's helpers (selectors, `mockSupabase`, etc.) — do not invent new harness utilities.

- [ ] **Step 3: Run the E2E mocked suite**

Run: `npm run test:e2e`
Expected: PASS, including the new spec.

- [ ] **Step 4: Deploy the edge functions**

```bash
npx supabase functions deploy send-push --no-verify-jwt
npx supabase functions deploy send-badge-push --no-verify-jwt
```

Expected: both deploy successfully.

- [ ] **Step 5: Smoke-test the deployed functions**

Run: `npm run test:smoke`
Expected: existing smoke checks PASS. If the smoke harness can target `send-badge-push`, assert an authenticated call returns `200` with `{ skipped: 'no device tokens' }` for the test user (no iOS token registered on web). If the harness can't, manually verify:

```bash
npx supabase functions invoke send-badge-push --no-verify-jwt --body '{"badgeNames":["First Watch"]}'
```

Expected: `401 Invalid token` without a user token (proves auth is enforced) — that is the correct negative result; real delivery requires the iOS app.

- [ ] **Step 6: Manual UAT on the local dev server (web)**

On http://192.168.1.246:3000 as `testuser` (private visibility only): trigger a fresh badge (e.g. add a first watch on a clean test account) and confirm:
- the badge toast appears;
- the bell shows "You earned the … badge 🏅" with the 🏅 avatar;
- tapping the bell row opens the badge wall.

(Push itself is iOS-only — not visible on web; covered by the deploy/smoke step.)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-email/lib.ts e2e/
git commit -m "test(e2e): badge_earned bell entry + tap-to-wall; note email exclusion"
```

---

## Self-Review

**Spec coverage:**
- Type `badge_earned` + constraint → Task 1. ✅
- Bell row shape (self, actor_id null, ref_id) → Tasks 4/5. ✅
- One push per N badges via `send-badge-push` → Task 3 + Task 5 invoke. ✅
- Webhook skip via `buildMessage` null → Task 2. ✅
- No email (comment) → Task 6 Step 1. ✅
- Bell render text + 🏅 avatar + tap→wall → Task 5. ✅
- Self-contained function with own `lib.ts` + accepted duplication → Task 3. ✅
- RLS self-insert verification → Task 1 Step 4. ✅
- Tests: deno (Tasks 2,3), vitest (Task 4), E2E (Task 6), smoke (Task 6), SW bump (Task 5). ✅
- Scope boundary (no iOS app change; push-tap deep-link deferred) → respected; nothing in `ios/` touched. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type/name consistency:** `buildBadgeNotificationRows(badges, userId)`, `notificationBody(type, actorName, opts)`, `notificationOpensBadgeWall(type)`, `buildBadgePushMessage(badgeNames)`, `sendPush(token, message, jwt, host)`, `createAPNsJWT(keyP8, keyId, teamId)` — names identical across the tasks that define and consume them. Badge item shape `{ ref, name }` consistent (Tasks 4/5). `ref_id` is a string everywhere. ✅

**Follow-up (out of scope):** iOS push-tap → badge-wall deep-link; add to the iOS update queue.
