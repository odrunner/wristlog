# Day-Zero Onboarding Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent "Getting started" checklist (watch → wear → measure → profile) to the top of the feed, a first-wear "streak started" line, and a "Getting Started" capstone badge.

**Architecture:** Pure client-side, reusing the shipped badge system. A unit-tested `onboardingChecklistState(earnedRefs)` reads the four existing onboarding badges (`first_watch`/`first_wear`/`first_measurement`/`profile_complete`) to compute 0–4 progress; a production renderer draws a feed-top card; a new capstone badge (ref 6) awarded when all four are earned fires the existing `badge_earned` toast/bell/push as the finale. No backend/schema/edge-function change.

**Tech Stack:** Vanilla JS (`index.html` + `wrotate_test.js` mirror), vitest, `tests/mirror-drift.test.js`, `tests/badges.test.js`.

**Spec:** `docs/superpowers/specs/2026-06-24-onboarding-checklist-design.md`

## Global Constraints

- **Steps (display order):** Add a watch (badge ref **1**) → Log a wear (ref **3**) → Measure your accuracy (ref **2**) → Complete your profile (ref **5**). Progress = count of `{1,3,2,5}` in `_earnedBadges`. `first_post` (ref 4) is **not** a step.
- **Capstone:** new badge **ref 6** `getting_started` (category `onboarding`), awarded when all of `{1,2,3,5}` are earned. Earning flows through the existing `awardBadge → newlyEarned → showBadgeToast + notifyBadgesEarned` (toast + bell + batched push) — no new finale code.
- **Card:** `#onboarding-checklist` at the top of `#page-feed`; rendered only when `currentUser` and progress < 4; **collapsible** (`localStorage` key `wrotate_onboarding_collapsed`, `'1'`=collapsed); **not** permanently dismissible; auto-hidden at 4/4.
- **CTAs (incomplete rows):** watch → `openPhotoIdentify()`; wear → `openTrackModal()`; measure → `nav(document.getElementById('nav-measure-btn'))`; profile → `openProfileModal()`.
- **First-wear line:** when `first_wear` (ref 3) is newly earned, also `toast('🔥 Your streak starts now — day 1')`.
- **Mirror-drift:** `onboardingChecklistState` defined in BOTH `index.html` and `wrotate_test.js`, byte-identical, registered `VERBATIM`.
- Bump `sw.js` (`wristlog-vNN`). `npm test` stays green. Pre-commit hook auto-bumps `APP_VERSION` in `index.html` — expected; leave it. No backend work.

---

### Task 1: Pure `onboardingChecklistState` + unit tests

**Files:**
- Modify: `wrotate_test.js` (add exported `onboardingChecklistState` near the other pure helpers)
- Create: `tests/onboarding.test.js`

**Interfaces:**
- Produces: `onboardingChecklistState(earnedRefs: Set<number>|number[]) → { steps: {key,label,ref,done}[], doneCount: number, total: 4, complete: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/onboarding.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { onboardingChecklistState } from '../wrotate_test.js';

describe('onboardingChecklistState', () => {
  it('empty → 0/4, not complete, correct step order/refs', () => {
    const s = onboardingChecklistState(new Set());
    expect(s.doneCount).toBe(0);
    expect(s.total).toBe(4);
    expect(s.complete).toBe(false);
    expect(s.steps.map(x => x.ref)).toEqual([1, 3, 2, 5]);
    expect(s.steps.map(x => x.key)).toEqual(['watch', 'wear', 'measure', 'profile']);
    expect(s.steps.every(x => x.done === false)).toBe(true);
  });

  it('marks done from a Set and counts correctly', () => {
    const s = onboardingChecklistState(new Set([1, 2]));
    expect(s.doneCount).toBe(2);
    expect(s.steps.find(x => x.key === 'watch').done).toBe(true);
    expect(s.steps.find(x => x.key === 'measure').done).toBe(true);
    expect(s.steps.find(x => x.key === 'wear').done).toBe(false);
    expect(s.complete).toBe(false);
  });

  it('accepts an array too', () => {
    expect(onboardingChecklistState([1, 3]).doneCount).toBe(2);
  });

  it('all four → complete; first_post (4) is irrelevant', () => {
    expect(onboardingChecklistState(new Set([1, 2, 3, 5])).complete).toBe(true);
    expect(onboardingChecklistState(new Set([1, 2, 3, 4])).complete).toBe(false); // missing 5; 4 ignored
    expect(onboardingChecklistState(new Set([1, 2, 3, 5])).doneCount).toBe(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- onboarding`
Expected: FAIL — `onboardingChecklistState` not exported.

- [ ] **Step 3: Implement in `wrotate_test.js`**

Add (e.g. near `notificationBody`/other pure helpers):

```js
export function onboardingChecklistState(earnedRefs) {
  const has = (r) => (earnedRefs instanceof Set ? earnedRefs.has(r) : (earnedRefs || []).includes(r));
  const steps = [
    { key: 'watch',   label: 'Add your first watch',  ref: 1, done: has(1) },
    { key: 'wear',    label: 'Log a wear',            ref: 3, done: has(3) },
    { key: 'measure', label: 'Measure your accuracy', ref: 2, done: has(2) },
    { key: 'profile', label: 'Complete your profile', ref: 5, done: has(5) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: 4, complete: doneCount === 4 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- onboarding`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. (mirror-drift still green — function only in `wrotate_test.js` so far.)

- [ ] **Step 6: Commit**

```bash
git add wrotate_test.js tests/onboarding.test.js
git commit -m "feat(onboarding): onboardingChecklistState pure helper + tests"
```

---

### Task 2: Production mirror of `onboardingChecklistState`

**Files:**
- Modify: `index.html` (add identical `onboardingChecklistState`, no `export`, near the badge helpers ~`index.html:5200`)
- Modify: `tests/mirror-drift.test.js` (register in `VERBATIM`)

**Interfaces:**
- Consumes: Task 1 body (byte-identical).
- Produces: `onboardingChecklistState` in `index.html` (used by Task 4).

- [ ] **Step 1: Add the identical function to `index.html`**

Insert near the other badge/streak helpers (e.g. just before `function badgeWallProfileSection()` or near `computeStreaks`):

```js
function onboardingChecklistState(earnedRefs) {
  const has = (r) => (earnedRefs instanceof Set ? earnedRefs.has(r) : (earnedRefs || []).includes(r));
  const steps = [
    { key: 'watch',   label: 'Add your first watch',  ref: 1, done: has(1) },
    { key: 'wear',    label: 'Log a wear',            ref: 3, done: has(3) },
    { key: 'measure', label: 'Measure your accuracy', ref: 2, done: has(2) },
    { key: 'profile', label: 'Complete your profile', ref: 5, done: has(5) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: 4, complete: doneCount === 4 };
}
```

- [ ] **Step 2: Register in mirror-drift `VERBATIM`**

In `tests/mirror-drift.test.js`, add `'onboardingChecklistState'` to the `const VERBATIM = [ ... ]` array.

- [ ] **Step 3: Run mirror-drift + onboarding tests**

Run: `npm test -- mirror-drift onboarding`
Expected: PASS — mirror-drift confirms byte-identity.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/mirror-drift.test.js
git commit -m "feat(onboarding): production mirror of onboardingChecklistState (VERBATIM)"
```

---

### Task 3: Capstone badge (ref 6) + first-wear streak line

**Files:**
- Modify: `index.html` — `BADGE_REGISTRY` (after ref 5, ~`index.html:4918`); `checkAndAwardBadges` onboarding block (~`5288-5306`) + the `newlyEarned`-processing site (~`5478`)
- Modify: `tests/badges.test.js` — fixture + counts

**Interfaces:**
- Consumes: existing `BADGE_REGISTRY`, `BADGE_BY_REF`, `awardBadge`, `alreadyEarned`, `newlyEarned`, `toast`.
- Produces: badge 6 awarded on `{1,2,3,5}`; first-wear toast.

- [ ] **Step 1: Update the badge-count test (RED)**

In `tests/badges.test.js`: change the total-count assertion `expect(BADGE_REGISTRY.length).toBe(30);` → `toBe(31);`, and the onboarding-category assertion `expect(onb.length).toBe(5);` → `toBe(6);`.

Run: `npm test -- badges`
Expected: FAIL — fixture still has 30 / onboarding 5.

- [ ] **Step 2: Add the fixture entry (GREEN for counts)**

In `tests/badges.test.js`, in the `BADGE_REGISTRY` fixture, immediately after the `ref: 5` (`profile_complete`) line, add:

```js
    { ref: 6, slug: 'getting_started', name: 'Getting Started', category: 'onboarding', isHidden: false },
```

Run: `npm test -- badges`
Expected: PASS (total 31, onboarding 6).

- [ ] **Step 3: Add the production registry entry**

In `index.html`, in `BADGE_REGISTRY`, immediately after the `ref: 5` (`profile_complete`) entry block (ends `...stroke-linecap="round"/>', isHidden: false },` ~line 4918), insert:

```js
  { ref: 6, slug: 'getting_started', name: 'Getting Started', category: 'onboarding',
    flavor: "Collection, a wear, a measurement, a profile — you're all set.",
    unlock: 'Add a watch, log a wear, measure, and complete your profile.',
    glyph: '<path d="M34 51l11 11 21-25" stroke="#3D2A14" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    isHidden: false },
```

- [ ] **Step 4: Award the capstone**

In `checkAndAwardBadges`, immediately after the `profile_complete` (ref 5) award block (the `if (!alreadyEarned(5) && myProfile) { ... }` ending ~line 5306), add:

```js
  if (!alreadyEarned(6) && [1, 2, 3, 5].every(alreadyEarned)) {
    if (await awardBadge(6)) newlyEarned.push(BADGE_BY_REF[6]);
  }
```

- [ ] **Step 5: Add the first-wear streak line**

In `checkAndAwardBadges`, find the `newlyEarned`-processing block (~line 5478):

```js
  if (newlyEarned.length > 0) {
    showBadgeToast(newlyEarned);
    notifyBadgesEarned(newlyEarned);
  }
```

Append, right after it:

```js
  if (newlyEarned.some(b => b && b.ref === 3)) {
    toast('🔥 Your streak starts now — day 1');
  }
```

- [ ] **Step 6: Run badges + full suite**

Run: `npm test`
Expected: PASS (badges 31, onboarding 6; everything else green).

- [ ] **Step 7: Commit**

```bash
git add index.html tests/badges.test.js
git commit -m "feat(onboarding): Getting Started capstone badge + first-wear streak line"
```

---

### Task 4: Checklist card on the feed

**Files:**
- Modify: `index.html` — `#onboarding-checklist` container in `#page-feed` (after the feed `.page-header`, ~`index.html:2697`); `renderOnboardingChecklist()` + `toggleOnboardingCollapse()`; calls in `renderFeed()` (~`9567`) and the `nav()` feed branch (~`13431`); CSS
- Modify: `sw.js` (cache bump)

**Interfaces:**
- Consumes: `onboardingChecklistState`, `currentUser`, `_earnedBadges`, and the CTA functions (`openPhotoIdentify`, `openTrackModal`, `nav`, `openProfileModal`).

- [ ] **Step 1: Add the container to the feed page**

In `index.html`, in `#page-feed`, immediately after the feed `.page-header` closes (before `#ptr-indicator`), add:

```html
    <div id="onboarding-checklist" class="ob-wrap"></div>
```

- [ ] **Step 2: Add the render + collapse functions**

Add to `index.html` (near `renderFeed`):

```js
function renderOnboardingChecklist() {
  const el = document.getElementById('onboarding-checklist');
  if (!el) return;
  if (!currentUser) { el.innerHTML = ''; return; }
  const st = onboardingChecklistState(new Set(_earnedBadges.map(e => e.badge_ref)));
  if (st.complete) { el.innerHTML = ''; return; }
  const collapsed = localStorage.getItem('wrotate_onboarding_collapsed') === '1';
  const cta = {
    watch: 'openPhotoIdentify()',
    wear: 'openTrackModal()',
    measure: "nav(document.getElementById('nav-measure-btn'))",
    profile: 'openProfileModal()',
  };
  const rows = st.steps.map(s => s.done
    ? `<div class="ob-row ob-done"><span class="ob-check">✓</span><span>${s.label}</span></div>`
    : `<div class="ob-row ob-todo" onclick="${cta[s.key]}"><span class="ob-dot"></span><span>${s.label}</span><span class="ob-go">›</span></div>`
  ).join('');
  el.innerHTML = `
    <div class="ob-card">
      <div class="ob-head" onclick="toggleOnboardingCollapse()">
        <span class="ob-title">Getting started</span>
        <span class="ob-count">${st.doneCount}/${st.total}</span>
        <span class="ob-chevron">${collapsed ? '▸' : '▾'}</span>
      </div>
      <div class="ob-bar"><div class="ob-bar-fill" style="width:${(st.doneCount / st.total) * 100}%"></div></div>
      ${collapsed ? '' : `<div class="ob-rows">${rows}</div>`}
    </div>`;
}

function toggleOnboardingCollapse() {
  const cur = localStorage.getItem('wrotate_onboarding_collapsed') === '1';
  localStorage.setItem('wrotate_onboarding_collapsed', cur ? '0' : '1');
  renderOnboardingChecklist();
}
```

- [ ] **Step 3: Call it where the feed renders**

(a) Inside `renderFeed()` (`index.html:9567`), add `renderOnboardingChecklist();` right after the opening `const el = document.getElementById('feed-list'); if (!el) return;` guard.

(b) In `nav()` (`index.html:13417`), inside the `if (page === 'feed') { ... }` block (~`13431`), add `renderOnboardingChecklist();` after the existing `loadFeed(); loadNotifications();` lines.

- [ ] **Step 4: Add CSS**

Add to the stylesheet in `index.html` (near other card styles), using existing CSS variables:

```css
.ob-wrap { max-width: 470px; margin: 0 auto .7rem; }
.ob-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: .7rem .85rem; }
.ob-head { display: flex; align-items: center; gap: .5rem; cursor: pointer; }
.ob-title { font-weight: 700; font-size: .9rem; color: var(--text); }
.ob-count { margin-left: auto; font-size: .78rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.ob-chevron { color: var(--muted); font-size: .8rem; }
.ob-bar { height: 5px; background: var(--border); border-radius: 3px; margin: .55rem 0; overflow: hidden; }
.ob-bar-fill { height: 100%; background: var(--gold); border-radius: 3px; transition: width .3s ease; }
.ob-rows { display: flex; flex-direction: column; gap: .15rem; }
.ob-row { display: flex; align-items: center; gap: .5rem; font-size: .85rem; padding: .35rem .15rem; }
.ob-todo { cursor: pointer; color: var(--text); }
.ob-done { color: var(--muted); text-decoration: line-through; }
.ob-check { color: var(--gold); font-weight: 700; }
.ob-dot { width: 14px; height: 14px; border: 1.5px solid var(--muted); border-radius: 50%; flex-shrink: 0; }
.ob-go { margin-left: auto; color: var(--muted); }
```

- [ ] **Step 5: Bump the SW cache version**

`grep -n "wristlog-v" sw.js`, then increment the number by one in `sw.js`.

- [ ] **Step 6: Run the full unit suite (regression)**

Run: `npm test`
Expected: PASS (onboarding, mirror-drift, badges all green).

- [ ] **Step 7: Manual UAT note (controller-run)**

No automated E2E (thin render; logic unit-tested). The controller verifies on the dev server: a test account with <4 of the onboarding badges shows the card at the top of the feed with correct ✓s; tapping an incomplete row routes to that action; collapsing persists; completing the 4th step hides the card and earns the `Getting Started` badge (one batched push); logging a first wear shows the "🔥 streak starts" line. State this in the report; do not block on it.

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat(onboarding): Getting started checklist card on the feed"
```

---

## Self-Review

**Spec coverage:**
- `onboardingChecklistState` (steps/refs/progress/complete) → Task 1. ✅
- Production mirror + VERBATIM → Task 2. ✅
- Capstone badge ref 6 awarded on `{1,2,3,5}`, reuses `badge_earned` → Task 3. ✅
- First-wear "streak started" line → Task 3 Step 5. ✅
- Feed-top card, own-user only, <4 progress, collapsible (localStorage), not dismissible, auto-hide at 4/4 → Task 4. ✅
- CTAs route to add-watch/log/measure/profile → Task 4 Step 2. ✅
- No backend/schema/edge change; reaches web users (in-app) → respected. ✅
- SW bump + tests → Task 4 Step 5/6, Task 1-3. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; E2E omission is explicit (Task 4 Step 7). ✅

**Type/name consistency:** `onboardingChecklistState(earnedRefs) → {steps,doneCount,total,complete}` identical in Tasks 1/2/4. Step keys `watch/wear/measure/profile` ↔ refs `1/3/2/5` consistent (Task 1, Task 4 `cta` map). Capstone ref `6`/`getting_started`/`onboarding` consistent across Task 3 registry entry, award `[1,2,3,5].every`, and fixture. Counts: total 30→31, onboarding 5→6 (Task 3). `_earnedBadges` items use `.badge_ref` (Task 4) and `BADGE_BY_REF[n]` items use `.ref` (Task 3 first-wear check) — matches the existing codebase. ✅
