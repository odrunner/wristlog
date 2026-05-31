# Delete a Comment — Design Spec

**Date:** 2026-05-31
**Status:** Approved, ready for implementation
**TODO source:** "ability to edit/delete comment" (delete only; edit deferred)

## Goal

Let users delete comments, following the Instagram/Strava model:

- The **commenter** can delete their own comments.
- The **post owner** can delete *any* comment on their own post (light moderation).
- On someone else's post, you can only delete your own comments.

Deletion is **silent** — no notification to anyone, no "X deleted your comment."

## Inspiration (Instagram / Strava)

- **Permissions:** commenter deletes own; content owner can remove any comment on their content. Identical in both apps.
- **Gesture:** IG = swipe-left / long-press → trash; Strava = explicit menu. No blocking "are you sure?" modal.
- **Feedback:** quiet toast; IG offers Undo. Silent — original commenter is not notified.
- **Hard delete:** comment and its likes/replies are gone.

## Decisions

| Decision | Choice |
|---|---|
| Who can delete | Both: commenter (own) + post owner (any on their post) |
| Confirmation UX | Double-tap "Sure?" — reuse existing `deleteLog` pattern (no new modal, no undo) |
| Control location | Three-dot menu per comment (reuse `feed-menu` styling) |
| Delete type | Hard delete |
| Notifications | Left untouched (silent, IG-style) |

## Current State (verified)

- Posts live in `logs`; ownership column = `logs.user_id`.
- `comments` columns: `id, user_id, log_id, body, created_at, moderation_status`.
- `comment_likes.comment_id` FK is **`ON DELETE CASCADE`** — likes clean up automatically.
- **No DELETE policy** exists on `comments` today (no one can delete).
- Comment render loop: [index.html](../../../index.html) ~9400-9432 inside `renderFeedCard`.
- `fetchComments(logId)` ~10777, `postComment(logId)` ~10972, `toggleCommentLike` ~10722.
- Reusable patterns: `deleteLog` double-tap confirm (~14369), `toggleFeedMenu`/`feed-menu` (~9496-9547).

## Design

### 1. Database / RLS

Add one DELETE policy on `comments`:

```sql
CREATE POLICY "Owner or post author can delete comments" ON comments
FOR DELETE USING (
  auth.uid() = user_id
  OR auth.uid() = (SELECT user_id FROM logs WHERE id = log_id)
);
```

`comment_likes` rows cascade-delete. `moderation_status` stays reserved for admin moderation (separate concern).

### 2. Client UI (`index.html`)

In the comment render loop, append a three-dot menu to each comment **only when**:

```js
canDeleteComment(c, item, currentUser?.id)
// === c.user_id === userId || item.user_id === userId
```

Menu (reusing `feed-menu` styles, scoped per comment id) has one item: **Delete** (red).
First tap → label flips to "Sure?"; second tap within 3s → delete. Mirrors `deleteLog`.

### 3. Delete logic — `deleteComment(commentId, logId)`

1. `demoGuard()` guard.
2. Optimistic: remove comment from `feedComments[logId]`, decrement `feedCommentCounts[logId]`, `refreshFeedCard(logId)`.
3. `await db.from('comments').delete().eq('id', commentId)` (RLS authorizes).
4. On error: restore comment to array, re-render, `toast("Couldn't delete comment", 'error')`.

### 4. Notifications

No changes. The `comment` notification's `ref_id` is the post id, not the comment, so there's nothing to surgically remove; leaving it matches IG's silent behavior and keeps the notification's link valid.

### 5. Tests

- **Unit:** pure helper `canDeleteComment(comment, post, userId)` — four cases (own comment / own post / neither / both).
- **E2E mocked:** menu visible only on deletable comments; double-tap removes the comment from the card.

## Out of Scope

- Editing comments (deferred — TODO covers edit too, doing delete first).
- Swipe / long-press gestures.
- Undo affordance (using double-tap confirm instead).

## Ship Checklist (per CLAUDE.md)

- Bump SW cache version (`sw.js` → `wristlog-vNN`).
- Deploy RLS policy via `supabase db query --linked`.
- `npm test` + `npm run test:e2e` green before commit.
- Update Help page / "What's New".
