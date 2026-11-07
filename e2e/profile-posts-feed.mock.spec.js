import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, FAKE_USER } from './helpers.js';

// The Posts title on a profile page links to the Feed tab filtered to that
// member, so their posts read as full cards instead of one grid tap at a time.
// Clicking it must query logs WITH a user_id filter (asserted on the request),
// show the filter in the scope chip, and picking "All posts" from the chip's
// menu must restore the normal feed.

const OTHER_USER = 'other-user-111';

const LOGS = [
  { id: 'log-own-1', user_id: FAKE_USER.id, watch_id: 'watch-001', date: '2025-03-15',
    use_case: 'work', notes: 'Own public post', photo_url: null, visibility: 'public',
    club_id: null, created_at: '2025-03-15T10:00:00Z' },
  { id: 'log-own-2', user_id: FAKE_USER.id, watch_id: 'watch-002', date: '2025-03-14',
    use_case: 'leisure', notes: 'Own private post', photo_url: null, visibility: 'private',
    club_id: null, created_at: '2025-03-14T10:00:00Z' },
  { id: 'log-other-1', user_id: OTHER_USER, watch_id: null, date: '2025-03-13',
    use_case: 'work', notes: 'Someone else entirely', photo_url: null, visibility: 'public',
    club_id: null, created_at: '2025-03-13T10:00:00Z' },
];

// Serve /rest/v1/logs honouring the user_id=eq.<id> filter, so the test proves
// the filtered view actually asks the server for one member's posts.
async function routeLogsWithUserFilter(page) {
  await page.route('**/rest/v1/logs*', route => {
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    const url = new URL(route.request().url());
    const userParam = url.searchParams.get('user_id'); // "eq.<id>" or null
    const rows = userParam && userParam.startsWith('eq.')
      ? LOGS.filter(l => l.user_id === userParam.slice(3))
      : LOGS;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
}

async function boot(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: LOGS });
  await routeLogsWithUserFilter(page); // registered after mockSupabase → wins
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => viewUserProfile(currentUser.id));
  await page.waitForSelector('#page-profile.active', { timeout: 5_000 });
}

test('Posts title links to the feed filtered to that member, and All posts clears it', async ({ page }) => {
  await boot(page);

  const link = page.locator('.profile-posts-link');
  await expect(link).toHaveCount(1);
  await link.click();

  // Lands on the Feed tab with the scope chip naming the member.
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
  await expect(page.locator('#feed-scope-chip')).toContainText('@testuser’s posts');

  // Only this member's posts render — the query carried user_id=eq.<id>, so the
  // other member's public post never arrived. Own private post is visible to self.
  await expect(page.locator('#feed-list [id^="feedcard-"]')).toHaveCount(2);
  await expect(page.locator('#feedcard-log-own-1')).toBeVisible();
  await expect(page.locator('#feedcard-log-own-2')).toBeVisible();
  await expect(page.locator('#feedcard-log-other-1')).toHaveCount(0);

  // Clearing the filter from the chip menu restores the normal feed.
  await page.locator('#feed-scope-chip').click();
  await page.locator('#feed-scope-menu .feed-menu-item', { hasText: 'All posts' }).click();
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();
});

test('feed card ⋯ menu filters to that member', async ({ page }) => {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: LOGS });
  await routeLogsWithUserFilter(page);
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);

  // The other member's post is in the normal feed; open its ⋯ menu.
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();
  await page.locator('#feedcard-log-other-1 .feed-edit-btn').click();
  await page.locator('#feed-menu-log-other-1 .feed-menu-item', { hasText: 'Posts by this member' }).click();

  // Feed reloads filtered to that member only (query carried their user_id).
  await expect(page.locator('#feed-scope-chip')).toContainText('posts');
  await expect(page.locator('#feed-scope-chip')).toHaveClass(/feed-scope-chip--active/);
  await expect(page.locator('#feed-list [id^="feedcard-"]')).toHaveCount(1);
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();
  await expect(page.locator('#feedcard-log-own-1')).toHaveCount(0);
});

test('leaving the feed for another tab drops the filter', async ({ page }) => {
  await boot(page);
  await page.locator('.profile-posts-link').click();
  await expect(page.locator('#feed-scope-chip')).toContainText('@testuser’s posts');

  await page.click('nav button[data-page="collection"]');
  await page.click('nav button[data-page="feed"]');
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();
});

test('a filtered load-more that lands after clearing the filter never splices into the full feed', async ({ page }) => {
  await boot(page);
  await page.locator('.profile-posts-link').click();
  await expect(page.locator('#feed-scope-chip')).toContainText('@testuser’s posts');

  // Gate the NEXT filtered logs query; it will answer with a fresh post only
  // after the filter has been cleared — the stale continuation's payload.
  let release;
  const gate = new Promise(r => { release = r; });
  let gated = 0; // only the first filtered query (the load-more below) is held
  await page.route('**/rest/v1/logs*', async route => {
    const url = new URL(route.request().url());
    if (gated++ > 0 || !(url.searchParams.get('user_id') || '').startsWith('eq.')) return route.fallback();
    await gate;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'log-own-3', user_id: FAKE_USER.id, watch_id: 'watch-001', date: '2025-03-10',
        use_case: 'work', notes: 'Stale page from the filtered view', photo_url: null,
        visibility: 'public', club_id: null, created_at: '2025-03-10T10:00:00Z' },
    ]) });
  });
  await page.evaluate(() => { feedHasMore = true; loadMoreFeed(); });

  // User escapes the filtered view while that page is still in flight.
  await page.locator('#feed-scope-chip').click();
  await page.locator('#feed-scope-menu .feed-menu-item', { hasText: 'All posts' }).click();
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();

  release();
  await page.waitForTimeout(300); // let the stale continuation run
  await expect(page.locator('#feedcard-log-own-3')).toHaveCount(0);
  expect(await page.evaluate(() => feedItems.some(i => i.id === 'log-own-3'))).toBe(false);
});
