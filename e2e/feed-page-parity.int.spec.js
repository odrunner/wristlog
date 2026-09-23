import { test, expect } from '@playwright/test';

// feed_page() must return the SAME feed the classic load (its fallback) builds
// from its five post queries + enrichment queries. The app load here is forced
// onto the classic path by failing feed_page until the comparison call. Read-only, against the real database, as each
// test account (they follow each other and are close friends, so followers-only
// and friends-only posts are exercised). Compares, post by post: ids in display
// order, like count + "liked by me", comment count, author, watch and fun fact.
// Requires: dev-config.js with __DEV_CREDS__ and __DEV_CREDS_2__.

const APP_URL = 'http://localhost:3000';

const failFeedPage = route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"parity: force the classic load"}' });

async function devLogin(page, useSecond) {
  await page.route('**/rest/v1/rpc/feed_page*', failFeedPage);
  await page.goto(APP_URL);
  await page.waitForSelector('#auth-screen', { state: 'visible', timeout: 10_000 });
  await page.click(useSecond ? 'button:has-text("testuser2")' : '#dev-login-wrap button:first-child');
  await page.waitForSelector('#auth-screen', { state: 'hidden', timeout: 15_000 });
  await page.waitForSelector('nav', { state: 'visible', timeout: 5_000 });
}

async function compare(page) {
  // Wait for the app's own full load (Phase 2 done) with the follows lookups landed.
  await page.waitForFunction(() => typeof feedLoadedAt !== 'undefined' && feedLoadedAt > 0 && !feedLoading && _bootGateOpen, null, { timeout: 20_000 });
  await page.waitForTimeout(1500);   // let a follows-changed reload (if any) finish
  await page.waitForFunction(() => feedLoadedAt > 0 && !feedLoading, null, { timeout: 20_000 });

  await page.unroute('**/rest/v1/rpc/feed_page*', failFeedPage);
  return page.evaluate(async () => {
    const shape = (items, likes, counts) => items.map(i => ({
      id: i.id, featured: !!i.__featured,
      likes: (likes[i.id] || { count: 0 }).count, liked: !!(likes[i.id] || {}).liked,
      comments: counts[i.id] || 0,
      author: i.profile ? i.profile.username : null,
      watch: i.watch ? (i.watch.brand + '|' + i.watch.name) : null,
      fact: i.fact || '',
    }));
    if (_feedViaRpc) return { error: 'the app load was not the classic path' };
    const app = shape(feedItems, feedLikes, feedCommentCounts);

    const { data: j, error } = await db.rpc('feed_page');
    if (error) return { error: error.message };
    // The PRODUCTION transformer — what the app renders from.
    const st = feedPageToState(j, todayStr());
    const rpc = shape(st.items, st.likes, st.commentCounts);
    return { app, rpc, following: following.size, friends: friendships.size, visibilities: [...new Set(feedItems.map(i => i.visibility))] };
  });
}

for (const second of [false, true]) {
  test(`feed_page() matches the app's feed for ${second ? 'testuser2' : 'testuser'}`, async ({ page }) => {
    await devLogin(page, second);
    const r = await compare(page);
    expect(r.error).toBeUndefined();
    console.log(`posts=${r.app.length} following=${r.following} friends=${r.friends} visibilities=${r.visibilities.join(',')} withLikes=${r.app.filter(p => p.likes).length} withComments=${r.app.filter(p => p.comments).length}`);
    expect(r.app.length).toBeGreaterThan(0);
    expect(r.rpc.map(p => p.id)).toEqual(r.app.map(p => p.id));
    expect(r.rpc).toEqual(r.app);
  });
}
