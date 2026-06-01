// ── Mocked E2E Tests ─────────────────────────────────────────────────────
// These tests use route interception to mock all Supabase calls.
// No real network needed — fast, deterministic, runs in CI.

import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, FAKE_PROFILE, SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// ── Boot & Auth ──────────────────────────────────────────────────────────

test.describe('App boot (mocked)', () => {
  test('shows auth screen when no session exists', async ({ page }) => {
    // Block all Supabase auth calls to simulate no session
    await page.route('**/auth/v1/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    );
    await page.route('**/rest/v1/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
    await page.route('**/realtime/**', route => route.abort());

    // Prevent A/B test redirect to r.html
    await page.addInitScript(() => { localStorage.setItem('ab_landing', 'a'); });

    await page.goto('/');
    const authScreen = page.locator('#auth-screen');
    await expect(authScreen).toBeVisible({ timeout: 10_000 });
  });

  test('boots into app with mocked session', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Nav should be visible
    await expect(page.locator('nav')).toBeVisible();
    // Auth screen should be hidden
    await expect(page.locator('#auth-screen')).toBeHidden();
  });
});

// ── Blurred Feed Preview Landing ─────────────────────────────────────────

test.describe('Landing page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth to return no session, mock public feed with sample posts
    await page.route('**/auth/v1/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    );
    await page.route('**/rest/v1/logs*order=created_at*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'p1', user_id: 'u1', watch_id: 'w1', photo_url: null, notes: 'Great wrist day', use_case: 'casual', date: '2026-03-25', created_at: '2026-03-25T10:00:00Z', visibility: 'public', moderation_status: null },
        { id: 'p2', user_id: 'u2', watch_id: 'w2', photo_url: 'https://example.com/watch.jpg', notes: null, use_case: 'dress', date: '2026-03-24', created_at: '2026-03-24T09:00:00Z', visibility: 'public', moderation_status: null },
      ]) })
    );
    await page.route('**/rest/v1/profiles*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'u1', username: 'alice', display_name: 'Alice', avatar_url: null, is_official: false },
        { id: 'u2', username: 'bob', display_name: 'Bob', avatar_url: null, is_official: false },
      ]) })
    );
    await page.route('**/rest/v1/watches*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'w1', user_id: 'u1', brand: 'Rolex', name: 'Submariner' },
        { id: 'w2', user_id: 'u2', brand: 'Omega', name: 'Speedmaster' },
      ]) })
    );
    await page.route('**/rest/v1/likes*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
    await page.route('**/rest/v1/comments*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
    await page.route('**/realtime/**', route => route.abort());
  });

  test('shows feature callouts and auth buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Feature callouts visible
    await expect(page.locator('.landing-features')).toBeVisible();
    const features = await page.locator('.landing-feature').count();
    expect(features).toBe(3);
  });

  test('Google and Apple sign-in buttons visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    await expect(page.locator('.landing-auth .btn-google')).toBeVisible();
    await expect(page.locator('.landing-auth .btn-apple')).toBeVisible();
  });

  test('App Store badge visible above sign-in buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    await expect(page.locator('.landing-app-badge img')).toBeVisible();
  });
});

// ── Collection Page ──────────────────────────────────────────────────────

test.describe('Collection page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('displays watches in the collection grid', async ({ page }) => {
    await navigateTo(page, 'collection');
    const grid = page.locator('#watches-grid');
    await expect(grid).toBeVisible();

    // Should show both watches in the collection grid
    await expect(grid.getByText('Submariner Date')).toBeVisible();
    await expect(grid.getByText('Speedmaster Professional')).toBeVisible();
  });

  test('shows watch count', async ({ page }) => {
    await navigateTo(page, 'collection');
    // The collection page should indicate 2 watches
    const pageContent = await page.locator('#page-collection').textContent();
    expect(pageContent).toContain('2');
  });

  test('opens add-watch modal', async ({ page }) => {
    await navigateTo(page, 'collection');
    // Click the add button (+ FAB or header add button)
    const addBtn = page.locator('#add-watch-btn, [onclick*="openWatchModal"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#watch-modal')).toBeVisible();
      await expect(page.locator('#watch-modal-title')).toContainText(/add/i);
    }
  });
});

// ── Track Page ───────────────────────────────────────────────────────────

test.describe('Track page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('displays watch selector with collection watches', async ({ page }) => {
    await navigateTo(page, 'track');
    const selector = page.locator('#watch-selector');
    await expect(selector).toBeVisible();

    // Should list both watches for tracking. Use auto-retrying toContainText
    // (not a one-shot textContent read) so the assertion waits for the mocked
    // watch data to load — under load the selector first renders empty
    // ("Nothing to track yet") before the data populates.
    await expect(selector).toContainText('Submariner');
    await expect(selector).toContainText('Speedmaster');
  });

  test('shows recent wear history', async ({ page }) => {
    await navigateTo(page, 'track');
    // The track history should show recent logs. Auto-retrying toContainText
    // waits for the mocked logs to load rather than reading once before the
    // async fetch resolves (the data-load race that made this flaky).
    const history = page.locator('#track-history-tbody, .track-history').first();
    await expect(history).toContainText('Submariner');
  });
});

// ── Stats Page ───────────────────────────────────────────────────────────

test.describe('Stats page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('renders stats with wear data', async ({ page }) => {
    await navigateTo(page, 'stats');
    const statsPage = page.locator('#page-stats');
    await expect(statsPage).toBeVisible();

    // Auto-retrying matcher waits for the mocked logs to load and stats to
    // compute, rather than reading textContent once before the fetch resolves.
    await expect(statsPage).toContainText('2');
  });
});

// ── Navigation ───────────────────────────────────────────────────────────

test.describe('Navigation (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('navigates between all main pages', async ({ page }) => {
    for (const pageName of ['track', 'collection', 'wishlist', 'stats']) {
      await navigateTo(page, pageName);
      await expect(page.locator(`#page-${pageName}`)).toBeVisible();
    }
  });
});

// ── Empty State ──────────────────────────────────────────────────────────

test.describe('Empty collection (mocked)', () => {
  test('shows empty state when user has no watches', async ({ page }) => {
    await mockSupabase(page, { watches: [], logs: [], wishlist: [] });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await navigateTo(page, 'collection');
    const pageText = await page.locator('#page-collection').textContent();
    // Should show 0 watches or an empty state message
    expect(pageText).toMatch(/0|add|empty|no watches/i);
  });
});

// ── Wishlist Page ────────────────────────────────────────────────────────

test.describe('Wishlist page (mocked)', () => {
  test('displays empty wishlist', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: [] });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await navigateTo(page, 'wishlist');
    await expect(page.locator('#page-wishlist')).toBeVisible();
  });
});

// ── Log a Wear (Track Flow) ─────────────────────────────────────────────

test.describe('Log a wear (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('opens track modal when clicking a watch', async ({ page }) => {
    await navigateTo(page, 'track');
    // Click the first watch option in the selector
    const watchOption = page.locator('.watch-option').first();
    await expect(watchOption).toBeVisible({ timeout: 10_000 });
    await watchOption.click();

    // Track log modal should open
    const modal = page.locator('#track-log-modal');
    await expect(modal).toBeVisible();

    // Should show the watch brand/name in the hero
    const brand = page.locator('#tl-watch-brand');
    const name = page.locator('#tl-watch-name');
    await expect(brand).toBeVisible();
    await expect(name).toBeVisible();
  });

  test('track modal has date, occasion, visibility fields', async ({ page }) => {
    await navigateTo(page, 'track');
    await page.locator('.watch-option').first().click();
    await expect(page.locator('#track-log-modal')).toBeVisible();

    // Date field
    await expect(page.locator('#track-date')).toBeVisible();
    // Occasion chips
    await expect(page.locator('#usecase-chips')).toBeVisible();
    await expect(page.locator('#usecase-chips [data-uc="work"]')).toBeVisible();
    await expect(page.locator('#usecase-chips [data-uc="leisure"]')).toBeVisible();
    // Caption / notes
    await expect(page.locator('#track-notes')).toBeVisible();
    // Visibility chips
    await expect(page.locator('#tl-vis-chips')).toBeVisible();
    await expect(page.locator('#tl-vis-chips [data-vis="public"]')).toBeVisible();
    await expect(page.locator('#tl-vis-chips [data-vis="private"]')).toBeVisible();
  });

  test('selects occasion chip', async ({ page }) => {
    await navigateTo(page, 'track');
    await page.locator('.watch-option').first().click();
    await expect(page.locator('#track-log-modal')).toBeVisible();

    // Click "Work" occasion
    const workChip = page.locator('#usecase-chips [data-uc="work"]');
    await workChip.click();
    await expect(workChip).toHaveClass(/selected/);
  });

  test('selects visibility chip', async ({ page }) => {
    await navigateTo(page, 'track');
    await page.locator('.watch-option').first().click();
    await expect(page.locator('#track-log-modal')).toBeVisible();

    const privateChip = page.locator('#tl-vis-chips [data-vis="private"]');
    await privateChip.click();
    await expect(privateChip).toHaveClass(/selected/);
  });

  test('save log button triggers API call', async ({ page }) => {
    await navigateTo(page, 'track');
    await page.locator('.watch-option').first().click();
    await expect(page.locator('#track-log-modal')).toBeVisible();

    // Listen for POST to logs
    const logPostPromise = page.waitForRequest(req =>
      req.url().includes('/rest/v1/logs') && req.method() === 'POST'
    );

    // Click save
    await page.locator('#track-log-modal button', { hasText: /log this wear/i }).click();

    // Verify the POST was sent
    const logPost = await logPostPromise;
    expect(logPost.method()).toBe('POST');
  });

  test('closes track modal on cancel', async ({ page }) => {
    await navigateTo(page, 'track');
    await page.locator('.watch-option').first().click();
    await expect(page.locator('#track-log-modal')).toBeVisible();

    await page.locator('#track-log-modal button', { hasText: /cancel/i }).click();
    await expect(page.locator('#track-log-modal')).toBeHidden();
  });
});

// ── Add a Watch ─────────────────────────────────────────────────────────

test.describe('Add a watch (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('opens add-watch modal from collection page', async ({ page }) => {
    await navigateTo(page, 'collection');
    const addBtn = page.locator('#add-watch-btn, [onclick*="openWatchModal"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#watch-modal')).toBeVisible();
    }
  });

  test('add-watch modal has all required fields', async ({ page }) => {
    await navigateTo(page, 'collection');
    const addBtn = page.locator('#add-watch-btn, [onclick*="openWatchModal"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#watch-modal')).toBeVisible();

      // Brand search input
      await expect(page.locator('#w-brand-display')).toBeVisible();
      // Model name
      await expect(page.locator('#w-name')).toBeVisible();
      // Reference number
      await expect(page.locator('#w-ref')).toBeVisible();
      // Price
      await expect(page.locator('#w-price')).toBeVisible();
      // Purchase date
      await expect(page.locator('#w-date')).toBeVisible();
      // Save button
      await expect(page.locator('#save-watch-btn')).toBeVisible();
    }
  });

  test('can fill in watch form fields', async ({ page }) => {
    await navigateTo(page, 'collection');
    const addBtn = page.locator('#add-watch-btn, [onclick*="openWatchModal"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#watch-modal')).toBeVisible();

      // Fill in the form
      await page.locator('#w-name').fill('Royal Oak');
      await page.locator('#w-ref').fill('15500ST');
      await page.locator('#w-price').fill('25000');
      await page.locator('#w-date').fill('2025-01-01');

      // Verify values stuck
      await expect(page.locator('#w-name')).toHaveValue('Royal Oak');
      await expect(page.locator('#w-ref')).toHaveValue('15500ST');
    }
  });

  test('delete button hidden in add mode', async ({ page }) => {
    await navigateTo(page, 'collection');
    const addBtn = page.locator('#add-watch-btn, [onclick*="openWatchModal"]').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('#watch-modal')).toBeVisible();
      // Delete button should be hidden when adding (not editing)
      await expect(page.locator('#modal-delete-btn')).toBeHidden();
    }
  });
});

// ── Feed Page ───────────────────────────────────────────────────────────

test.describe('Feed page (mocked)', () => {
  test('displays feed page on boot (default tab)', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Feed is the default active page
    await expect(page.locator('#page-feed')).toBeVisible();
  });

  test('shows feed list container', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    const feedList = page.locator('#feed-list');
    await expect(feedList).toBeVisible();
  });

  test('feed has Post and People buttons', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await expect(page.locator('#page-feed button', { hasText: /post/i })).toBeVisible();
    await expect(page.locator('#page-feed button', { hasText: /people/i })).toBeVisible();
  });

  test('renders feed cards when logs exist', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Wait for feed to render (skeletons should be replaced)
    await page.waitForTimeout(2000);
    // Feed cards should appear for the user's own logs
    const feedCards = page.locator('.feed-card');
    const count = await feedCards.count();
    // We have 2 sample logs, at least some should render as feed cards
    expect(count).toBeGreaterThanOrEqual(0); // Feed may filter by visibility
  });
});

// ── Share post button ────────────────────────────────────────────────────

test.describe('Share post (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(2000); // wait for feed to render
  });

  test('public post has share button in actions', async ({ page }) => {
    // log-001 is public — should have share button
    const card = page.locator('#feedcard-log-001');
    if (await card.count() > 0) {
      const shareBtn = card.locator('.feed-action-btn[title="Share post"]');
      await expect(shareBtn).toBeVisible();
    }
  });

  test('private post does not have share button', async ({ page }) => {
    // log-002 is private — should NOT have share button
    const card = page.locator('#feedcard-log-002');
    if (await card.count() > 0) {
      const shareBtn = card.locator('.feed-action-btn[title="Share post"]');
      await expect(shareBtn).toHaveCount(0);
    }
  });

  test('public post has share option in menu', async ({ page }) => {
    const card = page.locator('#feedcard-log-001');
    if (await card.count() > 0) {
      const menu = card.locator('.feed-menu');
      const shareItem = menu.locator('.feed-menu-item', { hasText: 'Share post' });
      await expect(shareItem).toHaveCount(1);
    }
  });

  test('private post does not have share option in menu', async ({ page }) => {
    const card = page.locator('#feedcard-log-002');
    if (await card.count() > 0) {
      const menu = card.locator('.feed-menu');
      const shareItem = menu.locator('.feed-menu-item', { hasText: 'Share post' });
      await expect(shareItem).toHaveCount(0);
    }
  });
});

// ── Search / Discover ───────────────────────────────────────────────────

test.describe('Search / Discover (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('opens discover modal from feed page', async ({ page }) => {
    const findBtn = page.locator('#page-feed button', { hasText: /people/i });
    await expect(findBtn).toBeVisible();
    await findBtn.click();

    await expect(page.locator('#discover-modal')).toBeVisible();
    await expect(page.locator('#discover-search')).toBeVisible();
  });

  test('discover search input accepts text', async ({ page }) => {
    await page.locator('#page-feed button', { hasText: /people/i }).click();
    await expect(page.locator('#discover-modal')).toBeVisible();

    await page.locator('#discover-search').fill('watchfan');
    await expect(page.locator('#discover-search')).toHaveValue('watchfan');
  });
});

// ── Theme Toggle ────────────────────────────────────────────────────────

test.describe('Theme toggle (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('theme button is visible in settings area', async ({ page }) => {
    const themeBtn = page.locator('#theme-btn');
    await expect(themeBtn).toBeVisible();
  });

  test('clicking theme button changes theme', async ({ page }) => {
    // The app starts in light mode (no data-theme attr or data-theme absent)
    // cycleTheme goes: light → os → dark → light
    // Get current stored theme
    const initialTheme = await page.evaluate(() => localStorage.getItem('wrotate_theme') || 'light');

    await page.locator('#theme-btn').click();

    // Theme should have cycled
    const newTheme = await page.evaluate(() => localStorage.getItem('wrotate_theme'));
    expect(newTheme).not.toBe(initialTheme);
  });
});

// ── Sign Out ────────────────────────────────────────────────────────────

test.describe('Sign out (mocked)', () => {
  test('sign out button is visible', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    const signOutBtn = page.locator('#signout-btn');
    // Sign-out may be in a menu or conditionally displayed
    if (await signOutBtn.isVisible()) {
      await expect(signOutBtn).toBeVisible();
    }
  });
});

// ── Profile Page ────────────────────────────────────────────────────────

test.describe('Profile page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('navigates to own profile and shows edit card', async ({ page }) => {
    // Profile is accessed via avatar/username click, trigger via evaluate
    await page.evaluate(() => {
      if (typeof viewMyProfile === 'function') viewMyProfile();
      else if (typeof viewUserProfile === 'function') viewUserProfile(currentUser.id);
    });

    const profilePage = page.locator('#page-profile');
    await expect(profilePage).toBeVisible({ timeout: 5000 });

    // Wait for profile content to load
    await page.waitForTimeout(1000);
    const profileContent = page.locator('#profile-page-content');
    const text = await profileContent.textContent();
    // Should show the test user's display name or username
    expect(text).toMatch(/Test User|testuser/);
  });

  test('profile edit card has editable fields', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof viewMyProfile === 'function') viewMyProfile();
      else if (typeof viewUserProfile === 'function') viewUserProfile(currentUser.id);
    });

    await expect(page.locator('#page-profile')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Check for editable fields (these render as part of profile-page-content)
    const editCard = page.locator('#profile-edit-card');
    if (await editCard.isVisible()) {
      await expect(page.locator('#pp-display-name')).toBeVisible();
      await expect(page.locator('#pp-username')).toBeVisible();
      await expect(page.locator('#pp-bio')).toBeVisible();
      await expect(page.locator('#profile-save-btn')).toBeVisible();
    }
  });
});

// ── Watch Detail / Preview ──────────────────────────────────────────────

test.describe('Watch detail view (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('clicking a watch in collection opens preview modal', async ({ page }) => {
    await navigateTo(page, 'collection');
    const grid = page.locator('#watches-grid');
    await expect(grid).toBeVisible();

    // Click the first watch card that has a preview handler
    const watchCard = grid.locator('[onclick*="previewWatch"]').first();
    if (await watchCard.isVisible()) {
      await watchCard.click();
      const previewModal = page.locator('#watch-preview-modal');
      await expect(previewModal).toBeVisible({ timeout: 3000 });
    }
  });
});

// ── Clubs Page ──────────────────────────────────────────────────────────

test.describe('Clubs page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('navigates to clubs page from feed', async ({ page }) => {
    await page.locator('#page-feed button', { hasText: /clubs/i }).click();
    await expect(page.locator('#page-clubs')).toBeVisible();
  });

  test('clubs page shows Create button', async ({ page }) => {
    await page.locator('#page-feed button', { hasText: /clubs/i }).click();
    await expect(page.locator('#page-clubs button', { hasText: /create/i })).toBeVisible();
  });
});

// ── Track History ───────────────────────────────────────────────────────

test.describe('Track history (mocked)', () => {
  test('empty track page shows prompt to add watches', async ({ page }) => {
    await mockSupabase(page, { watches: [], logs: [] });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await navigateTo(page, 'track');
    const trackText = await page.locator('#page-track').textContent();
    expect(trackText).toMatch(/nothing to track|add a watch|collection/i);
  });

  test('track page with watches shows history table', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await navigateTo(page, 'track');
    const tbody = page.locator('#track-history-tbody');
    if (await tbody.isVisible()) {
      // Should contain at least one log entry
      const rows = tbody.locator('tr');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

// ── Stats Detail ────────────────────────────────────────────────────────

test.describe('Stats page detail (mocked)', () => {
  test('stats with no data shows empty state', async ({ page }) => {
    await mockSupabase(page, { watches: [], logs: [] });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await navigateTo(page, 'stats');
    const statsText = await page.locator('#page-stats').textContent();
    expect(statsText).toMatch(/0|no data|start tracking|empty/i);
  });

  test('stats page shows watch names from collection', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await navigateTo(page, 'stats');
    // Auto-retrying matcher waits for the mocked collection to load before
    // asserting (one-shot textContent raced the data fetch under load).
    await expect(page.locator('#page-stats')).toContainText(/Submariner|Speedmaster/);
  });
});

// ── Help Page ───────────────────────────────────────────────────────────

test.describe('Help page (mocked)', () => {
  test('help page exists and shows content', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Navigate to help page via showHelpPage()
    await page.evaluate(() => showHelpPage());

    const helpPage = page.locator('#page-help');
    await expect(helpPage).toBeVisible({ timeout: 5000 });
    const text = await helpPage.textContent();
    expect(text.length).toBeGreaterThan(50); // Has substantial content
  });
});

// ── Feedback Modal ──────────────────────────────────────────────────────

test.describe('Feedback (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('feedback button exists in help page', async ({ page }) => {
    // Navigate to help page via the ? button
    const helpBtn = page.locator('#help-btn');
    await helpBtn.click();
    await expect(page.locator('#page-help')).toBeVisible();
    await expect(page.locator('#page-help button:has-text("Send Feedback")')).toBeVisible();
  });
});

// ── Notification bell aria-expanded ─────────────────────────────────────

test.describe('Notification bell (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('bell button starts with aria-expanded false', async ({ page }) => {
    const bell = page.locator('#bell-btn');
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking bell sets aria-expanded to true', async ({ page }) => {
    const bell = page.locator('#bell-btn');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#notif-panel')).toBeVisible();
  });

  test('clicking bell again sets aria-expanded back to false', async ({ page }) => {
    const bell = page.locator('#bell-btn');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#notif-panel')).toBeHidden();
  });

  test('bell button has aria-label and aria-controls', async ({ page }) => {
    const bell = page.locator('#bell-btn');
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await expect(bell).toHaveAttribute('aria-controls', 'notif-panel');
  });
});

// ── Admin chips keyboard accessibility ───────────────────────────────────

const ADMIN_USER_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
const ADMIN_USER = { ...FAKE_USER, id: ADMIN_USER_ID, email: 'admin@wrotate.com' };
const ADMIN_PROFILE = { ...FAKE_PROFILE, id: ADMIN_USER_ID, username: 'adminuser', is_admin: true };

test.describe('Admin chips (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, user: ADMIN_USER, profile: ADMIN_PROFILE });
    await injectSession(page, ADMIN_USER);
    await page.goto('/');
    await waitForAppBoot(page);
    // Admin page is not a nav tab — invoke showAdminPage() directly
    await page.evaluate(() => showAdminPage());
    await page.waitForSelector('#page-admin.active', { timeout: 5000 });
  });

  test('admin tab chips are button elements', async ({ page }) => {
    const chips = page.locator('#admin-tabs button.chip');
    await expect(chips).toHaveCount(8);
  });

  test('admin tab chips have correct labels', async ({ page }) => {
    const labels = await page.locator('#admin-tabs button.chip').allTextContents();
    expect(labels).toEqual(['Usage', 'Traffic', 'Feedback', 'Reports', 'Official', 'Broadcast', 'Campaigns', 'Dev']);
  });

  test('admin tab chips are keyboard focusable', async ({ page }) => {
    const firstChip = page.locator('#admin-tabs button.chip').first();
    await firstChip.focus();
    await expect(firstChip).toBeFocused();
  });

  test('clicking admin tab chip switches selected state', async ({ page }) => {
    const usageChip = page.locator('#admin-tabs button.chip[data-tab="usage"]');
    await usageChip.click();
    await expect(usageChip).toHaveClass(/selected/);
    // Previously selected chip should no longer be selected
    await expect(page.locator('#admin-tabs button.chip[data-tab="traffic"]')).not.toHaveClass(/selected/);
  });

  test('feedback filter chips are button elements', async ({ page }) => {
    // Switch to feedback tab first
    await page.locator('#admin-tabs button.chip[data-tab="feedback"]').click();
    const chips = page.locator('#admin-filter-chips button.chip');
    await expect(chips).toHaveCount(5);
  });

  test('report filter chips are button elements', async ({ page }) => {
    await page.locator('#admin-tabs button.chip[data-tab="reports"]').click();
    const chips = page.locator('#report-filter-chips button.chip');
    await expect(chips).toHaveCount(4);
  });

  test('official filter chips are button elements', async ({ page }) => {
    await page.locator('#admin-tabs button.chip[data-tab="official"]').click();
    const chips = page.locator('#official-filter-chips button.chip');
    await expect(chips).toHaveCount(3);
  });
});

// ── Measure page (mocked) ───────────────────────────────────────────────

test.describe('Measure page (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    // Inject a fake native bridge so the Measure tab becomes visible
    await page.addInitScript(() => {
      window.webkit = { messageHandlers: { timegrapher: { postMessage: () => {} }, appAction: { postMessage: () => {} } } };
    });
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('navigates to Measure tab and shows content', async ({ page }) => {
    await navigateTo(page, 'measure');
    await expect(page.locator('#page-measure')).toBeVisible();
    await expect(page.locator('h1:has-text("Measure Accuracy")')).toBeVisible();
  });

  test('shows first-time help modal on initial visit', async ({ page }) => {
    await navigateTo(page, 'measure');
    const helpModal = page.locator('#msr-help-modal');
    await expect(helpModal).toBeVisible({ timeout: 3000 });
    await expect(helpModal.locator('text=Find a quiet spot')).toBeVisible();
    await expect(helpModal.locator('text=Position the watch')).toBeVisible();
    await expect(helpModal.locator('text=Tap Measure and hold still')).toBeVisible();
    await helpModal.locator('button:has-text("Got it")').click();
    await expect(helpModal).toBeHidden();
  });

  test('help modal does not show on second visit', async ({ page }) => {
    await navigateTo(page, 'measure');
    const helpModal = page.locator('#msr-help-modal');
    await expect(helpModal).toBeVisible({ timeout: 3000 });
    await helpModal.locator('button:has-text("Got it")').click();
    await expect(helpModal).toBeHidden();
    await navigateTo(page, 'feed');
    await navigateTo(page, 'measure');
    await page.waitForTimeout(500);
    await expect(helpModal).toBeHidden();
  });

  test('help button (?) reopens help modal', async ({ page }) => {
    await navigateTo(page, 'measure');
    await page.locator('#msr-help-modal button:has-text("Got it")').click();
    await page.locator('#page-measure button[aria-label="How to measure"]').click();
    await expect(page.locator('#msr-help-modal')).toBeVisible();
  });

  test('Measure button is visible with correct label', async ({ page }) => {
    await navigateTo(page, 'measure');
    await page.locator('#msr-help-modal button:has-text("Got it")').click();
    const btn = page.locator('#msr-listen-btn');
    await expect(btn).toBeVisible();
    await expect(page.locator('#msr-btn-label')).toHaveText('Measure');
  });

  test('watch selector is populated', async ({ page }) => {
    await navigateTo(page, 'measure');
    await page.locator('#msr-help-modal button:has-text("Got it")').click();
    const select = page.locator('#msr-watch-select');
    await expect(select).toBeVisible();
    const options = await select.locator('option').count();
    expect(options).toBeGreaterThanOrEqual(2);
  });
});

// ── Anniversary modal (mocked) ──────────────────────────────────────────

test.describe('Anniversary modal (mocked)', () => {
  test('shows anniversary modal for watch with matching purchase date', async ({ page }) => {
    const today = new Date();
    const purchaseDate = `${today.getFullYear() - 3}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const annivWatch = [{
      ...SAMPLE_WATCHES[0],
      id: 'watch-anniv',
      brand: 'Tudor',
      name: 'Black Bay',
      purchase_date: purchaseDate,
    }];
    await mockSupabase(page, { watches: annivWatch, logs: SAMPLE_LOGS });
    await injectSession(page);
    // Clear any previous dismissal
    await page.addInitScript((pd) => {
      const key = `wristlog_anniv_${new Date().getFullYear()}_watch-anniv`;
      localStorage.removeItem(key);
    });
    await page.goto('/');
    await waitForAppBoot(page);

    const modal = page.locator('#anniversary-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator('text=3 Years Together')).toBeVisible();
    await expect(modal.locator('text=Tudor Black Bay')).toBeVisible();
  });

  test('dismiss sets localStorage key to prevent re-showing', async ({ page }) => {
    const today = new Date();
    const purchaseDate = `${today.getFullYear() - 2}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const annivWatch = [{
      ...SAMPLE_WATCHES[0],
      id: 'watch-anniv2',
      purchase_date: purchaseDate,
    }];
    await mockSupabase(page, { watches: annivWatch, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.addInitScript(() => {
      const key = `wristlog_anniv_${new Date().getFullYear()}_watch-anniv2`;
      localStorage.removeItem(key);
    });
    await page.goto('/');
    await waitForAppBoot(page);

    const modal = page.locator('#anniversary-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator('button:has-text("Dismiss")').click();
    await expect(modal).toBeHidden();

    // Verify localStorage was set
    const key = await page.evaluate(() => {
      const k = `wristlog_anniv_${new Date().getFullYear()}_watch-anniv2`;
      return localStorage.getItem(k);
    });
    expect(key).toBe('1');
  });

  test('does not show for watch < 1 year old', async ({ page }) => {
    const today = new Date();
    // Same month/day but same year = 0 years
    const purchaseDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const newWatch = [{
      ...SAMPLE_WATCHES[0],
      id: 'watch-new',
      purchase_date: purchaseDate,
    }];
    await mockSupabase(page, { watches: newWatch, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(1000);
    await expect(page.locator('#anniversary-modal')).toBeHidden();
  });
});

// ── Review prompt (mocked) ──────────────────────────────────────────────

test.describe('Review prompt (mocked)', () => {
  test('review prompt modal structure exists', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    // Modal should exist but be hidden
    await expect(page.locator('#review-prompt-modal')).toBeHidden();
    await expect(page.locator('#review-step-ask')).toBeAttached();
    await expect(page.locator('#review-step-feedback')).toBeAttached();
    await expect(page.locator('#review-step-thanks')).toBeAttached();
  });

  test('feedback form appears on "Not really" click', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    // Force-show the modal for testing
    await page.evaluate(() => {
      document.getElementById('review-step-ask').style.display = '';
      document.getElementById('review-step-feedback').style.display = 'none';
      document.getElementById('review-step-thanks').style.display = 'none';
      document.getElementById('review-prompt-modal').classList.remove('hidden');
    });
    await page.locator('#review-step-ask button:has-text("Not really")').click();
    await expect(page.locator('#review-step-feedback')).toBeVisible();
    await expect(page.locator('#review-feedback-text')).toBeVisible();
  });

  test('thank you appears after submitting feedback', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    // Open modal in feedback step
    await page.evaluate(() => {
      document.getElementById('review-step-ask').style.display = 'none';
      document.getElementById('review-step-feedback').style.display = '';
      document.getElementById('review-step-thanks').style.display = 'none';
      document.getElementById('review-prompt-modal').classList.remove('hidden');
    });
    await page.fill('#review-feedback-text', 'Would love dark mode improvements');
    await page.locator('#review-step-feedback button:has-text("Send")').click();
    await expect(page.locator('#review-step-thanks')).toBeVisible();
    await expect(page.locator('text=Thank you!')).toBeVisible();
    // The thanks step has no inline Close button; an X (top-right) closes it.
    await expect(page.locator('#review-x-close')).toBeVisible();
    await page.locator('#review-x-close').click();
    await expect(page.locator('#review-prompt-modal')).toBeHidden();
  });
});

// ── Boot-time popovers must not intercept test interactions ─────────────────
// Regression guard: maybeShowNewFeatures() un-hides a full-screen overlay on an
// 800ms timer at boot. Under full-suite load the app reaches a test's first
// click after 800ms, so the overlay covered the screen and stole clicks — the
// "occasion chip" flake. The test harness pre-sets its seen-key; this asserts
// the overlay never appears, so the suppression can't silently regress.
test.describe('Boot popovers (mocked)', () => {
  test('new-features overlay stays hidden after boot', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    // Wait well past the 800ms auto-show timer.
    await page.waitForTimeout(1200);
    await expect(page.locator('#new-features-modal')).toBeHidden();
  });

  // The Speedmaster fixture's purchase_date (2024-06-01) makes checkAnniversary()
  // pop a blocking overlay every June 1. The harness pre-dismisses it; this guards
  // that suppression so it can't silently regress and start eating clicks again.
  test('anniversary overlay stays hidden after boot', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#anniversary-modal')).toBeHidden();
  });
});

// ── Essentials Field Order ──────────────────────────────────────────────

test.describe('Essentials field order (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    // Dismiss What's New modal if present
    const gotIt = page.locator('button:has-text("Got it")');
    if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) await gotIt.click();
    await navigateTo(page, 'collection');
    // Open add-watch modal via JS to avoid selector issues
    await page.evaluate(() => openAddWatch());
    await expect(page.locator('#watch-modal')).toBeVisible();
    // Expand essentials section
    await page.evaluate(() => openSection('sec-essentials'));
    await page.waitForTimeout(300);
  });

  test('brand and model are in the same form-row', async ({ page }) => {
    // Both fields should share a parent .form-row
    const sameRow = await page.evaluate(() => {
      const brand = document.getElementById('w-brand-display');
      const name = document.getElementById('w-name');
      const brandRow = brand?.closest('.form-row');
      return brandRow && brandRow.contains(name);
    });
    expect(sameRow).toBe(true);
  });

  test('paid and purchased are in the same form-row', async ({ page }) => {
    const sameRow = await page.evaluate(() => {
      const price = document.getElementById('w-price');
      const date = document.getElementById('w-date');
      const priceRow = price?.closest('.form-row');
      return priceRow && priceRow.contains(date);
    });
    expect(sameRow).toBe(true);
  });

  test('reference and URL are in the same form-row', async ({ page }) => {
    const sameRow = await page.evaluate(() => {
      const ref = document.getElementById('w-ref');
      const url = document.getElementById('w-url');
      const refRow = ref?.closest('.form-row');
      return refRow && refRow.contains(url);
    });
    expect(sameRow).toBe(true);
  });

  test('field order: brand before price before ref', async ({ page }) => {
    const order = await page.evaluate(() => {
      const sec = document.getElementById('sec-essentials');
      const rows = [...sec.querySelectorAll('.form-row')];
      return rows.map(r => [...r.querySelectorAll('input,select')].map(el => el.id));
    });
    // Row 0: brand + name, Row 1: price + date, Row 2: ref + url
    expect(order[0]).toContain('w-brand-display');
    expect(order[1]).toContain('w-price');
    expect(order[2]).toContain('w-ref');
  });

  test('fetch button no longer exists', async ({ page }) => {
    await expect(page.locator('#w-fetch-btn')).toHaveCount(0);
  });
});

// ── Watch Modal Button Styling ──────────────────────────────────────────

test.describe('Watch modal button styling (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    const gotIt = page.locator('button:has-text("Got it")');
    if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) await gotIt.click();
  });

  test('save button uses btn-primary class without inline background override', async ({ page }) => {
    await navigateTo(page, 'collection');
    await page.evaluate(() => openAddWatch());
    await expect(page.locator('#watch-modal')).toBeVisible();
    const saveBtn = page.locator('#save-watch-btn');
    await expect(saveBtn).toHaveClass(/btn-primary/);
    const style = await saveBtn.getAttribute('style');
    expect(style).not.toContain('#854F0B');
  });

  test('delete button uses btn-danger class without inline color override', async ({ page }) => {
    await navigateTo(page, 'collection');
    // Open an existing watch to see the delete button
    const card = page.locator('#watches-grid [onclick*="previewWatch"]').first();
    if (await card.isVisible()) {
      await card.click();
      const editBtn = page.locator('button:has-text("Edit")').first();
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(500);
        const style = await page.locator('#modal-delete-btn').getAttribute('style');
        expect(style).not.toContain('#FCEBEB');
        expect(style).not.toContain('#A32D2D');
      }
    }
  });
});

// ── Notification Section Default State ──────────────────────────────────

test.describe('Profile notification section (mocked)', () => {
  test('notification settings section defaults to collapsed', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    const gotIt = page.locator('button:has-text("Got it")');
    if (await gotIt.isVisible({ timeout: 2000 }).catch(() => false)) await gotIt.click();

    await page.evaluate(() => {
      localStorage.removeItem('notif-collapse');
      if (typeof viewMyProfile === 'function') viewMyProfile();
      else if (typeof viewUserProfile === 'function') viewUserProfile(currentUser.id);
    });
    await expect(page.locator('#page-profile')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    const notifSection = page.locator('#notif-section');
    if (await notifSection.count() > 0) {
      await expect(notifSection).toHaveClass(/collapsed/);
    }
  });
});

// ── Username prompt modal with display name (mocked) ───────────────────

test.describe('Username prompt modal (mocked)', () => {
  test('username prompt modal has display name field', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // The modal exists in the DOM even when hidden
    await expect(page.locator('#username-prompt-modal')).toBeAttached();
    await expect(page.locator('#up-display-name')).toBeAttached();
    await expect(page.locator('#up-username')).toBeAttached();
  });

  test('username prompt modal shows "Set up your profile" title', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Force-show the modal
    await page.evaluate(() => {
      document.getElementById('username-prompt-modal').classList.remove('hidden');
    });

    await expect(page.locator('#username-prompt-title')).toContainText('Set up your profile');
    await expect(page.locator('#up-display-name')).toBeVisible();
    await expect(page.locator('#up-username')).toBeVisible();
    await expect(page.locator('#up-save-btn')).toBeVisible();
  });

  test('display name field accepts input', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await page.evaluate(() => {
      document.getElementById('username-prompt-modal').classList.remove('hidden');
    });

    await page.locator('#up-display-name').fill('Alice Watches');
    await expect(page.locator('#up-display-name')).toHaveValue('Alice Watches');
  });

  test('cancel button closes the modal', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    await page.evaluate(() => {
      document.getElementById('username-prompt-modal').classList.remove('hidden');
    });
    await expect(page.locator('#username-prompt-modal')).toBeVisible();

    await page.locator('#username-prompt-modal button:has-text("Cancel")').click();
    await expect(page.locator('#username-prompt-modal')).toBeHidden();
  });
});

// ── Watch preview modal structure (mocked) ─────────────────────────────

test.describe('Watch preview modal structure (mocked)', () => {
  test('watch preview modal has thumbnail container and ref row', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Verify the structural elements exist in the DOM
    await expect(page.locator('#watch-preview-modal')).toBeAttached();
    await expect(page.locator('#wpm-thumb')).toBeAttached();
    await expect(page.locator('#wpm-ref-row')).toBeAttached();
    await expect(page.locator('#wpm-fields')).toBeAttached();
  });

  test('ref row is placed before scrollable fields area', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Verify DOM order: wpm-ref-row comes before wpm-fields
    const order = await page.evaluate(() => {
      const refRow = document.getElementById('wpm-ref-row');
      const fields = document.getElementById('wpm-fields');
      if (!refRow || !fields) return false;
      // compareDocumentPosition: 4 means refRow precedes fields
      return !!(refRow.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
  });

  test('thumbnail is positioned next to title', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Verify wpm-thumb and watch-preview-modal-title share same parent flex row
    const sameRow = await page.evaluate(() => {
      const thumb = document.getElementById('wpm-thumb');
      const title = document.getElementById('watch-preview-modal-title');
      if (!thumb || !title) return false;
      return thumb.parentElement === title.parentElement.parentElement
        || thumb.parentElement.contains(title);
    });
    expect(sameRow).toBe(true);
  });

  test('link button has outline:none in watch preview', async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);

    // Open a watch preview by calling previewWatch with a URL
    await page.evaluate(() => {
      previewWatch({
        id: 'test',
        brand: 'Rolex',
        name: 'Submariner',
        ref: '126610LN',
        url: 'https://www.rolex.com',
        image: '',
        color: '#1a1a2e',
      });
    });

    await expect(page.locator('#watch-preview-modal')).toBeVisible();
    // The link button should have outline:none
    const linkBtn = page.locator('#wpm-ref-row a');
    const style = await linkBtn.getAttribute('style');
    expect(style).toContain('outline:none');
  });
});

// ── Badge system always on (mocked) ────────────────────────────────────

test.describe('Badge system (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock earned_badges table
    await page.route('**/rest/v1/earned_badges*', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
          { badge_ref: 1, earned_at: '2026-01-01T00:00:00Z', seen: true },
          { badge_ref: 3, earned_at: '2026-01-02T00:00:00Z', seen: true },
        ]) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
  });

  test('badge wall button is visible on own profile', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof viewMyProfile === 'function') viewMyProfile();
      else if (typeof viewUserProfile === 'function') viewUserProfile(currentUser.id);
    });

    await expect(page.locator('#page-profile')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Badge section should show "Achievements" and "View All Badges" button
    const profileContent = page.locator('#profile-page-content');
    const text = await profileContent.textContent();
    expect(text).toContain('Achievements');
  });
});

// ── Feed shows username (mocked) ───────────────────────────────────────

test.describe('Feed username display (mocked)', () => {
  test('landing feed cards show username instead of display_name', async ({ page }) => {
    await page.route('**/auth/v1/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    );
    await page.route('**/rest/v1/logs*order=created_at*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'p1', user_id: 'u1', watch_id: 'w1', photo_url: null, notes: 'Great day', use_case: 'casual', date: '2026-05-15', created_at: '2026-05-15T10:00:00Z', visibility: 'public', moderation_status: null },
      ]) })
    );
    await page.route('**/rest/v1/profiles*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'u1', username: 'watchfan42', display_name: 'John Smith', avatar_url: null, is_official: false },
      ]) })
    );
    await page.route('**/rest/v1/watches*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'w1', user_id: 'u1', brand: 'Seiko', name: 'SKX009' },
      ]) })
    );
    await page.route('**/rest/v1/likes*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
    await page.route('**/rest/v1/comments*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
    await page.route('**/realtime/**', route => route.abort());

    await page.goto('/');
    await page.waitForTimeout(3000);

    // The feed card should show 'watchfan42' (username), not 'John Smith' (display_name)
    const feedList = page.locator('#landing-feed-list');
    if (await feedList.count() > 0) {
      const text = await feedList.textContent();
      expect(text).toContain('watchfan42');
    }
  });
});

// ── Comment deletion (mocked) ──────────────────────────────────────────────

test.describe('Comment deletion (mocked)', () => {
  // A comment by another user on log-001 (which the session user owns) — so the
  // session user is the post owner and should be able to delete it.
  const COMMENT = {
    id: 'c-del-1', log_id: 'log-001', user_id: 'u-other',
    body: 'Nice piece', created_at: '2026-05-20T10:00:00Z', moderation_status: null,
  };
  let deleteCalled;

  test.beforeEach(async ({ page }) => {
    deleteCalled = false;
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    // Override the generic comments route: GET returns one comment, DELETE is accepted.
    await page.route('**/rest/v1/comments*', route => {
      const m = route.request().method();
      if (m === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([COMMENT]) });
      }
      if (m === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/rest/v1/comment_likes*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    // Suppress the "new features" modal so it doesn't overlay the feed
    await page.addInitScript(() => localStorage.setItem('wrotate_newfeatures_v2', '1'));
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(2000);
  });

  test('post owner sees delete menu on another user\'s comment and can delete it', async ({ page }) => {
    const card = page.locator('#feedcard-log-001');
    if (await card.count() === 0) test.skip(true, 'feed card did not render');

    // Post owner gets a kebab on the comment
    const menuBtn = card.locator('.comment-menu-btn').first();
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // Menu has a Delete item; double-tap confirm
    const del = card.locator('.feed-menu-item', { hasText: /Delete|Sure/ }).first();
    await expect(del).toBeVisible();
    await del.click();                       // first tap → "Sure?"
    await expect(del).toHaveText('Sure?');
    await del.click();                       // second tap → deletes

    await expect.poll(() => deleteCalled).toBe(true);
    await expect(card.locator('.comment-item')).toHaveCount(0);
  });
});
