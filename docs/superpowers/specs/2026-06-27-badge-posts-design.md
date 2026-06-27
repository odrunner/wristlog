# Badge Achievement Posts — Design

**Date:** 2026-06-27
**Status:** Approved. Behind `badge_posts` flag for founder testing, then flag removed to ship to all.
**Scope:** Auto-surface notable earned badges in the feed — inline on the post/log that earned them, or as a standalone badge card when there's no post. Reuses the logs/feed/likes/comments model. Adds two nullable DB columns + a setting.

## Background

The social feed is starved (4.3% follow, sparse content) but posted content engages (44% like rate). Surfacing achievements (Strava-style) adds quality social content. Badges already exist (`user_badges`, `BADGE_REGISTRY`, `checkAndAwardBadges`). A badge post is just a `logs` row (watch-less, `use_case:'badge'`) — it inherits the feed, visibility filter, likes, and comments for free (the measurement-share flow is the precedent).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Trigger | **Auto-post notable badges** (not opt-in-per-badge). |
| Notable filter | Exclude `category === 'onboarding'` and `isHidden` badges; include collection / connoisseur / timegrapher / habit-streak. |
| Earned **via a post/log** | Show **inline** on that post (a "🏅 Earned: <name>" ribbon) — **no** separate post. |
| Earned **without a post** (add-watch, un-shared measurement) | **Standalone** badge card in the feed. |
| Retroactive (app-load catch-up) | **No feed post** (no backfill of historical badges). |
| Visibility | Each user's **default post visibility** (`getDefaultVis()`). Private-default users never broadcast. |
| Control | Setting **"Share achievements to feed"** (`profiles.share_achievements`, default **true**) gates all auto-posting; posts are deletable. |
| Gating | Admin flag `badge_posts` gates **creation** only. **Rendering is NOT gated** (a founder-created badge post must render in everyone's feed). |

## Non-Goals

- No onboarding/hidden badges in the feed; no retroactive backfill.
- No editable caption on standalone badge posts (deletable only).
- No new likes/comments/notification infra (all inherited via `log_id`).
- No new card for the inline case — it's a ribbon added to the normal card.

## Architecture

### Data model (two nullable columns)
- `logs.badge_refs jsonb` — array of badge refs attached to this row. On a normal post → the badges that post earned (inline ribbon). On a `use_case:'badge'` row → the standalone badge(s).
- `profiles.share_achievements boolean NOT NULL DEFAULT true` — the opt-out.
- `use_case = 'badge'` distinguishes a standalone badge post from a text post (both are watch-less). A `notes` fallback (`"Earned the <name> badge 🏅"`) lets pre-update clients render something sane.

### Decision logic — `badgePostPlan(newlyEarned, context, postId)` (pure, mirror-drift, tested)
Returns `{ inline: number[], standalone: number[] }`:
- `notable = newlyEarned.filter(b => b && b.category !== 'onboarding' && !b.isHidden).map(b => b.ref)`.
- `context === 'retroactive'` or no notable → `{ inline: [], standalone: [] }`.
- `postId` present → `{ inline: notable, standalone: [] }`.
- else → `{ inline: [], standalone: notable }`.

### Creation (flag-gated) — in `checkAndAwardBadges(context, postId)`
After the existing `showBadgeToast` / `notifyBadgesEarned`, when `featureFlag('badge_posts')` **and** `myProfile?.share_achievements !== false`:
- `const plan = badgePostPlan(newlyEarned, context, postId);`
- `plan.inline.length` → `attachBadgesToPost(postId, plan.inline)` — `UPDATE logs SET badge_refs = <refs> WHERE id = postId`; force feed refresh.
- `plan.standalone` → for each ref, `INSERT` a `logs` row (`use_case:'badge'`, `watch_id:null`, `badge_refs:[ref]`, `visibility:getDefaultVis()`, `notes` fallback); force feed refresh.
- `saveLog` and `saveNewPost` pass their just-created log id as `postId` (so wear-logs and posts attach inline). All other callers pass nothing → standalone (or retroactive → nothing).

### Rendering (NOT gated) — `renderFeedCard`
- **Standalone badge card** (`item.use_case === 'badge'`): render the badge **medallion** (the glyph-in-gold-circle reused from the profile Achievements grid) + **name** + **flavor**, a "🏅 Badge" label, the normal avatar/username/time and the standard ♥/💬/share row. Tapping the medallion opens the user's badges. No watch chip, no caption edit.
- **Inline ribbon** (normal post with non-empty `item.badge_refs`): under the post content, a compact ribbon per ref — small glyph + "Earned: <name>". Purely additive to the existing card.
- Both resolve refs via `BADGE_BY_REF[ref]` (name/flavor/glyph). Unknown ref → skipped.
- The feed `select` and `myProfile` select must include `badge_refs` / `share_achievements` (safe only **after** the columns exist — see rollout).

### Setting UI (flag-gated during testing)
A "Share achievements to feed" toggle in the profile preferences (near the notification toggles), bound to `profiles.share_achievements`, shown when `featureFlag('badge_posts')` is on (so it appears for everyone once the flag is removed). Default reflects `share_achievements !== false`.

## Edge cases / failure modes

- **Flag off:** no creation anywhere; rendering still safe (badge_refs are null/empty for all existing rows → no ribbons/cards). Zero feed change.
- **Column missing at query time:** would break the feed `select` for everyone → **the SQL is applied before the client that selects the columns is merged** (gated ordering).
- **Multiple badges from one action:** all refs go on the one post (inline) — multiple ribbons.
- **Private-default user:** badge post is `only-me` → not in others' feeds (honored).
- **Pre-update client viewing a standalone badge post:** `use_case:'badge'` unknown → falls back to text post showing the `notes` line.
- **Delete:** a badge post (standalone) deletes like any post; an inline ribbon disappears if the post is deleted.
- **Likes/comments:** attach by `log_id`, work unchanged on both inline-bearing and standalone badge posts.

## Testing

- **Unit (vitest)** `tests/badge-posts.test.js` on `badgePostPlan`: notable filter (onboarding/hidden excluded); retroactive → empty; postId → inline; no postId → standalone; multiple notable refs; empty/no-notable → empty.
- **Mirror-drift:** `badgePostPlan` in `VERBATIM`.
- **Badge suite invariance:** existing `tests/badges.test.js` unaffected (we don't change awarding).
- **Full suite** (`npm test`) green.
- **Manual UAT (founder, flag on, test accounts):** earn a notable badge via a wear-log → ribbon on that post; earn one via add-watch (no post) → standalone card; an onboarding badge → no post; retroactive recompute → no post; toggle the setting off → no posts; like/comment a badge post from the second test account; delete a badge post. Flag off → nothing posts; feed unaffected.

## Files / changes

| Area | Change |
|---|---|
| `sql/2026-06-27-badge-posts.sql` | `logs.badge_refs jsonb`; `profiles.share_achievements bool default true` |
| `index.html` | `badgePostPlan` (verbatim); `badge_posts` flag; `attachBadgesToPost`/`createStandaloneBadgePosts`; `checkAndAwardBadges(context, postId)` integration; `saveLog`/`saveNewPost` pass postId; feed `select` + `myProfile` select include the new columns; `renderFeedCard` standalone card + inline ribbon; badge-card CSS; setting toggle; SW bump |
| `wrotate_test.js` | `badgePostPlan` (byte-identical, exported) |
| `tests/badge-posts.test.js` | New unit tests |
| `tests/mirror-drift.test.js` | Add `badgePostPlan` to `VERBATIM` |
| `sw.js` | Cache bump |

## Rollout (gated)

1. **Apply the SQL first** (`logs.badge_refs`, `profiles.share_achievements`) — before merging the client (the feed/profile selects reference the new columns).
2. Merge the client (creation behind `badge_posts` flag default off; rendering live but inert with no badge_refs data).
3. Founder toggles `badge_posts` on, tests across both accounts (inline, standalone, setting, likes/comments, delete).
4. On approval, **remove the flag** (creation runs for all who have `share_achievements`) — per the flags-are-personal-test-only rule.

## Follow-ups (out of scope)

- A celebratory "shared to your feed" hint on the badge toast.
- Backfill an opt-in "share past achievements" tool.
