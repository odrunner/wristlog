# Comments on shared wishlist / collection links — design

Date: 2026-08-22. Status: approved 2026-08-22.

## Goal
Anyone who opens a wishlist (`share-wishlist?t=`) or collection (`share-watches?t=`)
share link can leave a comment with a name — they usually have no WRotate account,
so the name is typed, not derived. Comments are a **public thread on the page**
(every recipient sees them), attach to the **page as a whole** (not a watch), and
the owner is told **in-app (Shared links + bell), by iOS push, and by email**.

## Decisions (from the owner)
- Visibility: everyone who opens the link sees all comments.
- Granularity: per link (page-level), one box under the watches.
- Notify: bell notification + push + email, every comment.

## Data
New table `share_comments` (one for both kinds; `kind` tells them apart):

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| kind | text check (kind in ('wishlist','collection')) | which share table `token` lives in |
| token | text | the share token (no FK — two tables) |
| owner_id | uuid not null → auth.users | copied from the share row at insert, for owner RLS |
| name | text not null | 1–40 chars after trim |
| body | text not null | 1–500 chars after trim |
| ip_hash | text | salted SHA-256 of the poster IP (same scheme as demo-login); never the raw IP |
| created_at | timestamptz default now() | |
| deleted_at | timestamptz | owner soft-delete; hidden from the page |

RLS: **owner-only** `select` and `update` (soft delete) on `owner_id = auth.uid()`.
No insert policy for anon/authenticated — inserts come only from the edge
functions on the service role after validation. Index `(kind, token, created_at)`
and `(owner_id, created_at desc)`.

`email_prefs.share_comments` (JSON key on `profiles.email_prefs`, default true)
gates the **email** only; bell + push are not optional (same as every other
notification). `email-unsubscribe` gets the category label "Comments on your shared links".

## Edge functions (both share pages, same shape)
`share-wishlist` and `share-watches` each gain:

**GET** — the page renders the existing thread below the grid (name, relative
time, body; newest last), then a form: Name (remembered in localStorage), Comment,
a hidden honeypot field, Post. No JS framework; a small inline script POSTs JSON
and appends the returned comment. Revoked / missing token → no form (404 page as today).

**POST** `{ t, name, body, hp }` →
1. Token resolves to a live share row, else 404.
2. Honeypot non-empty → 200 `{ok:true}` with nothing stored (bots think it worked).
3. Trim; name 1–40, body 1–500, strip control chars; else 400 with a reason.
4. Rate limits via the existing `rate_limits` table (`function_name` keyed,
   `user_id` = owner as the demo-login pattern does with a synthetic key):
   `share-comment:ip:<hash>` ≤ 10 per hour, `share-comment:token:<token>` ≤ 60 per
   day. Over → 429.
5. Insert `share_comments` (service role).
6. Insert `notifications` `{user_id: owner, type: 'share_comment', actor_id: null, ref_id: <comment id>}`
   → the existing `send-push` webhook fires.
7. Email (if `email_prefs.share_comments !== false`): owner address via
   `auth.admin.getUserById`; subject "New comment on your shared watches" /
   "…wishlist"; body = name, comment, link label, CTA `https://wrotate.com/open`,
   "we" voice, config set `wrotate-events`, unsubscribe link `cat=share_comments`.
   Throttle: at most one email per token per 30 min (`rate_limits` key
   `share-comment-email:<token>`), so a back-and-forth doesn't send ten emails —
   the bell/push still fire per comment.
8. Respond `{ ok: true, comment: { id, name, body, created_at } }`.

Pure logic (validation, rate-key builders, html for the thread/form, email html)
lives in a new `_shared/share-comments-lib.ts` with Deno tests; both index.ts
files import it so the two pages cannot drift.

**send-push**: `buildMessage('share_comment', …)` → "{name} commented on a link
you shared" — index.ts looks the comment up by `ref_id` for the name (one small
select; falls back to "Someone"). `buildRoute` → bell (the panel's click target is
a modal, not a post/profile/club, so the alignment test `tests/push-route.test.js`
gets `share_comment` added to its bell group).

## Client (index.html)
- **Bell**: type `share_comment` renders "**{name}** commented on your shared
  {wishlist|collection} link" (name/kind fetched in one batched
  `share_comments` select for the panel's `share_comment` rows — owner RLS allows
  it). Click → opens the matching Shared-links modal.
- **Shared links modal** (both Wishlist and Collection): each link row shows a
  "N comments" chip; tapping expands the thread inline (name, time, body, a
  Delete button per comment = soft delete). Counts come from one
  `share_comments` select per modal open.
- Help + What's New entries; SW bump.

## Abuse / privacy
- Comments are public to anyone with the link — the form says so ("Visible to
  everyone who has this link").
- Owner controls: delete any comment; revoking the link hides the thread with the
  page. Rate limits above; honeypot; length caps; HTML-escaped on render; no links
  auto-linked.
- Nothing about the owner beyond what the page already shows is exposed.

## Testing
- Deno: `_shared/share-comments-lib.test.ts` (validation edges, rate keys, thread
  html escaping, email html has CTA `/open` and unsubscribe), `send-push` message
  + route cases.
- Unit: push-route alignment (`share_comment` → bell), panel text builder,
  comment-count grouping helper, mirror-drift registration.
- E2E mocked: bell row renders; Shared links shows count, expands thread, delete.
- Smoke: POST with bad token → 404; POST empty body → 400 on both functions.
- Real path (test accounts only): post a comment on a testuser link, confirm row +
  notification + email to test@wrotate.com; delete.

## Ship order
SQL → `_shared` lib + both share functions + `send-push` deploy → smoke → client
push. Deploys and the push need the owner's go-ahead (email path is involved).
