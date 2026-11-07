import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Wishlist sort pills (2026-11-06): the Ranking Game moved from the header
// into a Collection-style sort bar, joined by Newest and My Ranking pills.
// No pill active = the user's own drag order; the active pill toggles off;
// drag-reorder is suspended while a sort is applied.

const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Daytona', wish_privacy: 'public',
    sort_order: 0, added_date: '2026-01-10', elo_rating: 1100 },
  { id: 'wl2', brand: 'Omega', name: 'Snoopy', wish_privacy: 'public',
    sort_order: 1, added_date: '2026-05-02', elo_rating: 900 },
  { id: 'wl3', brand: 'Tudor', name: 'BB58', wish_privacy: 'public',
    sort_order: 2, added_date: '2026-03-20', elo_rating: 1300 },
];

async function openWishlist(page, wl = WL) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: wl });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'wishlist');
  await expect(page.locator('#wishlist-grid .wl-card').first()).toBeVisible();
}

const names = page => page.locator('#wishlist-grid .wl-card .wl-name');

test('Rank chip lives in the sort bar (not the header) and opens the Ranking Game', async ({ page }) => {
  await openWishlist(page);
  await expect(page.locator('#page-wishlist .wl-actions #wl-rank-btn')).toHaveCount(0);
  const rank = page.locator('#wl-sort-bar #wl-rank-btn');
  await expect(rank).toBeVisible();
  await rank.click();
  await expect(page.locator('#game-overlay')).toBeVisible();
});

test('Newest and My Ranking pills sort a copy; toggling off restores drag order', async ({ page }) => {
  await openWishlist(page);
  // Default: the user's own sort_order
  await expect(names(page)).toHaveText(['Daytona', 'Snoopy', 'BB58']);
  await expect(page.locator('#wishlist-grid .drag-handle').first()).toBeVisible();

  await page.locator('#wl-sort-bar .coll-sort-chip', { hasText: 'Newest' }).click();
  await expect(names(page)).toHaveText(['Snoopy', 'BB58', 'Daytona']);
  // Reordering a sorted list is meaningless, so the handles go away
  await expect(page.locator('#wishlist-grid .drag-handle')).toHaveCount(0);

  await page.locator('#wl-sort-bar .coll-sort-chip', { hasText: 'My Ranking' }).click();
  await expect(names(page)).toHaveText(['BB58', 'Daytona', 'Snoopy']);

  // Tapping the active pill returns to the drag order, handles back
  await page.locator('#wl-sort-bar .coll-sort-chip.active').click();
  await expect(names(page)).toHaveText(['Daytona', 'Snoopy', 'BB58']);
  await expect(page.locator('#wishlist-grid .drag-handle').first()).toBeVisible();
});

test('My Ranking pill waits for the Ranking Game, like Collection', async ({ page }) => {
  await openWishlist(page, WL.map(w => ({ ...w, elo_rating: null })));
  await expect(page.locator('#wl-sort-bar .coll-sort-chip', { hasText: 'Newest' })).toBeVisible();
  await expect(page.locator('#wl-sort-bar .coll-sort-chip', { hasText: 'My Ranking' })).toHaveCount(0);
});
