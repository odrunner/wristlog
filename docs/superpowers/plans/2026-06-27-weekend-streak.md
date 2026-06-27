# Earn-Your-Weekend Streak (4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** A fully-logged Mon–Fri earns that weekend as transparent "rest days" that don't break the streak. Behind `streak_weekend` flag.

**Architecture:** Generalize `computeStreaksFrozen` with a `weekendEarn` arg + a precomputed `restSet`; "consecutive" = no non-rest day missing; the existing single-day freeze bridges one non-rest day. Empty `restSet` (flag off) ⇒ identical to current. `displayStreak` passes the flag; the calendar renders `restDays`.

**Spec:** `docs/superpowers/specs/2026-06-27-weekend-streak-design.md`

## Global Constraints
- `computeStreaksFrozen` is VERBATIM mirror (index.html + wrotate_test.js, byte-identical; already in `tests/mirror-drift.test.js:41`).
- Return shape gains `restDays` → **update the existing exact-match assertions** in `tests/streak-freeze.test.js` to include `restDays: []`.
- Flag `streak_weekend` (default off). `npm test` green (existing freeze tests must still pass = backward-compat proof). SW bump.

---

### Task 1: Rewrite `computeStreaksFrozen` (weekendEarn + restDays) + tests

**Files:** `wrotate_test.js`, `index.html` (byte-identical), `tests/streak-freeze.test.js` (add `restDays: []`), `tests/weekend-streak.test.js` (new)

- [ ] **Step 1: Update existing freeze tests for the new return key.** In `tests/streak-freeze.test.js`, every `.toEqual({ current, best, status, frozen, freezes })` assertion gains `, restDays: [] ` (the 2-arg call leaves `restSet` empty). Partial assertions (`.frozen`, `.current`, …) are unchanged. Run `npm test -- streak-freeze` → expect FAIL until Step 2 (function lacks restDays).

- [ ] **Step 2: Write new failing tests** — `tests/weekend-streak.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { computeStreaksFrozen } from '../wrotate_test.js';
const L = (...ds) => ds.map(date => ({ date }));

describe('computeStreaksFrozen — weekendEarn', () => {
  // Week Mon 2026-06-15 .. Fri 06-19 fully logged → Sat 20 / Sun 21 are rest.
  it('full week earns the weekend; run spans it', () => {
    const r = computeStreaksFrozen(L('2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-22'), '2026-06-22', true);
    expect(r.current).toBe(6);            // 5 weekdays + Mon 22 (weekend transparent)
    expect(r.status).toBe('active');
    expect(r.restDays.sort()).toEqual(['2026-06-20','2026-06-21']);
  });
  it('today is an earned rest weekend → active (resting)', () => {
    const r = computeStreaksFrozen(L('2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19'), '2026-06-20', true); // Sat
    expect(r.status).toBe('active'); expect(r.current).toBe(5);
  });
  it('Monday after earned weekend, unlogged → at_risk', () => {
    const r = computeStreaksFrozen(L('2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19'), '2026-06-22', true); // Mon
    expect(r.status).toBe('at_risk'); expect(r.current).toBe(5);
  });
  it('incomplete week (missed Fri) does NOT earn the weekend → breaks', () => {
    // 06-12 Fri missing; weekend 13/14 not earned. Logged 06-11(Thu) then 06-15(Mon) → 3 non-rest gap → break.
    const r = computeStreaksFrozen(L('2026-06-10','2026-06-11','2026-06-15','2026-06-16'), '2026-06-16', true);
    expect(r.current).toBe(2);            // run = 06-15,16 only
    expect(r.restDays).toEqual([]);
  });
  it('logged weekend counts as a normal day (never a rest day)', () => {
    const r = computeStreaksFrozen(L('2026-06-19','2026-06-20','2026-06-21'), '2026-06-21', true); // Fri,Sat,Sun all logged
    expect(r.current).toBe(3); expect(r.restDays).toEqual([]);
  });
  it('flag off (2-arg) is unchanged: single gap frozen, no restDays beyond []', () => {
    const r = computeStreaksFrozen(L('2026-06-23','2026-06-25'), '2026-06-25'); // missed 24 (Wed)
    expect(r.frozen).toEqual(['2026-06-24']); expect(r.current).toBe(3); expect(r.restDays).toEqual([]);
  });
});
```

Run `npm test -- weekend-streak` → FAIL (function is 2-arg, no restDays).

- [ ] **Step 3: Replace `computeStreaksFrozen` in `wrotate_test.js`** (keep `export`):

```js
export function computeStreaksFrozen(logs, today, weekendEarn) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { current: 0, best: 0, status: 'none', frozen: [], freezes: 2, restDays: [] };
  const loggedSet = new Set(dates);
  const dow = (s) => new Date(s + 'T12:00:00').getDay();
  const restSet = new Set();
  if (weekendEarn) {
    for (const ds of dates) {
      if (dow(ds) !== 5) continue;
      if (loggedSet.has(addDaysStr(ds, -4)) && loggedSet.has(addDaysStr(ds, -3)) && loggedSet.has(addDaysStr(ds, -2)) && loggedSet.has(addDaysStr(ds, -1))) {
        const sat = addDaysStr(ds, 1), sun = addDaysStr(ds, 2);
        if (!loggedSet.has(sat)) restSet.add(sat);
        if (!loggedSet.has(sun)) restSet.add(sun);
      }
    }
  }
  const nonRest = (a, b) => {
    let n = 0, x = addDaysStr(a, 1);
    while (x < b) { if (!restSet.has(x)) { n += 1; if (n > 1) break; } x = addDaysStr(x, 1); }
    return n;
  };
  const firstNonRest = (a, b) => {
    let x = addDaysStr(a, 1);
    while (x < b) { if (!restSet.has(x)) return x; x = addDaysStr(x, 1); }
    return null;
  };
  const frozen = [];
  let best = 0, runLen = 0, loggedInRun = 0, freezesAvail = 2, lastPresent = null;
  for (const d of dates) {
    if (lastPresent === null) {
      runLen = 1; loggedInRun = 1; freezesAvail = 2;
    } else {
      const nr = nonRest(lastPresent, d);
      if (nr === 0) {
        runLen += 1; loggedInRun += 1;
        if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
      } else if (nr === 1 && freezesAvail > 0) {
        frozen.push(firstNonRest(lastPresent, d));
        freezesAvail -= 1; runLen += 2; loggedInRun += 1;
        if (loggedInRun % 7 === 0 && freezesAvail < 2) freezesAvail += 1;
      } else {
        best = Math.max(best, runLen);
        runLen = 1; loggedInRun = 1; freezesAvail = 2;
      }
    }
    lastPresent = d;
    best = Math.max(best, runLen);
  }
  let current, status;
  if (lastPresent === today) { current = runLen; status = 'active'; }
  else if (restSet.has(today)) { current = runLen; status = 'active'; }
  else {
    const nr = nonRest(lastPresent, today);
    if (nr === 0) { current = runLen; status = 'at_risk'; }
    else if (nr === 1 && freezesAvail > 0) {
      frozen.push(firstNonRest(lastPresent, today));
      freezesAvail -= 1; runLen += 1; current = runLen; status = 'at_risk';
    } else { current = 0; status = 'none'; }
  }
  best = Math.max(best, runLen);
  return { current, best, status, frozen, freezes: status === 'none' ? 2 : freezesAvail, restDays: [...restSet] };
}
```

- [ ] **Step 4: Mirror in `index.html`** — replace the existing `function computeStreaksFrozen(logs, today) { … }` with the SAME body, bare `function` (no `export`).

- [ ] **Step 5: Run** `npm test -- streak-freeze weekend-streak mirror-drift` → all green (backward-compat + new behavior + byte-identical).

- [ ] **Step 6: Run** `npm test` → full suite green.

- [ ] **Step 7: Commit**
```bash
git add wrotate_test.js index.html tests/streak-freeze.test.js tests/weekend-streak.test.js
git commit -m "feat(streak): computeStreaksFrozen weekendEarn (earned rest days) + tests"
```

---

### Task 2: Flag, displayStreak, calendar rest rendering

**Files:** `index.html` (`FEATURE_FLAGS`; `displayStreak`; `renderStreakCalendar`; CSS), `sw.js`

- [ ] **Step 1: Flag** — add to `FEATURE_FLAGS`: `streak_weekend: { label: 'Streak: earn-your-weekend (admin)', default: false },`

- [ ] **Step 2: `displayStreak` passes the flag** — change `return computeStreaksFrozen(logs, today);` to:
```js
function displayStreak(logs, today) {
  return computeStreaksFrozen(logs, today, featureFlag('streak_weekend'));
}
```

- [ ] **Step 3: Calendar rest cells** — in `renderStreakCalendar`, after `const frozenSet = new Set(sk.frozen);` add `const restSet = new Set(sk.restDays || []);`. In the cell `.map`, extend the class logic so a non-logged, non-frozen day that is in `restSet` gets a `rest` class:
```js
        const isFrozen = !c.logged && frozenSet.has(c.date);
        const isRest = !c.logged && !isFrozen && restSet.has(c.date);
        const cls = 'streak-cal-cell' + (c.logged ? ' logged' : (isFrozen ? ' frozen' : (isRest ? ' rest' : ''))) + (c.isToday ? ' today' : '') + (c.isFuture ? ' future' : '');
        return `<div class="${cls}"${isFrozen ? ' title="A streak freeze covered this day"' : (isRest ? ' title="Rest day — earned by logging the full week"' : '')}>${c.day}</div>`;
```

- [ ] **Step 4: CSS** — near the other `.streak-cal-cell` rules:
```css
    .streak-cal-cell.rest { background:var(--surface2); color:var(--muted); position:relative; }
    .streak-cal-cell.rest::after { content:''; position:absolute; bottom:5px; left:50%; transform:translateX(-50%); width:4px; height:4px; border-radius:50%; background:var(--muted); opacity:.6; }
```

- [ ] **Step 5: SW bump** — increment `wristlog-vNN`.

- [ ] **Step 6:** `npm test` → green. Commit:
```bash
git add index.html sw.js
git commit -m "feat(streak): streak_weekend flag + displayStreak + calendar rest cells"
```

---

## Gated removal (after founder UAT)
Remove the `streak_weekend` flag (FEATURE_FLAGS entry) and hardcode `displayStreak` to `computeStreaksFrozen(logs, today, true)` to ship to all.

## Self-Review
- Spec coverage: weekendEarn + restSet + restDays (T1) ✅; flag + displayStreak + calendar rest (T2) ✅; backward-compat via empty restSet + existing tests (T1 S1/S5) ✅; mirror VERBATIM (already registered) ✅; SW bump ✅.
- Counting parity with current freeze: consecutive `+1`, loop-freeze `+2`, leading-edge-freeze `+1` — preserved. ✅
- Type consistency: return adds `restDays: string[]`; consumed by `renderStreakCalendar`; existing exact-match tests updated. `displayStreak` 3-arg call; flag name `streak_weekend` consistent. ✅
