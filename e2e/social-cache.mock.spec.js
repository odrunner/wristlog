import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// "Remember who you follow on the device": with the last known follows stored,
// the feed's posts query must not wait for the follows lookup, must not reload
// when that lookup comes back unchanged, and must reload once when it changed.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const NEWLY = '00000000-0000-4000-8000-0000000000ee';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));
const FOLLOWS = '**/rest/v1/follows*';
const followsHandler = (ids, gate) => async route => {
  if (route.request().method() !== 'GET') return route.fallback();
  if (gate) await gate;
  const mine = route.request().url().includes('follower_id=eq.');
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mine ? ids.map(id => ({ following_id: id })) : []) });
};
const spyPostHog = page => page.addInitScript(() => {
  window.__ph = [];
  window.posthog = { __SV: 1, init() {}, identify() {}, capture(name, props) { window.__ph.push({ name, props }); } };
});
const firstPageReqs = page => {
  const seen = [];
  page.on('request', r => { const u = r.url(); if (r.method() === 'GET' && u.includes('/rest/v1/logs') && u.includes('visibility=eq.public') && !u.includes('or=')) seen.push(u); });
  return seen;
};

async function warm(page) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  const h = followsHandler([OTHER]);
  await page.route(FOLLOWS, h);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect.poll(() => page.evaluate(id => localStorage.getItem('wrotate_social_cache_' + id), FAKE_USER.id)).toContain(OTHER);
  await page.unroute(FOLLOWS, h);
  // Drop the feed cache so visit 2's cards can only come from the network.
  await page.evaluate(id => localStorage.removeItem('wrotate_feed_cache_' + id), FAKE_USER.id);
}

// NOTE: the visits under test never click the Feed tab. The feed is the default
// page, and nav('feed') starts a load of its own — which would hide whether the
// BOOT path waited for the follows lookup.

test('the feed loads while the follows lookup is still in flight, and does not reload when it is unchanged', async ({ page }) => {
  await warm(page);
  await spyPostHog(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  let release; const gate = new Promise(r => { release = r; });
  const h = followsHandler([OTHER], gate);
  await page.route(FOLLOWS, h);
  const q1 = firstPageReqs(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);   // follows still held open

  release();
  await page.waitForTimeout(700);
  expect(q1).toHaveLength(1);                                             // same graph → no second load
  const ev = await page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));
  expect(ev[0].props.social_cache).toBe(true);
  await page.unroute(FOLLOWS, h);
});

test('a follow list that changed since the stored copy reloads the feed once', async ({ page }) => {
  await warm(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  let release; const gate = new Promise(r => { release = r; });
  const h = followsHandler([OTHER, NEWLY], gate);
  await page.route(FOLLOWS, h);
  const q1 = firstPageReqs(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  expect(q1).toHaveLength(1);

  release();
  await expect.poll(() => q1.length).toBe(2);
  await page.waitForTimeout(700);
  expect(q1).toHaveLength(2);                                             // once, not a loop
  await expect.poll(() => page.evaluate(id => localStorage.getItem('wrotate_social_cache_' + id), FAKE_USER.id)).toContain(NEWLY);
  await page.unroute(FOLLOWS, h);
});

// feed_page() resolves follows server-side, so even with no stored copy the feed
// no longer waits for the follows lookup (it did before feed_rpc shipped, 2026-09-23).
test('without a stored copy the feed does not wait for the follows lookup', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
  await page.route('**/rest/v1/rpc/feed_page*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ logs: POSTS, profiles: [], watches: [], likes: {}, comments: [], comment_likes: [], facts: [] }) }));
  let release; const gate = new Promise(r => { release = r; });
  const h = followsHandler([OTHER], gate);
  await page.route(FOLLOWS, h);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);   // follows still held
  expect(await page.evaluate(() => _feedViaRpc)).toBe(true);
  release();
  await page.unroute(FOLLOWS, h);
});
