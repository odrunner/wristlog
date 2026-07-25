# Badge reveal — modal + persistent dot (2026-07-25)

## Problem
55.8% of users have ≥1 badge, but **73.5% of earned badges (605 across 231 users)
are never `seen`**. Root cause (code): `user_badges.seen` flips to true ONLY when
the badge wall is opened (`openBadgeWall`), and almost nobody visits it. Earning
shows a 3.5s auto-dismissing toast + a bell notification, but neither marks `seen`,
and `seen` drives no other UI — so the earn moment doesn't land.

## Change (two surfaces)
1. **Persistent dot** on the header profile button (`#profile-btn`): unseen earned-
   badge count, styled with the existing `bell-badge` class. Rendered on badge load,
   on live earn, and after the retroactive scan; **cleared when the wall is opened**
   (which already marks `seen`). Ongoing, low-friction awareness.
2. **Reveal modal on app open** (`#badge-reveal-modal`): after `retroactiveBadgeScan()`,
   `maybeRevealBadges()` pops a celebratory modal — "🎉 N badges unlocked" + medallions
   + names — with **See them** → `openBadgeWall()` (marks seen, clears dot) and
   **Dismiss** → close (dot stays). Fires **once per new-badge batch** via a
   localStorage high-water mark (`wr_badge_reveal_count`); guarded so it never stacks
   on another open overlay (retries next open) and only bumps the mark when shown.

## Decision logic (pure, tested + mirrored)
`shouldRevealBadges({earnedCount, unseenCount, lastRevealedCount})` =
`unseenCount > 0 && earnedCount > lastRevealedCount`.

## Marking `seen`
Unchanged — only opening the wall marks `seen`. Dismiss does NOT. So `seen` keeps
measuring true engagement (wall visits); the dot + modal drive more of them. Target
metric: `seen` rate climbing from ~26%.

## Scope / non-goals
- JS + one modal in `index.html`; SW bump. No schema/backend (`seen` exists).
- Skips demo mode and the no-unseen case.
- OUT: when badges are awarded, the earn toast, push.

## Testing
- 5 unit tests for `shouldRevealBadges` (mirrored, byte-identical).
- Reuses `badgeMedallionSvg`, `BADGE_BY_REF`, `openBadgeWall`, `haptic` (existing).

## Rollback
JS/HTML-only; revert the `index.html` hunks + SW bump. No data migration.
