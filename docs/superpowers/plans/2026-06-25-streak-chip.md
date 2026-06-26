# Top-Bar Streak Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A compact, persistent `🔥 N` wear-streak chip in the global header, on every page, behind admin flag `streak_chip` (default off) for founder testing.

**Architecture:** Pure `streakChipState(sk, flagOn)` (mirror-drift VERBATIM, unit-tested) decides what the chip shows from the existing `computeStreaks` result; `updateStreakChip()` renders it into a new header `#streak-chip` element and is called wherever logs change. Client-only — no schema, no backend, no change to `computeStreaks`.

**Tech Stack:** Vanilla JS (single-file index.html), vitest, mirror-drift guard.

**Spec:** `docs/superpowers/specs/2026-06-25-streak-chip-design.md`

## Global Constraints

- **Flag-gated:** chip hidden unless `featureFlag('streak_chip')`. Flag entry `streak_chip: { label: 'Streak: top-bar chip (admin)', default: false }` in `FEATURE_FLAGS` (index.html ~4881). The admin Dev tab auto-renders the toggle — no admin UI work.
- **States:** active → bright `🔥 N`; at_risk → dim+amber `🔥 N`; none & `best≥1` → dim `🔥` no number (invite); never-logged (`best<1`) → hidden.
- **Tap → Track page.** Tooltip: "Consecutive days you've logged — any activity counts."
- `streakChipState` must be **byte-identical** in `index.html` and `wrotate_test.js` and registered in the mirror-drift `VERBATIM` list (`tests/mirror-drift.test.js:41`).
- Reuse existing CSS `.streak-flame` / `.streak-flame-dim` and the global `.hidden` class. `npm test` stays green. SW cache bump on the index.html change. Pre-commit hook bumps `APP_VERSION` — expected.

---

### Task 1: `streakChipState` pure helper + tests + mirror registration

**Files:**
- Modify: `wrotate_test.js` (add exported `streakChipState` after `computeStreaks`, ~line 44)
- Modify: `index.html` (add byte-identical `streakChipState` next to `computeStreaks`, ~line 5313)
- Create: `tests/streak-chip.test.js`
- Modify: `tests/mirror-drift.test.js:41` (add `'streakChipState'` to `VERBATIM`)

**Interfaces:**
- Consumes: `computeStreaks` result shape `{ current, best, status }` where `status ∈ {'active','at_risk','none'}`.
- Produces: `streakChipState(sk, flagOn) → { visible, count, dim, atRisk, invite }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/streak-chip.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { streakChipState } from '../wrotate_test.js';

describe('streakChipState', () => {
  it('flag off → hidden regardless of streak', () => {
    expect(streakChipState({ current: 12, best: 12, status: 'active' }, false).visible).toBe(false);
  });
  it('active → bright chip with count', () => {
    expect(streakChipState({ current: 12, best: 20, status: 'active' }, true))
      .toEqual({ visible: true, count: 12, dim: false, atRisk: false, invite: false });
  });
  it('at_risk → dim/amber chip with count', () => {
    expect(streakChipState({ current: 12, best: 20, status: 'at_risk' }, true))
      .toEqual({ visible: true, count: 12, dim: true, atRisk: true, invite: false });
  });
  it('none but has logged before → dim invite, no number', () => {
    expect(streakChipState({ current: 0, best: 5, status: 'none' }, true))
      .toEqual({ visible: true, count: null, dim: true, atRisk: false, invite: true });
  });
  it('never logged → hidden', () => {
    expect(streakChipState({ current: 0, best: 0, status: 'none' }, true).visible).toBe(false);
  });
  it('null streak → hidden', () => {
    expect(streakChipState(null, true).visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- streak-chip`
Expected: FAIL — `streakChipState` is not exported.

- [ ] **Step 3: Implement in `wrotate_test.js`**

Insert after the `computeStreaks` function (after its closing `}`, ~line 44):

```js
export function streakChipState(sk, flagOn) {
  if (!flagOn || !sk) return { visible: false, count: null, dim: false, atRisk: false, invite: false };
  if (sk.status === 'active') return { visible: true, count: sk.current, dim: false, atRisk: false, invite: false };
  if (sk.status === 'at_risk') return { visible: true, count: sk.current, dim: true, atRisk: true, invite: false };
  if (sk.status === 'none' && sk.best >= 1) return { visible: true, count: null, dim: true, atRisk: false, invite: true };
  return { visible: false, count: null, dim: false, atRisk: false, invite: false };
}
```

- [ ] **Step 4: Mirror it in `index.html`**

Find `computeStreaks` in index.html (~line 5298–5313). Immediately after its closing `}`, insert the SAME function **byte-identical** but WITHOUT the `export` keyword (index.html uses bare `function`):

```js
function streakChipState(sk, flagOn) {
  if (!flagOn || !sk) return { visible: false, count: null, dim: false, atRisk: false, invite: false };
  if (sk.status === 'active') return { visible: true, count: sk.current, dim: false, atRisk: false, invite: false };
  if (sk.status === 'at_risk') return { visible: true, count: sk.current, dim: true, atRisk: true, invite: false };
  if (sk.status === 'none' && sk.best >= 1) return { visible: true, count: null, dim: true, atRisk: false, invite: true };
  return { visible: false, count: null, dim: false, atRisk: false, invite: false };
}
```

(The mirror-drift guard strips the `export` keyword + whitespace/comments before comparing, so the bodies must match exactly.)

- [ ] **Step 5: Register in the mirror-drift VERBATIM list**

In `tests/mirror-drift.test.js:41`, change:
```js
  'addDaysStr', 'computeStreaks',
```
to:
```js
  'addDaysStr', 'computeStreaks', 'streakChipState',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- streak-chip mirror-drift`
Expected: PASS — streak-chip unit tests pass; mirror-drift confirms `streakChipState` is byte-identical and classified.

- [ ] **Step 7: Commit**

```bash
git add wrotate_test.js index.html tests/streak-chip.test.js tests/mirror-drift.test.js
git commit -m "feat(streak): streakChipState pure helper + tests + mirror registration"
```

---

### Task 2: Header chip element, flag, render fn + wiring

**Files:**
- Modify: `index.html` — `FEATURE_FLAGS` (~4881); `#streak-chip` element in `.header-data` before `#bell-btn` (~2617); `.streak-chip` CSS (near `.bell-btn` ~1944); `updateStreakChip()` + `streakChipTap()` (near `updateStreakChip` neighbors / after `computeStreaks` callers); wiring calls
- Modify: `sw.js` (cache bump)

**Interfaces:**
- Consumes: `streakChipState` (Task 1), `computeStreaks`, `todayStr`, `featureFlag`, `logs`, `nav`.

- [ ] **Step 1: Add the feature flag**

In `FEATURE_FLAGS` (index.html ~4881), add the entry (after the last existing flag, keep formatting):

```js
  deep_test: { label: 'Timegrapher: Deep Test (admin)', default: false },
  streak_chip: { label: 'Streak: top-bar chip (admin)', default: false },
};
```
(Match the actual last line; only add the `streak_chip` line before the closing `};`.)

- [ ] **Step 2: Add the header element**

Find the bell button in the header (`<button class="bell-btn" id="bell-btn"` ~index.html:2617). Immediately BEFORE it, insert:

```html
        <button class="streak-chip hidden" id="streak-chip" onclick="streakChipTap()" title="Consecutive days you've logged — any activity counts." aria-label="Wear streak"></button>
```

- [ ] **Step 3: Add CSS**

Near the `.bell-btn` rules (~index.html:1944), add:

```css
    .streak-chip { display:inline-flex; align-items:center; gap:.18rem; font-size:.82rem; font-weight:700; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:.12rem .5rem; cursor:pointer; line-height:1; }
    .streak-chip .streak-count { font-variant-numeric:tabular-nums; }
    .streak-chip.streak-chip-atrisk { border-color:#d9a441; color:#d9a441; }
```

(`.streak-flame` / `.streak-flame-dim` already exist; `.hidden` is the existing global hide class.)

- [ ] **Step 4: Add `updateStreakChip()` + `streakChipTap()`**

Add these two functions (place them after `computeStreaks`/`streakChipState`, or near other render helpers):

```js
function updateStreakChip() {
  const el = document.getElementById('streak-chip');
  if (!el) return;
  const st = streakChipState(computeStreaks(logs, todayStr()), featureFlag('streak_chip'));
  if (!st.visible) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.classList.toggle('streak-chip-atrisk', st.atRisk);
  const flame = `<span class="streak-flame${st.dim ? ' streak-flame-dim' : ''}">🔥</span>`;
  el.innerHTML = flame + (st.invite ? '' : ` <span class="streak-count">${st.count}</span>`);
}

function streakChipTap() {
  const b = document.querySelector('[data-page="track"]');
  if (b) nav(b);
}
```

- [ ] **Step 5: Wire `updateStreakChip()` into the refresh points**

Add a call to `updateStreakChip();` at each of these (search to confirm exact lines):
1. **Boot/init** — where the app first renders after `logs` + profile are ready (e.g. right after the initial `renderTrack()` / feed render on load). If there's a post-auth init render block, add it there.
2. **`saveLog`** — immediately after the existing `renderTrack();` call (~index.html:14720s).
3. **`saveNewPost`** — immediately after the post is saved + toast (~index.html:11197 area, after the feed-refresh `feedLoadedAt = 0`).
4. **`nav`** — inside `nav(...)` (after it switches page), so navigation keeps the chip fresh.

(If a cloud-sync apply-logs function is obvious, add a call there too; otherwise the above keep it current.)

- [ ] **Step 6: Bump SW cache**

`grep -n "wristlog-v" sw.js`, increment the version by one.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS (1166+ tests; the new streak-chip tests included). No mirror-drift failure.

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat(streak): top-bar streak chip behind streak_chip flag (default off)"
```

## Self-Review

**Spec coverage:** flag (Task 2 Step 1) ✅; pure state helper + 5 states (Task 1) ✅; header element + CSS (Task 2 Steps 2-3) ✅; render + tap→Track + tooltip (Task 2 Steps 2,4) ✅; wiring/live-update (Task 2 Step 5) ✅; mirror-drift + unit tests (Task 1) ✅; SW bump (Task 2 Step 6) ✅. Default-off rollout: flag `default:false` → hidden for all until removed. ✅

**Placeholder scan:** All code shown in full; wiring points named with search hints (the single-file app shifts line numbers, so the implementer confirms by search — not a placeholder). ✅

**Type/name consistency:** `streakChipState` return keys `{visible,count,dim,atRisk,invite}` are produced in Task 1 and consumed verbatim in `updateStreakChip` (Task 2). `streak_chip` flag name consistent across `FEATURE_FLAGS`, `featureFlag('streak_chip')`. `.streak-chip` / `.streak-chip-atrisk` / `.streak-flame(-dim)` / `.hidden` classes consistent between element, CSS, and render fn. ✅
