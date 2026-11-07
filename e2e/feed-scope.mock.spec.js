import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, FAKE_USER } from './helpers.js';

// Feed scope dropdown — All posts / People I follow / Close friends / My posts.
// Scoped views are single author-set queries; the logs route below honours the
// user_id eq/in filters so the assertions test what the server would return.

const FRIEND = 'cccccccc-0000-0000-0000-000000000001';
const OTHER  = 'cccccccc-0000-0000-0000-000000000002';

function log(id, uid, date) {
  return { id, user_id: uid, watch_id: null, date, use_case: 'work', notes: id,
           photo_url: null, visibility: 'public', club_id: null, created_at: `${date}T08:00:00Z` };
}
const fulfill = rows => ({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });

async function boot(page, { logs = [], follows = [], friends = [], logsRoute = null } = {}) {
  await mockSupabase(page, { logs });
  await page.route('**/rest/v1/follows*', route => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() !== 'GET') return route.fulfill(fulfill([]));
    if (url.includes('select=following_id')) return route.fulfill(fulfill(follows.map(id => ({ following_id: id }))));
    if (url.includes('select=follower_id')) return route.fulfill(fulfill(friends.map(id => ({ follower_id: id }))));
    return route.fulfill(fulfill([]));
  });
  await page.route('**/rest/v1/friend_requests*', route => route.fulfill(fulfill(
    friends.map(fid => ({ id: 'fr-' + fid, initiator_id: FAKE_USER.id, target_id: fid, status: 'accepted' })))));
  await page.route('**/rest/v1/logs*', logsRoute || (route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = decodeURIComponent(route.request().url());
    let rows = logs;
    const mId = url.match(/[?&]id=eq\.([\w-]+)/);
    const mEq = url.match(/user_id=eq\.([\w-]+)/);
    const mIn = url.match(/user_id=in\.\(([^)]*)\)/);
    if (mId) rows = rows.filter(l => l.id === mId[1]);
    else if (mEq) rows = rows.filter(l => l.user_id === mEq[1]);
    else if (mIn) { const ids = mIn[1].split(','); rows = rows.filter(l => ids.includes(l.user_id)); }
    return route.fulfill(fulfill(rows));
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
}

async function pickScope(page, label) {
  await page.locator('#feed-scope-chip').click();
  await page.locator('#feed-scope-menu .feed-menu-item', { hasText: label }).click();
}

test('chip cycles scopes: my posts, then back to all', async ({ page }) => {
  await boot(page, {
    logs: [log('own-1', FAKE_USER.id, '2025-03-15'), log('oth-1', OTHER, '2025-03-14')],
    follows: [OTHER],
  });
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-oth-1')).toBeVisible();
  await pickScope(page, 'My posts');
  await expect(page.locator('#feed-scope-chip')).toContainText('My posts');
  await expect(page.locator('#feedcard-own-1')).toBeVisible();
  await expect(page.locator('#feedcard-oth-1')).toHaveCount(0);
  await pickScope(page, 'All posts');
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-oth-1')).toBeVisible();
});

test('close friends scope shows only friend-authored posts', async ({ page }) => {
  await boot(page, {
    logs: [log('fr-1', FRIEND, '2025-03-15'), log('oth-1', OTHER, '2025-03-14')],
    follows: [FRIEND, OTHER],
    friends: [FRIEND],
  });
  await pickScope(page, 'Close friends');
  await expect(page.locator('#feedcard-fr-1')).toBeVisible();
  await expect(page.locator('#feedcard-oth-1')).toHaveCount(0);
});

test('empty following scope shows find-people and never queries in.()', async ({ page }) => {
  const badLogsCalls = [];
  await boot(page, { logs: [log('own-1', FAKE_USER.id, '2025-03-15')], follows: [] });
  page.on('request', req => {
    const url = decodeURIComponent(req.url());
    if (url.includes('/rest/v1/logs') && url.includes('user_id=in.()')) badLogsCalls.push(url);
  });
  await pickScope(page, 'People I follow');
  await expect(page.locator('#feed-list')).toContainText('not following anyone yet');
  expect(badLogsCalls).toHaveLength(0);
  await page.locator('#feed-list button', { hasText: 'Find people' }).click();
  await expect(page.locator('#discover-modal')).toBeVisible();
});

test('scope survives tab-away and back', async ({ page }) => {
  await boot(page, { logs: [log('own-1', FAKE_USER.id, '2025-03-15')] });
  await pickScope(page, 'My posts');
  await expect(page.locator('#feed-scope-chip')).toContainText('My posts');
  await navigateTo(page, 'collection');
  await navigateTo(page, 'feed');
  await expect(page.locator('#feed-scope-chip')).toContainText('My posts');
});

test('switching scope mid-flight never shows the old scope’s rows', async ({ page }) => {
  const logs = [log('own-1', FAKE_USER.id, '2025-03-15'), log('oth-1', OTHER, '2025-03-14')];
  let release; const gate = new Promise(r => { release = r; });
  let held = 0;
  await boot(page, {
    logs, follows: [OTHER],
    logsRoute: async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = decodeURIComponent(route.request().url());
      // or=(visibility… is unique to the scope loaders' single query — the
      // boot load's parallel queries use eq/is visibility filters instead.
      if (url.includes('user_id=in.(') && url.includes('or=(visibility') && held++ === 0) {
        await gate; // the following-scope page, answered after the user moved on
        return route.fulfill(fulfill([logs[1]]));
      }
      const mEq = url.match(/user_id=eq\.([\w-]+)/);
      return route.fulfill(fulfill(mEq ? logs.filter(l => l.user_id === mEq[1]) : logs));
    },
  });
  await pickScope(page, 'People I follow');   // query now held in flight
  await pickScope(page, 'My posts');          // user moves on before it answers
  release();
  await expect(page.locator('#feed-scope-chip')).toContainText('My posts');
  await expect(page.locator('#feedcard-own-1')).toBeVisible();
  await expect(page.locator('#feedcard-oth-1')).toHaveCount(0);
});

test('scope picked during the initial feed load wins over it', async ({ page }) => {
  const logs = [log('own-1', FAKE_USER.id, '2025-03-15'), log('oth-1', OTHER, '2025-03-14')];
  let release; const gate = new Promise(r => { release = r; });
  let held = 0;
  await boot(page, {
    logs, follows: [OTHER],
    logsRoute: async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = decodeURIComponent(route.request().url());
      // Hold the boot load's followers-visibility query so the whole classic
      // load is still in flight when the user picks a scope.
      if (url.includes('visibility=eq.followers') && held++ === 0) {
        await gate;
        return route.fulfill(fulfill([]));
      }
      const mEq = url.match(/user_id=eq\.([\w-]+)/);
      return route.fulfill(fulfill(mEq ? logs.filter(l => l.user_id === mEq[1]) : logs));
    },
  });
  await pickScope(page, 'My posts'); // the boot 'all' load is still in flight
  release();
  await expect(page.locator('#feed-scope-chip')).toContainText('My posts');
  await expect(page.locator('#feedcard-own-1')).toBeVisible();
  await expect(page.locator('#feedcard-oth-1')).toHaveCount(0);
});

test('jump-to-post resets a scoped view instead of injecting into it', async ({ page }) => {
  await boot(page, {
    logs: [log('own-1', FAKE_USER.id, '2025-03-15'), log('oth-1', OTHER, '2025-03-14')],
    follows: [OTHER, FRIEND],
    friends: [FRIEND],
  });
  await pickScope(page, 'Close friends');
  await expect(page.locator('#feedcard-oth-1')).toHaveCount(0);
  // A notification tap / deep link lands on a non-friend's post.
  await page.evaluate(() => scrollToFeedPost('oth-1'));
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-oth-1')).toBeVisible();
});

test('quiet following scope says no posts, not "not following anyone"', async ({ page }) => {
  await boot(page, {
    logs: [log('own-1', FAKE_USER.id, '2025-03-15')], // the followed user never posted
    follows: [OTHER],
  });
  await pickScope(page, 'People I follow');
  await expect(page.locator('#feed-list')).toContainText('No posts to show');
  await expect(page.locator('#feed-list')).not.toContainText('not following anyone');
});

test('person filter folds into the chip (escaped), menu clears it', async ({ page }) => {
  await boot(page, {
    logs: [log('own-1', FAKE_USER.id, '2025-03-15'), log('oth-1', OTHER, '2025-03-14')],
    follows: [OTHER],
  });
  await page.evaluate(uid => viewUserFeed(uid, '', 'Steve <b>X</b>'), OTHER);
  const chip = page.locator('#feed-scope-chip');
  await expect(chip).toBeVisible();
  // textContent assertion: an unescaped name would become a real <b> element
  // and the literal "<b>" would vanish from the text.
  await expect(chip).toContainText('Steve <b>X</b>’s posts');
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feedcard-oth-1')).toBeVisible();
  await expect(page.locator('#feedcard-own-1')).toHaveCount(0);
  await pickScope(page, 'All posts');
  await expect(chip).toContainText('All posts');
  await expect(page.locator('#feedcard-own-1')).toBeVisible();
});

test('scope load-more dedups overlapping pages', async ({ page }) => {
  // 20 rows fill page 1 (USER_FEED_PAGE); page 2 overlaps the last id + 5 new.
  const page1 = [], page2 = [];
  for (let i = 0; i < 20; i++) {
    const d = new Date('2025-03-15T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    page1.push(log(`mine-${String(i).padStart(2, '0')}`, FAKE_USER.id, d.toISOString().slice(0, 10)));
  }
  page2.push(page1[19]);
  for (let i = 20; i < 25; i++) {
    const d = new Date('2025-03-15T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    page2.push(log(`mine-${String(i).padStart(2, '0')}`, FAKE_USER.id, d.toISOString().slice(0, 10)));
  }
  await boot(page, {
    logs: page1,
    logsRoute: route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = decodeURIComponent(route.request().url());
      if (!url.includes('user_id=eq.')) return route.fulfill(fulfill([]));
      const rangeHdr = route.request().headers()['range'] || '';
      const offsetParam = url.match(/offset=(\d+)/);
      const isFirst = offsetParam ? offsetParam[1] === '0' : (!rangeHdr || rangeHdr.startsWith('0-'));
      return route.fulfill(fulfill(isFirst ? page1 : page2));
    },
  });
  await pickScope(page, 'My posts');
  await expect(page.locator('[id^="feedcard-mine-"]')).toHaveCount(20);
  await page.evaluate(() => loadMoreFeed());
  await expect(page.locator('#feedcard-mine-24')).toBeVisible();
  await expect(page.locator('[id^="feedcard-mine-"]')).toHaveCount(25);
});
