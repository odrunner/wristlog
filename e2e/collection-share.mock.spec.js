import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Three watches: one public-by-default, one private, one followers-only.
const WATCHES = [
  { ...SAMPLE_WATCHES[0], id: 'w1', watch_privacy: null },
  { ...SAMPLE_WATCHES[1], id: 'w2', watch_privacy: 'private' },
  { ...SAMPLE_WATCHES[0], id: 'w3', brand: 'Tudor', name: 'Black Bay 58', ref: '79030N', watch_privacy: 'followers' },
];

async function openCollection(page) {
  await mockSupabase(page, { watches: WATCHES, logs: SAMPLE_LOGS });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => setCollView('grid'));
  await navigateTo(page, 'collection');
  await expect(page.locator('#page-collection')).toBeVisible();
}

test('Share button turns the collection into a selection surface', async ({ page }) => {
  await openCollection(page);
  await expect(page.locator('#coll-select-bar')).toBeHidden();
  await page.click('#coll-share-btn');
  await expect(page.locator('#coll-select-bar')).toBeVisible();
  await expect(page.locator('.coll-select-box')).toHaveCount(3);
  await expect(page.locator('#coll-select-count')).toHaveText('0 selected');
  await expect(page.locator('#coll-share-go')).toBeDisabled();
});

test('ticking a watch enables Share and counts it', async ({ page }) => {
  await openCollection(page);
  await page.click('#coll-share-btn');
  await page.locator('.coll-select-box').first().click();
  await expect(page.locator('#coll-select-count')).toHaveText('1 selected');
  await expect(page.locator('#coll-share-go')).toBeEnabled();
});

test('the selection survives a switch to gallery view', async ({ page }) => {
  await openCollection(page);
  await page.click('#coll-share-btn');
  await page.locator('.coll-select-box').first().click();
  await page.evaluate(() => setCollView('gallery'));
  await expect(page.locator('#coll-select-count')).toHaveText('1 selected');
  await expect(page.locator('.coll-select-box')).toHaveCount(3);
});

test('Select all and Clear move the whole collection', async ({ page }) => {
  await openCollection(page);
  await page.click('#coll-share-btn');
  await page.click('#coll-select-all');
  await expect(page.locator('#coll-select-count')).toHaveText('3 selected');
  await page.click('#coll-select-none');
  await expect(page.locator('#coll-select-count')).toHaveText('0 selected');
});

// In selection mode a tap must toggle, not open the editor.
test('tapping a card toggles instead of opening the editor', async ({ page }) => {
  await openCollection(page);
  await page.click('#coll-share-btn');
  await page.locator('.watch-card .watch-card-name').first().click();
  await expect(page.locator('#watch-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#coll-select-count')).toHaveText('1 selected');
});

test('Cancel leaves selection mode and restores the header', async ({ page }) => {
  await openCollection(page);
  await page.click('#coll-share-btn');
  await page.locator('.coll-select-box').first().click();
  await page.click('#coll-select-cancel');
  await expect(page.locator('#coll-select-bar')).toBeHidden();
  await expect(page.locator('.coll-select-box')).toHaveCount(0);
  await expect(page.locator('#coll-share-btn')).toBeVisible();
});

test('selection bar hides when the collection empties while in selection mode', async ({ page }) => {
  await openCollection(page);
  await page.click('#coll-share-btn');
  await expect(page.locator('#coll-select-bar')).toBeVisible();
  await page.evaluate(() => {
    watches.length = 0;
    renderCollection(true);
  });
  await expect(page.locator('#coll-select-bar')).toBeHidden();
  await expect(page.locator('#coll-share-btn')).toBeHidden();
});

// The mocked POST echoes the inserted row back, as PostgREST does.
async function mockMint(page) {
  await page.route('**/rest/v1/collection_shares*', route => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify([{ ...body, views: 0, created_at: '2026-08-22T09:00:00Z', revoked_at: null }]),
      });
    }
    if (method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          token: 'existingtoken000000000000000002', label: 'For the insurer',
          item_ids: ['w1'], views: 4, created_at: '2026-08-21T09:00:00Z', revoked_at: null,
        }]),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('the share sheet reports the count and flags non-public watches', async ({ page }) => {
  await openCollection(page);
  await mockMint(page);
  await page.click('#coll-share-btn');
  await page.click('#coll-select-all');
  await page.click('#coll-share-go');
  await expect(page.locator('#coll-share-modal')).toBeVisible();
  await expect(page.locator('#coll-share-compose')).toContainText('3 watches');
  await expect(page.locator('#coll-share-private-note')).toContainText('2 private items');
});

test('creating a link shows a copyable share-watches URL rather than sharing straight away', async ({ page }) => {
  await openCollection(page);
  await mockMint(page);
  await page.click('#coll-share-btn');
  await page.locator('.coll-select-box').first().click();
  await page.click('#coll-share-go');
  await page.fill('#coll-share-label', 'For the insurer');
  await page.click('#coll-share-create');
  await expect(page.locator('#coll-share-done')).toBeVisible();
  const url = await page.locator('#coll-share-url').textContent();
  expect(url).toContain('/functions/v1/share-watches?t=');
});

test('the minted row carries only the ticked ids and the label', async ({ page }) => {
  await openCollection(page);
  let posted = null;
  await page.route('**/rest/v1/collection_shares*', route => {
    if (route.request().method() === 'POST') {
      posted = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([posted]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.click('#coll-share-btn');
  await page.locator('.coll-select-box').nth(2).click();   // Tudor only
  await page.click('#coll-share-go');
  await page.fill('#coll-share-label', 'Dealer');
  await page.click('#coll-share-create');
  await expect(page.locator('#coll-share-done')).toBeVisible();
  expect(posted.item_ids).toEqual(['w3']);
  expect(posted.label).toBe('Dealer');
  expect(posted.token).toMatch(/^[0-9a-f]{32}$/);
  expect(Object.keys(posted).sort()).toEqual(['item_ids', 'label', 'token', 'user_id']);
});

test('existing links are listed and can be revoked', async ({ page }) => {
  await openCollection(page);
  await mockMint(page);
  await page.click('#coll-share-btn');
  await page.click('#coll-share-links');
  await expect(page.locator('#coll-share-modal')).toContainText('For the insurer');
  await expect(page.locator('#coll-share-modal')).toContainText('4 views');
  await page.click('[data-revoke="existingtoken000000000000000002"]');
  await expect(page.locator('#coll-share-modal')).not.toContainText('For the insurer');
});
