import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot,
  SAMPLE_WATCHES,
} from './helpers.js';

// Feed first: at boot only what the feed's first render needs goes out; the
// collection reads, profile, experiments, presence… wait until the feed has
// painted (or failed), the user leaves the Feed tab, or 3 s pass. Measured
// reason: a cold API server answers the FIRST burst of a visit 2–3 s late
// however trivial each request is, so the burst must be small.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));
const LOGS = '**/rest/v1/logs*';
const isFeedQuery = url => url.includes('select=id%2Cuser_id');   // FEED_LOG_COLS; loadUserData's logs read selects id,watch_id,…
const DEFERRED = ['/rpc/my_watches', '/rest/v1/wishlist', '/rest/v1/brands', '/rpc/my_profile', '/rpc/get_experiments', '/rest/v1/follow_requests'];

async function start(page) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  let release; const gate = new Promise(r => { release = r; });
  const hold = async route => { if (route.request().method() === 'GET' && isFeedQuery(route.request().url())) await gate; return route.fallback(); };
  await page.route(LOGS, hold);
  const seen = [];
  page.on('request', r => { const hit = DEFERRED.find(d => r.url().includes(d)); if (hit) seen.push(hit); });
  await page.goto('/');
  await waitForAppBoot(page);
  return { seen, release, done: () => page.unroute(LOGS, hold) };
}

test('nothing but the feed goes out until the feed has painted', async ({ page }) => {
  const { seen, release, done } = await start(page);
  await page.waitForTimeout(1200);
  expect(seen).toEqual([]);                                   // feed still in flight → the rest is waiting
  release();
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect.poll(() => DEFERRED.every(d => seen.includes(d))).toBe(true);
  await done();
});

test('a feed that never answers cannot hold the rest of boot past 3 s', async ({ page }) => {
  const { seen, done, release } = await start(page);
  await page.waitForTimeout(1500);
  expect(seen).toEqual([]);
  await expect.poll(() => seen.includes('/rpc/my_watches'), { timeout: 4000 }).toBe(true);
  release();
  await done();
});

test('leaving the Feed tab lets the rest of boot go at once', async ({ page }) => {
  const { seen, done, release } = await start(page);
  await page.waitForTimeout(400);
  expect(seen).toEqual([]);
  await page.click('nav button[data-page="collection"]');
  await expect.poll(() => seen.includes('/rpc/my_watches'), { timeout: 1500 }).toBe(true);
  release();
  await done();
});
