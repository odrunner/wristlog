# Private Messaging (DMs) — Design

Date: 2026-11-05 · Status: SHIPPED to all users 2026-11-06 (beta 2026-11-05)

## Intent

Let two WRotate users message each other privately, Reddit/Strava style:
first contact is a **message request** the recipient must accept before a
conversation opens. Conversations support plain text and **sharing a WRotate
post** into the thread. The goal is retention and social density — give
people a reason to come back and a private channel around the public feed.

## Goals

- 1:1 private conversations with a request/accept gate for first contact.
- Share a feed post into a conversation (compact post card in the thread).
- Push notification on new message / new request, deep-linking into the
  thread — with **no new App Store build required**.
- Safety from day one: blocks enforced server-side both directions, a
  "who can message me" setting, rate limits, report-a-message.
- House style: vanilla JS in index.html, Supabase RPCs + RLS, no frameworks,
  no emoji, design-system tokens only.

## Non-goals (v1)

- Group chats, media/photo uploads (sharing a post covers photos), message
  editing, typing indicators, read receipts shown to the other party,
  E2E encryption, web realtime (polling only — see Freshness), message
  search, last-seen/online indicators.

## Anti-goals

- Anything that lets a DM bypass post visibility: a shared post must only
  render for a recipient who can already see it under the existing `logs`
  RLS. Otherwise show a "Post unavailable" placeholder. No new leak surface.
- Admin read-all access to private messages. Moderation sees only messages
  that a participant reported (snapshot into the report row).
- Push spam. One push per message is acceptable at current scale, but the
  bell panel must not be flooded (see Notifications).

## Constraints

- No `posts` table — posts are `logs` rows, `id` is TEXT, visibility
  enforced by RLS ('public' | 'followers' | 'friends' | 'private').
- Blocks (`user_blocks`) are NOT enforced by RLS on other tables today; the
  DM layer must check them itself, both directions.
- Push fires only via an AFTER INSERT webhook on `notifications`
  (`send-push-on-notification` → `send-push`); email likewise via
  `send_email` trigger → `send-email` (type must be mapped in
  `TYPE_TO_CATEGORY` or no email is sent — that absence is a valid choice).
- The client-side `notifications` INSERT policy whitelists 13 types and
  rate-limits; DM notification rows are inserted by SECURITY DEFINER RPCs
  instead (runs as owner, bypasses that policy, doesn't burn the user's
  notification rate budget).
- No realtime anywhere in the app today (`supabase_realtime` publication is
  empty). v1 uses polling, matching the existing 30s notification poll with
  its visibilitychange pause.
- iOS (`PushManager.swift` → `openPushRoute`) and Android (`PushTapJs.kt`)
  pass unknown `w.route` values to JS — a new `messages` route is one new
  branch in `openPushRoute(route, id)` (index.html:31499), no native change.
- All the usual ship gates: tests before commit, `npm run test:coverage`
  (new `wrotate_test.js` exports need branch coverage), SW cache bump,
  design-system ratchet (no hand-typed values; index.html is a counted
  file), new tables need explicit GRANTs, every SQL file ends with
  `NOTIFY pgrst, 'reload schema'`, UAT with testuser/testuser2 only.

## Decided — data model

Two tables, both RLS-enabled, written **only via SECURITY DEFINER RPCs**
(no client INSERT/UPDATE policies; SELECT policies for participants so
reads stay cheap and simple):

**`dm_conversations`**
- `id uuid pk default gen_random_uuid()`
- `user_lo uuid`, `user_hi uuid` — the pair, ordered `user_lo < user_hi`,
  `UNIQUE(user_lo, user_hi)` (one conversation ever per pair)
- `requester_id uuid` — who initiated
- `status text` — 'pending' | 'accepted' | 'declined'
- `created_at`, `accepted_at`, `last_message_at timestamptz`
- `lo_last_read_at`, `hi_last_read_at timestamptz` — per-side read marker
- SELECT policy: participant only (`auth.uid() IN (user_lo, user_hi)`),
  plus the house RESTRICTIVE demo-readonly guard on writes is moot (no
  write policies at all).

**`dm_messages`**
- `id uuid pk`, `conversation_id uuid` (FK → dm_conversations ON DELETE
  CASCADE), `sender_id uuid`, `body text` (trimmed, 1–2000 chars),
  `shared_log_id text` null (a shared post; body may be empty when sharing
  with no comment — exactly one of body/shared_log_id may be empty),
  `created_at`
- SELECT policy: participant of the parent conversation.
- DELETE policy: `sender_id = auth.uid()` (delete-your-own; hard delete).

GRANTs: `authenticated` gets SELECT on both, DELETE on `dm_messages`;
`service_role` as needed by `delete-user`. No INSERT/UPDATE grants.

### RPCs (all SECURITY DEFINER, `SET search_path = public`, EXECUTE revoked
from PUBLIC/anon, granted to authenticated; inputs validated in SQL)

- **`dm_start(p_target uuid, p_body text, p_log_id text default null)`**
  Creates the conversation + first message. Checks, in order: not self; not
  suspended; no block either direction; target's `dm_privacy` allows it
  (see Settings — 'nobody' rejects every incoming start, even from people
  the target follows, Strava's "No one" semantics; 'following' requires
  the target to follow the sender; the target can always initiate
  outward); no existing conversation for the pair ('declined' blocks
  re-requests; 'pending' rejects a duplicate). **Auto-accept when the
  target already follows the sender, or they are close friends** — the
  target has signaled trust, so no request gate (Strava behavior).
  Otherwise status 'pending'. Inserts the notification row
  (`message_request` or `message`). Rate limit: max 5 new pending requests
  per sender per day.
- **`dm_send(p_conversation uuid, p_body text, p_log_id text default null)`**
  Participant only; status must be 'accepted' — while 'pending' the
  requester cannot send more (the request carries exactly one message,
  Reddit-style) and the *target* sending a reply to a pending conversation
  implicitly accepts it (replying = accepting, like Reddit). Re-checks
  blocks and suspension. Updates `last_message_at`. Inserts a `message`
  notification row. Rate limit: 60 messages/hour, 500/day per sender
  (own `dm_rate_ok`, not `notification_rate_ok`).
- **`dm_respond(p_conversation uuid, p_accept boolean)`** Target only,
  'pending' only. Accept → 'accepted' + `accepted_at`; no notification on
  accept — the requester finds out when the reply arrives or by opening
  the thread (keeps notification types to two). Decline →
  status 'declined', kept so the **requester** can never re-request.
  **Declined is not dead for the decliner** (Reddit semantics): if the
  original target later calls `dm_start` toward the requester, the row
  revives as 'accepted' (the decliner reaching out is consent) and their
  message is appended. Likewise, the target calling `dm_start` while a
  request from the other side is 'pending' is treated as accept-and-send,
  same as replying in the thread.
- **`dm_mark_read(p_conversation uuid)`** — sets the caller's side's
  last_read marker to now().
- **`dm_inbox()`** — one-shot jsonb (feed_page pattern): conversation list
  with the other party's profile (id, username, display_name, avatar_url),
  last message preview, per-conversation unread flag, pending requests
  (incoming separated from outgoing), and total unread count. Filters out
  conversations where a block now exists either direction.
- **`dm_unread_count()`** — cheap scalar for the badge poll.

Message history for an open thread is a direct client SELECT on
`dm_messages` (RLS-gated), paged by `created_at` descending, 50 at a time.

### Blocking & reporting

- Block (existing UI) freezes the conversation: `dm_send`/`dm_start` reject,
  `dm_inbox` hides it. Unblock restores it.
- Report: a new SECURITY DEFINER RPC **`dm_report_message(p_message_id,
  p_reason, p_details)`** — NOT the existing client-INSERT report path and
  NOT `flag_content`. It verifies the caller is a participant of the
  message's conversation, then inserts the `content_reports` row itself
  with `content_type='message'` and a **server-side snapshot** of the
  message body + sender in `details`. (A client-written snapshot would let
  anyone fabricate message evidence; `flag_content` only flips
  `moderation_status`, which `dm_messages` doesn't have and v1 doesn't
  need — no auto-hide for DMs.) The existing `report-notify` INSERT
  webhook alerts the admin unchanged.
- Account deletion: both tables get FK `ON DELETE CASCADE` to
  `auth.users` (the `follows` pattern — `delete-user` itself needs no
  change; it deletes the auth user after data cleanup). A deleted
  account's conversations disappear for the other party too — acceptable
  for v1.

## Decided — notifications & push

- Two new notification types: **`message_request`** and **`message`**,
  inserted by the RPCs (not the client). The `notifications.type` CHECK
  constraint is extended for both.
- **Lifecycle (builder-check settlement):** one notification row per
  message, `ref_id` = conversation id. `dm_mark_read` ALSO marks the
  caller's unread `message`/`message_request` rows for that conversation
  as read — otherwise the server-computed iOS badge (send-push counts all
  unread notifications) would inflate forever, since these types never
  appear in the bell. `loadNotifications` excludes both types **in the
  query** (not post-filter), so DM volume can't crowd real notifications
  out of its 30-row window.
- `send-push/lib.ts`: `buildMessage` texts — request: "<name> wants to send
  you a message"; message: "<name> sent you a message" (no body preview in
  the push payload for privacy, v1). `buildRoute` → route `messages`, id =
  conversation id.
- `openPushRoute('messages', id)` opens the Messages page and, when id
  resolves, the thread.
- **Bell panel excludes both types** (`loadNotifications` filters them out);
  the envelope badge is the surface for DM unreads. The server-side badge
  count in `send-push` includes them, which is correct — total unread.
- `send-email` `TYPE_TO_CATEGORY`: map `message_request` to the existing
  social category (one email can be the difference between a request seen
  and never seen for push-less users); leave `message` unmapped — **no
  email per message** in v1.

## Decided — client UI

- **Entry point: an envelope icon in the header next to the bell**
  (index.html:3236–3247) with an unread badge — not a sixth tab; the tab
  bar is full. Opens `page-messages` as an off-tab page (the
  explore/profile pattern: manual activate, cleared nav highlight).
- **Inbox view**: "Requests (n)" section on top when any are pending
  (incoming shows Accept / Decline / Block with the first message visible —
  the recipient can read it before deciding), then conversations sorted by
  `last_message_at`, each row: avatar, name, last-message preview, unread
  dot, timestamp.
- **Thread view**: standard bubble layout from design-system tokens (own
  messages right, theirs left), day separators, composer pinned at the
  bottom (16px input — iOS no-zoom fence), long-press/⋮ per message for
  Delete (own) / Report (theirs). Shared posts render as a compact card
  (photo thumb, watch name, caption excerpt) that taps through to
  `scrollToFeedPost`/p-page; recipients who fail the `logs` RLS see a
  "Post unavailable" placeholder card.
- **Profile**: a "Message" button in the action row (index.html:8960–8967)
  next to follow/close-friend/block. Label reflects state: Message /
  Requested / blocked ⇒ hidden.
- **Post share**: a "Send to…" entry in the post ⋮ overflow (next to the
  existing `sharePost` share) → a picker listing accepted conversations
  first, then followed users (starting one via `dm_start` with the post
  attached). Respects the request gate: sending a post to a non-contact is
  a message request carrying the post.
- **Settings — "Who can message me"** (user decision 2026-11-05, matching
  Strava's control): new `profiles.dm_privacy` text, 'everyone' default |
  'following' = only people I follow | 'nobody'. Surfaced next to the
  existing privacy settings; enforced in `dm_start`; the profile Message
  button hides client-side when the target's setting forbids the viewer
  (the column is readable via the normal profiles select).
- **Freshness (polling, no realtime in v1)**: `dm_unread_count()` rides the
  existing 30s notification poll cycle; an open thread polls new messages
  every 10s while visible (visibilitychange-paused, like the notif poll);
  mark-read fires on thread open and on new messages arriving while open.
  Realtime (`supabase.channel`) is a possible later upgrade, deliberately
  not v1 — it would be the app's first realtime usage.

## Decided — rollout

- A 50/50 A/B experiment is wrong for a network feature (treatment users
  would message control users who have no UI to accept). Ship dark behind
  `featureFlag('dms')` for UAT with the two test accounts, then enable for
  everyone in one release. If staged exposure is wanted, use an
  `experiments` row at rollout_pct 0 → 100 (never 50) so the existing
  admin kill switch applies. **My call; flag the experiment-norm deviation
  to the user.**
- **Dark-UAT guard:** a client flag hides only the UI — the RPCs are live
  for every authenticated user the moment the SQL ships, and a stray
  `dm_start` would push "X sent you a message" to someone with no messages
  UI. So during UAT, `dm_start` additionally requires the **sender** to be
  in `internal_accounts`; the enable-for-all SQL lifts that guard in the
  same release that turns the UI on.
- UAT needs both gate paths: testuser/testuser2 are mutual followers (auto-
  accept path); temporarily remove one follow edge to exercise the
  request gate, then restore. Private visibility of shared posts tested
  with a friends-only post.
- Admin metrics (conversations started, messages/day, excluding
  `internal_accounts`) can come later; not v1.

## Left to the builder

- Exact SQL file layout (house style: one dated file, tests in
  `tests/*-sql.test.js`), index choices (`dm_messages(conversation_id,
  created_at)`, partial index on pending requests).
- Pagination/scroll mechanics in the thread view; optimistic send vs
  wait-for-RPC (recommend optimistic with failure toast, matching the
  comment composer).
- Exact copy for empty states, request explainer, decline/ block toasts
  (ux: plain language, no emoji).
- Whether `dm_inbox` enriches profiles inline or reuses the client profile
  cache.
- Push text truncation and localization posture (app is English-only
  today).
- Precise rate-limit numbers if the ones above prove awkward in testing.
