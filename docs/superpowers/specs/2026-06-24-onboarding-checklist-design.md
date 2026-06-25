# Day-Zero Onboarding Checklist + Capstone — Design

**Date:** 2026-06-24
**Status:** Approved (design); implementation plan pending
**Scope:** Web app client only (`index.html` + `wrotate_test.js`). Reuses the shipped badge + `badge_earned` notification system. **No backend, schema, or edge-function change.**

## Background

Engagement data (see `docs/research/2026-06-24-engagement-deep-dive.md`): 78% of users add a watch but 63% never act again; only 16% ever log a wear; D30 retention ~8%. The app is used as a catalog, not a habit. Research: an **endowed-progress checklist** lifts completion 34%→19%, and a **day-zero achievement** lifts retention to 56.9% vs 27.1%. This feature is roadmap item #3 (the first of #3 → #1 → #2).

## Goal

Drive new-user activation through the core funnel (watch → wear → measure → profile) with a persistent, endowed-progress "Getting started" checklist on the feed, a stronger first-wear moment, and a "Getting Started" capstone badge.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Steps (in order) | **Add a watch → Log a wear → Measure your accuracy → Complete your profile.** |
| Step-complete source | The four **existing onboarding badges**: `first_watch` (1), `first_wear` (3), `first_measurement` (2), `profile_complete` (5). Progress = count of `{1,3,2,5}` in `_earnedBadges` (0–4). Endowed head start is automatic (most users land at ≥1/4). |
| Placement | Compact card at the **top of the feed** (`#page-feed`); rendered only when logged in and progress < 4. **Collapsible** (state in `localStorage`); **not** permanently dismissible. Auto-hides at 4/4. |
| First-wear celebration | When `first_wear` (3) is newly earned, augment the badge moment with **"🔥 Your streak starts now — day 1"**. |
| Finale / capstone | A **new "Getting Started" badge** (`ref 6`, onboarding) awarded when all of `{1,2,3,5}` are earned. Its existing badge toast (+ bell/push) **is** the lightweight finale; the card auto-hides at 4/4. |
| Reach | In-app card → reaches **everyone incl. web users** (65% are web-only and unreachable by push). |

## Non-Goals

- No backend, DB, edge function, or schema change (badges are client-awarded; `badge_earned` infra already deployed).
- No permanent dismissal of the card (keeps nudging until done).
- No change to the one-time 6-step welcome modal (this is the *persistent* layer it lacks).
- The checklist is **watch/wear/measure/profile** — `first_post` (4) is intentionally **not** a step (social is the weakest loop).
- No reminders/email here (that's roadmap #1, next).

## Architecture

Pure client-side, reusing the badge system. One pure function computes checklist state from earned-badge refs; one production renderer draws the card; the capstone is one registry entry + one award condition; the first-wear line hooks the existing award pass.

### Component 1 — `onboardingChecklistState(earnedRefs)` (pure)

Added to **both** `wrotate_test.js` (exported) and `index.html`, byte-identical, `VERBATIM` in `tests/mirror-drift.test.js`.

```js
// earnedRefs: Set or array of earned badge refs.
// Returns { steps: [{ key, label, ref, done }], doneCount, total, complete }.
function onboardingChecklistState(earnedRefs) {
  const has = (r) => (earnedRefs instanceof Set ? earnedRefs.has(r) : (earnedRefs || []).includes(r));
  const steps = [
    { key: 'watch',   label: 'Add your first watch',     ref: 1, done: has(1) },
    { key: 'wear',    label: 'Log a wear',               ref: 3, done: has(3) },
    { key: 'measure', label: 'Measure your accuracy',    ref: 2, done: has(2) },
    { key: 'profile', label: 'Complete your profile',    ref: 5, done: has(5) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: 4, complete: doneCount === 4 };
}
```

### Component 2 — `renderOnboardingChecklist()` (production render)

In `index.html`, populates a `<div id="onboarding-checklist">` placed at the top of `#page-feed` (after the feed `.page-header`, before `#feed-list`). Logic:
- If `!currentUser` → empty.
- `const st = onboardingChecklistState(new Set(_earnedBadges.map(e => e.badge_ref)))`.
- If `st.complete` → empty (card gone).
- Else render: header `Getting started — {doneCount}/4`, a progress bar, and 4 rows. Done rows: ✓ + muted/strikethrough label. Incomplete rows: tappable, routing to the action:
  - watch → the add-watch flow (e.g. `openPhotoIdentify()` / `openAddWatch()`)
  - wear → the log-wear flow (e.g. `openTrackModal()`)
  - measure → the Measure page (nav to `page-track`/measure)
  - profile → own profile edit
  (Exact entry-point function names resolved in the plan.)
- A collapse chevron toggles a one-line summary; collapsed state in `localStorage` (`wrotate_onboarding_collapsed`).

Called from the existing feed-render path: inside `renderFeed()` and the `nav()` feed branch (same hook pattern as the shipped streak chip), so it refreshes whenever the feed shows or a step is completed.

### Component 3 — first-wear "streak started" line

In `checkAndAwardBadges`, where `newlyEarned` is processed: if `newlyEarned` includes `BADGE_BY_REF[3]` (first_wear), surface a "🔥 Your streak starts now — day 1" message alongside the badge toast (a one-line addition to the existing toast/notify moment). No new infra.

### Component 4 — "Getting Started" capstone badge (`ref 6`)

- New `BADGE_REGISTRY` entry: `{ ref: 6, slug: 'getting_started', name: 'Getting Started', category: 'onboarding', flavor: "Collection, a wear, a measurement, a profile — you're all set.", unlock: 'Add a watch, log a wear, measure, and complete your profile.', glyph: <onboarding-style SVG>, isHidden: false }`. Ref 6 is free (1–5 used).
- Awarded in `checkAndAwardBadges` (any context): `if (!alreadyEarned(6) && [1,2,3,5].every(alreadyEarned)) awardBadge(6)`. Flows through the existing `awardBadge → newlyEarned → showBadgeToast + notifyBadgesEarned` path → toast + bell + batched push. This **is** the finale; no separate finale code or flag is needed (the card hides at 4/4; the badge is awarded once, idempotent via `_earnedBadges`).

### Data flow / edge cases

- The card recomputes on every feed render (and the badge-award passes mark steps done as they happen), so completing a step updates it live.
- Already-activated/old users: if `{1,3,2,5}` already earned, the card never shows; the capstone is back-awarded on the next `retroactiveBadgeScan`/award pass (one batched push) — a pleasant retro reward, consistent with the streak-badge rollout.
- Logged-out / no user → no card.
- `first_post` (4) is unrelated to the checklist and capstone.

## Testing

- **vitest** against `wrotate_test.js`: `onboardingChecklistState` — 0/1/2/3/4 done, correct `complete` flag, step order/refs, accepts Set and array.
- **badges.test.js**: `getting_started` (ref 6) present with required fields; registry count updated (30 → 31); onboarding category count updated.
- **mirror-drift**: register `onboardingChecklistState`.
- **SW cache bump** for the `index.html` change.
- No automated E2E (thin render; logic unit-tested). Manual UAT: a test account with <4 onboarding badges shows the card with correct ✓s and tappable CTAs; completing the 4th hides the card and earns `getting_started`; first wear shows the streak line.

## Files touched

| File | Change |
|---|---|
| `wrotate_test.js` | `onboardingChecklistState` (exported) |
| `index.html` | `onboardingChecklistState` (mirror); `renderOnboardingChecklist()`; `#onboarding-checklist` container in `#page-feed`; hooks in `renderFeed()` + `nav()`; first-wear "streak started" line in the award pass; `getting_started` (ref 6) registry entry + capstone award in `checkAndAwardBadges`; CSS; SW bump in `sw.js` |
| `sw.js` | Cache version bump |
| `tests/streak.test.js` or new `tests/onboarding.test.js` | `onboardingChecklistState` unit tests |
| `tests/badges.test.js` | `getting_started` fixture + counts |
| `tests/mirror-drift.test.js` | Register `onboardingChecklistState` |

## Follow-ups (out of scope)

- Roadmap **#1** (2-tap daily wear-log + multi-channel reminder) — next.
- Roadmap **#2** (post=log) — verified already bidirectional; at most a small UX nudge.
