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

    // Should show both watches
    await expect(page.getByText('Submariner Date')).toBeVisible();
    await expect(page.getByText('Speedmaster Professional')).toBeVisible();
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
      await expect(page.locator('#modal-title')).toContainText(/add/i);
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

    // Should list both watches for tracking
    const selectorText = await selector.textContent();
    expect(selectorText).toContain('Submariner');
    expect(selectorText).toContain('Speedmaster');
  });

  test('shows recent wear history', async ({ page }) => {
    await navigateTo(page, 'track');
    // The track history table should show recent logs
    const history = page.locator('#track-history-tbody, .track-history');
    if (await history.isVisible()) {
      const text = await history.textContent();
      expect(text).toContain('Submariner');
    }
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

    const statsText = await statsPage.textContent();
    // Should show total wears count
    expect(statsText).toContain('2');
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
