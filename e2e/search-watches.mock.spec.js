import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Unified search sheet — the people search modal also finds watch models
// (browse_watch_models RPC) and a watch row jumps to its model page.

// 1x1 transparent PNG — a real loadable image so the thumbnail-size assertion
// measures what a user with a model photo sees.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const MODEL = { id: 'aaaaaaaa-0000-0000-0000-000000000009', brand: 'Omega', name: 'Speedmaster', slug: 'omega-speedmaster', owners: 3, image: TINY_PNG };
const PERSON = { id: 'bbbbbbbb-0000-0000-0000-000000000001', username: 'speedyfan', display_name: 'Speedy Fan', avatar_url: null, profile_privacy: 'public' };

async function openSearchSheet(page, { modelsStatus = 200 } = {}) {
  await mockSupabase(page, {});
  await page.route('**/rest/v1/rpc/browse_watch_models*', route => {
    if (modelsStatus !== 200) return route.fulfill({ status: modelsStatus, contentType: 'application/json', body: '{"message":"boom"}' });
    const body = route.request().postDataJSON() || {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((body.p_q || '').includes('speed') ? [MODEL] : []) });
  });
  // People search is a GET on profiles with an or=ilike filter.
  await page.route('**/rest/v1/profiles*', route => {
    const url = route.request().url();
    if (route.request().method() === 'GET' && url.includes('or=')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([PERSON]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.locator('#page-feed button', { hasText: /people|search/i }).first().click();
  await expect(page.locator('#discover-modal')).toBeVisible();
}

test('search finds watches and opens the model page', async ({ page }) => {
  await openSearchSheet(page);
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 3, era_min: null, era_max: null, visible: [] }),
  }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: MODEL.id, brand: 'Omega', name: 'Speedmaster', specs: {}, facts_key: null }),
  }));
  await page.locator('#discover-search').fill('speed');
  const watchResults = page.locator('#discover-watch-results');
  await expect(watchResults).toContainText('Watches');
  await expect(watchResults).toContainText('Omega Speedmaster');
  // The model photo is a small avatar-sized thumbnail, never a hero image.
  const thumb = watchResults.locator('[data-mid] img').first();
  await expect(thumb).toBeVisible();
  const box = await thumb.boundingBox();
  expect(box.width).toBeLessThanOrEqual(48);
  expect(box.height).toBeLessThanOrEqual(48);
  // People group renders too, above the watches group.
  await expect(page.locator('#discover-results')).toContainText('Speedy Fan');
  await watchResults.locator('[data-mid]').first().click();
  await expect(page.locator('#discover-modal')).toBeHidden();
  await expect(page.locator('#page-model')).toHaveClass(/active/);
});

test('header search pill opens the sheet and Post still posts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockSupabase(page, {});
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  // Chip + pill + post share one line even at the narrowest phone width.
  const tops = await page.evaluate(() => ['#feed-scope-chip', '.feed-search-pill', '#feed-post-btn']
    .map(s => document.querySelector(s).getBoundingClientRect().top));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(10);
  await page.locator('.feed-search-pill').click();
  await expect(page.locator('#discover-modal')).toBeVisible();
  await page.locator('#discover-modal .modal-actions button', { hasText: 'Close' }).click();
  await page.locator('#feed-post-btn').click();
  await expect(page.locator('#new-post-modal')).toBeVisible();
});

test('one group failing keeps the other', async ({ page }) => {
  await openSearchSheet(page, { modelsStatus: 500 });
  await page.locator('#discover-search').fill('speed');
  await expect(page.locator('#discover-results')).toContainText('Speedy Fan');
  await expect(page.locator('#discover-watch-results')).not.toContainText('Watches');
});
