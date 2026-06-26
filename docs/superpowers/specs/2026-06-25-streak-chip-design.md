# Persistent Top-Bar Streak Chip — Design

**Date:** 2026-06-25
**Status:** Approved (design); behind an admin feature flag for founder testing, then flag removed to ship to all.
**Scope:** Client-only. A new header element + a pure state helper + a render function calling the existing `computeStreaks`. No schema, no edge function, no backend.

## Background

Wear-streaks exist but are buried on the user's own profile Achievements card only — so few users notice or care. Before investing in streak *freeze* mechanics (the deferred next step), we must first make the streak **visible enough that people care about it**. A prior v1 put a centered chip in the *feed body*; it was reverted (looked off in the feed + a one-off "9 looked wrong" trust hit — the math was correct). This design uses a **different placement**: a compact, persistent chip in the **global top bar**, visible on every page (the Duolingo/Snapchat pattern).

This ships **behind an admin feature flag** (`streak_chip`, default off) so the founder can test it on their own devices first; once validated, the flag is removed and the chip renders for everyone. Streak **freeze + loss-aversion framing** remain a separate, later spec, gated on whether this prominence lifts logging.

## Goal

Surface the user's current wear-streak as an ambient, always-visible `🔥 N` chip in the header, so the streak becomes something users notice every session and want to keep alive.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Placement | Compact chip in the global header's right-side icon cluster (`.header-data`), before the bell. Visible on every page. |
| Source | Existing `computeStreaks(logs, todayStr())` → `{current, best, status}`. No math change. |
| States | `active` → bright `🔥 N`; `at_risk` → dim/amber `🔥 N`; `none` but has logged before (`best ≥ 1`) → dim `🔥` (no number, invites restart); never logged (`best 0`) → **hidden**. |
| Tap | Navigates to the **Track** page (the streak-maintaining action). |
| Trust | Tooltip: "Consecutive days you've logged — any activity counts." |
| Gating | Admin feature flag `streak_chip` (default `false`); chip hidden unless `featureFlag('streak_chip')`. |
| Updates | Recomputed on load, after a log (`saveLog`/`saveNewPost`), on nav, after sync — same cadence the bell badge uses. |

## Non-Goals

- **No streak freeze, no loss-aversion framing** (deferred next spec).
- **Not in the feed** (the reverted placement) and **no new notifications/push**.
- No streak storage / server compute (others'-profile streaks are a later spec).
- No change to `computeStreaks` itself.

## Architecture

### Component 1 — Feature flag
Add `streak_chip: { label: 'Streak: top-bar chip (admin)', default: false }` to `FEATURE_FLAGS` (index.html ~4881). The admin Dev tab auto-renders its toggle (no extra admin UI). `featureFlag('streak_chip')` gates the chip.

### Component 2 — Pure state helper (testable, mirror-drift)
`streakChipState(sk, flagOn)` → `{ visible, count, dim, atRisk, invite }`, where `sk` is the `computeStreaks` result. Pure, defined byte-identically in `index.html` and `wrotate_test.js`, registered in the mirror-drift `VERBATIM` list, and unit-tested. Rules:
- `flagOn === false` → `{ visible: false }`.
- `status === 'active'` → `{ visible: true, count: current, dim: false, atRisk: false, invite: false }`.
- `status === 'at_risk'` → `{ visible: true, count: current, dim: true, atRisk: true, invite: false }`.
- `status === 'none' && best >= 1` → `{ visible: true, count: null, dim: true, atRisk: false, invite: true }`.
- `status === 'none' && best < 1` → `{ visible: false }` (never-logged; onboarding owns them).

### Component 3 — Header element + CSS
A `<button id="streak-chip" class="streak-chip hidden" title="…">` placed in `.header-data` before the bell button. CSS `.streak-chip` is a compact pill sized for the header; reuses `.streak-flame` / `.streak-flame-dim`; `at_risk` adds an amber tint. Mobile: stays compact (`🔥 N`, icon+number only).

### Component 4 — `updateStreakChip()` render fn
Computes `computeStreaks(logs, todayStr())`, derives `streakChipState(sk, featureFlag('streak_chip'))`, and shows/hides + fills the chip element accordingly (count, dim, amber, invite-with-no-number). Wired into the same places the streak/feed refresh already fires: app load/boot, after `saveLog` and `saveNewPost`, on `nav`, and after cloud sync applies logs. Clicking the chip routes to the Track page.

## Edge cases

- **Flag off (everyone, default):** `streakChipState` returns `visible:false` → chip hidden; zero visual change for users until the flag ships.
- **Never-logged user:** hidden (no nag).
- **Logged today after being at_risk/none:** next `updateStreakChip()` flips it to bright and bumps the count immediately.
- **Per-device flag:** localStorage-scoped, like existing flags — the founder toggles it on each device they test on (consistent with `tg_piezo` etc.).

## Testing

- **Unit (vitest)** on `streakChipState`: each branch (flag off; active; at_risk; none+best≥1 invite; none+best0 hidden), via `tests/streak-chip.test.js` importing from `wrotate_test.js`.
- **Mirror-drift**: `streakChipState` added to the `VERBATIM` registry; the guard test confirms the two copies are byte-identical.
- **Full suite** (`npm test`) stays green.
- **Manual UAT (founder):** toggle `streak_chip` on in the admin Dev tab; confirm the chip shows the correct count/state on every page, dims when at_risk, hides for a never-logged test account, and routes to Track on tap. (Test accounts only.)

## Files / changes

| Area | Change |
|---|---|
| `index.html` | `FEATURE_FLAGS.streak_chip`; `streakChipState` (verbatim); `#streak-chip` header element + `.streak-chip` CSS; `updateStreakChip()` + wiring; tap→Track; tooltip; SW bump |
| `wrotate_test.js` | `streakChipState` (byte-identical, exported) |
| `tests/streak-chip.test.js` | New unit tests |
| `tests/mirror-drift.test.js` | Add `streakChipState` to `VERBATIM` |
| `sw.js` | Cache bump |

## Rollout

1. Build behind `streak_chip` (default off) → merge to main. **No user sees it** (flag off everywhere).
2. Founder toggles it on in the admin Dev tab and tests across pages/devices.
3. On approval, a **follow-up change removes the flag entirely** (delete the `FEATURE_FLAGS` entry + the `featureFlag('streak_chip')` guard so the chip renders unconditionally) and ships to all — per the project rule that flags are personal-test-only.

## Follow-ups (out of scope)

- **#4 A+B** — streak freeze + loss-aversion framing (the original next step), gated on this lifting logging.
- **#4 C** — social-visible streaks (needs a stored/server-computed streak).
- Optional streak-at-risk notification (reuse the reminder rails).
