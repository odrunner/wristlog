// ── Real Integration Tests ───────────────────────────────────────────────
// These tests hit the real Supabase backend using test accounts.
// Requires: dev-config.js with __DEV_CREDS__ and __DEV_CREDS_2__
//
// Run with: npx playwright test --project=integration
//
// IMPORTANT: Uses testuser and testuser2 only.
// Never posts publicly — uses private visibility.

import { test, expect } from '@playwright/test';

const APP_URL = '/';

// Skip the entire file if no dev-config.js is available (e.g., in CI without secrets)
test.beforeEach(async ({ page }) => {
  // Check if dev-config.js exists by trying to load it
  const response = await page.goto('/dev-config.js');
  if (!response || response.status() !== 200) {
    test.skip(true, 'dev-config.js not found — skipping integration tests');
  }
});

/**
 * Login as testuser via the dev login flow (localhost only).
 */
async function devLogin(page, useSecond = false) {
  await page.goto(APP_URL);

  // Wait for auth screen
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });

  // Click the appropriate dev login button
  const btnSelector = useSecond
    ? 'button:has-text("testuser2")'
    : '#dev-login-wrap button:first-child';
  await page.click(btnSelector);

  // Wait for app to boot (auth screen hides)
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

// ── Auth Flow ────────────────────────────────────────────────────────────

test.describe('Authentication (real)', () => {
  test('testuser can sign in via dev login', async ({ page }) => {
    await devLogin(page);

    // Verify app is loaded
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('testuser2 can sign in via dev login', async ({ page }) => {
    await devLogin(page, true);

    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('can sign out and return to auth screen', async ({ page }) => {
    await devLogin(page);

    // Sign out
    const signoutBtn = page.locator('#signout-btn, button:has-text("Sign Out")').first();
    if (await signoutBtn.isVisible()) {
      await signoutBtn.click();
      await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
    }
  });
});

// ── Data Loading ─────────────────────────────────────────────────────────

test.describe('Data loading (real)', () => {
  test('loads collection after sign-in', async ({ page }) => {
    await devLogin(page);

    // Navigate to collection
    await page.click('nav button[data-page="collection"]');
    await page.waitForSelector('#page-collection', { state: 'visible' });

    // Collection page should have loaded (may be empty or populated)
    const grid = page.locator('#watches-grid');
    await expect(grid).toBeVisible({ timeout: 10_000 });
  });

  test('loads stats page after sign-in', async ({ page }) => {
    await devLogin(page);

    await page.click('nav button[data-page="stats"]');
    await page.waitForSelector('#page-stats', { state: 'visible' });
    await expect(page.locator('#page-stats')).toBeVisible();
  });

  test('loads feed page', async ({ page }) => {
    await devLogin(page);

    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });
    await expect(page.locator('#page-feed')).toBeVisible();
  });
});

// ── Cross-Account Social ─────────────────────────────────────────────────

test.describe('Social features (real)', () => {
  test('testuser can view their profile', async ({ page }) => {
    await devLogin(page);

    const profileBtn = page.locator('#profile-btn');
    if (await profileBtn.isVisible()) {
      await profileBtn.click();
      await page.waitForSelector('#page-profile', { state: 'visible', timeout: 5_000 });
      await expect(page.locator('#page-profile')).toBeVisible();
    }
  });
});

// ── Navigation Smoke Test ────────────────────────────────────────────────

test.describe('Full navigation (real)', () => {
  test('can navigate to all main pages without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await devLogin(page);

    for (const pageName of ['feed', 'track', 'collection', 'wishlist', 'stats']) {
      await page.click(`nav button[data-page="${pageName}"]`);
      await page.waitForSelector(`#page-${pageName}`, { state: 'visible', timeout: 5_000 });
    }

    // No JS errors should have occurred during navigation
    expect(errors).toEqual([]);
  });
});
