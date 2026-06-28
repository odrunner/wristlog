# Featured Post — Design

**Date:** 2026-06-27
**Status:** Approved, ready for implementation

## Summary

Let the admin spotlight one post at the top of everyone's main feed. The admin
features a post from the existing per-post kebab menu; it pins to the top of the
feed for 24 hours, then automatically rotates to the next post in a FIFO queue.
Only one post is featured at a time. The admin manages the queue from a new tab
in the admin portal.

## Decisions (locked)

- **Single slot + queue.** Exactly one post is featured at any moment. Featuring
  more posts adds them to a FIFO queue; the next one auto-promotes when the
  current feature expires.
- **Fixed 24h duration.** Every feature lasts 24 hours. No per-feature choice.
- **Scope: everyone's main feed.** The featured post pins to the top of the main
  feed for all users. Only **public** posts qualify.
- **Visual: "★ Featured" pill** on the pinned post.
- **Admin-only action** added to the *existing* kebab menu (no new menu).
- **Queue management** lives in the existing admin portal as a new "Featured" tab.
- **Lazy rotation, no cron.** Rotation is computed on read. The 24h clock for the
  next post starts on the first feed-load after the previous feature expires.
  Drift is seconds-to-minutes for a community feed — accepted, keeps zero moving
  parts.

## Architecture

### Data — new table `featured_posts`

A FIFO queue, one row per featured/queued post.

| column | type | purpose |
|---|---|---|
| `id` | uuid pk (default gen_random_uuid) | row id |
| `log_id` | uuid → `logs.id` ON DELETE CASCADE | the post |
| `enqueued_by` | uuid → auth.users | admin who featured it |
| `enqueued_at` | timestamptz default now() | FIFO ordering key |
| `activated_at` | timestamptz null | set when promoted to active slot |
| `expires_at` | timestamptz null | `activated_at + 24h`; null while queued |
| `status` | text default `'queued'` | `queued` / `active` / `expired` |

- Partial unique index: a given `log_id` can appear at most once while
  `status IN ('queued','active')` (no double-queueing the same post).
- RLS enabled; **no public policies** — all access is via the SECURITY DEFINER
  RPCs below. (Matches the project pattern for admin-controlled tables.)

### Server — RPCs

All `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, following the
existing admin-RPC convention (`20260612_guard_admin_user_stats.sql`). Source
saved to `sql/2026-06-27-featured-post.sql`, deployed via
`supabase db query --linked` (migration push doesn't work — remote-only
migrations).

1. **`featured_current()`** → `uuid` (the active featured `log_id`, or null).
   - Public-readable (EXECUTE to `authenticated`). Does **lazy rotation**:
     1. If there's an `active` row whose `expires_at <= now()`, mark it `expired`.
     2. Also expire the active row if its post is no longer eligible — deleted,
        `visibility <> 'public'`, or `moderation_status = 'removed'`.
     3. If no `active` row remains, promote the oldest `queued` row (by
        `enqueued_at`) whose post is still eligible: set `status='active'`,
        `activated_at=now()`, `expires_at=now()+interval '24 hours'`. Skip and
        expire any queued rows whose post is no longer eligible.
     4. Return the active row's `log_id`, or null if the queue is empty.
   - Idempotent and safe to call on every feed load.

2. **`admin_feature_post(p_log_id uuid)`** → void. Admin-guarded.
   - Reject if caller is not admin (`profiles.is_admin`).
   - Reject if the post doesn't exist, isn't `visibility='public'`, or is
     `moderation_status='removed'` (RAISE EXCEPTION with a clear message).
   - Reject if the post is already `queued`/`active`.
   - Insert a `queued` row. (Promotion to the active slot happens lazily on the
     next `featured_current()` call — including immediately if the slot is empty.)

3. **`admin_unfeature(p_id uuid)`** → void. Admin-guarded.
   - Delete the `featured_posts` row with that id (works for both queued and
     active). If it was active, the next `featured_current()` promotes the
     successor.

4. **`admin_featured_queue()`** → table. Admin-guarded.
   - Calls the rotation logic first (so the view is current), then returns the
     active row + queued rows ordered `active` first then by `enqueued_at`, with
     joined post fields for display: `id, log_id, status, activated_at,
     expires_at, enqueued_at, notes, photo_url, user_id` and the author's
     `display_name`/`username`.

### Client — `index.html`

**Kebab menu (existing, [index.html:10360-10373](index.html#L10360-L10373)).**
Add one admin-only item to *both* branches (owner + non-owner) of the existing
`.feed-menu`, rendered only when the current user is admin:

```
${_isDevUser() && vis === 'public' ? `<div class="feed-menu-item" onclick="featurePost('${item.id}');closeFeedMenu('${item.id}')">★ Feature this post</div>` : ''}
```

Gating uses `_isDevUser()` ([index.html:5023-5024](index.html#L5023-L5024)) — the
same admin gate the admin portal uses, and it maps to the admin whose
`profiles.is_admin = true`, so it lines up with the server guard. Only shown for
public posts (only those qualify). New handler `featurePost(logId)` calls
`db.rpc('admin_feature_post', { p_log_id: logId })` and shows an inline toast
("Featured — pinned to the top for 24h" / "Added to the feature queue") per the
project's no-`confirm()`/`alert()` rule.

**Feed pinning ([loadFeed](index.html#L9719), Phase 1).** After `rawLogs` is
computed and visibility-filtered, before the Phase-1 render:
1. `const featuredId = await db.rpc('featured_current')` (fast, single value;
   guarded with a short timeout so it never blocks the feed).
2. If `featuredId` is set: ensure that log is loaded — if it's not already in
   `rawLogs`, fetch it with `db.from('logs').select(FEED_LOG_COLS).eq('id',
   featuredId).eq('visibility','public').maybeSingle()`.
3. Remove any existing copy of `featuredId` from `rawLogs` (de-dupe), then
   unshift the featured log at index 0 with a marker flag `__featured: true`.
4. Phase 2 enrichment must include the featured log's `user_id`/`watch_id` in its
   id lists so its avatar/watch/likes/comments load too.

**Pill render ([renderFeedCard](index.html#L10350)).** When `item.__featured`,
render a small "★ Featured" pill in the card header (reuse the existing badge/pill
styling, e.g. near `visBadge`). Pure presentational.

**Admin portal tab (existing, [index.html:2825-2833](index.html#L2825-L2833)).**
Add a "Featured" tab button + an `admin-tab-featured` panel. New
`loadAdminFeatured()` render function calls `db.rpc('admin_featured_queue')` and
lists the active post (with time remaining) + the queued posts, each with a
remove/unfeature button calling `db.rpc('admin_unfeature', { p_id })` then
re-rendering. Wire into `switchAdminTab()` and `showAdminPage()`
([index.html:13030-13067](index.html#L13030-L13067)).

## Edge cases

- **Featured post deleted / made private / removed after featuring** →
  `featured_current()` skips it (expires it) and promotes the next eligible
  queued post. The pill never shows a non-public post.
- **Empty queue** → `featured_current()` returns null, no pill, feed renders
  normally.
- **Featured post older than the first feed page** → fetched explicitly by id and
  unshifted, so it pins even if it wouldn't otherwise appear.
- **Double-feature** → blocked by the partial unique index + the RPC pre-check.
- **`featured_current()` RPC fails/times out** → feed falls back to normal
  rendering (no pin). Featuring is non-critical to feed availability.

## Testing

**Unit tests** (pure logic, extract rotation rules into a testable JS helper or
test the SQL logic's decision table):
- expire-then-promote: active past `expires_at` → next queued becomes active.
- skip-invalid: queued post that's now private/removed/deleted is skipped, next
  eligible promoted.
- FIFO order honored by `enqueued_at`.
- empty queue → null.
- de-dupe: featured id present in rawLogs appears exactly once, at index 0.

**E2E mocked** (Playwright, mocked Supabase routes):
- kebab "★ Feature this post" item visible for admin, absent for non-admin.
- featuring a public post calls `admin_feature_post` and shows the toast.
- "★ Featured" pill renders on the pinned post and it sits at the top.
- admin "Featured" tab lists active + queue; remove button calls
  `admin_unfeature` and the row disappears.

## Files touched

- `sql/2026-06-27-featured-post.sql` — new table + 4 RPCs (source of record).
- `index.html` — kebab item + `featurePost()`, feed pin/de-dupe in `loadFeed`,
  pill in `renderFeedCard`, admin "Featured" tab + `loadAdminFeatured()`.
- `sw.js` — bump `wristlog-vNN` cache version.
- Test files — unit + E2E mocked per above.
- Help page / "What's New" — note the new admin capability (admin-facing).

## Out of scope (YAGNI)

- Per-feature duration choice (fixed 24h).
- Queue reordering (FIFO only; remove + re-add to reorder).
- Multiple simultaneous featured posts.
- pg_cron rotation (lazy-on-read instead).
- Non-admin three-dots changes.
