// ── Regression: feed resolves watches without exposing financial fields ──────
//
// Feed cards used to read the watches table directly, which the `watches_feed_read`
// RLS policy allowed for any watch attached to a non-private post — handing over the
// whole row, price and insured_value included. They now go through the
// feed_watch_display RPC, which returns ten display columns and nothing else.
//
// Publicly posting a followers/friends-only watch is intended behaviour, so the feed
// must still show the watch. This asserts both halves: the card still resolves, and
// the money never arrives in the browser.
//
// Run: npx playwright test e2e/feed-watch-display.int.spec.js --project=integration

import { test, expect } from '@playwright/test';

const MONEY_FIELDS = ['price', 'insured_value', 'insurance', 'insurance_notes',
                      'receipts', 'purchase_date', 'market_price'];

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/dev-config.js');
  if (!response || response.status() !== 200) {
    test.skip(true, 'dev-config.js not found — skipping integration tests');
  }
});

async function devLogin(page, useSecond = false) {
  await page.goto('/');
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click(useSecond ? 'button:has-text("testuser2")' : '#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

test('feed still resolves watches, and the payload carries no financial fields', async ({ page }) => {
  // Capture what the RPC actually returns over the wire.
  const payloads = [];
  page.on('response', async (res) => {
    if (res.url().includes('/rpc/feed_watch_display')) {
      try { payloads.push(await res.json()); } catch { /* non-JSON */ }
    }
  });

  await devLogin(page, true);
  await page.evaluate(() => window.loadFeed && window.loadFeed());
  await page.waitForTimeout(6000);

  const rows = payloads.flat();
  console.log('[feed] feed_watch_display calls:', payloads.length, 'rows:', rows.length);
  expect(payloads.length, 'feed must call the RPC').toBeGreaterThan(0);

  if (rows.length) {
    console.log('[feed] sample row keys:', Object.keys(rows[0]).join(', '));
    for (const row of rows) {
      for (const f of MONEY_FIELDS) {
        expect(Object.keys(row), `RPC leaked ${f}`).not.toContain(f);
      }
    }
    // A resolved card needs something to display.
    expect(rows.some(r => r.brand || r.name), 'RPC returned no display data').toBe(true);
  }

  // And the feed itself rendered watch labels, i.e. resolution still works end to end.
  const cardWatchLabels = await page.locator('.feed-wearing-watch-name, .feed-watch-chip').count();
  console.log('[feed] rendered watch labels on cards:', cardWatchLabels);
  expect(cardWatchLabels, 'feed cards must still resolve and show their watch').toBeGreaterThan(0);
});
