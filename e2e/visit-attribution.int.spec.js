// ── Visit attribution (real) ─────────────────────────────────────────────
// Regression guard for the Traffic-tab bug: page_visits.user_id was NULL on
// every non-admin visit, so admin_traffic_stats' visitor fingerprint
// (COALESCE(user_id::text, user_agent, 'unknown')) collapsed to "distinct
// User-Agent string" instead of counting people.
//
// Two causes, both covered here against the real browser + real Supabase:
//   1. the session lookup hardcoded "sb-<project-ref>-auth-token", but the
//      client points at the custom domain api.wrotate.com, so supabase-js
//      actually stores it under "sb-api-auth-token" — the read always
//      returned null and the visit went out unattributed;
//   2. the fallback backfill used a plain UPDATE, which RLS silently drops for
//      everyone but the admin — it now goes through attribute_page_visit().
//
// Uses testuser only. Read-only apart from the page_visit row the app itself
// writes on load.

import { test, expect } from '@playwright/test';

const STALE_KEY = 'sb-xnzweevzrojmouzhpwzv-auth-token'; // the project ref — never written

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/dev-config.js');
  if (!response || response.status() !== 200) {
    test.skip(true, 'dev-config.js not found — skipping integration tests');
  }
});

async function devLogin(page) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click('#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
}

test('the session is found under the real storage key, not the hardcoded project ref', async ({ page }) => {
  await devLogin(page);

  const probe = await page.evaluate((staleKey) => ({
    staleKeyValue: localStorage.getItem(staleKey),          // what the old code read
    realKey: Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)) || null,
    lookedUpId: storedAuthUserId(),                          // what the fixed code reads
    currentUserId: currentUser?.id || null,
  }), STALE_KEY);

  expect(probe.currentUserId, 'the app resolved a signed-in user').toBeTruthy();
  expect(probe.realKey, 'a session is stored under some sb-*-auth-token key').toBeTruthy();

  // Proves the bug was real, not theoretical: the key the old code asked for
  // does not exist, so it could never recover an id.
  expect(probe.staleKeyValue, 'the hardcoded project-ref key holds nothing').toBe(null);

  expect(probe.lookedUpId, 'the lookup recovers the id the app is running as')
    .toBe(probe.currentUserId);
});

test('a signed-in page load records a page_visit carrying user_id', async ({ page }) => {
  const inserted = [];
  const attributed = [];

  await page.route('**/rest/v1/page_visits*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      try { inserted.push(JSON.parse(req.postData() || '{}')); } catch (e) {}
    }
    await route.continue();
  });
  await page.route('**/rest/v1/rpc/attribute_page_visit*', async (route) => {
    try { attributed.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
    await route.continue();
  });

  await devLogin(page);
  await page.waitForTimeout(3000); // let the insert + any backfill settle

  const uid = await page.evaluate(() => currentUser?.id || null);
  expect(uid, 'signed in').toBeTruthy();

  // The visit is attributed either inline (user_id on the INSERT) or, if the
  // page loaded before auth resolved, via the backfill RPC. Either is a pass;
  // what must not happen is the row staying anonymous with neither firing.
  const inlineAttributed = inserted.some(r => r && r.user_id === uid);
  const backfilled = attributed.length > 0;

  expect(inserted.length + attributed.length, 'a visit was tracked at all').toBeGreaterThan(0);
  expect(inlineAttributed || backfilled,
    `visit left anonymous — inserts=${JSON.stringify(inserted.map(r => r && r.user_id))}, rpc=${attributed.length}`)
    .toBe(true);
});
