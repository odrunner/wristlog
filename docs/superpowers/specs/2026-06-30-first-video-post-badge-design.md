# First Video Post badge — design

**Date:** 2026-06-30
**Scope:** One new achievement badge. Client-only (index.html). No schema, RPC, or edge-function change.

## Goal
Award a badge the first time a user publishes a **non-private post that includes a video** (not a photo). Mirrors the existing "First Post" badge (ref 4), which fires on any non-private post.

## Registry entry
Added to `BADGE_REGISTRY` (index.html), directly after ref 4 "First Post":

```js
{ ref: 8, slug: 'first_video_post', name: 'First Video Post', category: 'onboarding',
  flavor: 'Lights, camera — your first video hits the feed.',
  unlock: 'Publish your first post that includes a video.',
  glyph: '<rect x="26" y="34" width="48" height="32" rx="4" stroke="var(--badge-ink)" stroke-width="2" fill="none"/><path d="M44 43l14 7-14 7z" fill="var(--badge-ink)"/>',
  isHidden: false },
```

- **ref 8** — verified unused (refs in use: 1–7, 20–23, 40–44, 60–63, 80–88, 100–103).
- **category `onboarding`** — where post badges live; no "social/content" category exists and adding one for a single badge isn't worth the badge-wall grouping work.
- **glyph** — a video frame (rounded rect) + play triangle, in the same line-art style as siblings.

## Awarding logic
One block in `checkAndAwardBadges()` (index.html), right after the ref-4 First Post check:

```js
if (!alreadyEarned(8) && logs.some(l => l.visibility && l.visibility !== 'private'
    && parsePhotoUrl(l.photoUrl).some(isVideoUrl))) {
  if (await awardBadge(8)) newlyEarned.push(BADGE_BY_REF[8]);
}
```

- `parsePhotoUrl(l.photoUrl)` returns an array for both single-URL and JSON-array media; `isVideoUrl` matches `.mp4/.webm/.mov/.m3u8`.
- Non-private = `visibility !== 'private'` (public / followers / friends), matching First Post.
- **Retroactive:** scans the full `logs` array, so existing video posters earn it on their next badge check. No backfill job.

## Detection helper (for testability)
Extract the predicate into a tiny pure helper so it can be unit-tested without the DOM/DB:

```js
function isVideoPostLog(l) {
  return !!(l && l.visibility && l.visibility !== 'private'
    && parsePhotoUrl(l.photoUrl).some(isVideoUrl));
}
```
Use `logs.some(isVideoPostLog)` in the award check. Unit test covers: video single-URL, video in a JSON array, photo-only (no earn), private video post (no earn), missing media (no earn).

## Verification
- New unit test for `isVideoPostLog` (all cases above).
- Full unit suite + mocked E2E green.
- SW cache bump. Ship via push (client-only).

## Out of scope
- No new badge category. No server-side awarding. No "First Photo Post" badge (explicitly video-only).
