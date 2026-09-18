import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES,
} from './helpers.js';

// The head's early-fetch script starts the feed's public + own-posts queries
// before the 1.4 MB boot script has arrived; loadFeed() must use those results
// rather than issue the same queries again. supabase-js stamps x-client-info on
// every request it makes, so a request without it came from the early script.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));

const spyPostHog = page => page.addInitScript(() => {
  window.__ph = [];
  window.posthog = { __SV: 1, init() {}, identify() {}, capture(name, props) { window.__ph.push({ name, props }); } };
});

test('the feed is built from the early-fetched queries, not a second copy of them', async ({ page }) => {
  await injectSession(page);
  await spyPostHog(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  const publicReqs = [];
  page.on('request', r => {
    // First-page public query only: load-more reuses the visibility filter but
    // adds a keyset (or=…) cursor, and fires as soon as the sentinel is in view.
    const u = r.url();
    if (r.method() === 'GET' && u.includes('/rest/v1/logs') && u.includes('visibility=eq.public') && !u.includes('or='))
      publicReqs.push({ early: !r.headers()['x-client-info'], url: decodeURIComponent(u.split('/rest/v1/')[1]) });
  });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);

  expect(publicReqs.map(r => r.url)).toHaveLength(1);
  expect(publicReqs[0].early).toBe(true);
  const events = () => page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));
  await expect.poll(() => events().then(e => e.length)).toBe(1);
  expect((await events())[0].props.early_feed).toBe(true);
});

test('a failed early fetch is absorbed by the normal retry', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  const failEarly = route => (route.request().method() === 'GET' && !route.request().headers()['x-client-info'])
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
    : route.fallback();
  await page.route('**/rest/v1/logs*', failEarly);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await page.unroute('**/rest/v1/logs*', failEarly);
});
