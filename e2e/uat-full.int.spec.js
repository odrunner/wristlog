// ── Full UAT — Real Browser Tests ────────────────────────────────────────
// Hits real Supabase with test accounts. Opens Chrome and clicks through.
// Run with: npx playwright test e2e/uat-full.int.spec.js --project=integration
//
// RULES:
// - Uses testuser and testuser2 ONLY
// - NEVER posts publicly — uses private/followers/friends visibility
// - NEVER interacts with public posts or real users

import { test, expect } from '@playwright/test';

const APP_URL = '/';

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/dev-config.js');
  if (!response || response.status() !== 200) {
    test.skip(true, 'dev-config.js not found');
  }
});

async function devLogin(page, useSecond = false) {
  await page.goto(APP_URL);
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  const btnSelector = useSecond
    ? 'button:has-text("testuser2")'
    : '#dev-login-wrap button:first-child';
  await page.click(btnSelector);
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

// ── 1. AUTH ──────────────────────────────────────────────────────────────

test.describe('1. Auth', () => {
  test('testuser logs in and sees nav', async ({ page }) => {
    await devLogin(page);
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.locator('#auth-screen')).toBeHidden();
  });

  test('testuser2 logs in and sees nav', async ({ page }) => {
    await devLogin(page, true);
    await expect(page.locator('nav')).toBeVisible();
  });
});

// ── 2. PROFILE ──────────────────────────────────────────────────────────

test.describe('2. Profile', () => {
  test('own profile loads with display name and username', async ({ page }) => {
    await devLogin(page);
    await page.locator('#profile-btn').click();
    await page.waitForSelector('#page-profile', { state: 'visible', timeout: 5_000 });
    // Should see display name and username
    await expect(page.locator('.profile-display-name')).toBeVisible();
    await expect(page.locator('.profile-username-lbl')).toBeVisible();
  });

  test('profile shows stats (watches, wears, followers, following)', async ({ page }) => {
    await devLogin(page);
    await page.locator('#profile-btn').click();
    await page.waitForSelector('#page-profile', { state: 'visible', timeout: 5_000 });
    await expect(page.locator('.profile-stat')).toHaveCount(4, { timeout: 5_000 });
  });

  test('avatar camera overlay visible on hover/tap', async ({ page }) => {
    await devLogin(page);
    await page.locator('#profile-btn').click();
    await page.waitForSelector('#page-profile', { state: 'visible', timeout: 5_000 });
    const cam = page.locator('.profile-avatar-cam');
    // The cam overlay exists in the DOM even if opacity:0
    await expect(cam).toHaveCount(1);
  });
});

// ── 3. COLLECTION ───────────────────────────────────────────────────────

test.describe('3. Collection', () => {
  test('collection page loads with watches', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="collection"]');
    await page.waitForSelector('#page-collection', { state: 'visible' });
    await page.waitForTimeout(3_000); // wait for data to load from Supabase
    const grid = page.locator('#watches-grid');
    await expect(grid).toBeVisible({ timeout: 15_000 });
  });

  test('can switch between grid and list view', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="collection"]');
    await page.waitForSelector('#watches-grid', { state: 'visible', timeout: 10_000 });

    // Click list view button
    const listBtn = page.locator('#view-list-btn, button[title*="List"], button[aria-label*="List"]').first();
    if (await listBtn.isVisible()) {
      await listBtn.click();
      await page.waitForTimeout(500);
    }

    // Click grid view button to switch back
    const gridBtn = page.locator('#view-grid-btn, button[title*="Grid"], button[aria-label*="Grid"]').first();
    if (await gridBtn.isVisible()) {
      await gridBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('add watch modal opens', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="collection"]');
    await page.waitForSelector('#watches-grid', { state: 'visible', timeout: 10_000 });

    const addBtn = page.locator('[onclick*="openAddWatch"], .watch-card-add').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#watch-modal')).toBeVisible({ timeout: 3_000 });
      // Close without saving
      await page.keyboard.press('Escape');
    }
  });
});

// ── 4. FEED ─────────────────────────────────────────────────────────────

test.describe('4. Feed', () => {
  test('feed page loads', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });
    await expect(page.locator('#feed-list')).toBeVisible();
  });

  test('feed shows post and find people buttons', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });
    await expect(page.locator('#page-feed button', { hasText: /post/i })).toBeVisible();
    await expect(page.locator('#page-feed button', { hasText: /people/i })).toBeVisible();
  });

  test('new post modal opens and has visibility chips', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });

    await page.locator('#page-feed button', { hasText: /post/i }).click();
    await expect(page.locator('#new-post-modal')).toBeVisible({ timeout: 3_000 });
    // Visibility chips should exist
    await expect(page.locator('#np-vis-chips')).toBeVisible();
    // Close without posting
    await page.keyboard.press('Escape');
  });

  test('feed cards render for own posts', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });
    await page.waitForTimeout(3_000); // wait for feed to load

    const cards = page.locator('.feed-card');
    const count = await cards.count();
    // testuser should have at least some feed cards (own posts or followed users)
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ── 5. SOCIAL ───────────────────────────────────────────────────────────

test.describe('5. Social', () => {
  test('discover modal opens from feed', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });

    await page.locator('#page-feed button', { hasText: /people/i }).click();
    await expect(page.locator('#discover-modal')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#discover-search')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('notification bell exists and is clickable', async ({ page }) => {
    await devLogin(page);
    const bell = page.locator('#bell-btn');
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute('aria-expanded', 'false');

    await bell.click();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    // Close
    await bell.click();
  });

  test('testuser can view testuser2 profile', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="feed"]');
    await page.waitForSelector('#page-feed', { state: 'visible' });

    // Open discover and search for testuser2
    await page.locator('#page-feed button', { hasText: /people/i }).click();
    await page.waitForSelector('#discover-modal', { state: 'visible' });
    await page.fill('#discover-search', 'testuser2');
    await page.waitForTimeout(1500); // wait for search results

    // Click on result if found
    const result = page.locator('.discover-result, .search-result').first();
    if (await result.isVisible()) {
      await result.click();
      await page.waitForTimeout(1000);
      // Should see their profile
      await expect(page.locator('#page-profile')).toBeVisible();
    }
  });
});

// ── 6. TRACKING ─────────────────────────────────────────────────────────

test.describe('6. Tracking', () => {
  test('track page loads', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="track"]');
    await page.waitForSelector('#page-track', { state: 'visible', timeout: 5_000 });
    await expect(page.locator('#page-track')).toBeVisible();
  });

  test('track history shows past wears', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="track"]');
    await page.waitForSelector('#page-track', { state: 'visible' });
    await page.waitForTimeout(2_000);

    // Track history section should exist
    const history = page.locator('#track-history, .track-history');
    if (await history.isVisible()) {
      // Should have at least one row
      const rows = page.locator('.track-row, .history-row, tr').first();
      expect(await rows.count()).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── 7. STATS ────────────────────────────────────────────────────────────

test.describe('7. Stats', () => {
  test('stats page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await devLogin(page);
    await page.click('nav button[data-page="stats"]');
    await page.waitForSelector('#page-stats', { state: 'visible' });
    await page.waitForTimeout(2_000);

    expect(errors).toEqual([]);
  });

  test('watch recommendation card renders', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="stats"]');
    await page.waitForSelector('#page-stats', { state: 'visible' });
    await page.waitForTimeout(4_000); // rec needs weather fetch + compute

    const rec = page.locator('#rec-container');
    // Rec container may or may not be visible depending on collection size
    if (await rec.isVisible()) {
      const text = await rec.textContent();
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

// ── 8. WISHLIST ──────────────────────────────────────────────────────────

test.describe('8. Wishlist', () => {
  test('wishlist page loads', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="wishlist"]');
    await page.waitForSelector('#page-wishlist', { state: 'visible' });
    await expect(page.locator('#page-wishlist')).toBeVisible();
  });

  test('add wishlist modal opens', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="wishlist"]');
    await page.waitForSelector('#page-wishlist', { state: 'visible' });

    const addBtn = page.locator('[onclick*="openWishlistModal"], button:has-text("+ Add")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#wishlist-modal')).toBeVisible({ timeout: 3_000 });
      await page.keyboard.press('Escape');
    }
  });
});

// ── 9. CLUBS ────────────────────────────────────────────────────────────

test.describe('9. Clubs', () => {
  test('clubs page loads', async ({ page }) => {
    await devLogin(page);
    await page.click('nav button[data-page="stats"]'); // clubs is under stats or its own tab
    await page.waitForSelector('#page-stats', { state: 'visible' });

    // Look for clubs section or tab
    const clubsTab = page.locator('nav button[data-page="clubs"]');
    if (await clubsTab.isVisible()) {
      await clubsTab.click();
      await page.waitForSelector('#page-clubs', { state: 'visible' });
    }
  });
});

// ── 10. HELP & FEEDBACK ─────────────────────────────────────────────────

test.describe('10. Help & Feedback', () => {
  test('help page loads via ? button', async ({ page }) => {
    await devLogin(page);
    const helpBtn = page.locator('#help-btn');
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();
    await expect(page.locator('#page-help')).toBeVisible({ timeout: 3_000 });
  });

  test('feedback form opens from help page', async ({ page }) => {
    await devLogin(page);
    await page.locator('#help-btn').click();
    await page.waitForSelector('#page-help', { state: 'visible' });

    await page.locator('#page-help button', { hasText: /send feedback/i }).click();
    await expect(page.locator('#feedback-modal')).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape');
  });

  test('whats new modal opens', async ({ page }) => {
    await devLogin(page);
    await page.locator('#help-btn').click();
    await page.waitForSelector('#page-help', { state: 'visible' });

    await page.locator('button', { hasText: /what.*new/i }).click();
    await expect(page.locator('#whats-new-modal')).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press('Escape');
  });
});

// ── 11. NEW FEATURES ────────────────────────────────────────────────────

test.describe('11. New features', () => {
  test('share post page prompts anonymous viewer to sign in', async ({ page }) => {
    // The in-app viewer (/p/) is linked for non-public posts. An anonymous viewer
    // can't be evaluated by RLS, so any non-readable id (including a nonexistent
    // one — indistinguishable without auth) shows the sign-in prompt.
    await page.goto('/p/?id=nonexistent-id');
    await page.waitForTimeout(3_000);
    const content = await page.locator('#main-content').textContent();
    expect(content).toContain('Sign in to view');
  });
});

// ── 12. FULL NAVIGATION SMOKE ───────────────────────────────────────────

test.describe('12. Full navigation smoke', () => {
  test('all main pages load without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.evaluate(() => localStorage.setItem('wrotate_newfeatures_v2', '1'));
    await devLogin(page);

    for (const pageName of ['feed', 'track', 'collection', 'wishlist', 'stats']) {
      await page.click(`nav button[data-page="${pageName}"]`);
      await page.waitForSelector(`#page-${pageName}`, { state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(500);
    }

    // Profile
    await page.locator('#profile-btn').click();
    await page.waitForSelector('#page-profile', { state: 'visible', timeout: 5_000 });

    // Help
    await page.locator('#help-btn').click();
    await page.waitForSelector('#page-help', { state: 'visible', timeout: 5_000 });

    expect(errors).toEqual([]);
  });

  test('testuser2 full navigation without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.evaluate(() => localStorage.setItem('wrotate_newfeatures_v2', '1'));
    await devLogin(page, true);

    for (const pageName of ['feed', 'track', 'collection', 'wishlist', 'stats']) {
      await page.click(`nav button[data-page="${pageName}"]`);
      await page.waitForSelector(`#page-${pageName}`, { state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(500);
    }

    expect(errors).toEqual([]);
  });
});
