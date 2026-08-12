import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Two Rolexes (so there is a real folder to take in one tap) and one Omega.
const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Cosmograph Daytona', ref: '126519LN', price: 42700, wish_privacy: 'public', sort_order: 0 },
  { id: 'wl2', brand: 'Rolex', name: 'Submariner', ref: '124060', price: 10200, wish_privacy: 'private', sort_order: 1 },
  { id: 'wl3', brand: 'Omega', name: 'Speedmaster', ref: '310.30', wish_privacy: 'public', sort_order: 2 },
];

async function openWishlist(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'wishlist');
  await expect(page.locator('#page-wishlist')).toBeVisible();
}

test('Share button turns the wishlist into a selection surface', async ({ page }) => {
  await openWishlist(page);
  await expect(page.locator('#wl-select-bar')).toBeHidden();
  await page.click('#wl-share-btn');
  await expect(page.locator('#wl-select-bar')).toBeVisible();
  await expect(page.locator('.wl-select-box')).toHaveCount(3);
  await expect(page.locator('#wl-select-count')).toHaveText('0 selected');
  await expect(page.locator('#wl-share-go')).toBeDisabled();
});

test('ticking an item enables Share and counts it', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
  await expect(page.locator('#wl-share-go')).toBeEnabled();
});

test('a folder checkbox takes every watch of that brand', async ({ page }) => {
  await openWishlist(page);
  await page.click('.wl-view-btn[data-view="folders"]');
  await page.click('#wl-share-btn');
  await page.locator('.wl-folder-select').first().click();   // Omega folder — 1 watch
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
  await page.locator('.wl-folder-select').nth(1).click();    // Rolex folder — 2 watches
  await expect(page.locator('#wl-select-count')).toHaveText('3 selected');
  await page.locator('.wl-folder-select').nth(1).click();    // untick Rolex
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
});

test('the selection survives a view switch', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await page.click('.wl-view-btn[data-view="gallery"]');
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
  await expect(page.locator('.wl-select-box')).toHaveCount(3);
});

test('Select all and Clear move the whole list', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.click('#wl-select-all');
  await expect(page.locator('#wl-select-count')).toHaveText('3 selected');
  await page.click('#wl-select-none');
  await expect(page.locator('#wl-select-count')).toHaveText('0 selected');
});

// In selection mode a tap must toggle, not open the editor — otherwise every
// attempt to pick a watch drops the user into a modal.
test('tapping a card toggles instead of opening the editor', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-card .wl-info').first().click();
  await expect(page.locator('#wishlist-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
});

test('Cancel leaves selection mode and restores the header', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await page.click('#wl-select-cancel');
  await expect(page.locator('#wl-select-bar')).toBeHidden();
  await expect(page.locator('.wl-select-box')).toHaveCount(0);
  await expect(page.locator('#wl-share-btn')).toBeVisible();
});

test('selection bar hides when wishlist empties while in selection mode', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await expect(page.locator('#wl-select-bar')).toBeVisible();
  // Empty the wishlist the way a sync would, by evaluating in the page
  await page.evaluate(() => {
    wishlist.length = 0;
    renderWishlist(true);
  });
  // Bar and Share button should both be hidden
  await expect(page.locator('#wl-select-bar')).toBeHidden();
  await expect(page.locator('#wl-share-btn')).toBeHidden();
});

// The mocked POST echoes the inserted row back, as PostgREST does.
async function mockMint(page) {
  await page.route('**/rest/v1/wishlist_shares*', route => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify([{ ...body, views: 0, created_at: '2026-08-11T09:00:00Z', revoked_at: null }]),
      });
    }
    if (method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          token: 'existingtoken000000000000000001', label: 'Watches of Switzerland',
          item_ids: ['wl1'], views: 4, created_at: '2026-08-10T09:00:00Z', revoked_at: null,
        }]),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('the share sheet reports the count and flags private items', async ({ page }) => {
  await openWishlist(page);
  await mockMint(page);
  await page.click('#wl-share-btn');
  await page.click('#wl-select-all');
  await page.click('#wl-share-go');
  await expect(page.locator('#wl-share-modal')).toBeVisible();
  await expect(page.locator('#wl-share-compose')).toContainText('3 watches');
  await expect(page.locator('#wl-share-private-note')).toContainText('1 private item');
});

test('creating a link shows a copyable URL rather than sharing straight away', async ({ page }) => {
  await openWishlist(page);
  await mockMint(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await page.click('#wl-share-go');
  await page.fill('#wl-share-label', 'Watches of Switzerland');
  await page.click('#wl-share-create');
  await expect(page.locator('#wl-share-done')).toBeVisible();
  const url = await page.locator('#wl-share-url').textContent();
  expect(url).toContain('/functions/v1/share-wishlist?t=');
});

test('the minted row carries only the ticked ids and the label', async ({ page }) => {
  await openWishlist(page);
  let posted = null;
  await page.route('**/rest/v1/wishlist_shares*', route => {
    if (route.request().method() === 'POST') {
      posted = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([posted]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').nth(2).click();   // Omega only
  await page.click('#wl-share-go');
  await page.fill('#wl-share-label', 'Dealer');
  await page.click('#wl-share-create');
  await expect(page.locator('#wl-share-done')).toBeVisible();
  expect(posted.item_ids).toEqual(['wl3']);
  expect(posted.label).toBe('Dealer');
  expect(posted.token).toMatch(/^[0-9a-f]{32}$/);
});

test('existing links are listed and can be revoked', async ({ page }) => {
  await openWishlist(page);
  await mockMint(page);
  await page.click('#wl-share-btn');
  await page.click('#wl-share-links');
  await expect(page.locator('#wl-share-modal')).toContainText('Watches of Switzerland');
  await expect(page.locator('#wl-share-modal')).toContainText('4 views');
  await page.click('[data-revoke="existingtoken000000000000000001"]');
  await expect(page.locator('#wl-share-modal')).not.toContainText('Watches of Switzerland');
});
