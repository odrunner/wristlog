# Featured Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin spotlight one public post at the top of everyone's main feed for 24h, with a FIFO queue that auto-rotates.

**Architecture:** A `featured_posts` queue table holds one `active` row + `queued` rows. Rotation is computed lazily on read inside a SECURITY DEFINER RPC (`featured_current`) — expire the stale/ineligible active row, promote the oldest eligible queued one with a fresh 24h clock. The client kebab menu gains an admin-only "Feature this post" item; `loadFeed` pins the active post to the top; the admin portal gets a "Featured" tab to view/remove queue entries.

**Tech Stack:** Vanilla JS (no frameworks), Supabase (Postgres + RLS + RPCs), vitest (unit), Playwright (E2E mocked).

## Global Constraints

- Product name is **WRotate** (never WristLog except the SW cache string). Copy verbatim.
- Vanilla JS only — no frameworks. No `confirm()`/`alert()` — use inline toast UIs.
- Bump `sw.js` `CACHE = 'wristlog-vNN'` on every HTML/JS change (currently `wristlog-v828`).
- Admin gate (client): `_isDevUser()` → `currentUser?.id === ADMIN_USER_ID` ([index.html:5023-5024](index.html#L5023-L5024)).
- Admin gate (server): `IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN RAISE EXCEPTION 'Not authorized'; END IF;`
- RPCs deploy via `npx supabase db query --linked` (migration push doesn't work — remote-only migrations). SQL source file is the record.
- Run `npm test` before every commit. Full pre-push check: `npm test && npm run test:e2e`.
- Posts live in the `logs` table. Eligible = `visibility='public'` AND `moderation_status` not `'removed'`.

---

### Task 1: Database — `featured_posts` table + rotation RPCs

**Files:**
- Create: `sql/2026-06-27-featured-post.sql` (source of record)
- Deploy: via `npx supabase db query --linked --file sql/2026-06-27-featured-post.sql`

**Interfaces:**
- Produces (callable from client via `db.rpc(...)`):
  - `featured_current()` → `uuid` (active featured `log_id`, or `null`). EXECUTE to `authenticated`.
  - `admin_feature_post(p_log_id uuid)` → void. Admin-guarded.
  - `admin_unfeature(p_id uuid)` → void. Admin-guarded.
  - `admin_featured_queue()` → table `(id, log_id, status, activated_at, expires_at, enqueued_at, notes, photo_url, user_id, display_name, username)`. Admin-guarded.

- [ ] **Step 1: Write the SQL file**

Create `sql/2026-06-27-featured-post.sql` with exactly:

```sql
-- Featured post: single active slot + FIFO queue, 24h lazy rotation (no cron).
-- Spec: docs/superpowers/specs/2026-06-27-featured-post-design.md
-- Deployed via `npx supabase db query --linked`; this file is the record.

CREATE TABLE IF NOT EXISTS public.featured_posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id       uuid NOT NULL REFERENCES public.logs(id) ON DELETE CASCADE,
  enqueued_by  uuid REFERENCES auth.users(id),
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at   timestamptz,
  status       text NOT NULL DEFAULT 'queued'  -- queued | active | expired
);

-- A given post can appear at most once while still queued/active.
CREATE UNIQUE INDEX IF NOT EXISTS featured_posts_one_per_log
  ON public.featured_posts(log_id)
  WHERE status IN ('queued','active');

ALTER TABLE public.featured_posts ENABLE ROW LEVEL SECURITY;
-- No RLS policies: all access via the SECURITY DEFINER RPCs below (which bypass RLS).

-- ── Internal rotation: expire stale/ineligible active, promote next eligible queued ──
CREATE OR REPLACE FUNCTION public.featured_rotate()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_next uuid;
BEGIN
  -- Serialize concurrent rotations (every feed load calls this) so we never double-promote.
  PERFORM pg_advisory_xact_lock(hashtext('featured_rotate'));

  -- 1. Expire active rows past expiry or whose post is no longer eligible.
  UPDATE featured_posts fp SET status = 'expired'
  WHERE fp.status = 'active'
    AND (
      fp.expires_at <= now()
      OR NOT EXISTS (
        SELECT 1 FROM logs l
        WHERE l.id = fp.log_id
          AND l.visibility = 'public'
          AND (l.moderation_status IS NULL OR l.moderation_status <> 'removed')
      )
    );

  -- 2. Expire queued rows whose post is no longer eligible (hard-deleted handled by cascade).
  UPDATE featured_posts fp SET status = 'expired'
  WHERE fp.status = 'queued'
    AND NOT EXISTS (
      SELECT 1 FROM logs l
      WHERE l.id = fp.log_id
        AND l.visibility = 'public'
        AND (l.moderation_status IS NULL OR l.moderation_status <> 'removed')
    );

  -- 3. If nothing active, promote the oldest eligible queued row with a fresh 24h clock.
  IF NOT EXISTS (SELECT 1 FROM featured_posts WHERE status = 'active') THEN
    SELECT fp.id INTO v_next
    FROM featured_posts fp
    WHERE fp.status = 'queued'
    ORDER BY fp.enqueued_at ASC
    LIMIT 1;
    IF v_next IS NOT NULL THEN
      UPDATE featured_posts
      SET status = 'active', activated_at = now(), expires_at = now() + interval '24 hours'
      WHERE id = v_next;
    END IF;
  END IF;
END;
$f$;

-- ── Public read: rotate, then return the active featured log_id (or null) ──
CREATE OR REPLACE FUNCTION public.featured_current()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_log uuid;
BEGIN
  PERFORM featured_rotate();
  SELECT log_id INTO v_log FROM featured_posts WHERE status = 'active' LIMIT 1;
  RETURN v_log;
END;
$f$;

-- ── Admin: feature a post (append to FIFO queue; lazy promote if slot empty) ──
CREATE OR REPLACE FUNCTION public.admin_feature_post(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM logs WHERE id = p_log_id
      AND visibility = 'public'
      AND (moderation_status IS NULL OR moderation_status <> 'removed')
  ) THEN
    RAISE EXCEPTION 'Post is not eligible to be featured (must be a public, non-removed post)';
  END IF;
  IF EXISTS (SELECT 1 FROM featured_posts WHERE log_id = p_log_id AND status IN ('queued','active')) THEN
    RAISE EXCEPTION 'Post is already featured or queued';
  END IF;
  INSERT INTO featured_posts(log_id, enqueued_by) VALUES (p_log_id, auth.uid());
  PERFORM featured_rotate();
END;
$f$;

-- ── Admin: remove a queued/active entry (next read promotes successor) ──
CREATE OR REPLACE FUNCTION public.admin_unfeature(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM featured_posts WHERE id = p_id;
  PERFORM featured_rotate();
END;
$f$;

-- ── Admin: current active + queued, with post fields for display ──
CREATE OR REPLACE FUNCTION public.admin_featured_queue()
RETURNS TABLE(
  id uuid, log_id uuid, status text, activated_at timestamptz, expires_at timestamptz,
  enqueued_at timestamptz, notes text, photo_url text, user_id uuid,
  display_name text, username text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  PERFORM featured_rotate();
  RETURN QUERY
  SELECT fp.id, fp.log_id, fp.status, fp.activated_at, fp.expires_at, fp.enqueued_at,
         l.notes, l.photo_url, l.user_id, pr.display_name, pr.username
  FROM featured_posts fp
  JOIN logs l ON l.id = fp.log_id
  LEFT JOIN profiles pr ON pr.id = l.user_id
  WHERE fp.status IN ('queued','active')
  ORDER BY (fp.status = 'active') DESC, fp.enqueued_at ASC;
END;
$f$;

-- ── Grants: lock down, expose only what the client needs to authenticated ──
REVOKE EXECUTE ON FUNCTION public.featured_rotate()          FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_feature_post(uuid)   FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_unfeature(uuid)      FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_featured_queue()     FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.featured_current()         FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.featured_current()         TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_feature_post(uuid)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_unfeature(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_featured_queue()     TO authenticated;
```

- [ ] **Step 2: Deploy the SQL**

Run: `npx supabase db query --linked --file sql/2026-06-27-featured-post.sql`
Expected: no errors (CREATE TABLE / CREATE FUNCTION / GRANT succeed).

- [ ] **Step 3: Verify rotation decision-table via db query (manual UAT)**

Pick two real public log ids (`A`, `B`) and the admin uuid `d70b1a85-4f31-4431-b3b7-db76543daaf5`. Run each and confirm:

```sql
-- simulate admin auth
SELECT set_config('request.jwt.claims', '{"sub":"d70b1a85-4f31-4431-b3b7-db76543daaf5"}', true);

-- feature A then B
SELECT admin_feature_post('A');
SELECT admin_feature_post('B');
-- A is active, B queued:
SELECT log_id, status, expires_at FROM featured_posts ORDER BY enqueued_at;   -- A=active, B=queued
SELECT featured_current();                                                    -- = A

-- force A expired → next read promotes B
UPDATE featured_posts SET expires_at = now() - interval '1 minute' WHERE log_id='A' AND status='active';
SELECT featured_current();                                                    -- = B

-- empty queue → null
SELECT admin_unfeature(id) FROM featured_posts WHERE status='active';
SELECT featured_current();                                                    -- = null

-- double-feature blocked
SELECT admin_feature_post('A'); SELECT admin_feature_post('A');               -- 2nd raises 'already featured or queued'

-- non-admin blocked
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true);
SELECT admin_feature_post('A');                                              -- raises 'Not authorized'

-- cleanup
SELECT set_config('request.jwt.claims', '{"sub":"d70b1a85-4f31-4431-b3b7-db76543daaf5"}', true);
DELETE FROM featured_posts;
```
Expected: each comment's stated result holds.

- [ ] **Step 4: Commit**

```bash
git add sql/2026-06-27-featured-post.sql
git commit -m "feat(featured): featured_posts table + rotation/admin RPCs"
```

---

### Task 2: Pure helper `pinFeatured` + unit tests

**Files:**
- Modify: `wrotate_test.js` (add exported `pinFeatured`)
- Modify: `index.html` (add identical non-exported `pinFeatured` near other feed helpers, ~[index.html:9718](index.html#L9718))
- Test: `tests/featured-post.test.js`

**Interfaces:**
- Produces: `pinFeatured(rawLogs, featuredId, featuredLog)` → new array. If `featuredId` falsy, returns a shallow copy of `rawLogs`. Otherwise removes any item whose `id === featuredId` from the list, finds the pin (from `rawLogs` first, else `featuredLog`), and if found returns `[{...pin, __featured:true}, ...rest]`; if not found returns `rest`.

- [ ] **Step 1: Write the failing test**

Create `tests/featured-post.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { pinFeatured } from '../wrotate_test.js';

const L = (id) => ({ id, notes: 'n' + id });

describe('pinFeatured', () => {
  it('returns a copy unchanged when no featured id', () => {
    const logs = [L('a'), L('b')];
    const r = pinFeatured(logs, null, null);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
    expect(r).not.toBe(logs);
    expect(r.some(x => x.__featured)).toBe(false);
  });

  it('moves an in-list featured post to the front, marked, no duplicate', () => {
    const r = pinFeatured([L('a'), L('b'), L('c')], 'c', null);
    expect(r.map(x => x.id)).toEqual(['c', 'a', 'b']);
    expect(r[0].__featured).toBe(true);
    expect(r.filter(x => x.id === 'c')).toHaveLength(1);
  });

  it('prepends a featured post not present in the list (older than first page)', () => {
    const r = pinFeatured([L('a'), L('b')], 'z', L('z'));
    expect(r.map(x => x.id)).toEqual(['z', 'a', 'b']);
    expect(r[0].__featured).toBe(true);
  });

  it('returns the list without pin when featured post cannot be found anywhere', () => {
    const r = pinFeatured([L('a'), L('b')], 'z', null);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.some(x => x.__featured)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- featured-post`
Expected: FAIL — `pinFeatured` is not exported.

- [ ] **Step 3: Implement in `wrotate_test.js`**

Append near the other feed helpers:

```js
export function pinFeatured(rawLogs, featuredId, featuredLog) {
  if (!featuredId) return rawLogs.slice();
  const rest = rawLogs.filter(l => l.id !== featuredId);
  const pin = rawLogs.find(l => l.id === featuredId) || featuredLog;
  if (!pin) return rest;
  return [{ ...pin, __featured: true }, ...rest];
}
```

- [ ] **Step 4: Mirror into `index.html`** (non-exported, identical body) just above `async function loadFeed()`:

```js
function pinFeatured(rawLogs, featuredId, featuredLog) {
  if (!featuredId) return rawLogs.slice();
  const rest = rawLogs.filter(l => l.id !== featuredId);
  const pin = rawLogs.find(l => l.id === featuredId) || featuredLog;
  if (!pin) return rest;
  return [{ ...pin, __featured: true }, ...rest];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- featured-post`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add wrotate_test.js index.html tests/featured-post.test.js
git commit -m "feat(featured): pinFeatured helper + unit tests"
```

---

### Task 3: Kebab menu admin item + `featurePost()` handler

**Files:**
- Modify: `index.html` kebab menu in `renderFeedCard` ([index.html:10361-10373](index.html#L10361-L10373))
- Modify: `index.html` add `featurePost(logId)` near `toggleFeedMenu` ([index.html:10398](index.html#L10398))

**Interfaces:**
- Consumes: `_isDevUser()`, `vis` (post visibility, in scope in `renderFeedCard`), `db.rpc`, existing toast helper.
- Produces: `featurePost(logId)` — calls `admin_feature_post`, shows a toast.

- [ ] **Step 1: Add the admin-only menu item to BOTH branches**

In the `isMe` branch menu (after the "Report a comment" item, before `</div>`) and in the non-owner branch menu (after "Block user", before `</div>`), add the SAME line:

```js
${_isDevUser() && vis === 'public' ? `<div class="feed-menu-item" onclick="featurePost('${item.id}');closeFeedMenu('${item.id}')">★ Feature this post</div>` : ''}
```

- [ ] **Step 2: Add the handler** near `toggleFeedMenu` (~[index.html:10398](index.html#L10398)):

```js
async function featurePost(logId) {
  try {
    const { error } = await db.rpc('admin_feature_post', { p_log_id: logId });
    if (error) throw error;
    showToast('★ Featured — pinned to the top for 24h (or queued behind the current one)');
    loadFeed(true);
  } catch (e) {
    showToast(e?.message || 'Could not feature this post', true);
  }
}
```

(If the toast helper has a different name/signature, match the existing one used elsewhere in the file — grep `showToast` / the project's toast function and adapt. Do NOT use `alert()`.)

- [ ] **Step 3: Verify the toast helper name**

Run: `grep -n "function showToast\|showToast(" index.html | head`
Expected: confirm the real signature; adjust Step 2 if needed before committing.

- [ ] **Step 4: Manual smoke (admin account, local dev)**

On http://192.168.1.246:3000 signed in as the admin account: open the kebab on a public post → "★ Feature this post" appears; on a non-public post it does NOT; as a non-admin (test account) it never appears. Clicking it shows the toast.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(featured): admin-only 'Feature this post' kebab item + handler"
```

---

### Task 4: Feed pinning in `loadFeed` + "★ Featured" pill in `renderFeedCard`

**Files:**
- Modify: `index.html` `loadFeed` Phase 1, after the visibility filter (~[index.html:9838](index.html#L9838)) and Phase 2 id-lists (~[index.html:9853](index.html#L9853))
- Modify: `index.html` `renderFeedCard` header, near `visBadge` (~[index.html:10390](index.html#L10390))

**Interfaces:**
- Consumes: `pinFeatured` (Task 2), `db.rpc('featured_current')`, `FEED_LOG_COLS`, `withTimeout`.
- Produces: feed items may carry `__featured: true`; the pill renders when set.

- [ ] **Step 1: Pin the featured post in Phase 1**

Immediately AFTER the `rawLogs = rawLogs.filter(...)` visibility gate block ([index.html:9827-9838](index.html#L9827-L9838)) and BEFORE `const logIds = rawLogs.map(...)`, insert:

```js
    // ── Featured post: pin the active featured log to the top (admin spotlight) ──
    try {
      const fc = await withTimeout(db.rpc('featured_current'), 4000);
      const featuredId = fc?.data || null;
      if (featuredId) {
        let featuredLog = rawLogs.find(l => l.id === featuredId) || null;
        if (!featuredLog) {
          const fr = await withTimeout(
            db.from('logs').select(FEED_LOG_COLS)
              .eq('id', featuredId).eq('visibility', 'public').maybeSingle(), 4000);
          featuredLog = fr?.data || null;
        }
        rawLogs = pinFeatured(rawLogs, featuredId, featuredLog);
      }
    } catch (e) { /* featured is non-critical; feed renders normally */ }
```

- [ ] **Step 2: Ensure Phase 2 enriches the pinned post**

The Phase 2 `watchIds`/`userIds` are derived from `rawLogs` ([index.html:9853-9854](index.html#L9853-L9854)), so a pinned post added to `rawLogs` is already covered. Verify no separate id list excludes it. No code change expected; confirm by reading the lines.

- [ ] **Step 3: Render the pill in `renderFeedCard`**

Add a `featuredPill` const near where `visBadge` is built, and include it in the header body. Minimal, reuses inline styling:

```js
const featuredPill = item.__featured
  ? `<span class="feat-pill" style="display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:600;color:#b8860b;background:rgba(184,134,11,.12);border-radius:999px;padding:.1rem .45rem;margin-left:.4rem;">★ Featured</span>`
  : '';
```

Insert `${featuredPill}` into the header next to the display name (within `headerBody`, or right after the name span in the `.feed-card-header`). Choose the existing name element and append the pill so it sits inline with the author line.

- [ ] **Step 4: Run unit + mocked E2E to confirm no regression**

Run: `npm test && npm run test:e2e`
Expected: all pass (existing feed tests still green; pill code is inert when `__featured` is unset).

- [ ] **Step 5: Manual smoke (admin account)**

Feature a public post → reload feed → it appears at the very top with the "★ Featured" pill, exactly once (not duplicated lower down).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(featured): pin active featured post atop feed + pill"
```

---

### Task 5: Admin portal "Featured" tab

**Files:**
- Modify: `index.html` admin tab bar ([index.html:2825-2833](index.html#L2825-L2833)) — add tab button
- Modify: `index.html` — add `admin-tab-featured` panel div near the other `admin-tab-*` divs ([index.html:2837-3036](index.html#L2837-L3036))
- Modify: `index.html` `switchAdminTab` ([index.html:13067](index.html#L13067)) and `showAdminPage` ([index.html:13030](index.html#L13030))
- Add: `loadAdminFeatured()` render function near the other `loadAdmin*` functions

**Interfaces:**
- Consumes: `db.rpc('admin_featured_queue')`, `db.rpc('admin_unfeature', { p_id })`, existing admin tab machinery.
- Produces: `loadAdminFeatured()`.

- [ ] **Step 1: Add the tab button** in the admin tab bar, after the existing buttons:

```html
<button class="admin-tab-btn" onclick="switchAdminTab('featured')">Featured</button>
```

(Match the exact class/markup the sibling tab buttons use — read [index.html:2826-2833](index.html#L2826-L2833) and copy the pattern.)

- [ ] **Step 2: Add the panel div** alongside the other `admin-tab-*` divs:

```html
<div id="admin-tab-featured" class="admin-tab" style="display:none;">
  <div id="admin-featured-list">Loading…</div>
</div>
```

- [ ] **Step 3: Wire `switchAdminTab`** — ensure switching to `'featured'` shows `#admin-tab-featured` and calls `loadAdminFeatured()`. Follow the existing switch structure (it toggles `display` on `admin-tab-*` and calls the matching loader). Add the `featured` case/branch.

- [ ] **Step 4: Add `loadAdminFeatured()`** near the other admin loaders:

```js
async function loadAdminFeatured() {
  if (currentUser?.id !== ADMIN_USER_ID) return;
  const el = document.getElementById('admin-featured-list');
  if (!el) return;
  el.innerHTML = 'Loading…';
  const { data, error } = await db.rpc('admin_featured_queue');
  if (error) { el.innerHTML = `<div style="color:var(--danger);">${error.message}</div>`; return; }
  const rows = data || [];
  if (!rows.length) { el.innerHTML = '<div style="opacity:.7;">No featured posts. Use a post’s ★ menu to feature one.</div>'; return; }
  el.innerHTML = rows.map(r => {
    const who = r.display_name || r.username || 'Unknown';
    const txt = (r.notes || '').slice(0, 80);
    const badge = r.status === 'active'
      ? `<span style="color:#b8860b;font-weight:600;">★ Active</span>` + (r.expires_at ? ` · expires ${new Date(r.expires_at).toLocaleString()}` : '')
      : `<span style="opacity:.7;">Queued</span>`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border);">
      <div style="min-width:0;"><div style="font-size:.85rem;">${badge}</div>
        <div style="font-size:.8rem;opacity:.85;">${who}: ${txt}</div></div>
      <button class="admin-tab-btn" onclick="unfeatureAdmin('${r.id}')">Remove</button>
    </div>`;
  }).join('');
}

async function unfeatureAdmin(id) {
  const { error } = await db.rpc('admin_unfeature', { p_id: id });
  if (error) { showToast(error.message, true); return; }
  showToast('Removed from featured');
  loadAdminFeatured();
}
```

(Adapt `showToast`, `var(--danger)`, `var(--border)`, and `.admin-tab-btn` to the real names used in the file.)

- [ ] **Step 5: Initialize in `showAdminPage`** — add a `loadAdminFeatured()` call alongside the other initial loaders (or rely on lazy load via `switchAdminTab`; match how sibling tabs initialize).

- [ ] **Step 6: Manual smoke (admin account)**

Admin portal → Featured tab: shows the active post (with expiry) + queued posts; Remove deletes the row and re-renders; removing the active one promotes the next on the next feed/queue load.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(featured): admin portal Featured tab (view + remove queue)"
```

---

### Task 6: E2E mocked coverage (kebab visibility + pill render)

**Files:**
- Modify: `e2e/helpers.js` — add an RPC route mock so `featured_current` (and other rpc) calls don't 404, configurable via `opts.featuredId`
- Test: `e2e/featured.mock.spec.js`

**Interfaces:**
- Consumes: `mockSupabase`, `waitForAppBoot`, `navigateTo`, `SAMPLE_LOGS`, `FAKE_USER` from helpers.
- Produces: mocked `**/rest/v1/rpc/featured_current` returning `opts.featuredId ?? null`.

- [ ] **Step 1: Add RPC mock to `mockSupabase`** — add `featuredId = null` to the destructured opts and register a route (place near the other `page.route('**/rest/v1/...')` blocks):

```js
  await page.route('**/rest/v1/rpc/featured_current', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(featuredId) })
  );
  // Catch-all for other RPCs used in tests so they don't 404.
  await page.route('**/rest/v1/rpc/*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  );
```

(Register `featured_current` BEFORE the catch-all so it wins.)

- [ ] **Step 2: Write the failing test** `e2e/featured.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { mockSupabase, waitForAppBoot, navigateTo, SAMPLE_LOGS } from './helpers.js';

const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

test.describe('Featured post (mocked)', () => {
  test('★ Featured pill renders on the pinned post', async ({ page }) => {
    const featured = SAMPLE_LOGS[0];
    await mockSupabase(page, { logs: SAMPLE_LOGS, featuredId: featured.id });
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');
    await expect(page.locator('.feat-pill').first()).toBeVisible();
  });

  test('admin sees the Feature kebab item; non-admin does not', async ({ page }) => {
    await mockSupabase(page, {
      logs: SAMPLE_LOGS,
      user: { id: ADMIN_ID, email: 'admin@wrotate.com' },
    });
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');
    // open the first post kebab
    await page.locator('.feed-dots-wrap button').first().click();
    await expect(page.getByText('Feature this post')).toBeVisible();
  });
});
```

(Confirm `SAMPLE_LOGS` has at least one `visibility:'public'` row; if `navigateTo`/feed selector names differ, adapt to the real helpers.)

- [ ] **Step 3: Run to verify the pill test fails first (before Task 4 wiring), then passes**

Run: `npm run test:e2e -- featured`
Expected: PASS once Tasks 3–4 are in place. If admin-id assertion is flaky due to `_isDevUser` reading `currentUser`, confirm the app sets `currentUser.id` from the mocked session.

- [ ] **Step 4: Run the full mocked suite (no regressions from the catch-all RPC mock)**

Run: `npm run test:e2e`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers.js e2e/featured.mock.spec.js
git commit -m "test(featured): mocked E2E for pill render + admin kebab visibility"
```

---

### Task 7: SW bump, Help / What's New, final verification

**Files:**
- Modify: `sw.js` ([sw.js:4](sw.js#L4))
- Modify: Help page + "What's New" section in `index.html` (admin-facing note)

- [ ] **Step 1: Bump the SW cache version**

In [sw.js:4](sw.js#L4) change `wristlog-v828` → `wristlog-v829`.

- [ ] **Step 2: Update Help / What's New**

Add a short admin-facing note (Help in-app guide + "What's New") that the admin can feature a post from its ★ menu (pins to the top of the feed for 24h, with a queue managed in the admin portal). Keep WRotate naming; team "we" voice. Do not touch the landing page.

- [ ] **Step 3: Full suite**

Run: `npm test && npm run test:e2e`
Expected: all pass (unit incl. `pinFeatured`; mocked E2E incl. featured specs).

- [ ] **Step 4: Commit**

```bash
git add sw.js index.html
git commit -m "chore(featured): bump SW cache, Help/What's New note"
```

- [ ] **Step 5: Final admin UAT before push**

On local dev (admin account): feature post A and B; A pins with pill; admin Featured tab shows A active + B queued; force-expire A (or via db query) → B promotes; remove from the tab works; non-admin/test account sees no kebab item and the same featured post at top.

- [ ] **Step 6: Deploy**

```bash
git push origin main
```

---

## Notes for the implementer

- The `featured_current()` RPC writes (rotation) on every feed load — this is intentional and serialized by the advisory lock. Do not "optimize" it to a pure read.
- Exact toast/CSS-var/class names (`showToast`, `.admin-tab-btn`, `var(--danger)`, `var(--border)`) must be confirmed against the real file before committing each task — the plan uses the most likely names; grep and adapt.
- Admin UAT must use the real admin account (`d70b1a85-…`), NOT testuser/testuser2 (they aren't admins). Keep all test posting private/followers per project rules; do not feature real users' posts in a way that's externally visible beyond what the feature intends.
