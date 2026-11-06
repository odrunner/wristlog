import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, FAKE_USER } from './helpers.js';

// Experiment `profile_posts_feed`: the Posts title on a profile page links to the
// Feed tab filtered to that member, so their posts read as full cards instead of
// one grid tap at a time. Treatment renders the title as a button; clicking it
// must query logs WITH a user_id filter (asserted on the request), show the
// filter bar, and the bar's "Show all posts" must restore the normal feed.
// Control (no arm) keeps the plain title — the pre-experiment markup.

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

async function boot(page, { treatment }) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: LOGS });
  await routeLogsWithUserFilter(page); // registered after mockSupabase → wins
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  if (treatment) await page.evaluate(() => { EXPERIMENTS.profile_posts_feed = 'treatment'; });
  await page.evaluate(() => viewUserProfile(currentUser.id));
  await page.waitForSelector('#page-profile.active', { timeout: 5_000 });
}

test('treatment: Posts title links to the feed filtered to that member, and Show all posts clears it', async ({ page }) => {
  await boot(page, { treatment: true });

  const link = page.locator('.profile-posts-link');
  await expect(link).toHaveCount(1);
  await link.click();

  // Lands on the Feed tab with the filter bar naming the member.
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
  const bar = page.locator('#feed-list .feed-stale');
  await expect(bar).toContainText('Posts by @testuser');

  // Only this member's posts render — the query carried user_id=eq.<id>, so the
  // other member's public post never arrived. Own private post is visible to self.
  await expect(page.locator('#feed-list [id^="feedcard-"]')).toHaveCount(2);
  await expect(page.locator('#feedcard-log-own-1')).toBeVisible();
  await expect(page.locator('#feedcard-log-own-2')).toBeVisible();
  await expect(page.locator('#feedcard-log-other-1')).toHaveCount(0);

  // Clearing the filter restores the normal feed (other members' posts return).
  await bar.getByRole('button', { name: 'Show all posts' }).click();
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();
});

test('treatment: leaving the feed for another tab drops the filter', async ({ page }) => {
  await boot(page, { treatment: true });
  await page.locator('.profile-posts-link').click();
  await expect(page.locator('#feed-list .feed-stale')).toContainText('Posts by @testuser');

  await page.click('nav button[data-page="collection"]');
  await page.click('nav button[data-page="feed"]');
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feedcard-log-other-1')).toBeVisible();
});

test('control: the Posts title stays a plain label', async ({ page }) => {
  await boot(page, { treatment: false });
  await expect(page.locator('.profile-posts-link')).toHaveCount(0);
  await expect(page.locator('#page-profile .profile-page-section-title').filter({ hasText: 'Posts' })).toHaveCount(1);
});
