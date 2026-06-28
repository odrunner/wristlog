# UX consistency — before/after (2026-06-28)

Captured with `e2e/_screenshots.mjs` (mocked app, phone viewport, light + dark).

- `baseline/` — pre-UX-work state (commit 5fdf397~1, before "phase 0 tokens")
- `current/`  — after the full consistency initiative (SW v849)

Nav pages only (feed/collection/stats/wishlist/track). The dark-mode badge
wall / watch-detail fixes need seeded data not in the mock — verified
separately via live screenshots. The streak-chip fix needs an active streak
(hidden in the mock) — verify live.

Re-run: `SHOT_PHASE=current node e2e/_screenshots.mjs`
