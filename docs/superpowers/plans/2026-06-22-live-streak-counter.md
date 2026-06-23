# Live Streak Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user their current activity streak as a live "🔥 N" counter on their own profile and at the top of the feed (the landing page).

**Architecture:** Pure client-side. One pure function (`computeCurrentStreak`) computes the streak from the already-loaded `logs` array (mirrored in `wrotate_test.js` for unit tests + `index.html` for production, kept identical by the mirror-drift guard). One production render helper (`renderStreakChip`) emits the chip HTML; `renderStreakChips()` updates the feed surface; the profile surface computes inline. No backend, schema, edge function, or badge change.

**Tech Stack:** Vanilla JS (`index.html` + `wrotate_test.js` test mirror), vitest (unit), `tests/mirror-drift.test.js` (production↔mirror guard).

**Spec:** `docs/superpowers/specs/2026-06-22-live-streak-counter-design.md`

## Global Constraints

- **Streak semantics:** consecutive distinct log dates ending at the most recent log; "alive" (shown as `N`) while the latest log date is **today or yesterday**; `count = 0` / `status 'none'` once a full day is missed.
- **Day counting:** every log entry counts (all `use_case`s — wear and measurement). This matches the existing streak **badges** — make **no** change to badge logic.
- **Dates are local:** both `logs[].date` and "today" are local `'YYYY-MM-DD'` strings (via `todayStr()`); never parse them as UTC.
- **States/copy:** hidden when `count < 1`; `active` (latest === today) → solid 🔥; `at_risk` (latest === yesterday) → dimmed flame + the literal cue **`keep it going`**. Profile label is **`Day streak`**. Emoji is 🔥.
- **Own-only:** profile stat renders only on the user's own profile; the feed chip only when a user is logged in and `count ≥ 1`.
- **Mirror-drift:** functions defined in BOTH `index.html` and `wrotate_test.js` must be byte-identical (after whitespace/comment stripping) and registered in the `VERBATIM` array of `tests/mirror-drift.test.js`. The DOM render helpers live only in `index.html` and need no registration.
- **Bump the SW cache** (`sw.js` `wristlog-vNN` → next) on the HTML/JS change.
- **Tests:** `npm test` (vitest) must stay green (currently 1150). A pre-commit hook auto-bumps `APP_VERSION` in `index.html` — expected; leave it.
- No backend, DB, edge function, or pg_cron work in this plan.

---

### Task 1: Pure streak logic in the test mirror

**Files:**
- Modify: `wrotate_test.js` (add `addDaysStr` and `computeCurrentStreak` exports, near the other date/stats helpers)
- Create: `tests/streak.test.js`

**Interfaces:**
- Produces:
  - `addDaysStr(dateStr: string, delta: number): string` — `'YYYY-MM-DD'` shifted by `delta` days (local, noon-anchored).
  - `computeCurrentStreak(logs: {date:string}[], today: string): { count: number, status: 'none'|'active'|'at_risk' }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/streak.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { addDaysStr, computeCurrentStreak } from '../wrotate_test.js';

describe('addDaysStr', () => {
  it('subtracts a day', () => expect(addDaysStr('2026-06-22', -1)).toBe('2026-06-21'));
  it('adds a day', () => expect(addDaysStr('2026-06-22', 1)).toBe('2026-06-23'));
  it('crosses a month boundary backward', () => expect(addDaysStr('2026-06-01', -1)).toBe('2026-05-31'));
  it('crosses a year boundary backward', () => expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31'));
});

describe('computeCurrentStreak', () => {
  const L = (...dates) => dates.map(d => ({ date: d }));

  it('counts a run ending today as active', () => {
    expect(computeCurrentStreak(L('2026-06-20','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ count: 3, status: 'active' });
  });

  it('last log yesterday is at_risk, still counted', () => {
    expect(computeCurrentStreak(L('2026-06-20','2026-06-21'), '2026-06-22'))
      .toEqual({ count: 2, status: 'at_risk' });
  });

  it('a full missed day breaks it', () => {
    expect(computeCurrentStreak(L('2026-06-19','2026-06-20'), '2026-06-22'))
      .toEqual({ count: 0, status: 'none' });
  });

  it('single log today is a 1-day active streak', () => {
    expect(computeCurrentStreak(L('2026-06-22'), '2026-06-22'))
      .toEqual({ count: 1, status: 'active' });
  });

  it('empty logs -> none', () => {
    expect(computeCurrentStreak([], '2026-06-22')).toEqual({ count: 0, status: 'none' });
  });

  it('multiple logs on the same day count once', () => {
    expect(computeCurrentStreak(L('2026-06-21','2026-06-22','2026-06-22'), '2026-06-22'))
      .toEqual({ count: 2, status: 'active' });
  });

  it('only counts the run ending at the latest date, ignoring older clusters', () => {
    expect(computeCurrentStreak(L('2026-06-01','2026-06-02','2026-06-21','2026-06-22'), '2026-06-22'))
      .toEqual({ count: 2, status: 'active' });
  });

  it('measurement-only days count (any log date)', () => {
    // computeCurrentStreak only reads .date; use_case is irrelevant by design
    expect(computeCurrentStreak([{date:'2026-06-21'},{date:'2026-06-22'}], '2026-06-22'))
      .toEqual({ count: 2, status: 'active' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- streak`
Expected: FAIL — `addDaysStr`/`computeCurrentStreak` are not exported.

- [ ] **Step 3: Implement the two functions in `wrotate_test.js`**

Add near the other date helpers (e.g. just after `todayStr`/`fmtDate`, ~line 22):

```js
export function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00'); // noon-anchored to avoid DST/midnight drift
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeCurrentStreak(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { count: 0, status: 'none' };
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  if (latest !== today && latest !== yesterday) return { count: 0, status: 'none' };
  const present = new Set(dates);
  let count = 1, cursor = latest;
  while (present.has(addDaysStr(cursor, -1))) { count++; cursor = addDaysStr(cursor, -1); }
  return { count, status: latest === today ? 'active' : 'at_risk' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- streak`
Expected: PASS (all 12 cases).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS (1150 + new tests). Note: `mirror-drift` still passes because the new functions exist only in `wrotate_test.js` so far (the guard only checks functions defined in BOTH files).

- [ ] **Step 6: Commit**

```bash
git add wrotate_test.js tests/streak.test.js
git commit -m "feat(streak): pure computeCurrentStreak + addDaysStr with unit tests"
```

---

### Task 2: Production mirror of the streak logic

**Files:**
- Modify: `index.html` (add `addDaysStr` + `computeCurrentStreak`, identical to the mirror, near the badge/streak code ~`index.html:5350`)
- Modify: `tests/mirror-drift.test.js` (register both in `VERBATIM`)

**Interfaces:**
- Consumes: the function bodies from Task 1 (must be byte-identical after whitespace/comment stripping).
- Produces: `computeCurrentStreak` / `addDaysStr` callable in `index.html`; consumed by Task 3.

- [ ] **Step 1: Add the identical functions to `index.html`**

Insert just before `async function checkAndAwardBadges` (~`index.html:5218`) so the streak helpers sit with the other streak logic. Use the **exact same body** as Task 1 (the mirror-drift guard strips whitespace/comments, but keep them textually identical to be safe):

```js
function addDaysStr(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00'); // noon-anchored to avoid DST/midnight drift
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeCurrentStreak(logs, today) {
  const dates = [...new Set((logs || []).map(l => l.date).filter(Boolean))].sort();
  if (dates.length === 0) return { count: 0, status: 'none' };
  const latest = dates[dates.length - 1];
  const yesterday = addDaysStr(today, -1);
  if (latest !== today && latest !== yesterday) return { count: 0, status: 'none' };
  const present = new Set(dates);
  let count = 1, cursor = latest;
  while (present.has(addDaysStr(cursor, -1))) { count++; cursor = addDaysStr(cursor, -1); }
  return { count, status: latest === today ? 'active' : 'at_risk' };
}
```

(The `index.html` copy omits the `export` keyword — that is expected and the guard handles it.)

- [ ] **Step 2: Register both functions in the mirror-drift `VERBATIM` array**

In `tests/mirror-drift.test.js`, add `'addDaysStr'` and `'computeCurrentStreak'` to the `VERBATIM` list (the array starting `const VERBATIM = [`).

- [ ] **Step 3: Run the mirror-drift + streak tests**

Run: `npm test -- mirror-drift streak`
Expected: PASS — mirror-drift confirms the two copies are byte-identical; streak unit tests still green.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (1150 + streak).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/mirror-drift.test.js
git commit -m "feat(streak): production mirror of computeCurrentStreak (mirror-drift VERBATIM)"
```

---

### Task 3: Render the counter on the feed + profile surfaces

**Files:**
- Modify: `index.html` — add `renderStreakChip` + `renderStreakChips`; `#feed-streak-chip` container after the feed header (`:2697`); the call inside `renderFeed` (`:9474`) and the `nav()` feed branch (`:13337`); the profile stats-row chip (`:6749`); CSS for the chip + at-risk styling
- Modify: `sw.js` (cache version bump)

**Interfaces:**
- Consumes: `computeCurrentStreak(logs, todayStr())`, `currentUser`, `logs`, `todayStr()`.
- Produces: visible streak chips on both surfaces.

- [ ] **Step 1: Add the render helpers**

Insert near the new streak logic in `index.html` (just after `computeCurrentStreak` from Task 2):

```js
// Build the streak chip markup for a surface. Returns '' when there is no active streak.
// variant: 'feed' (compact centered chip) | 'profile' (a profile-stat cell).
function renderStreakChip(streak, variant) {
  if (!streak || streak.count < 1) return '';
  const atRisk = streak.status === 'at_risk';
  const flame = atRisk ? `<span class="streak-flame streak-flame-dim">🔥</span>`
                       : `<span class="streak-flame">🔥</span>`;
  if (variant === 'profile') {
    const sub = atRisk ? `<span class="streak-cue">keep it going</span>` : 'Day streak';
    return `<div class="profile-stat streak-stat${atRisk ? ' streak-at-risk' : ''}">`
         + `<div class="profile-stat-value">${flame} ${streak.count}</div>`
         + `<div class="profile-stat-label">${sub}</div></div>`;
  }
  // feed variant
  const cue = atRisk ? ` <span class="streak-cue">· keep it going</span>` : '';
  return `<div class="streak-chip${atRisk ? ' streak-at-risk' : ''}">${flame} `
       + `<span class="streak-count">${streak.count}</span>${cue}</div>`;
}

// Update the feed's streak chip from the current logs. Cheap + idempotent.
function renderStreakChips() {
  const el = document.getElementById('feed-streak-chip');
  if (!el) return;
  if (!currentUser) { el.innerHTML = ''; return; }
  el.innerHTML = renderStreakChip(computeCurrentStreak(logs, todayStr()), 'feed');
}
```

- [ ] **Step 2: Add the feed container**

In `index.html` at the feed page, immediately after the feed `.page-header` closes (after `index.html:2697`, before `#ptr-indicator`), add:

```html
    <div id="feed-streak-chip" class="streak-chip-wrap"></div>
```

- [ ] **Step 3: Call `renderStreakChips()` where the feed renders**

(a) Inside `renderFeed()` (`index.html:9474`), add `renderStreakChips();` as the first line of the function body (so every feed render refreshes the chip).

(b) In `nav()` (`index.html:13337`), in the `if (page === 'feed') { ... }` block, add `renderStreakChips();` right after `loadFeed(); loadNotifications();` (guarantees a refresh on every feed visit even when `loadFeed()` is cached/short-circuits).

- [ ] **Step 4: Add the profile stats-row chip**

In `renderProfilePageHTML` where `statsHtml` is built (`index.html:6749`), compute the streak for the **own** profile and prepend the chip cell. Change:

```js
  const statsHtml = `
    <div class="profile-stats-row">
      <div class="profile-stat"><div class="profile-stat-value">${watchCount}</div><div class="profile-stat-label">${watchLabel}</div></div>
```

to:

```js
  const streakStat = isOwn ? renderStreakChip(computeCurrentStreak(logs, todayStr()), 'profile') : '';
  const statsHtml = `
    <div class="profile-stats-row">
      ${streakStat}
      <div class="profile-stat"><div class="profile-stat-value">${watchCount}</div><div class="profile-stat-label">${watchLabel}</div></div>
```

- [ ] **Step 5: Add CSS**

Add to the stylesheet in `index.html` (near other chip/profile styles). Use existing CSS variables (`--gold`, `--muted`, `--surface`, `--border`, `--text`):

```css
.streak-chip-wrap { display: flex; justify-content: center; margin: 0 auto .6rem; max-width: 470px; }
.streak-chip { display: inline-flex; align-items: center; gap: .3rem; font-size: .85rem; font-weight: 600;
  color: var(--text); background: var(--surface); border: 1px solid var(--border);
  border-radius: 999px; padding: .25rem .7rem; }
.streak-chip .streak-count { font-variant-numeric: tabular-nums; }
.streak-flame { line-height: 1; }
.streak-flame-dim { opacity: .45; filter: grayscale(.6); }
.streak-cue { color: var(--muted); font-weight: 500; font-size: .8em; }
.streak-stat .streak-flame { font-size: .9em; }
```

- [ ] **Step 6: Bump the SW cache version**

Run `grep -n "wristlog-v" sw.js`, then increment the version by one in `sw.js`.

- [ ] **Step 7: Run the full unit suite (regression)**

Run: `npm test`
Expected: PASS (1150 + streak; mirror-drift green).

- [ ] **Step 8: Manual UAT on the local dev server**

(No automated E2E: the streak logic is fully unit-tested and the render layer is a thin string helper; a meaningful E2E would require brittle today-relative log seeding. Verify visually instead.)

On http://192.168.1.246:3000 (or localhost:3000) as `testuser`:
- With a log today → feed shows a solid `🔥 N` chip; own profile shows the `🔥 N / Day streak` stat.
- Confirm the chip disappears when there is no active streak (count 0).
- (If practical) a state where the latest log is yesterday shows the dimmed flame + "· keep it going".

- [ ] **Step 9: Commit**

```bash
git add index.html sw.js
git commit -m "feat(streak): live 🔥 streak chip on feed + profile"
```

---

## Self-Review

**Spec coverage:**
- `computeCurrentStreak` semantics (alive-through-yesterday, any-log-day, local dates) → Task 1. ✅
- `addDaysStr` noon-anchored helper → Task 1. ✅
- Production mirror + VERBATIM registration → Task 2. ✅
- `renderStreakChip` states (none hidden / active solid / at_risk dimmed + "keep it going") → Task 3 Step 1/5. ✅
- Feed surface (`#feed-streak-chip` after feed header, refreshed on render + nav) → Task 3 Steps 2-3. ✅
- Profile surface (own-only stats-row chip, "Day streak") → Task 3 Step 4. ✅
- Hidden at `count < 1` (both surfaces) → `renderStreakChip` returns `''`; profile `streakStat` empty. ✅
- No badge/backend/schema change → nothing in those areas touched. ✅
- SW bump + tests + mirror-drift → Task 3 Step 6/7, Task 2. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; E2E omission is an explicit, justified decision (Task 3 Step 8). ✅

**Type/name consistency:** `computeCurrentStreak(logs, today)` → `{count, status}`; `addDaysStr(dateStr, delta)`; `renderStreakChip(streak, variant)` with `variant ∈ {'feed','profile'}`; `renderStreakChips()` (no args, updates `#feed-streak-chip`). Names identical across all tasks. `status` values `'none'|'active'|'at_risk'` used consistently. ✅
