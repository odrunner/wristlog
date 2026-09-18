import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// The feed's first stage (public + own + followed posts) gets one retry. A
// single dropped request must not drop the user to the own-posts fallback;
// and when the fallback IS used, it must not be pinned as "loaded recently".

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));
const LOGS = '**/rest/v1/logs*';
const fail = route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });

async function boot(page) {
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
}

test('one failed request is retried: the full feed loads with no chip', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  let n = 0;
  const flaky = route => (route.request().method() === 'GET' && n++ === 0) ? fail(route) : route.fallback();
  await page.route(LOGS, flaky);
  await boot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  expect(n).toBeGreaterThan(1);
  await page.unroute(LOGS, flaky);
});

test('public posts failing for good: own posts show with a chip, and the next load re-fetches', async ({ page }) => {
  await injectSession(page);
  // Own posts must be visible in the fallback: the mock serves the same logs to every logs GET.
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  const failPublic = route => (route.request().method() === 'GET' && route.request().url().includes('visibility=eq.public'))
    ? fail(route) : route.fallback();
  await page.route(LOGS, failPublic);
  await boot(page);
  await expect(page.locator('#feed-list .feed-stale')).toContainText('showing yours');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);

  // Not pinned: with the network back, a plain loadFeed() (what the 60 s guard
  // would otherwise short-circuit) replaces the partial feed.
  await page.unroute(LOGS, failPublic);
  await page.evaluate(() => loadFeed());
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
});
