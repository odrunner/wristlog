import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES } from './helpers.js';

// Feed videos: lazy (preload="none", no autoplay attribute — the observer
// plays them when on screen) and stable across a feed refresh (the same
// <video> node is kept, so a refresh does not restart an 8 MB download).

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const VIDEO_LOG = {
  id: 'vid-1', user_id: OTHER, watch_id: 'watch-001', date: '2026-08-07',
  created_at: '2026-08-07T10:00:00Z', use_case: 'work', notes: 'clip',
  strap_id: null, photo_url: 'https://x.test/clip.mp4?v=1', visibility: 'public', club_id: null,
};

test('feed video is preload="none" without autoplay, and survives a feed refresh as the same node', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [VIDEO_LOG] });
  await page.route('**/x.test/**', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');

  const video = page.locator('video#feed-hero-vid-1');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('preload', 'none');
  expect(await video.getAttribute('autoplay')).toBe(null);

  // Mark the node, force a full refresh (what boot-over-cache and foreground do),
  // and check the very same element is still in the DOM afterwards.
  await page.evaluate(() => { document.getElementById('feed-hero-vid-1').__keep = 1; feedLoadedAt = 0; return loadFeed(); });
  await expect(page.locator('.feed-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.getElementById('feed-hero-vid-1')?.__keep)).toBe(1);
});
