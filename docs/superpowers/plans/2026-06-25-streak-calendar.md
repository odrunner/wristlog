# Streak Calendar Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping the header streak chip opens a month-calendar modal of logged days, with the current/best streak and month navigation. Behind the existing `streak_chip` flag.

**Architecture:** Pure `streakCalendarGrid(loggedDates, year, monthIndex, today)` (mirror-drift VERBATIM, unit-tested) builds the month cells; a `.overlay/.modal` popup renders them; `streakChipTap()` is repointed from Track to open it. Client-only — no backend.

**Tech Stack:** Vanilla JS (single-file index.html), vitest, mirror-drift guard.

**Spec:** `docs/superpowers/specs/2026-06-25-streak-calendar-design.md`

## Global Constraints

- Entry is the streak chip (gated by `streak_chip`, default off) → no new flag; the calendar is unreachable until the chip is on.
- `streakCalendarGrid` must be **byte-identical** in `index.html` and `wrotate_test.js` and registered in the mirror-drift `VERBATIM` list (`tests/mirror-drift.test.js:41`).
- Reuse the app's `.overlay/.modal` pattern + the shared backdrop/Esc close via `_overlayCloseMap`. Reuse CSS vars `--gold`, `--surface2`, `--muted`, and `.streak-flame`/`.streak-flame-dim`.
- Month grid: logged days flamed, today outlined, future days dimmed; `‹ ›` pages months, next disabled at the current month. `npm test` stays green. SW cache bump. Pre-commit bumps `APP_VERSION` — expected.

---

### Task 1: `streakCalendarGrid` pure helper + tests + mirror registration

**Files:**
- Modify: `wrotate_test.js` (add exported `streakCalendarGrid` after `streakChipState`)
- Modify: `index.html` (byte-identical `streakCalendarGrid` next to `streakChipState`)
- Create: `tests/streak-calendar.test.js`
- Modify: `tests/mirror-drift.test.js:41` (add `'streakCalendarGrid'` to `VERBATIM`)

**Interfaces:**
- Produces: `streakCalendarGrid(loggedDates, year, monthIndex, today) → Array<null | { day, date, logged, isToday, isFuture }>` (leading `null`s for days before the 1st).

- [ ] **Step 1: Write the failing tests**

Create `tests/streak-calendar.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { streakCalendarGrid } from '../wrotate_test.js';

describe('streakCalendarGrid', () => {
  it('Jan 2026 → 4 leading blanks (Jan 1 is Thursday), 35 cells', () => {
    const g = streakCalendarGrid(new Set(), 2026, 0, '2026-01-15');
    expect(g.slice(0, 4).every(c => c === null)).toBe(true);
    expect(g[4]).toMatchObject({ day: 1, date: '2026-01-01' });
    expect(g.length).toBe(35);
  });
  it('flags logged days from a Set', () => {
    const g = streakCalendarGrid(new Set(['2026-01-10', '2026-01-11']), 2026, 0, '2026-01-15');
    expect(g.find(c => c && c.day === 10).logged).toBe(true);
    expect(g.find(c => c && c.day === 12).logged).toBe(false);
  });
  it('accepts an array too', () => {
    const g = streakCalendarGrid(['2026-01-10'], 2026, 0, '2026-01-15');
    expect(g.find(c => c && c.day === 10).logged).toBe(true);
  });
  it('marks today and future', () => {
    const g = streakCalendarGrid(new Set(), 2026, 0, '2026-01-20');
    expect(g.find(c => c && c.day === 20).isToday).toBe(true);
    expect(g.find(c => c && c.day === 25).isFuture).toBe(true);
    expect(g.find(c => c && c.day === 15).isFuture).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- streak-calendar`
Expected: FAIL — `streakCalendarGrid` not exported.

- [ ] **Step 3: Implement in `wrotate_test.js`**

Insert after the `streakChipState` function:

```js
export function streakCalendarGrid(loggedDates, year, monthIndex, today) {
  const has = (d) => (loggedDates instanceof Set ? loggedDates.has(d) : (loggedDates || []).includes(d));
  const pad = (n) => String(n).padStart(2, '0');
  const startDow = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${pad(monthIndex + 1)}-${pad(d)}`;
    cells.push({ day: d, date, logged: has(date), isToday: date === today, isFuture: date > today });
  }
  return cells;
}
```

- [ ] **Step 4: Mirror it in `index.html`**

Find `streakChipState` in index.html (added by the chip feature, ~line 5316). Immediately after its closing `}`, insert the SAME function **byte-identical** but with bare `function` (no `export`):

```js
function streakCalendarGrid(loggedDates, year, monthIndex, today) {
  const has = (d) => (loggedDates instanceof Set ? loggedDates.has(d) : (loggedDates || []).includes(d));
  const pad = (n) => String(n).padStart(2, '0');
  const startDow = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${pad(monthIndex + 1)}-${pad(d)}`;
    cells.push({ day: d, date, logged: has(date), isToday: date === today, isFuture: date > today });
  }
  return cells;
}
```

- [ ] **Step 5: Register in VERBATIM**

In `tests/mirror-drift.test.js:41`, change `'addDaysStr', 'computeStreaks', 'streakChipState',` to append `'streakCalendarGrid'`:
```js
  'addDaysStr', 'computeStreaks', 'streakChipState', 'streakCalendarGrid',
```

- [ ] **Step 6: Run tests**

Run: `npm test -- streak-calendar mirror-drift`
Expected: PASS (4 calendar tests + mirror-drift green).

- [ ] **Step 7: Commit**

```bash
git add wrotate_test.js index.html tests/streak-calendar.test.js tests/mirror-drift.test.js
git commit -m "feat(streak): streakCalendarGrid pure helper + tests + mirror registration"
```

---

### Task 2: Calendar modal, render fns, repoint chip tap

**Files:**
- Modify: `index.html` — modal markup (near other modals, ~`index.html:2135`); `.streak-cal-*` CSS (near `.dow-grid` ~`index.html:1327`); render/open/close/shift fns (near `streakCalendarGrid`); repoint `streakChipTap` (~`index.html:5339`); register in `_overlayCloseMap` (~`index.html:21950`)
- Modify: `sw.js` (cache bump)

**Interfaces:**
- Consumes: `streakCalendarGrid` (Task 1), `computeStreaks`, `todayStr`, `logs`.

- [ ] **Step 1: Add the modal markup**

After the `whats-new-modal` block (or near other `.overlay` modals, ~`index.html:2135`), add:

```html
<div id="streak-calendar-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="streak-calendar-title">
  <div class="modal" style="max-width:380px;">
    <div class="modal-title" id="streak-calendar-title">Streak Calendar</div>
    <div id="streak-calendar-body"></div>
    <div class="modal-actions" style="margin-top:1rem;">
      <button class="btn btn-ghost" onclick="closeStreakCalendar()">Close</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

Near `.dow-grid` (~`index.html:1327`), add:

```css
    .streak-cal-head { text-align:center; font-weight:700; font-size:1rem; margin-bottom:.9rem; display:flex; align-items:center; justify-content:center; gap:.3rem; }
    .streak-cal-nav { display:flex; align-items:center; justify-content:space-between; margin-bottom:.6rem; }
    .streak-cal-month { font-weight:600; font-size:.92rem; }
    .streak-cal-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:.25rem; }
    .streak-cal-dow { text-align:center; font-size:.62rem; font-weight:700; text-transform:uppercase; color:var(--muted); padding-bottom:.2rem; }
    .streak-cal-cell { aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:.8rem; border-radius:8px; background:var(--surface2); color:var(--text); }
    .streak-cal-blank { background:transparent; }
    .streak-cal-cell.logged { background:var(--gold); color:#1a1205; font-weight:700; }
    .streak-cal-cell.today { outline:2px solid var(--gold); outline-offset:-2px; }
    .streak-cal-cell.future { opacity:.35; }
```

- [ ] **Step 3: Add render / open / close / shift functions**

After `streakCalendarGrid` in index.html, add:

```js
let _streakCalYM = null; // displayed month {year, month}

function openStreakCalendar() {
  const t = todayStr();
  _streakCalYM = { year: +t.slice(0, 4), month: +t.slice(5, 7) - 1 };
  renderStreakCalendar();
  document.getElementById('streak-calendar-modal').classList.remove('hidden');
}

function closeStreakCalendar() {
  document.getElementById('streak-calendar-modal').classList.add('hidden');
}

function streakCalShift(delta) {
  if (!_streakCalYM) return;
  let { year, month } = _streakCalYM;
  month += delta;
  if (month < 0) { month = 11; year--; } else if (month > 11) { month = 0; year++; }
  _streakCalYM = { year, month };
  renderStreakCalendar();
}

function renderStreakCalendar() {
  const body = document.getElementById('streak-calendar-body');
  if (!body || !_streakCalYM) return;
  const t = todayStr();
  const sk = computeStreaks(logs, t);
  const logged = new Set(logs.map(l => l.date));
  const { year, month } = _streakCalYM;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const cells = streakCalendarGrid(logged, year, month, t);
  const head = sk.status === 'none'
    ? `Start a streak${sk.best >= 1 ? ` · best ${sk.best}` : ''}`
    : `<span class="streak-flame${sk.status === 'at_risk' ? ' streak-flame-dim' : ''}">🔥</span> ${sk.current}-day streak${sk.best > sk.current ? ` · best ${sk.best}` : ''}`;
  const curY = +t.slice(0, 4), curM = +t.slice(5, 7) - 1;
  const atCurrent = (year > curY) || (year === curY && month >= curM);
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  body.innerHTML =
    `<div class="streak-cal-head">${head}</div>` +
    `<div class="streak-cal-nav">` +
      `<button class="btn btn-ghost btn-sm" onclick="streakCalShift(-1)" aria-label="Previous month">‹</button>` +
      `<span class="streak-cal-month">${MONTHS[month]} ${year}</span>` +
      `<button class="btn btn-ghost btn-sm" onclick="streakCalShift(1)" ${atCurrent ? 'disabled' : ''} aria-label="Next month">›</button>` +
    `</div>` +
    `<div class="streak-cal-grid">` +
      dow.map(d => `<div class="streak-cal-dow">${d}</div>`).join('') +
      cells.map(c => {
        if (!c) return `<div class="streak-cal-cell streak-cal-blank"></div>`;
        const cls = 'streak-cal-cell' + (c.logged ? ' logged' : '') + (c.isToday ? ' today' : '') + (c.isFuture ? ' future' : '');
        return `<div class="${cls}">${c.day}</div>`;
      }).join('') +
    `</div>`;
}
```

- [ ] **Step 4: Repoint the chip tap**

Replace the body of the existing `streakChipTap()` (~`index.html:5339`) so it opens the calendar:

```js
function streakChipTap() {
  openStreakCalendar();
}
```

- [ ] **Step 5: Register in `_overlayCloseMap`**

In `_overlayCloseMap` (~`index.html:21950`), add an entry so backdrop-click + Esc close the calendar:

```js
  'streak-calendar-modal': closeStreakCalendar,
```

- [ ] **Step 6: Bump SW cache**

`grep -n "wristlog-v" sw.js`, increment by one.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (all tests, including streak-calendar + mirror-drift).

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat(streak): month-calendar popup on chip tap (behind streak_chip flag)"
```

## Self-Review

**Spec coverage:** pure grid builder + 5 cell properties (Task 1) ✅; modal markup + CSS (Task 2 Steps 1-2) ✅; render with header streak + month nav + logged/today/future styling (Step 3) ✅; repoint chip tap (Step 4) ✅; backdrop/Esc close via `_overlayCloseMap` (Step 5) ✅; next-disabled-at-current-month guard (Step 3, `atCurrent`) ✅; mirror + unit tests (Task 1) ✅; SW bump (Step 6) ✅. Behind `streak_chip` (no new flag). ✅

**Placeholder scan:** all code shown in full; insertion points named with search hints (single-file app shifts lines). ✅

**Type/name consistency:** `streakCalendarGrid` cell shape `{day,date,logged,isToday,isFuture}` produced in Task 1, consumed in `renderStreakCalendar` (Task 2). `_streakCalYM`, `openStreakCalendar`/`closeStreakCalendar`/`renderStreakCalendar`/`streakCalShift` consistent across Steps 3-5. `streak-calendar-modal` / `streak-calendar-body` ids consistent between markup (Step 1), render (Step 3), open/close (Step 3), and `_overlayCloseMap` (Step 5). `.streak-cal-*` classes consistent between CSS (Step 2) and render (Step 3). ✅
