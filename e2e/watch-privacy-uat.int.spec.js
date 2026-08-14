// ── Regression: followers/friends-only watch privacy (2026-08-13 RLS fix) ────
//
// Guards audit finding S2. `watches_public_read` granted every authenticated user
// any watch whose privacy was merely "not private", so 'followers' and 'friends'
// both passed and the correctly-scoped policy beside it never ran. Verified before
// the fix: an unrelated user could read 56 restricted watches across 12 users,
// 29 with purchase prices.
//
// Asserts at the API layer using each page's own authenticated session — that is
// where RLS actually lives. A DOM-only assertion is not sufficient here: testuser's
// profile_privacy gate hides the whole collection client-side, so a UI check passes
// for the wrong reason even with the RLS hole wide open.
//
// Self-managing: sets its own fixture as testuser (their own row, via RLS) and
// restores it afterwards. Test-owned data only. Never posts.
//
// Run: npx playwright test e2e/watch-privacy-uat.int.spec.js --project=integration

import { test, expect } from '@playwright/test';

const TESTUSER_ID = 'e0af1615-b151-4260-b6bd-c23e497efa6d';
const FIXTURE_WATCH_ID = 'mmfxtyvxn4i1id5mie';   // testuser's A. Lange Saxonia
const FIXTURE_NAME = 'Saxonia';

async function devLogin(page, useSecond = false) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click(useSecond ? 'button:has-text("testuser2")' : '#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

async function demoLogin(page) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click('.btn-demo');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 20_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

/** `db` is a top-level const (index.html:6062) — global lexical scope, not on window. */
async function setFixturePrivacy(page, value) {
  return page.evaluate(async ([id, val]) => {
    const { error } = await db.from('watches').update({ watch_privacy: val }).eq('id', id);
    return error?.message || null;
  }, [FIXTURE_WATCH_ID, value]);
}

async function readFixture(page) {
  return page.evaluate(async (id) => {
    const { data, error } = await db
      .from('watches').select('id, brand, name, price, watch_privacy').eq('id', id);
    return { rows: data || [], error: error?.message || null };
  }, FIXTURE_WATCH_ID);
}

test.describe.configure({ mode: 'serial' });

test.describe('Friends-only watch privacy (S2 regression)', () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto('/dev-config.js');
    if (!response || response.status() !== 200) {
      test.skip(true, 'dev-config.js not found — skipping integration tests');
    }
  });

  test('setup: owner marks the watch friends-only', async ({ page }) => {
    await devLogin(page);
    expect(await setFixturePrivacy(page, 'friends')).toBeNull();
    const api = await readFixture(page);
    expect(api.rows[0]?.watch_privacy).toBe('friends');
  });

  test('friend still sees it — the fix must not over-block', async ({ page }) => {
    await devLogin(page, true);   // testuser2: follows AND is friends with testuser
    const api = await readFixture(page);
    console.log('[friend] rows:', JSON.stringify(api.rows));
    expect(api.rows.length).toBe(1);
    expect(api.rows[0].name).toContain(FIXTURE_NAME);
  });

  test('stranger cannot see it — the leak, closed', async ({ page }) => {
    await demoLogin(page);        // demo: neither follows nor is friends
    const api = await readFixture(page);
    console.log('[stranger] rows:', JSON.stringify(api.rows), 'error:', api.error);
    expect(api.error).toBeNull();     // blocked by RLS, not by a query failure
    expect(api.rows.length).toBe(0);
  });

  test('teardown: restore the fixture', async ({ page }) => {
    await devLogin(page);
    expect(await setFixturePrivacy(page, null)).toBeNull();
    const api = await readFixture(page);
    expect(api.rows[0]?.watch_privacy).toBeNull();
  });
});
