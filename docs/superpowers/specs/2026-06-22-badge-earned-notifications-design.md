# Badge-Earned Notifications — Design

**Date:** 2026-06-22
**Status:** Approved (design); implementation plan pending
**Scope:** Web app (`index.html`), Supabase edge functions, one SQL constraint change. **No iOS app change.**

## Problem

WRotate already has a 24-badge achievement system (`index.html` ~4880–5400) and a full
notification stack (in-app bell inbox, iOS APNs push, email — all triggered off `notifications`
table inserts). But earning a badge produces **only** a transient in-app toast (`showBadgeToast`,
~3.5s) and writes to `user_badges`. It does **not** insert into `notifications`, so a badge never
reaches the bell inbox or push. A user who earns "First Watch" or a 30-day streak while not looking
at the screen at that exact moment may never learn it happened.

## Goal

Make earning a badge create a real notification that flows through the **in-app bell** and an
**iOS push**. No email. Tapping the bell entry opens the badge wall.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Channels | In-app bell + iOS push. **No email.** |
| Push scope | **All** 24 badges push (bell gets all too). |
| Batching | One bell row per badge; **one combined push** when several are earned at once. |
| Tap target | Bell entry tap → **badge wall** (`openBadgeWall()`). |
| iOS push-tap deep-link | **Out of scope** — tracked as an iOS follow-up. |

## Non-Goals

- No email for badges (matches how "hearts"/likes are intentionally excluded from email).
- No push-tap deep-linking to the badge wall (requires native `AppDelegate` tap routing the app
  does not have today — no existing push type deep-links). Tracked separately for a future iOS build.
- No change to the badge registry, badge wall, toast, or `user_badges` schema/logic.
- No new persistent streak counter or streak reminders (those are separate roadmap items #2/#3).

## Architecture

Chosen approach: **decouple push from the insert webhook.** The per-badge bell rows never trigger
push; the client makes one explicit push call after the award pass. This honors the batch decision
exactly and keeps bell rows as pure data.

### Flow

```
checkAndAwardBadges()  [client, index.html]
  ├─ awardBadge(ref) × N        → writes user_badges rows  (unchanged)
  ├─ collects newlyEarned[]                                 (unchanged)
  └─ if newlyEarned.length > 0:
       ├─ showBadgeToast(newlyEarned)                        (unchanged)
       ├─ INSERT N notifications rows  type='badge_earned'   (NEW)
       └─ db.functions.invoke('send-badge-push', {badgeNames}) ── one push  (NEW)

notifications INSERT  → send-push webhook  → EARLY-SKIP type='badge_earned'  (NEW guard)
                      → send-email webhook  → returns null (not in TYPE_TO_CATEGORY) → no email (no change)
```

### Components

**1. Notification type `badge_earned`**
- Add to the `notifications_type_check` CHECK constraint (currently defined in
  `sql/friends_migration.sql:89-98`). Deployed via `npx supabase db query --linked` with
  `ALTER TABLE notifications DROP CONSTRAINT ... ; ALTER TABLE notifications ADD CONSTRAINT ...`
  (migration-push doesn't work on this project per CLAUDE.md). Update `sql/friends_migration.sql`
  too so the repo stays the source of truth.

**2. Bell row (client INSERT in `checkAndAwardBadges`)**

One row per badge in `newlyEarned`:

```js
{
  user_id: currentUser.id,   // recipient = self
  type: 'badge_earned',
  actor_id: null,            // self-generated, like the existing 'system' type
  ref_id: String(badge.ref), // numeric badge ref, for bell text + wall lookup
  is_read: false
}
```

Inserted as a batch (single `.insert([...])`). `awardBadge()` is unchanged (writes only `user_badges`).

**3. In-app bell rendering (`renderNotificationPanel`, `index.html`)**
- Add to the type→text chain:
  `badge_earned` → `You earned the {name} badge 🏅`, where
  `name = BADGE_BY_REF[Number(n.ref_id)]?.name` (fallback to a generic "a new badge" if the ref is
  unknown, e.g. a registry change).
- Tap handler for `badge_earned` rows → `openBadgeWall()`.

**4. New edge function `send-badge-push`**
- Deployed `--no-verify-jwt`; authenticates the caller itself via `supabase.auth.getUser(jwt)` and
  derives `user_id` from the verified token. A user can therefore only trigger a push **to
  themselves** — `badgeNames` from the request body is used only for display text, never to choose a
  recipient.
- Looks up the caller's `device_tokens` (`platform = 'ios'`) with the service-role client, builds
  **one** message via `buildBadgePushMessage(badgeNames)`, sends via APNs to all the user's devices,
  and cleans up 410-expired tokens (same as `send-push`).
- Request body: `{ badgeNames: string[] }`. Response mirrors `send-push`
  (`{ sent, failed, cleaned }` / `{ skipped }`).

**5. Shared APNs internals**
- Extract `createAPNsJWT` and `sendPush` (currently private in `send-push/index.ts`) into
  `send-push/lib.ts`, and import them in both `send-push` and `send-badge-push`. Avoids duplicating
  the APNs signing/delivery code.

**6. `buildBadgePushMessage(badgeNames: string[])` — pure function in `send-push/lib.ts`**
- `[]` → `null` (caller skips — defensive; should not happen).
- 1 name → `{ title: 'WRotate', body: 'You earned the "First Watch" badge 🏅' }`
- ≥2 names → `{ title: 'WRotate', body: 'You earned 3 badges! 🏅' }`
- Unit-testable in isolation.

**7. Webhook guard (`send-push/index.ts`)**
- Immediately after extracting `type`, add: `if (type === 'badge_earned') return 200 {skipped:'badge_earned'}`.
  Ensures the N per-badge bell inserts never each fire a push; push is exclusively the explicit
  client call.

**8. `send-email`** — no code change required (`badge_earned` is absent from `TYPE_TO_CATEGORY`, so
  `buildEmailContent` returns null and no email is sent). Add a one-line comment noting badges are
  intentionally excluded, for the next reader.

## Data flow / failure modes

- **Multiple badges at once (bulk import):** N bell rows + exactly one push. ✅
- **Client dies between bell inserts and the push call:** user has correct bell entries + toast but
  no push. Acceptable — `user_badges` is the source of truth; the badge is not lost.
- **`send-badge-push` fails / user has no iOS token:** bell + toast still correct; function returns
  `{skipped:'no device tokens'}` or a 5xx that the client ignores (best-effort, non-blocking — do
  not await-block the UI on it).
- **Web user:** no push (iOS-only); bell + toast + tap-to-wall fully functional.
- **iOS user, push banner tap:** opens the app to the last webview screen (same as every existing
  push — none deep-link today). Route to the wall via the bell entry. Deep-link is the deferred iOS
  item.

## Security / RLS

- **Mandatory pre-implementation check:** confirm the `notifications` INSERT RLS policy allows a row
  where `user_id` = the authenticated caller's own id. (Existing client inserts target *other*
  users' ids, so a permissive insert policy is expected — but verify before relying on it. If it
  blocks self-inserts, do the bell insert through a `SECURITY DEFINER` RPC instead.)
- `send-badge-push` derives the recipient from the verified JWT, not from request input — no way to
  push to another user.

## Testing

- **Unit:** `buildBadgePushMessage()` — empty/singular/plural, and quoting/escaping of badge names;
  webhook early-skip of `badge_earned`; bell-row object construction (shape + ref serialization).
- **E2E (mocked):** earning a badge inserts a `badge_earned` bell row and renders
  "You earned the … badge 🏅"; tapping it opens the badge wall.
- **Smoke (after deploy):** invoke `send-badge-push` for the test user → expect 200 with
  `skipped: 'no device tokens'` (test account has no iOS token; no real delivery on web).
- **RLS:** verify the self-insert policy as above before wiring the client insert.
- **SW cache:** bump `sw.js` (`wristlog-vNN`) for the `index.html` change.
- Manual UAT across both test accounts on web: earn a badge (e.g. add first watch) → toast + bell
  entry + tap-to-wall.

## Files touched

| File | Change |
|---|---|
| `index.html` | Bell inserts + push invoke in `checkAndAwardBadges`; `badge_earned` render + tap in `renderNotificationPanel`; SW cache bump in `sw.js` |
| `sw.js` | Cache version bump |
| `supabase/functions/send-push/lib.ts` | Add `buildBadgePushMessage`; receive extracted `createAPNsJWT`/`sendPush` |
| `supabase/functions/send-push/index.ts` | Early-skip `badge_earned`; move JWT/sendPush to lib |
| `supabase/functions/send-badge-push/index.ts` | New function |
| `supabase/functions/send-email/lib.ts` | Comment noting badges intentionally excluded |
| `sql/friends_migration.sql` (defines `notifications_type_check`) | Add `badge_earned`; apply to remote via `db query --linked` |
| Tests | Unit + mocked E2E + smoke additions |

## Follow-ups (out of scope, track separately)

- **iOS:** add `UNUserNotificationCenterDelegate` push-tap routing + a JS bridge so tapping a badge
  push (and ideally any notification) navigates the webview to the right screen — the badge wall for
  badges. First push type to deep-link; benefits all notification types. Add to the iOS update queue.
- Roadmap #2 (live streak counter) and #3 (streak-reminder push) remain separate initiatives.
