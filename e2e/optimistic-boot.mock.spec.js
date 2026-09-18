import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// getSession() refreshes an expired access token over the network before it
// resolves. The app must not wait for that: it boots from the session stored
// in localStorage, paints the cached feed, and only signs out when getSession()
// settles with definitively no session — never while a refresh merely hangs or
// fails with a network error. The helper's getSession option shapes that
// settle; the SDK's own refresh path is bypassed in the mocked suite.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00Z`,
  use_case: 'work', notes: `Post ${i}`, strap_id: null, photo_url: null, visibility: 'public', club_id: null,
}));
const RETRYABLE = { __isAuthError: true, name: 'AuthRetryableFetchError', message: 'Failed to fetch' };

const spyPostHog = page => page.addInitScript(() => {
  window.__ph = [];
  window.posthog = { __SV: 1, init() {}, identify() {}, capture(name, props) { window.__ph.push({ name, props }); } };
});

async function warmCache(page) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect.poll(() => page.evaluate(id => localStorage.getItem('wrotate_feed_cache_' + id), FAKE_USER.id)).not.toBe(null);
}

test('a slow getSession() no longer gates boot: cached feed is up long before it settles', async ({ page }) => {
  await warmCache(page);

  await injectSession(page, FAKE_USER, { getSession: { delayMs: 6000 } });
  await spyPostHog(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  const t0 = Date.now();
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  expect(Date.now() - t0).toBeLessThan(4000);

  // getSession() settles with the same user: still up, and the event says how we booted.
  await page.waitForTimeout(6500);
  await expect(page.locator('#auth-screen')).toBeHidden();
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  // Every REST call queued behind the slow getSession() too, so the Phase-2
  // render that sends the event lands only after it settled.
  const events = () => page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));
  await expect.poll(() => events().then(e => e.length), { timeout: 15_000 }).toBe(1);
  expect((await events())[0].props.optimistic_boot).toBe(true);
});

test('a retryable refresh failure keeps the stored session and the app up', async ({ page }) => {
  await warmCache(page);
  await injectSession(page, FAKE_USER, { getSession: { delayMs: 300, result: { data: { session: null }, error: RETRYABLE } } });
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('#auth-screen')).toBeHidden();
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
});

test('definitively no session after an optimistic boot signs the user out', async ({ page }) => {
  await warmCache(page);
  await injectSession(page, FAKE_USER, { getSession: { delayMs: 300, result: { data: { session: null }, error: null } } });
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.goto('/');
  await expect(page.locator('#auth-screen')).toBeVisible({ timeout: 5000 });
  // Signed out for real: the cached feed of the previous account is gone too.
  expect(await page.evaluate(id => localStorage.getItem('wrotate_feed_cache_' + id), FAKE_USER.id)).toBeNull();
});
