# Accuracy Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Accuracy History page opens on a list of every watch with its latest rate and a shared-scale strip; tapping a row opens today's per-watch view.

**Architecture:** Three pure helpers (summary, ordering, strip SVG) live in `wrotate_test.js` and are mirrored VERBATIM into `index.html`, next to `groupReadingsByDay`. The History page gets two states driven by one variable (`_msrHistWatchId`, null = overview); the watch dropdown is removed. One client read of the member's own `timegrapher_results`; no SQL.

**Tech Stack:** Vanilla JS in `index.html`, vitest (`tests/`), Playwright mocked (`e2e/*.mock.spec.js`).

**Spec:** `docs/superpowers/specs/2026-11-15-accuracy-overview-design.md` (mockup linked there, screen "A+B"). Ships to everyone, no experiment (owner, 2026-11-15).

## Global Constraints

- No hand-typed colour, size, spacing, radius or weight: tokens / existing utility classes only; `tests/design-system-ratchet.test.js` budget must not rise.
- Status colours: good = `--status-good`, warn = `--status-warn`, bad = `--danger`. Bands reuse `.acc-band-5` / `.acc-band-15`.
- No emoji. No `confirm()`/`alert()`.
- User-visible strings go through `tx()` or static markup; after text changes run the three `scripts/i18n.mjs` steps in `docs/i18n.md` and fill all six `i18n/<lang>.json`.
- Mirrors are byte-identical between `wrotate_test.js` and `index.html` (`tests/mirror-drift.test.js`); every new export needs branch coverage (`npm run test:coverage`, 94%).
- Bump `sw.js` `wristlog-v1447` → next on ship.
- Scale limit 30 s/d; thresholds 5 and 15 s/d; default range `3M`; default sort `accurate`.
- Test accounts only; do not touch the landing page.

## Review Focus

1. The readings read fails (network/RLS): the overview must say it could not load, not show every watch as "Not measured yet".
2. Readings whose `watch_id` is no longer in `watches` (deleted watch): ignored, no blank row, no crash.
3. A watch whose only rows have a null / non-numeric rate: treated as not measured.
4. Latest reading beyond the scale, either sign (+38, -45): arrow pinned to the correct edge, rate text still exact.
5. Watch names containing `<`, `&` or quotes: escaped in the row and in the SVG `aria-label`.

---

### Task 1: Pure helpers

**Files:**
- Modify: `wrotate_test.js` (after `accuracyTrendSvg`, ~line 2060)
- Modify: `index.html` (after `accuracyTrendSvg`, ~line 15618; VERBATIM mirror comment above each)
- Test: `tests/accuracy-history.test.js`

**Interfaces — Produces:**
- `accuracyStatus(rate: number) -> 'good' | 'warn' | 'bad'` — `|rate| <= 5` good, `<= 15` warn, else bad.
- `summarizeWatchAccuracy(rows, range, now = new Date()) -> { latest: {rate:number, created_at:string} | null, inRange: {n, min, max, avg} | null }` — `latest` is the valid-rate row with the newest `created_at`, regardless of range. `inRange` comes from `filterDaysByRange(groupReadingsByDay(rows), range, now)`: `n` = sum of day `n`, `min`/`max` across days, `avg` = mean of day medians (same definition the per-watch page uses); null when no day is in range.
- `buildAccuracyOverview(watches, rows, range, sort, now = new Date()) -> Array<{ id, label, latest, inRange }>` — one entry per watch in `watches` (`label` = `brand + ' ' + name`, trimmed); rows grouped by `watch_id`, rows for unknown watches dropped. Order: measured watches first by `sort` (`'accurate'` ascending `|latest.rate|`; `'recent'` descending `latest.created_at`; `'name'` ascending label, `localeCompare`), ties by label; unmeasured always last, by label. Unknown `sort` behaves as `'accurate'`.
- `accuracyStripSvg(summary, { width = 300, height = 18, limit = 30, label = '' } = {}) -> string` — pure string. Always: `.acc-band-15` rect (-15..15), `.acc-band-5` rect (-5..5), `.acc-zero` line at 0. If `summary.inRange`: `<line class="acc-strip-bar acc-s-<status>">` from min to max, both clamped to ±limit. If `summary.latest`: `<circle class="acc-strip-dot acc-s-<status>">` at the rate when `|rate| <= limit`, otherwise `<path class="acc-strip-arrow acc-s-<status>">` at the edge on the rate's side. `status` is `accuracyStatus(latest.rate)`. `aria-label` = `label` (caller passes already-escaped text). Horizontal padding 6.

- [ ] **Step 1: Write failing tests** in `tests/accuracy-history.test.js` (import the four names):

```js
const NOW = new Date('2026-11-15T12:00:00');
const R = (watch_id, rate, created_at) => ({ watch_id, rate, created_at });
describe('accuracyStatus', () => {
  it('bands at 5 and 15, either sign', () => {
    expect([0, 5, -5, 5.1, -15, 15.1, -40].map(accuracyStatus)).toEqual(['good', 'good', 'good', 'warn', 'warn', 'bad', 'bad']);
  });
});
describe('summarizeWatchAccuracy', () => {
  const rows = [R('a', 2, '2026-11-10T09:00'), R('a', 4, '2026-11-10T10:00'), R('a', -6, '2026-11-01T09:00'), R('a', 20, '2026-05-01T09:00'), R('a', null, '2026-11-14T09:00')];
  it('latest ignores range and invalid rates; inRange uses day medians', () => {
    const s = summarizeWatchAccuracy(rows, '1M', NOW);
    expect(s.latest).toEqual({ rate: 4, created_at: '2026-11-10T10:00' });
    expect(s.inRange).toEqual({ n: 3, min: -6, max: 4, avg: -1.5 }); // medians 3 and -6
    expect(summarizeWatchAccuracy(rows, 'ALL', NOW).inRange.n).toBe(4);
  });
  it('latest older than the range: latest kept, inRange null', () => {
    const s = summarizeWatchAccuracy([R('a', 20, '2026-05-01T09:00')], '1M', NOW);
    expect(s.latest.rate).toBe(20); expect(s.inRange).toBeNull();
  });
  it('nothing usable', () => {
    expect(summarizeWatchAccuracy([R('a', null, '2026-11-14T09:00')], '3M', NOW)).toEqual({ latest: null, inRange: null });
    expect(summarizeWatchAccuracy(null, '3M', NOW)).toEqual({ latest: null, inRange: null });
  });
});
describe('buildAccuracyOverview', () => {
  const watches = [{ id: 'a', brand: 'Omega', name: 'Speedmaster' }, { id: 'b', brand: 'Seiko', name: 'SKX' }, { id: 'c', brand: 'Cartier', name: 'Tank' }, { id: 'd', brand: 'Atlas', name: '' }];
  const rows = [R('a', 6, '2026-11-01T09:00'), R('b', -2, '2026-10-01T09:00'), R('gone', 1, '2026-11-12T09:00'), R('c', null, '2026-11-12T09:00')];
  const ids = (sort) => buildAccuracyOverview(watches, rows, '3M', sort, NOW).map(w => w.id);
  it('orders measured by sort, unmeasured last by name, unknown watches dropped', () => {
    expect(ids('accurate')).toEqual(['b', 'a', 'd', 'c']);
    expect(ids('recent')).toEqual(['a', 'b', 'd', 'c']);
    expect(ids('name')).toEqual(['a', 'b', 'd', 'c']);
    expect(ids('bogus')).toEqual(ids('accurate'));
  });
  it('labels and empties', () => {
    expect(buildAccuracyOverview(watches, rows, '3M', 'name', NOW)[2].label).toBe('Atlas');
    expect(buildAccuracyOverview(null, null, '3M', 'name', NOW)).toEqual([]);
  });
  it('ties break by label', () => {
    const o = buildAccuracyOverview(watches, [R('a', 3, '2026-11-01T09:00'), R('b', -3, '2026-11-01T09:00')], '3M', 'accurate', NOW);
    expect(o.slice(0, 2).map(w => w.id)).toEqual(['a', 'b']);
  });
});
describe('accuracyStripSvg', () => {
  const sum = (rate, inRange = null) => ({ latest: rate == null ? null : { rate, created_at: 'x' }, inRange });
  it('bands and zero line always; nothing else when unmeasured', () => {
    const s = accuracyStripSvg(sum(null));
    expect(s).toContain('acc-band-15'); expect(s).toContain('acc-band-5'); expect(s).toContain('acc-zero');
    expect(s).not.toContain('acc-strip-dot'); expect(s).not.toContain('acc-strip-bar');
  });
  it('dot coloured by status, bar only with inRange', () => {
    const s = accuracyStripSvg(sum(2, { n: 2, min: -1, max: 3, avg: 1 }), { label: 'Omega' });
    expect(s).toContain('acc-strip-dot acc-s-good'); expect(s).toContain('acc-strip-bar acc-s-good'); expect(s).toContain('aria-label="Omega"');
    expect(accuracyStripSvg(sum(12))).toContain('acc-strip-dot acc-s-warn');
    expect(accuracyStripSvg(sum(12))).not.toContain('acc-strip-bar');
  });
  it('beyond the scale: arrow on the right side, bar clamped inside the width', () => {
    const hi = accuracyStripSvg(sum(38, { n: 2, min: 24, max: 41, avg: 33 }), { width: 300 });
    const lo = accuracyStripSvg(sum(-45), { width: 300 });
    expect(hi).toContain('acc-strip-arrow acc-s-bad'); expect(hi).not.toContain('acc-strip-dot');
    const x2 = Number(hi.match(/acc-strip-bar[^>]*x2="([\d.]+)"/)[1]); expect(x2).toBeLessThanOrEqual(294);
    const xHi = Number(hi.match(/acc-strip-arrow[^>]*data-x="([\d.]+)"/)[1]), xLo = Number(lo.match(/acc-strip-arrow[^>]*data-x="([\d.]+)"/)[1]);
    expect(xHi).toBeGreaterThan(150); expect(xLo).toBeLessThan(150);
  });
});
```

(The arrow `<path>` carries `data-x` = the clamped x so the test can read the side.)

- [ ] **Step 2:** `npx vitest run tests/accuracy-history.test.js` — FAIL (names not exported).
- [ ] **Step 3:** Implement the four exports in `wrotate_test.js`.
- [ ] **Step 4:** Same command — PASS.
- [ ] **Step 5:** Copy the four functions into `index.html` under `// VERBATIM mirror of wrotate_test.js — keep byte-identical (see mirror-drift.test.js).`; register them wherever `tests/mirror-drift.test.js` lists VERBATIM names if it is list-driven. `npx vitest run tests/mirror-drift.test.js tests/accuracy-history.test.js` — PASS.
- [ ] **Step 6:** Commit `Accuracy overview: summary, ordering and strip helpers`.

### Task 2: Overview screen and navigation

**Files:**
- Modify: `index.html` — style block ~line 631 (strip classes), page markup ~4949-4972, script ~36022-36150
- Test: `e2e/accuracy-overview.mock.spec.js` (new; copy route-mocking setup from an existing `e2e/*.mock.spec.js` that mocks `timegrapher_results` or `watches`, e.g. `e2e/app.mock.spec.js`)

**Interfaces — Consumes:** Task 1's four functions; existing `fetchAccuracyRows`, `renderMsrHistoryView`, `_fmtRateSigned`, `_fmtDayLabel`, `escHtml`, `escAttr`, `safeLS`, `watches`.

**Produces (names the tests and Task 3 rely on):**
- Markup: `#msr-hist-overview` (sort `<select id="msr-hist-sort">` with values `accurate`/`recent`/`name` labelled "Most accurate", "Most recent", "Name"; list `#msr-hist-ov-list`) and `#msr-hist-detail` (wraps the existing summary card + `#msr-hist-days`, plus `<div id="msr-hist-watch-name">`). The range chips stay above both. `#msr-hist-watch-select` is deleted. Back button calls `msrHistBack()`, `aria-label="Back"`.
- Rows: `<div class="acc-ov-row" data-watch-id="…" role="button" tabindex="0">` (Enter/Space activate); unmeasured rows add class `acc-ov-empty`. Line 1 name + `_fmtRateSigned(latest.rate)`; line 2 `accuracyStripSvg(...)` at the row's width; line 3 `avg {a} · {n} readings · last {date}` or, when `inRange` is null, `none in this range · last {date}`; unmeasured: `Not measured yet`. One axis row (-15, -5, 0, +5, +15, `.acc-label`) at the top of the list card, same x scale as the strips.
- CSS (tokens only): `.acc-strip-bar` (stroke-width 3, round caps, 45% mix of its status colour), `.acc-strip-dot`, `.acc-strip-arrow`, `.acc-s-good` / `.acc-s-warn` / `.acc-s-bad` → `--status-good` / `--status-warn` / `--danger`. Rate text stays `--text` (the status hues fail contrast as text on the light surface); the dot carries the colour.
- State/functions: `let _msrHistWatchId = null; let _msrHistAllRows = null; let _msrHistSort = safeLS.get('msr_hist_sort') || 'accurate';`
  - `fetchAllAccuracyRows() -> Promise<rows | null>` — `timegrapher_results` `select('watch_id, rate, created_at')`, own `user_id`, newest first, `limit(1000)`; returns `null` on error.
  - `openMsrHistory(source)` — keeps both analytics writes; `source === 'hint_card'` sets `_msrHistWatchId` to the Measure dropdown's watch, otherwise null; then `renderMsrHistory()`.
  - `renderMsrHistory()` — overview: fetch all rows, render list (on `null`: `Could not load your readings.` plus a `Try again` button calling `renderMsrHistory()`); detail: existing per-watch fetch using `_msrHistWatchId`, set `#msr-hist-watch-name`.
  - `openMsrHistWatch(id)` — sets id, `posthog.capture('accuracy_overview_watch_opened')`, renders, scrolls to top.
  - `msrHistBack()` — detail → overview (re-fetch so a discarded reading is reflected); overview → Measure (old `closeMsrHistory` body). Remove `closeMsrHistory`.
  - `setMsrHistSort(v)` — stores `msr_hist_sort`, re-renders from `_msrHistAllRows` without refetching. `setMsrHistRange` re-renders whichever level is showing, also without refetching on the overview.
  - No watches at all: list shows `Add a watch to your collection to start tracking its accuracy.`

- [ ] **Step 1: Write the failing e2e spec** `e2e/accuracy-overview.mock.spec.js`, mocking three watches (`Omega Speedmaster`, `Seiko SKX`, `A<b>&"c` as a name) and readings: Omega +2.1 (yesterday) and +3.8; Seiko +38 (10 days ago); one row for an unknown watch id; third watch none. Tests:
  1. `header icon opens the overview`: click `#msr-history-btn` → `.acc-ov-row` count 3; order Omega, Seiko, third; third has `.acc-ov-empty` and text `Not measured yet`; Seiko row contains `.acc-strip-arrow` and `+38.0 s/d`; third row's name renders as literal text (`page.locator('.acc-ov-row b')` count 0).
  2. `sort persists`: select `name` → first row is the `A<b>…` watch... (unmeasured stays last, so order Omega, Seiko, third); select `recent` → Omega first; reload, reopen → `#msr-hist-sort` value `recent`.
  3. `row opens the watch and back returns`: click Seiko row → `#msr-hist-detail` visible, `#msr-hist-watch-name` has `Seiko SKX`, `#msr-hist-overview` hidden; back → overview visible; back again → `#page-measure` active.
  4. `hint card still lands on its watch`: select Omega on Measure, click `#msr-history-hint` → detail visible with `Omega Speedmaster`; back → overview.
  5. `load failure says so`: route the all-rows request to 500 → list contains `Could not load your readings.` and no `.acc-ov-empty`.
- [ ] **Step 2:** `npx playwright test --project=mocked e2e/accuracy-overview.mock.spec.js` — FAIL.
- [ ] **Step 3:** Implement markup, CSS and script per Produces.
- [ ] **Step 4:** Same command — PASS. Then `npm test` (ratchet, mirror, stamps) — PASS.
- [ ] **Step 5:** Commit `Accuracy History opens on an overview of every watch`.

### Task 3: Copy, translations, ship

**Files:** `index.html` (Help step ~4132, What's New above the first current entry ~2920), `i18n/en.keys.json`, `i18n/{es,it,fr,tr,de,pt}.json` + built `.js`, `sw.js`.

- [ ] **Step 1:** Help step "Accuracy history and trend": add that the trend icon in the header opens every watch on one screen (latest rate, a strip on a shared ±30 s/d scale, sortable), and tapping a watch opens its history. What's New entry titled `Accuracy overview`, two sentences, features only.
- [ ] **Step 2:** `node scripts/i18n.mjs extract` → `status --missing` → add every new string to the six language files → `node scripts/i18n.mjs build`.
- [ ] **Step 3:** Bump `sw.js` cache to `wristlog-v1448` (or next free).
- [ ] **Step 4:** Gates, each checked on its own exit status: `npm run test:coverage`, `npm run test:functions`, `npm run test:e2e`. Known pre-existing mocked failure: wear-leaderboard keyboard; anything else red is this change.
- [ ] **Step 5:** Local check at `http://localhost:3000` signed in as test@wrotate.com: overview, sort, range chips, row → detail → back, hint card path, dark theme, 375px width, Spanish (`?lang=es`).
- [ ] **Step 6:** `git diff HEAD -- index.html` sanity check (pre-commit hook re-adds it), commit `Accuracy overview: help, What's New, translations`, `git push origin main`, confirm the Deploy site run is green.
