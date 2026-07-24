import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// Bug: navigating Feed → a user's profile → Back drops the Feed back to the top
// instead of remembering the prior scroll position. Root cause: goBackFromProfile()
// routes through nav(), which unconditionally window.scrollTo(0,0)'s. The feed DOM
// is preserved (60s loadFeed cache), so only the scroll offset is lost.
//
// This test drives the real functions (viewUserProfile → goBackFromProfile) and
// asserts the window scroll is restored, so it exercises the actual layout.

// Enough tall cards that the feed scrolls well past one viewport.
function manyLogs(n) {
  const logs = [];
  for (let i = 0; i < n; i++) {
    logs.push({
      id: `log-${String(i).padStart(3, '0')}`,
      user_id: FAKE_USER.id,
      watch_id: i % 2 === 0 ? 'watch-001' : 'watch-002',
      date: `2025-03-${String((i % 27) + 1).padStart(2, '0')}`,
      created_at: `2025-03-${String((i % 27) + 1).padStart(2, '0')}T10:00:00Z`,
      use_case: 'work',
      notes: `Wore it on day ${i}. `.repeat(6),
      strap_id: i % 2 === 0 ? 'strap-001' : 'strap-002',
      photo_url: null,
      visibility: 'public',
      club_id: null,
    });
  }
  return logs;
}

test('Feed remembers scroll position after visiting a profile and going Back', async ({ page }) => {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: manyLogs(25) });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');

  // Wait for real feed cards (not skeletons) so the page has scrollable height.
  await expect(page.locator('.feed-card').first()).toBeVisible();
  await page.waitForFunction(() =>
    document.querySelectorAll('#feed-list .feed-card').length >= 5);

  // Scroll the feed down.
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForFunction(() => window.scrollY > 400);
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(400);

  // Open a profile, then go Back — the exact user flow.
  await page.evaluate((uid) => window.viewUserProfile(uid), FAKE_USER.id);
  await expect(page.locator('#page-profile')).toHaveClass(/active/);
  await page.evaluate(() => window.goBackFromProfile());
  await expect(page.locator('#page-feed')).toHaveClass(/active/);

  // Scroll position must be restored (allow a small tolerance for layout).
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 50, before, { timeout: 3000 });
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(50);
});
