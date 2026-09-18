import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// A refresh that fails while last visit's feed is on screen must keep those
// cards and say the refresh failed — not replace them with the empty
// "Couldn't load your feed" screen (which is what an offline PWA launch used
// to show a moment after painting the cached feed).

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));
const LOGS_GET = '**/rest/v1/logs*';
// Same pattern mockSupabase uses, so unroute(pattern) alone would drop the mock
// too — always add and remove this exact handler.
const failLogs = route => route.request().method() === 'GET'
  ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
  : route.fallback();

async function visit(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
}

test('failed refresh keeps the cached cards and offers a retry', async ({ page }) => {
  await injectSession(page);
  await visit(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect.poll(() => page.evaluate(id => localStorage.getItem('wrotate_feed_cache_' + id), FAKE_USER.id)).not.toBe(null);

  // Visit 2: every logs read fails.
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.route(LOGS_GET, failLogs);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');

  await expect(page.locator('#feed-list .feed-stale')).toBeVisible();
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect(page.locator('#feed-list')).not.toContainText("Couldn't load your feed");

  // Network back: retry replaces the chip with a normal feed.
  await page.unroute(LOGS_GET, failLogs);
  await page.locator('#feed-list .feed-stale button').click();
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
});

test('with nothing cached, a failed load still shows the full error screen', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.route(LOGS_GET, failLogs);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list')).toContainText("Couldn't load your feed");
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
});
