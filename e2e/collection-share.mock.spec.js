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

// Phone layout: the select bar keeps all six controls on one row, and the sort
// bar (Rank + three sorts + Post Pics) never pushes the toggle past the edge.
test('at 390px the select bar is one row and the sort bar does not spill', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const logs = SAMPLE_LOGS.map((l, i) => i === 0 ? { ...l, photo_url: 'https://example.com/p.jpg' } : l);
  await mockSupabase(page, { watches: WATCHES, logs });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => setCollView('grid'));
  await navigateTo(page, 'collection');
  await page.evaluate(() => { eloRatings[watches[0].id] = 1500; renderCollection(true); });
  await expect(page.locator('.coll-photo-toggle')).toHaveCount(1);
  await page.click('#coll-share-btn');
  const report = await page.evaluate(() => {
    const rowsOf = sel => {
      const kids = [...document.querySelectorAll(sel)].filter(c => c.getClientRects().length);
      const centers = kids.map(c => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; }).sort((a, b) => a - b);
      const rows = centers.reduce((acc, y) => { if (!acc.length || y - acc[acc.length - 1] > 12) acc.push(y); return acc; }, []);
      const spills = kids.filter(c => c.getBoundingClientRect().right > window.innerWidth + 1).length;
      return { rows: rows.length, spills, count: kids.length };
    };
    return { select: rowsOf('#coll-select-bar > *'), sort: rowsOf('.coll-sort-bar > *') };
  });
  expect(report.select.count).toBe(7);            // count, all, none, spacer, links, cancel, share
  expect(report.select.rows, JSON.stringify(report.select)).toBe(1);
  expect(report.select.spills).toBe(0);
  expect(report.sort.spills, JSON.stringify(report.sort)).toBe(0);
  expect(report.sort.rows, JSON.stringify(report.sort)).toBe(1);
});

test('Shared links shows comment counts, expands the thread, and deletes a comment', async ({ page }) => {
  await openCollection(page);
  await mockMint(page);
  await page.route('**/rest/v1/share_comments*', route => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'c1', token: 'existingtoken000000000000000002', name: 'Sarah', body: 'Is the GMT available?', created_at: '2026-08-22T10:00:00Z', deleted_at: null },
      { id: 'c2', token: 'existingtoken000000000000000002', name: 'Tom', body: 'Lovely set', created_at: '2026-08-22T11:00:00Z', deleted_at: null },
    ]) });
  });
  await page.click('#coll-share-btn');
  await page.click('#coll-share-links');
  await expect(page.locator('[data-thread="existingtoken000000000000000002"]')).toContainText('2 comments');
  await page.click('[data-thread="existingtoken000000000000000002"]');
  await expect(page.locator('.share-thread')).toContainText('Is the GMT available?');
  await page.click('[data-delete-comment="c1"]');
  await expect(page.locator('.share-thread')).not.toContainText('Is the GMT available?');
  await expect(page.locator('[data-thread="existingtoken000000000000000002"]')).toContainText('1 comment');
});
