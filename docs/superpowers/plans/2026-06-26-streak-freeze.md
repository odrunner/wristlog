# Streak Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An isolated missed day is auto-covered by a streak freeze (computed purely from logs), surfaced on the calendar (❄️ days + freeze count) and via a one-time toast. Behind the `streak_freeze` flag.

**Architecture:** A pure `computeStreaksFrozen(logs, today)` (mirror-drift VERBATIM, unit-tested) derives the freeze-aware streak + the frozen dates + freezes available from logs alone. A thin `displayStreak(logs, today)` flag-seam swaps it in for the naive streak in the chip, calendar, and profile. Milestone badges are untouched (real logged days only). Client-only — no DB.

**Tech Stack:** Vanilla JS (single-file index.html), vitest, mirror-drift guard.

**Spec:** `docs/superpowers/specs/2026-06-26-streak-freeze-design.md`

## Global Constraints

- Gated by `streak_freeze` (default off). `displayStreak` returns the naive streak + `frozen:[]`,`freezes:0` when off → zero behaviour change until shipped.
- **Badges unchanged:** do NOT touch the streak-badge computation in `checkAndAwardBadges` (it stays on real logged days).
- `computeStreaksFrozen` must be **byte-identical** in `index.html` + `wrotate_test.js` and registered in `VERBATIM` (`tests/mirror-drift.test.js:41`). It uses `addDaysStr` (already mirrored) — no other date math.
- Model: every run starts with 2 freezes; an isolated 1-day gap costs a freeze; 2+ consecutive misses break; +1 freeze per 7 logged days (cap 2). `npm test` green. SW bump. Pre-commit bumps `APP_VERSION` — expected.

---

### Task 1: `computeStreaksFrozen` pure helper + tests + mirror registration

**Files:**
- Modify: `wrotate_test.js` (add exported `computeStreaksFrozen` after `computeStreaks`)
- Modify: `index.html` (byte-identical `computeStreaksFrozen` after `computeStreaks`)
- Create: `tests/streak-freeze.test.js`
- Modify: `tests/mirror-drift.test.js:41` (add `'computeStreaksFrozen'`)

**Interfaces:**
- Produces: `computeStreaksFrozen(logs, today) → { current, best, status, frozen: string[], freezes: number }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/streak-freeze.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { computeStreaksFrozen } from '../wrotate_test.js';

const L = (...ds) => ds.map(date => ({ date }));

describe('computeStreaksFrozen', () => {
  it('no logs → 0, freezes 2', () => {
    expect(computeStreaksFrozen([], '2026-06-25')).toEqual({ current: 0, best: 0, status: 'none', frozen: [], freezes: 2 });
  });
  it('consecutive run logged today → active, no frozen', () => {
    const r = computeStreaksFrozen(L('2026-06-23', '2026-06-24', '2026-06-25'), '2026-06-25');
    expect(r.current).toBe(3); expect(r.status).toBe('active'); expect(r.frozen).toEqual([]); expect(r.freezes).toBe(2);
  });
  it('single isolated gap is healed', () => {
    const r = computeStreaksFrozen(L('2026-06-23', '2026-06-25'), '2026-06-25'); // missed 24
    expect(r.frozen).toEqual(['2026-06-24']); expect(r.current).toBe(3); expect(r.status).toBe('active'); expect(r.freezes).toBe(1);
  });
  it('two isolated gaps healed with 2 freezes', () => {
    const r = computeStreaksFrozen(L('2026-06-20', '2026-06-22', '2026-06-24', '2026-06-25'), '2026-06-25'); // missed 21, 23
    expect(r.frozen).toEqual(['2026-06-21', '2026-06-23']); expect(r.current).toBe(6); expect(r.freezes).toBe(0);
  });
  it('third isolated gap with no freezes left → break', () => {
    const r = computeStreaksFrozen(L('2026-06-20', '2026-06-22', '2026-06-24', '2026-06-26'), '2026-06-26'); // gaps 21,23,25
    expect(r.frozen).toEqual(['2026-06-21', '2026-06-23']); expect(r.current).toBe(1); expect(r.status).toBe('active'); expect(r.best).toBe(5);
  });
  it('two consecutive misses break the streak', () => {
    const r = computeStreaksFrozen(L('2026-06-20', '2026-06-23'), '2026-06-23'); // missed 21,22
    expect(r.frozen).toEqual([]); expect(r.current).toBe(1); expect(r.status).toBe('active'); expect(r.best).toBe(1);
  });
  it('leading-edge miss (last log today-2) frozen → at_risk', () => {
    const r = computeStreaksFrozen(L('2026-06-22', '2026-06-23'), '2026-06-25'); // missed 24, today 25 unlogged
    expect(r.frozen).toEqual(['2026-06-24']); expect(r.current).toBe(3); expect(r.status).toBe('at_risk');
  });
  it('last log today-3 → broken (none)', () => {
    const r = computeStreaksFrozen(L('2026-06-22'), '2026-06-25');
    expect(r.current).toBe(0); expect(r.status).toBe('none');
  });
  it('regen: a freeze returns after 7 logged days, healing a later gap', () => {
    // Mar: 01,03,05 burn both freezes (gaps 02,04). 06-12 = 7 more logged days → +1 freeze. gap 13 heals.
    const r = computeStreaksFrozen(
      L('2026-03-01','2026-03-03','2026-03-05','2026-03-06','2026-03-07','2026-03-08','2026-03-09','2026-03-10','2026-03-11','2026-03-12','2026-03-14'),
      '2026-03-14');
    expect(r.frozen).toEqual(['2026-03-02','2026-03-04','2026-03-13']); expect(r.status).toBe('active');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- streak-freeze`
Expected: FAIL — `computeStreaksFrozen` not exported.

- [ ] **Step 3: Implement in `wrotate_test.js`**

Insert after the `computeStreaks` function:

```js
export function computeStreaksFrozen(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none', frozen: [], freezes: 2 };
  const frozen = [];
  let best = 0, runLen = 0, loggedInRun = 0, freezesAvail = 2, lastPresent = null;
  for (const d of dates) {
    if (lastPresent === null) {
      runLen = 1; loggedInRun = 1; freezesAvail = 2;
    } else if (addDaysStr(lastPresent, 1) === d) {
      runLen += 1; loggedInRun += 1;
      if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
    } else if (addDaysStr(lastPresent, 2) === d && freezesAvail > 0) {
      frozen.push(addDaysStr(lastPresent, 1));
      freezesAvail -= 1; runLen += 2; loggedInRun += 1;
      if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
    } else {
      best = Math.max(best, runLen);
      runLen = 1; loggedInRun = 1; freezesAvail = 2;
    }
    lastPresent = d;
    best = Math.max(best, runLen);
  }
  let current, status;
  if (lastPresent === today) { current = runLen; status = 'active'; }
  else if (lastPresent === addDaysStr(today, -1)) { current = runLen; status = 'at_risk'; }
  else if (lastPresent === addDaysStr(today, -2) && freezesAvail > 0) {
    frozen.push(addDaysStr(today, -1));
    freezesAvail -= 1; runLen += 1; current = runLen; status = 'at_risk';
  } else { current = 0; status = 'none'; }
  best = Math.max(best, runLen);
  return { current, best, status, frozen, freezes: status === 'none' ? 2 : freezesAvail };
}
```

- [ ] **Step 4: Mirror it in `index.html`**

Find `computeStreaksFrozen`'s sibling `computeStreaks` in index.html (and the already-present `streakChipState`/`streakCalendarGrid` after it). Insert the SAME function **byte-identical** but bare `function` (no `export`) immediately after `computeStreaks`'s closing `}` (before `streakChipState`):

```js
function computeStreaksFrozen(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none', frozen: [], freezes: 2 };
  const frozen = [];
  let best = 0, runLen = 0, loggedInRun = 0, freezesAvail = 2, lastPresent = null;
  for (const d of dates) {
    if (lastPresent === null) {
      runLen = 1; loggedInRun = 1; freezesAvail = 2;
    } else if (addDaysStr(lastPresent, 1) === d) {
      runLen += 1; loggedInRun += 1;
      if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
    } else if (addDaysStr(lastPresent, 2) === d && freezesAvail > 0) {
      frozen.push(addDaysStr(lastPresent, 1));
      freezesAvail -= 1; runLen += 2; loggedInRun += 1;
      if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
    } else {
      best = Math.max(best, runLen);
      runLen = 1; loggedInRun = 1; freezesAvail = 2;
    }
    lastPresent = d;
    best = Math.max(best, runLen);
  }
  let current, status;
  if (lastPresent === today) { current = runLen; status = 'active'; }
  else if (lastPresent === addDaysStr(today, -1)) { current = runLen; status = 'at_risk'; }
  else if (lastPresent === addDaysStr(today, -2) && freezesAvail > 0) {
    frozen.push(addDaysStr(today, -1));
    freezesAvail -= 1; runLen += 1; current = runLen; status = 'at_risk';
  } else { current = 0; status = 'none'; }
  best = Math.max(best, runLen);
  return { current, best, status, frozen, freezes: status === 'none' ? 2 : freezesAvail };
}
```

- [ ] **Step 5: Register in VERBATIM**

In `tests/mirror-drift.test.js:41`, append `'computeStreaksFrozen'`:
```js
  'addDaysStr', 'computeStreaks', 'streakChipState', 'streakCalendarGrid', 'computeStreaksFrozen',
```

- [ ] **Step 6: Run tests**

Run: `npm test -- streak-freeze mirror-drift`
Expected: PASS (9 freeze tests + mirror-drift green).

- [ ] **Step 7: Commit**

```bash
git add wrotate_test.js index.html tests/streak-freeze.test.js tests/mirror-drift.test.js
git commit -m "feat(streak): computeStreaksFrozen pure helper + tests + mirror registration"
```

---

### Task 2: `displayStreak` seam, flag, surfaces (chip/calendar/profile), ❄️, toast

**Files:**
- Modify: `index.html` — `streak_freeze` flag (~`FEATURE_FLAGS`); `displayStreak` (after `computeStreaksFrozen`); `updateStreakChip`, `renderStreakCalendar`, `badgeWallProfileSection` → `displayStreak`; `.streak-cal-cell.frozen` CSS; freeze toast on boot; SW bump
- Modify: `sw.js`

**Interfaces:**
- Consumes: `computeStreaksFrozen`, `computeStreaks`, `featureFlag`, `streakChipState`, `streakCalendarGrid`, `todayStr`, `addDaysStr`, `logs`, `toast`.

- [ ] **Step 1: Add the flag**

In `FEATURE_FLAGS`, add (after the last entry, before `};`):
```js
  streak_freeze: { label: 'Streak: freeze (admin)', default: false },
```

- [ ] **Step 2: Add `displayStreak`**

Immediately after `computeStreaksFrozen` in index.html:
```js
function displayStreak(logs, today) {
  if (featureFlag('streak_freeze')) return computeStreaksFrozen(logs, today);
  const s = computeStreaks(logs, today);
  return { current: s.current, best: s.best, status: s.status, frozen: [], freezes: 0 };
}
```

- [ ] **Step 3: Chip → `displayStreak`**

In `updateStreakChip`, change the `streakChipState(computeStreaks(logs, todayStr()), true)` line to:
```js
  const st = streakChipState(displayStreak(logs, todayStr()), true);
```

- [ ] **Step 4: Profile streak line → `displayStreak`**

In `badgeWallProfileSection`, change its `const sk = computeStreaks(logs, todayStr());` to:
```js
  const sk = displayStreak(logs, todayStr());
```

- [ ] **Step 5: Calendar → `displayStreak` + ❄️ frozen cells + freeze line**

In `renderStreakCalendar`:
(a) change `const sk = computeStreaks(logs, t);` to `const sk = displayStreak(logs, t);` and add `const frozenSet = new Set(sk.frozen);` and `const freezeOn = featureFlag('streak_freeze');`.
(b) In the cell `.map`, replace the cell builder so frozen days render distinctly:
```js
      cells.map(c => {
        if (!c) return `<div class="streak-cal-cell streak-cal-blank"></div>`;
        const isFrozen = !c.logged && frozenSet.has(c.date);
        const cls = 'streak-cal-cell' + (c.logged ? ' logged' : (isFrozen ? ' frozen' : '')) + (c.isToday ? ' today' : '') + (c.isFuture ? ' future' : '');
        return `<div class="${cls}"${isFrozen ? ' title="A streak freeze covered this day"' : ''}>${c.day}</div>`;
      }).join('') +
```
(c) After the `streak-cal-head` div, add a freeze-count line when the flag is on. Change the head line build to also include:
```js
    (freezeOn ? `<div class="streak-cal-freezes">❄️ ${sk.freezes} freeze${sk.freezes === 1 ? '' : 's'}</div>` : '') +
```
Insert that string immediately after the `` `<div class="streak-cal-head">${head}</div>` `` term in the `body.innerHTML = ...` concatenation.

- [ ] **Step 6: Add `.frozen` CSS**

Near the other `.streak-cal-cell` rules:
```css
    .streak-cal-cell.frozen { background:#cfe8f5; color:#0c4a6e; font-weight:700; }
    .streak-cal-freezes { text-align:center; font-size:.78rem; color:var(--muted); margin:-.5rem 0 .7rem; }
```

- [ ] **Step 7: Freeze-saved toast on boot**

Add the function (near `updateStreakChip`):
```js
function maybeFreezeToast() {
  if (!featureFlag('streak_freeze')) return;
  const t = todayStr();
  const sk = computeStreaksFrozen(logs, t);
  const recent = [addDaysStr(t, -1), addDaysStr(t, -2)];
  const hit = sk.frozen.find(d => recent.includes(d));
  if (!hit) return;
  const key = 'wrotate_freeze_toast_' + hit;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  toast(`❄️ A freeze saved your ${sk.current}-day streak — log today to keep it going`);
}
```
Call `maybeFreezeToast();` once on boot — right after the boot `updateStreakChip();` call (the one in the init/load path, ~the `loadUserData`/post-auth render).

- [ ] **Step 8: Bump SW cache**

`grep -n "wristlog-v" sw.js`, increment by one.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS (all tests; badges unchanged).

- [ ] **Step 10: Commit**

```bash
git add index.html sw.js
git commit -m "feat(streak): freeze surfaces (displayStreak seam, calendar ❄️, freeze toast) behind streak_freeze"
```

## Self-Review

**Spec coverage:** pure freeze computation + 9 cases (Task 1) ✅; flag (Task 2 S1) ✅; `displayStreak` seam (S2) ✅; chip/profile/calendar use it (S3–S5) ✅; calendar ❄️ + freeze count (S5–S6) ✅; freeze toast (S7) ✅; badges untouched (Global Constraints; no edit to `checkAndAwardBadges`) ✅; mirror + unit tests (Task 1) ✅; SW bump (S8) ✅. Default-off via flag. ✅

**Placeholder scan:** all code shown in full; insertion points named with search hints. ✅

**Type/name consistency:** `computeStreaksFrozen` returns `{current,best,status,frozen,freezes}`; `displayStreak` returns the same shape (naive path fills `frozen:[]`,`freezes:0`); consumed by `streakChipState` (expects `{current,best,status}` — extra keys ignored) and `renderStreakCalendar` (uses `.frozen`,`.freezes`). `streak_freeze` flag name consistent across `FEATURE_FLAGS`/`displayStreak`/`renderStreakCalendar`/`maybeFreezeToast`. `.streak-cal-cell.frozen` / `.streak-cal-freezes` consistent between CSS and render. ✅
