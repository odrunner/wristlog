import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES,
} from './helpers.js';

// The feed card loads the ~95 KB card-size sibling of a post photo, not the
// 1280 px original, and falls back to the original when the sibling is missing
// (a photo uploaded before the backfill).

const BASE = 'https://api.wrotate.com/storage/v1/object/public/media/';
const OTHER = '00000000-0000-4000-8000-0000000000ff';
const ORIGINAL = BASE + 'logs/' + OTHER + '/p-1.jpg?v=42';
const POSTS = [{
  id: 'p-1', user_id: OTHER, watch_id: 'watch-001', date: '2026-08-07', created_at: '2026-08-07T10:00:00Z',
  use_case: 'work', notes: 'Photo post', strap_id: null, photo_url: ORIGINAL, visibility: 'public', club_id: null,
}];
// 1×1 JPEG, enough for <img> to fire load rather than error.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function boot(page) {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(1);
}

test('the card requests the _card sibling and keeps the original for the viewer', async ({ page }) => {
  const requested = [];
  await page.route(BASE + '**', route => { requested.push(route.request().url()); route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG }); });
  await boot(page);
  const img = page.locator('#feed-hero-p-1');
  await expect(img).toHaveAttribute('src', BASE + 'logs/' + OTHER + '/p-1_card.jpg?v=42');
  await expect(img).toHaveAttribute('data-full', ORIGINAL);
  await expect.poll(() => requested.some(u => u.endsWith('/p-1_card.jpg?v=42'))).toBe(true);
  expect(requested.some(u => u.endsWith('/p-1.jpg?v=42'))).toBe(false);
});

test('a missing sibling falls back to the original photo', async ({ page }) => {
  await page.route(BASE + '**', route => route.request().url().includes('_card.jpg')
    ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"statusCode":"404"}' })
    : route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPEG }));
  await boot(page);
  const img = page.locator('#feed-hero-p-1');
  await expect(img).toHaveAttribute('src', ORIGINAL);
  await expect(img).toBeVisible();
});
