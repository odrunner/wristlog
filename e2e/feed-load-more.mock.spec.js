// ── Feed "load more" / infinite scroll (mocked) ──────────────────────────────
// Verifies keyset pagination: the first page renders with a bottom sentinel,
// scrolling in a second page appends new (deduped) cards, and a page that
// yields nothing new removes the sentinel ("no more").
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, FAKE_USER } from './helpers.js';

// Build N own/public logs (always pass the visibility gate) with descending dates.
function makeLogs(prefix, count, startDate) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    out.push({
      id: `${prefix}-${String(i).padStart(3, '0')}`,
      user_id: FAKE_USER.id,
      watch_id: null,
      date: ds,
      use_case: 'work',
      notes: `${prefix} #${i}`,
      photo_url: null,
      visibility: 'public',
      club_id: null,
      created_at: `${ds}T08:00:00Z`,
    });
  }
  return out;
}

test.describe('Feed load-more (mocked)', () => {
  test('appends a second page on load-more, dedupes, then stops when dry', async ({ page }) => {
    const page1 = makeLogs('log-p1', 50, '2025-03-15');
    const page2 = makeLogs('log-p2', 30, '2024-12-20');

    await mockSupabase(page, { logs: page1 });
    await injectSession(page);

    // Override the logs route: keyset (`or=`) requests get page 2, everything
    // else gets page 1. Non-GET falls back to the base mock.
    await page.route('**/rest/v1/logs*', route => {
      const req = route.request();
      if (req.method() !== 'GET') return route.fallback();
      const isNextPage = req.url().includes('or=');
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(isNextPage ? page2 : page1),
      });
    });

    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');

    // Page 1 rendered with a sentinel wired at the bottom.
    await expect(page.locator('#feedcard-log-p1-000')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#feed-list #feed-load-sentinel')).toHaveCount(1);
    await expect(page.locator('[id^="feedcard-log-p1-"]')).toHaveCount(50);

    // Trigger load-more (the IntersectionObserver would fire this on scroll).
    await page.evaluate(() => loadMoreFeed());

    // Page 2 appended; no page-1 cards lost; sentinel still present for the next page.
    await expect(page.locator('#feedcard-log-p2-000')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[id^="feedcard-log-p2-"]')).toHaveCount(30);
    await expect(page.locator('[id^="feedcard-log-p1-"]')).toHaveCount(50);
    await expect(page.locator('#feed-load-sentinel')).toHaveCount(1);

    // Next load-more returns page 2 again → all already shown → no more.
    await page.evaluate(() => loadMoreFeed());
    await expect(page.locator('#feed-load-sentinel')).toHaveCount(0);
    // Still exactly 80 unique cards — nothing duplicated.
    await expect(page.locator('[id^="feedcard-log-p"]')).toHaveCount(80);
  });
});
