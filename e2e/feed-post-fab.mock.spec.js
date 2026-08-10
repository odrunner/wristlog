import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// Steve's feedback: the feed's Post button lives in the page header, which
// scrolls away — so there's no way to post after scrolling through posts.
// A Post button now floats at the top right of the feed once the page
// header's Post button leaves the viewport, and only on the Feed page.

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

async function bootFeed(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: manyLogs(25) });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('.feed-card').first()).toBeVisible();
  await page.waitForFunction(() =>
    document.querySelectorAll('#feed-list .feed-card').length >= 5);
}

test('floating Post button appears only after the feed Post button scrolls away', async ({ page }) => {
  await bootFeed(page);

  const fab = page.locator('#feed-post-fab');

  // At the top of the feed both buttons would be on screen — the FAB stays hidden.
  await expect(page.locator('#feed-post-btn')).toBeVisible();
  await expect(fab).toBeHidden();

  // Scroll past the page header.
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(fab).toBeVisible();

  // It floats clear of the sticky header, at the right-hand side.
  const box = await fab.boundingBox();
  const headerBox = await page.locator('header').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(box.x).toBeGreaterThan(page.viewportSize().width / 2);

  // It opens the same composer as the page-header button.
  await fab.click();
  await expect(page.locator('#new-post-modal')).not.toHaveClass(/hidden/);
  await page.evaluate(() => window.closeNewPost());

  // Back at the top it hides again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(fab).toBeHidden();
});

test('floating Post button stays hidden on other pages', async ({ page }) => {
  await bootFeed(page);

  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(page.locator('#feed-post-fab')).toBeVisible();

  // Switching tabs hides the feed, so the observer would report the feed Post
  // button as off-screen — the Feed-only gate is what keeps the shortcut away.
  await navigateTo(page, 'collection');
  await expect(page.locator('#page-collection')).toHaveClass(/active/);
  await expect(page.locator('#feed-post-fab')).toBeHidden();

  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-post-fab')).toBeHidden();
});
