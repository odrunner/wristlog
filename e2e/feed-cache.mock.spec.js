import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// "Show what you saw last time, then quietly refresh." A returning user gets
// the last rendered feed at DOM-ready — before any network — and the normal
// load then replaces it in place. Drives the real two-visit flow through the
// app (localStorage write on visit 1, read on visit 2) rather than the pure
// helpers, so the boot wiring is what's covered.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const OTHER_USER = { ...FAKE_USER, id: '00000000-0000-4000-8000-0000000000aa', email: 'other@example.com' };

function log({ id, day, createdAt, user = OTHER }) {
  return {
    id, user_id: user, watch_id: 'watch-001',
    date: `2026-08-${String(day).padStart(2, '0')}`,
    created_at: createdAt,
    use_case: 'work', notes: `Post ${id}. `.repeat(4),
    strap_id: null, photo_url: null, visibility: 'public', club_id: null,
  };
}

const POSTS = [
  log({ id: 'p-1', day: 7, createdAt: '2026-08-07T10:00:00Z' }),
  log({ id: 'p-2', day: 6, createdAt: '2026-08-06T10:00:00Z' }),
  log({ id: 'p-3', day: 5, createdAt: '2026-08-05T10:00:00Z' }),
];

const cacheKey = (uid) => 'wrotate_feed_cache_' + uid;

async function visit(page, logs, user = FAKE_USER) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs, user });
  await page.route('**/auth/v1/logout*', route => route.fulfill({ status: 204, body: '' }));
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
}

function cardIds(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#feed-list > .feed-card')].map(k => (k.id || '').replace('feedcard-', '')));
}

test('a returning user sees last visit\'s feed before the logs request has answered, with no skeleton', async ({ page }) => {
  await injectSession(page);

  // Visit 1: a normal load writes the cache.
  await visit(page, POSTS);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), cacheKey(FAKE_USER.id))).not.toBe(null);

  // Visit 2: hold every logs GET open so the feed cannot come from the network.
  let releaseLogs;
  const gate = new Promise(r => { releaseLogs = r; });
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.route('**/rest/v1/logs*', async route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    await gate;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POSTS) });
  });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');

  // Content is on screen while the network is still pending, and nothing is a skeleton.
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3, { timeout: 3000 });
  expect(await cardIds(page)).toEqual(['p-1', 'p-2', 'p-3']);
  await expect(page.locator('#feed-list .feed-skeleton-item')).toHaveCount(0);

  // Releasing the network must not flash skeletons or lose the cards.
  releaseLogs();
  await page.waitForTimeout(800);
  await expect(page.locator('#feed-list .feed-skeleton-item')).toHaveCount(0);
  expect(await cardIds(page)).toEqual(['p-1', 'p-2', 'p-3']);
});

test('a post that disappeared server-side is gone once the refresh lands', async ({ page }) => {
  await injectSession(page);
  await visit(page, POSTS);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);

  await visit(page, POSTS.filter(p => p.id !== 'p-2'));
  await expect.poll(() => cardIds(page)).toEqual(['p-1', 'p-3']);
});

test('another account on the same device never sees the cached feed', async ({ page }) => {
  await injectSession(page);
  await visit(page, POSTS);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);

  // Same browser, different user, empty feed on the server.
  await injectSession(page, OTHER_USER);
  await visit(page, [], OTHER_USER);
  await expect(page.locator('#feed-list .feed-empty-state')).toBeVisible();
  expect(await cardIds(page)).toEqual([]);
});

test('signing out removes the cached feed from this device', async ({ page }) => {
  await injectSession(page);
  await visit(page, POSTS);
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), cacheKey(FAKE_USER.id))).not.toBe(null);

  await page.evaluate(() => signOut());
  await expect(page.locator('#auth-screen')).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), cacheKey(FAKE_USER.id))).toBe(null);
});
