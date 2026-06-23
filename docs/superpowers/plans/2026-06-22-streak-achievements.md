# Streak Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a consecutive-streak header (current + best) in the profile's Achievements section, and add milestone streak badges (5/10/20/30/50/100/365) that reuse the shipped badge bell+push.

**Architecture:** Pure client-side. A unit-tested `computeStreaks(logs, today)` → `{current, best, status}` (mirrored production/test) drives a header rendered inside the existing `badgeWallProfileSection()`. Six new `BADGE_REGISTRY` entries + a data-driven extension of the existing habit streak-award block turn streak milestones into badges that self-notify through the already-shipped `badge_earned` path. No backend/schema/edge-function change.

**Tech Stack:** Vanilla JS (`index.html` + `wrotate_test.js` mirror), vitest, `tests/mirror-drift.test.js`, `tests/badges.test.js`.

**Spec:** `docs/superpowers/specs/2026-06-22-streak-achievements-design.md`

## Global Constraints

- **Streak semantics:** `current` = consecutive distinct log-dates ending at the latest date, only if that date is today or yesterday (else 0); `best` = longest consecutive run ever; `status` ∈ `'none'|'active'|'at_risk'` (`active` = latest is today, `at_risk` = latest is yesterday). Any log day counts (all `use_case`s). Local `'YYYY-MM-DD'` dates only.
- **Copy:** none-state header = exactly `Start a streak` (no verb — activity isn't only logging). At-risk cue = `keep it going`. Append `· best {N}` only when it adds info (`best > current`, or `best ≥ 2` in the none state). Emoji 🔥.
- **Surface:** the streak header goes inside `badgeWallProfileSection()` (own-profile only) — NOT the feed/homepage.
- **Milestones:** badges at **5, 10, 20, 30, 50, 100, 365** consecutive days, keyed off the **max** streak. Existing 7 (ref 80) and 30 (ref 81) are kept; new refs **83=5, 84=10, 85=20, 86=50, 87=100, 88=365**. Earning flows through the existing `awardBadge`→`newlyEarned`→`notifyBadgesEarned` (bell + batched push) — add NO notification code.
- **Mirror-drift:** `computeStreaks` + `addDaysStr` are defined in BOTH files, byte-identical, registered `VERBATIM` in `tests/mirror-drift.test.js`. The render code is production-only.
- **Bump the SW cache** (`sw.js` `wristlog-vNN` → next).
- `npm test` must stay green. A pre-commit hook auto-bumps `APP_VERSION` in `index.html` — expected; leave it.
- No backend/DB/edge-function work.

---

### Task 1: Pure streak logic (`computeStreaks` + `addDaysStr`) in the test mirror

**Files:**
- Modify: `wrotate_test.js` (add both exports near the date helpers, ~line 22)
- Create: `tests/streak.test.js`

**Interfaces:**
- Produces: `addDaysStr(dateStr, delta): string`; `computeStreaks(logs, today): {current:number, best:number, status:'none'|'active'|'at_risk'}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/streak.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { addDaysStr, computeStreaks } from '../wrotate_test.js';

describe('addDaysStr', () => {
  it('subtracts a day', () => expect(addDaysStr('2026-06-22', -1)).toBe('2026-06-21'));
  it('adds a day', () => expect(addDaysStr('2026-06-22', 1)).toBe('2026-06-23'));
  it('crosses a month boundary backward', () => expect(addDaysStr('2026-06-01', -1)).toBe('2026-05-31'));
  it('crosses a year boundary backward', () => expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31'));
});

describe('computeStreaks', () => {
  const L = (...dates) => dates.map(d => ({ date: d }));

  it('active run ending today: current=best=3', () => {
    expect(computeStreaks(L('2026-06-20','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ current: 3, best: 3, status: 'active' });
  });

  it('last log yesterday → at_risk, current still counts', () => {
    expect(computeStreaks(L('2026-06-20','2026-06-21'), '2026-06-22'))
      .toEqual({ current: 2, best: 2, status: 'at_risk' });
  });

  it('broken current but best preserved from an older run', () => {
    expect(computeStreaks(L('2026-06-01','2026-06-02','2026-06-03','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ current: 2, best: 3, status: 'active' });
  });

  it('a full missed day resets current to 0, best kept', () => {
    expect(computeStreaks(L('2026-06-18','2026-06-19','2026-06-20'), '2026-06-22'))
      .toEqual({ current: 0, best: 3, status: 'none' });
  });

  it('single log today', () => {
    expect(computeStreaks(L('2026-06-22'), '2026-06-22'))
      .toEqual({ current: 1, best: 1, status: 'active' });
  });

  it('empty logs', () => {
    expect(computeStreaks([], '2026-06-22')).toEqual({ current: 0, best: 0, status: 'none' });
  });

  it('multiple logs same day count once', () => {
    expect(computeStreaks(L('2026-06-21','2026-06-22','2026-06-22'), '2026-06-22'))
      .toEqual({ current: 2, best: 2, status: 'active' });
  });

  it('best reflects a long past run while current is short', () => {
    const dates = ['2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05','2026-06-22'];
    expect(computeStreaks(dates.map(d => ({ date: d })), '2026-06-22'))
      .toEqual({ current: 1, best: 5, status: 'active' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- streak`
Expected: FAIL — `addDaysStr`/`computeStreaks` not exported.

- [ ] **Step 3: Implement in `wrotate_test.js`**

Add near the other date helpers (~after `fmtMonYear`, line 22):

```js
export function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00'); // noon-anchored to avoid DST/midnight drift
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeStreaks(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none' };
  const present = new Set(dates);
  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (addDaysStr(dates[i - 1], 1) === dates[i]) { run++; best = Math.max(best, run); }
    else run = 1;
  }
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  if (latest !== today && latest !== yesterday) return { current: 0, best, status: 'none' };
  let current = 1, cursor = latest;
  while (present.has(addDaysStr(cursor, -1))) { current++; cursor = addDaysStr(cursor, -1); }
  return { current, best, status: latest === today ? 'active' : 'at_risk' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- streak`
Expected: PASS (12 cases).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (1150 + new). `mirror-drift` still green (functions only in `wrotate_test.js` so far).

- [ ] **Step 6: Commit**

```bash
git add wrotate_test.js tests/streak.test.js
git commit -m "feat(streak): computeStreaks (current+best) + addDaysStr with unit tests"
```

---

### Task 2: Production mirror of the streak logic

**Files:**
- Modify: `index.html` (add identical `addDaysStr` + `computeStreaks`, no `export`, just before `async function checkAndAwardBadges` ~line 5218)
- Modify: `tests/mirror-drift.test.js` (register both in `VERBATIM`)

**Interfaces:**
- Consumes: Task 1 bodies (byte-identical).
- Produces: `computeStreaks`/`addDaysStr` in `index.html` (used by Tasks 3-display and 4).

- [ ] **Step 1: Add the identical functions to `index.html`**

Insert just before `async function checkAndAwardBadges(` (~`index.html:5218`):

```js
function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00'); // noon-anchored to avoid DST/midnight drift
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeStreaks(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none' };
  const present = new Set(dates);
  let best = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (addDaysStr(dates[i - 1], 1) === dates[i]) { run++; best = Math.max(best, run); }
    else run = 1;
  }
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  if (latest !== today && latest !== yesterday) return { current: 0, best, status: 'none' };
  let current = 1, cursor = latest;
  while (present.has(addDaysStr(cursor, -1))) { current++; cursor = addDaysStr(cursor, -1); }
  return { current, best, status: latest === today ? 'active' : 'at_risk' };
}
```

- [ ] **Step 2: Register both in mirror-drift `VERBATIM`**

In `tests/mirror-drift.test.js`, add `'addDaysStr'` and `'computeStreaks'` to the `const VERBATIM = [ ... ]` array.

- [ ] **Step 3: Run mirror-drift + streak tests**

Run: `npm test -- mirror-drift streak`
Expected: PASS — mirror-drift confirms byte-identity.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/mirror-drift.test.js
git commit -m "feat(streak): production mirror of computeStreaks (mirror-drift VERBATIM)"
```

---

### Task 3: Milestone streak badges (registry + award extension)

**Files:**
- Modify: `index.html` — 6 new `BADGE_REGISTRY` entries (after ref 81, ~`index.html:4980`); extend the habit streak-award block in `checkAndAwardBadges` (~`index.html:5353-5364`)
- Modify: `tests/badges.test.js` — add the 6 entries to the fixture (after ref 81/82) and update the total count

**Interfaces:**
- Consumes: existing `BADGE_REGISTRY`, `BADGE_BY_REF`, `awardBadge`, `alreadyEarned`, `newlyEarned`.
- Produces: badges 83-88 awarded off max streak; auto-notify via existing path.

- [ ] **Step 1: Update the badge-registry count test (RED)**

In `tests/badges.test.js`, change line 54 from `expect(BADGE_REGISTRY.length).toBe(24);` to `expect(BADGE_REGISTRY.length).toBe(30);`.

Run: `npm test -- badges`
Expected: FAIL — fixture still has 24 entries.

- [ ] **Step 2: Add the 6 entries to the test fixture (GREEN for the count)**

In `tests/badges.test.js`, in the main `BADGE_REGISTRY` fixture, immediately after the `ref: 81` line (`{ ref: 81, ... 'habit', isHidden: false },`), add:

```js
    { ref: 83, slug: 'five_day_streak', name: 'Five-Day Streak', category: 'habit', isHidden: false },
    { ref: 84, slug: 'ten_day_streak', name: 'Ten-Day Streak', category: 'habit', isHidden: false },
    { ref: 85, slug: 'twenty_day_streak', name: 'Twenty-Day Streak', category: 'habit', isHidden: false },
    { ref: 86, slug: 'fifty_day_streak', name: 'Fifty-Day Streak', category: 'habit', isHidden: false },
    { ref: 87, slug: 'hundred_day_streak', name: 'Hundred-Day Streak', category: 'habit', isHidden: false },
    { ref: 88, slug: 'year_streak', name: 'Year-Long Streak', category: 'habit', isHidden: false },
```

Run: `npm test -- badges`
Expected: PASS (length now 30; `.every`/category assertions unaffected).

- [ ] **Step 3: Add the 6 production registry entries**

In `index.html`, in `BADGE_REGISTRY`, immediately after the `ref: 81` (thirty_day_streak) entry block (it ends `...30</text>', isHidden: false },` ~line 4980), insert:

```js
  { ref: 83, slug: 'five_day_streak', name: 'Five-Day Streak', category: 'habit',
    flavor: 'Five days running. The habit takes hold.',
    unlock: 'Activity on 5 consecutive days.',
    glyph: '<text x="50" y="62" text-anchor="middle" fill="#3D2A14" font-size="40" font-family="Georgia,serif" font-style="italic">5</text>',
    isHidden: false },
  { ref: 84, slug: 'ten_day_streak', name: 'Ten-Day Streak', category: 'habit',
    flavor: 'Ten in a row. Momentum.',
    unlock: 'Activity on 10 consecutive days.',
    glyph: '<text x="50" y="62" text-anchor="middle" fill="#3D2A14" font-size="36" font-family="Georgia,serif" font-style="italic">10</text>',
    isHidden: false },
  { ref: 85, slug: 'twenty_day_streak', name: 'Twenty-Day Streak', category: 'habit',
    flavor: 'Twenty straight. Dedication shows.',
    unlock: 'Activity on 20 consecutive days.',
    glyph: '<text x="50" y="62" text-anchor="middle" fill="#3D2A14" font-size="36" font-family="Georgia,serif" font-style="italic">20</text>',
    isHidden: false },
  { ref: 86, slug: 'fifty_day_streak', name: 'Fifty-Day Streak', category: 'habit',
    flavor: 'Fifty days. Unbroken.',
    unlock: 'Activity on 50 consecutive days.',
    glyph: '<text x="50" y="62" text-anchor="middle" fill="#3D2A14" font-size="36" font-family="Georgia,serif" font-style="italic">50</text>',
    isHidden: false },
  { ref: 87, slug: 'hundred_day_streak', name: 'Hundred-Day Streak', category: 'habit',
    flavor: 'One hundred days. Remarkable.',
    unlock: 'Activity on 100 consecutive days.',
    glyph: '<text x="50" y="62" text-anchor="middle" fill="#3D2A14" font-size="30" font-family="Georgia,serif" font-style="italic">100</text>',
    isHidden: false },
  { ref: 88, slug: 'year_streak', name: 'Year-Long Streak', category: 'habit',
    flavor: 'A full year, every day. Legendary.',
    unlock: 'Activity on 365 consecutive days.',
    glyph: '<text x="50" y="62" text-anchor="middle" fill="#3D2A14" font-size="28" font-family="Georgia,serif" font-style="italic">365</text>',
    isHidden: false },
```

- [ ] **Step 4: Extend the award block (data-driven, preserves 80/81)**

In `checkAndAwardBadges`, replace the existing streak sub-block:

```js
    if (!alreadyEarned(80) || !alreadyEarned(81)) {
      let maxStreak = 1, curStreak = 1;
      for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diff = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diff === 1) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
        else if (diff > 1) curStreak = 1;
      }
      if (!alreadyEarned(80) && maxStreak >= 7) { if (await awardBadge(80)) newlyEarned.push(BADGE_BY_REF[80]); }
      if (!alreadyEarned(81) && maxStreak >= 30) { if (await awardBadge(81)) newlyEarned.push(BADGE_BY_REF[81]); }
    }
```

with:

```js
    const STREAK_BADGES = [[83,5],[80,7],[84,10],[85,20],[81,30],[86,50],[87,100],[88,365]];
    if (STREAK_BADGES.some(([ref]) => !alreadyEarned(ref))) {
      let maxStreak = 1, curStreak = 1;
      for (let i = 1; i < sortedDates.length; i++) {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diff = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diff === 1) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
        else if (diff > 1) curStreak = 1;
      }
      for (const [ref, days] of STREAK_BADGES) {
        if (!alreadyEarned(ref) && maxStreak >= days) { if (await awardBadge(ref)) newlyEarned.push(BADGE_BY_REF[ref]); }
      }
    }
```

(Same `maxStreak` computation and the same 7/30 thresholds as before — 80/81 behavior is preserved; the new refs are awarded at their thresholds, ascending so `newlyEarned` is ordered.)

- [ ] **Step 5: Run badges + full suite**

Run: `npm test`
Expected: PASS (1150 + streak + badges). Output pristine.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/badges.test.js
git commit -m "feat(streak): milestone streak badges 5/10/20/50/100/365 (reuse badge_earned)"
```

---

### Task 4: Streak header in the profile Achievements section

**Files:**
- Modify: `index.html` — `badgeWallProfileSection()` (header build + insertion ~`index.html:5457-5463`); CSS for the streak line; SW bump in `sw.js`
- Modify: `sw.js`

**Interfaces:**
- Consumes: `computeStreaks(logs, todayStr())`, existing `badgeWallProfileSection()` markup.
- Produces: the visible streak header.

- [ ] **Step 1: Build the header string**

In `badgeWallProfileSection()` (`index.html:5439`), after the `lockedPreview` block and before the `return \`` (i.e. ~line 5457), add:

```js
  const sk = computeStreaks(logs, todayStr());
  const streakHeader = sk.status === 'none'
    ? `<div class="streak-line">Start a streak${sk.best >= 2 ? ` <span class="streak-best">· best ${sk.best}</span>` : ''}</div>`
    : `<div class="streak-line${sk.status === 'at_risk' ? ' streak-at-risk' : ''}">`
      + `<span class="streak-flame${sk.status === 'at_risk' ? ' streak-flame-dim' : ''}">🔥</span> `
      + `<span class="streak-count">${sk.current}-day streak</span>`
      + (sk.status === 'at_risk' ? ` <span class="streak-cue">· keep it going</span>` : '')
      + (sk.best > sk.current ? ` <span class="streak-best">· best ${sk.best}</span>` : '')
      + `</div>`;
```

- [ ] **Step 2: Insert the header into the returned markup**

In the `return` template of `badgeWallProfileSection()`, insert `${streakHeader}` immediately after the closing `</div>` of the `profile-page-section-title` block and before the badge grid `<div style="display:flex;gap:.5rem;...`. Result:

```js
      <div class="profile-page-section-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>Achievements</span>
        <span style="font-size:.72rem;color:var(--muted);font-weight:400;">${earned.length} / ${visible.length}</span>
      </div>
      ${streakHeader}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;padding:.5rem 0;">
```

- [ ] **Step 3: Add CSS**

Add to the stylesheet in `index.html` (near profile/badge styles), using existing CSS variables:

```css
.streak-line { display: flex; align-items: center; gap: .25rem; font-size: .92rem; font-weight: 600;
  color: var(--text); padding: .35rem 0 .15rem; }
.streak-line .streak-count { font-variant-numeric: tabular-nums; }
.streak-flame { line-height: 1; }
.streak-flame-dim { opacity: .45; filter: grayscale(.6); }
.streak-cue, .streak-best { color: var(--muted); font-weight: 500; font-size: .82em; }
```

- [ ] **Step 4: Bump the SW cache version**

`grep -n "wristlog-v" sw.js`, then increment the number by one in `sw.js`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (mirror-drift, streak, badges all green).

- [ ] **Step 6: Manual UAT note (controller-run)**

No automated E2E (thin render; logic unit-tested). The controller will verify on the dev server: own profile → Achievements section shows `🔥 N-day streak · best M`; the founder's retroactive milestone badges (5/7/10/20/30) fire one batched push. State this in the report; do not block on it.

- [ ] **Step 7: Commit**

```bash
git add index.html sw.js
git commit -m "feat(streak): current+best streak header in profile Achievements"
```

---

## Self-Review

**Spec coverage:**
- `computeStreaks` (current/best/status, alive-through-yesterday, any-log-day, local dates) → Task 1. ✅
- Production mirror + VERBATIM → Task 2. ✅
- Milestone badges 5/10/20/30/50/100/365 keyed off max streak, reuse badge_earned → Task 3 (existing 7/30 preserved). ✅
- Achievements-section header (current + best, at-risk "keep it going", none "Start a streak", `· best M` only when informative) → Task 4. ✅
- Own-profile only (header lives in `badgeWallProfileSection`, already `isOwn`-gated) → Task 4. ✅
- No feed/homepage surface; no backend/schema/edge-function; no new notification code → respected across tasks. ✅
- SW bump + tests + mirror-drift → Tasks 2/3/4. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; E2E omission is explicit (Task 4 Step 6). ✅

**Type/name consistency:** `computeStreaks(logs, today) → {current,best,status}` and `addDaysStr(dateStr, delta)` identical in Tasks 1/2/4. Refs 83-88 consistent between Task 3 registry entries, fixture, and `STREAK_BADGES` thresholds (`[83,5],[80,7],[84,10],[85,20],[81,30],[86,50],[87,100],[88,365]`). `status` values `'none'|'active'|'at_risk'` consistent. CSS classes (`streak-line/flame/flame-dim/count/cue/best`) defined in Task 4 Step 3 and used in Step 1. ✅
