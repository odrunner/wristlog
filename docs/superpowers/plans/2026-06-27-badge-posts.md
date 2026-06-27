# Badge Achievement Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-surface notable earned badges in the feed — inline on the post/log that earned them, or as a standalone badge card otherwise. Creation behind the `badge_posts` flag; rendering live for all.

**Architecture:** A pure `badgePostPlan(newlyEarned, context, postId)` decides inline vs standalone vs nothing. `checkAndAwardBadges(context, postId)` acts on it (flag-gated): inline = set `logs.badge_refs` on the triggering row; standalone = insert a `use_case:'badge'` row. `renderFeedCard` renders a badge medallion card (standalone) or a "Earned: X" ribbon (inline) — reusing `badgeMedallionSvg`. Two nullable DB columns.

**Tech Stack:** Vanilla JS (single-file index.html), vitest, mirror-drift, Supabase.

**Spec:** `docs/superpowers/specs/2026-06-27-badge-posts-design.md`

## Global Constraints

- **Creation** is gated by `featureFlag('badge_posts')` (default off) **and** `myProfile.share_achievements !== false`. **Rendering is NOT gated** (a founder-created badge post must render in everyone's feed).
- **Notable** = `b.category !== 'onboarding' && !b.isHidden`.
- `badgePostPlan` byte-identical in `index.html` + `wrotate_test.js`, in `VERBATIM`.
- Badge posts use `getDefaultVis()`. `use_case:'badge'`, `watch_id:null`, `notes` fallback `"Earned the <name> badge 🏅"`.
- **SQL applied BEFORE the client is merged** (feed/profile selects reference the new columns). `npm test` green. SW bump. Pre-commit bumps `APP_VERSION`.
- Do NOT change badge *awarding* (`awardBadge`, the badge milestone computation) or the existing `badges.test.js`.

---

### Task 1: SQL — `logs.badge_refs` + `profiles.share_achievements`

**Files:** Create `sql/2026-06-27-badge-posts.sql`

- [ ] **Step 1: Write the SQL file**

```sql
-- Badge achievement posts: which badges a feed row carries, and the per-user opt-out.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS badge_refs jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS share_achievements boolean NOT NULL DEFAULT true;
```

- [ ] **Step 2: Commit**

```bash
git add sql/2026-06-27-badge-posts.sql
git commit -m "feat(badge-posts): SQL for logs.badge_refs + profiles.share_achievements"
```

(Apply is gated — see end. No local DB.)

---

### Task 2: `badgePostPlan` pure helper + tests + mirror

**Files:** Modify `wrotate_test.js`, `index.html`; Create `tests/badge-posts.test.js`; Modify `tests/mirror-drift.test.js:41`

**Interfaces:** Produces `badgePostPlan(newlyEarned, context, postId) → { inline: number[], standalone: number[] }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/badge-posts.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { badgePostPlan } from '../wrotate_test.js';

const B = (ref, category, isHidden = false) => ({ ref, category, isHidden, name: 'X', flavor: 'y' });

describe('badgePostPlan', () => {
  it('excludes onboarding and hidden badges', () => {
    const r = badgePostPlan([B(1, 'onboarding'), B(2, 'habit'), B(3, 'collection', true)], 'watch', null);
    expect(r.standalone).toEqual([2]); expect(r.inline).toEqual([]);
  });
  it('retroactive context → nothing', () => {
    expect(badgePostPlan([B(2, 'habit')], 'retroactive', null)).toEqual({ inline: [], standalone: [] });
  });
  it('with postId → inline', () => {
    expect(badgePostPlan([B(2, 'habit'), B(4, 'timegrapher')], 'wear', 'log-1'))
      .toEqual({ inline: [2, 4], standalone: [] });
  });
  it('without postId → standalone', () => {
    expect(badgePostPlan([B(2, 'habit')], 'watch', null)).toEqual({ inline: [], standalone: [2] });
  });
  it('no notable badges → empty', () => {
    expect(badgePostPlan([B(1, 'onboarding')], 'wear', 'log-1')).toEqual({ inline: [], standalone: [] });
  });
  it('empty / null input → empty', () => {
    expect(badgePostPlan([], 'wear', 'log-1')).toEqual({ inline: [], standalone: [] });
    expect(badgePostPlan(null, 'watch', null)).toEqual({ inline: [], standalone: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- badge-posts` → FAIL (not exported).

- [ ] **Step 3: Implement in `wrotate_test.js`** (anywhere among the exports):

```js
export function badgePostPlan(newlyEarned, context, postId) {
  const notable = (newlyEarned || []).filter(b => b && b.category !== 'onboarding' && !b.isHidden).map(b => b.ref);
  if (!notable.length || context === 'retroactive') return { inline: [], standalone: [] };
  if (postId) return { inline: notable, standalone: [] };
  return { inline: [], standalone: notable };
}
```

- [ ] **Step 4: Mirror in `index.html`** — same function, bare `function` (no `export`), near the badge helpers (e.g. after `badgeMedallionSvg` ~index.html:5168):

```js
function badgePostPlan(newlyEarned, context, postId) {
  const notable = (newlyEarned || []).filter(b => b && b.category !== 'onboarding' && !b.isHidden).map(b => b.ref);
  if (!notable.length || context === 'retroactive') return { inline: [], standalone: [] };
  if (postId) return { inline: notable, standalone: [] };
  return { inline: [], standalone: notable };
}
```

- [ ] **Step 5: Register in VERBATIM** — append `'badgePostPlan'` to `tests/mirror-drift.test.js:41`.

- [ ] **Step 6: Run** — `npm test -- badge-posts mirror-drift` → PASS.

- [ ] **Step 7: Commit**

```bash
git add wrotate_test.js index.html tests/badge-posts.test.js tests/mirror-drift.test.js
git commit -m "feat(badge-posts): badgePostPlan pure helper + tests + mirror"
```

---

### Task 3: Creation path (flag, attach/standalone, checkAndAwardBadges integration)

**Files:** Modify `index.html` (`badge_posts` flag ~`FEATURE_FLAGS`; `FEED_LOG_COLS` ~9539; `checkAndAwardBadges` signature + tail ~5700s; `saveLog` ~14937; `saveNewPost` ~11399; add the two creation fns)

**Interfaces:** Consumes `badgePostPlan`, `BADGE_BY_REF`, `getDefaultVis`, `todayStr`, `uid`, `db`, `logs`, `myProfile`, `featureFlag`.

- [ ] **Step 1: Add the flag** — in `FEATURE_FLAGS` add: `badge_posts: { label: 'Badge achievement posts (admin)', default: false },`

- [ ] **Step 2: Add `badge_refs` to the feed select** — `FEED_LOG_COLS` (~index.html:9539): append `, badge_refs` to the column string.

- [ ] **Step 3: Add the creation functions** (near `badgePostPlan`):

```js
async function attachBadgesToPost(postId, refs) {
  if (!postId || !refs || !refs.length) return;
  const local = logs.find(l => l.id === postId);
  if (local) local.badgeRefs = refs;
  try { await db.from('logs').update({ badge_refs: refs }).eq('id', postId); }
  catch (e) { console.warn('[badge-post] attach failed:', e); }
  feedLoadedAt = 0;
  if (document.getElementById('page-feed')?.classList.contains('active')) loadFeed();
}

async function createStandaloneBadgePost(ref) {
  const b = BADGE_BY_REF[ref];
  if (!b || !currentUser) return;
  try {
    await db.from('logs').insert({
      id: uid(), user_id: currentUser.id, watch_id: null, date: todayStr(),
      use_case: 'badge', notes: `Earned the ${b.name} badge 🏅`, photo_url: null,
      visibility: getDefaultVis(), location: null, club_id: null, badge_refs: [ref],
    });
  } catch (e) { console.warn('[badge-post] standalone failed:', e); return; }
  feedLoadedAt = 0;
  if (document.getElementById('page-feed')?.classList.contains('active')) loadFeed();
}
```

- [ ] **Step 4: Wire into `checkAndAwardBadges`** — change its signature to accept a second arg and act on the plan.
  (a) Signature: `async function checkAndAwardBadges(context, postId) {` (find the declaration; add `, postId`).
  (b) At the tail, right after the existing `if (newlyEarned.length > 0) { showBadgeToast(...); notifyBadgesEarned(...); }` block, add:

```js
  if (newlyEarned.length > 0 && featureFlag('badge_posts') && myProfile && myProfile.share_achievements !== false) {
    const _bp = badgePostPlan(newlyEarned, context, postId);
    if (_bp.inline.length) attachBadgesToPost(postId, _bp.inline);
    for (const _ref of _bp.standalone) createStandaloneBadgePost(_ref);
  }
```

- [ ] **Step 5: Pass the post id from the two post-creating callers**
  - `saveLog` (~14937): `checkAndAwardBadges('wear');` → `checkAndAwardBadges('wear', logEntry.id);`
  - `saveNewPost` (~11399): `checkAndAwardBadges('post');` → `checkAndAwardBadges('post', entry.id);`
  (Leave the other 5 callers — retroactive/profile/watch/measurement — unchanged; `postId` is `undefined` for them.)

- [ ] **Step 6: Type/regression check** — `npm test` → PASS (no unit test exercises these, but confirm nothing broke + mirror still green).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(badge-posts): creation path (flag, attach inline / standalone) behind badge_posts"
```

---

### Task 4: Rendering (badge card + inline ribbon) + setting toggle

**Files:** Modify `index.html` (`renderFeedCard` hero ~9940 + card assembly ~10181; CSS ~feed styles; the notif prefs `notifHtml` ~7169; add `saveShareAchievements`); `sw.js`

**Interfaces:** Consumes `badgeMedallionSvg`, `BADGE_BY_REF`, `openBadgeDetail`, `escHtml`, `featureFlag`, `db`.

- [ ] **Step 1: Standalone badge hero** — in `renderFeedCard`, make the badge hero the FIRST branch of the hero decision. Just before `let heroHtml = '';` … `if (item.photo_url) {`, change to:

```js
  let heroHtml = '';
  if (item.use_case === 'badge' && Array.isArray(item.badge_refs) && item.badge_refs.length) {
    const _b = BADGE_BY_REF[Number(item.badge_refs[0])];
    if (_b) heroHtml = `<div class="feed-badge-hero" onclick="openBadgeDetail(${_b.ref})">`
      + badgeMedallionSvg(_b, 72, true)
      + `<div class="feed-badge-name">${escHtml(_b.name)}</div>`
      + `<div class="feed-badge-flavor">${escHtml(_b.flavor || '')}</div>`
      + `<div class="feed-badge-tag">🏅 Badge</div></div>`;
  } else if (item.photo_url) {
```
(Keep the rest of the existing `else if` chain intact.)

- [ ] **Step 2: Inline ribbon** — just before the `return \`` that assembles the card (~10160), compute:

```js
  let badgeRibbon = '';
  if (item.use_case !== 'badge' && Array.isArray(item.badge_refs) && item.badge_refs.length) {
    badgeRibbon = item.badge_refs.map(r => {
      const _rb = BADGE_BY_REF[Number(r)];
      return _rb ? `<div class="feed-badge-ribbon" onclick="openBadgeDetail(${_rb.ref})">`
        + badgeMedallionSvg(_rb, 22, true) + `<span>Earned: ${escHtml(_rb.name)}</span></div>` : '';
    }).join('');
  }
```
Then insert `${badgeRibbon}` in the card template between `${heroHtml}` and the `<div class="feed-actions">` line.

- [ ] **Step 3: CSS** — near the feed-card styles:

```css
    .feed-badge-hero { display:flex; flex-direction:column; align-items:center; gap:.3rem; padding:1.1rem 1rem; cursor:pointer; }
    .feed-badge-name { font-weight:700; font-size:1rem; color:var(--text); }
    .feed-badge-flavor { font-size:.82rem; color:var(--muted); text-align:center; line-height:1.4; max-width:34ch; }
    .feed-badge-tag { font-size:.68rem; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--muted); margin-top:.15rem; }
    .feed-badge-ribbon { display:inline-flex; align-items:center; gap:.4rem; margin:.1rem 1rem .5rem; padding:.3rem .6rem; background:var(--surface2); border-radius:999px; font-size:.8rem; font-weight:600; color:var(--text); cursor:pointer; }
```

- [ ] **Step 4: Setting toggle (flag-gated)** — in the `notifHtml` builder (~7169), after the "Daily reminders" toggle row, before the closing of `prof-section-body`, add:

```js
          ${featureFlag('badge_posts') ? `
          <div style="font-size:.75rem;color:var(--muted);margin:.8rem 0 .6rem;border-top:1px solid var(--border);padding-top:.8rem;">Sharing</div>
          <div class="toggle-row">
            <span class="toggle-label">Share achievements to feed</span>
            <label class="toggle-switch">
              <input type="checkbox" ${profile.share_achievements !== false ? 'checked' : ''} onchange="saveShareAchievements(this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>` : ''}
```

- [ ] **Step 5: `saveShareAchievements`** — add near `saveEmailPref`:

```js
async function saveShareAchievements(enabled) {
  if (demoGuard()) return;
  if (!currentUser) return;
  const { error } = await db.from('profiles').update({ share_achievements: enabled }).eq('id', currentUser.id);
  if (!error && window.myProfile) window.myProfile.share_achievements = enabled;
  if (error) toast('Could not save — ' + error.message, 'error');
}
```

- [ ] **Step 6: SW bump** — increment `wristlog-vNN` in `sw.js`.

- [ ] **Step 7: Run** — `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat(badge-posts): feed badge card + inline ribbon + share-achievements toggle"
```

---

## Gated production steps (human-run, after merge)

- [ ] **G1: Apply the SQL** (`sql/2026-06-27-badge-posts.sql`) via `npx supabase db query --linked --file` — **before** merging/deploying the client (the feed/profile selects reference `badge_refs`/`share_achievements`).
- [ ] **G2: Merge + push** the client (creation behind `badge_posts` flag off; rendering live but inert).
- [ ] **G3:** Founder toggles `badge_posts` on (admin Dev tab) and UATs across both test accounts: notable badge via wear-log → inline ribbon; via add-watch → standalone card; onboarding badge → nothing; retroactive → nothing; setting off → nothing; like/comment a badge post from account 2; delete a badge post.
- [ ] **G4:** On approval, **remove the `badge_posts` flag** (entry + the `featureFlag('badge_posts')` guards in `checkAndAwardBadges` and the setting toggle) so creation runs for everyone with `share_achievements`.

## Self-Review

**Spec coverage:** schema (T1) ✅; notable filter + inline/standalone/retroactive decision (T2 `badgePostPlan`) ✅; flag-gated creation + attach/standalone + 2 callers pass id (T3) ✅; feed select badge_refs (T3) ✅; standalone badge card + inline ribbon rendering, not gated (T4) ✅; setting toggle flag-gated + persistence (T4) ✅; SW bump (T4) ✅; apply-SQL-before-merge ordering (gated section) ✅.

**Placeholder scan:** all code shown; insertion points named with search hints. ✅

**Type/name consistency:** `badgePostPlan` returns `{inline,standalone}` (arrays of refs) — consumed in T3. `badge_refs` column + `item.badge_refs` render + `FEED_LOG_COLS` add are consistent. `share_achievements` column + `myProfile.share_achievements` check + toggle + `saveShareAchievements` consistent. `badge_posts` flag name consistent across `FEATURE_FLAGS`, creation guard, toggle gate, gated removal. `checkAndAwardBadges(context, postId)` — only saveLog/saveNewPost pass postId; other callers pass one arg (postId `undefined`). `badgeMedallionSvg(b, size, true)` signature matches index.html:5153. ✅
