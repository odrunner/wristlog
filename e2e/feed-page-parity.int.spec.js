import { test, expect } from '@playwright/test';

// feed_page() must return the SAME feed the app builds today from its five post
// queries + enrichment queries. Read-only, against the real database, as each
// test account (they follow each other and are close friends, so followers-only
// and friends-only posts are exercised). Compares, post by post: ids in display
// order, like count + "liked by me", comment count, author, watch and fun fact.
// Requires: dev-config.js with __DEV_CREDS__ and __DEV_CREDS_2__.

const APP_URL = 'http://localhost:3000';

async function devLogin(page, useSecond) {
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

  return page.evaluate(async () => {
    const shape = (items, likes, counts) => items.map(i => ({
      id: i.id, featured: !!i.__featured,
      likes: (likes[i.id] || { count: 0 }).count, liked: !!(likes[i.id] || {}).liked,
      comments: counts[i.id] || 0,
      author: i.profile ? i.profile.username : null,
      watch: i.watch ? (i.watch.brand + '|' + i.watch.name) : null,
      fact: i.fact || '',
    }));
    const app = shape(feedItems, feedLikes, feedCommentCounts);

    const { data: j, error } = await db.rpc('feed_page');
    if (error) return { error: error.message };
    const today = todayStr();
    let logs = (j.logs || []).slice().sort((a, b) => compareFeedLogs(a, b, today));
    logs = pinFeatured(logs, j.featured_id, j.featured_log);
    const prof = Object.fromEntries((j.profiles || []).map(p => [p.id, p]));
    const wat = Object.fromEntries((j.watches || []).map(w => [w.id, w]));
    const fac = Object.fromEntries((j.facts || []).map(f => [f.id, f.fact]));
    const counts = {};
    (j.comments || []).forEach(c => { counts[c.log_id] = (counts[c.log_id] || 0) + 1; });
    const items = logs.map(l => ({ ...l, profile: prof[l.user_id] || null, watch: l.watch_id ? (wat[l.watch_id] || null) : null, fact: l.fact_id ? (fac[l.fact_id] || '') : '' }));
    const rpc = shape(items, j.likes || {}, counts);
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
