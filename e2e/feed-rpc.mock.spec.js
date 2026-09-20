import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES } from './helpers.js';

// Experiment feed_rpc: the whole first page of the feed comes from ONE request
// (feed_page). These drive the real boot with the arm hinted the way a previous
// visit leaves it, and check the two things that matter: the classic feed
// queries are not made, and any failure falls back to them untouched.

const OTHER = '00000000-0000-4000-8000-0000000000ff';
const POSTS = [1, 2, 3].map(i => ({
  id: `p-${i}`, user_id: OTHER, watch_id: 'watch-001', club_id: null, photo_url: null, notes: `Post ${i}`, use_case: 'work',
  date: `2026-08-0${8 - i}`, created_at: `2026-08-0${8 - i}T10:00:00+00:00`, visibility: 'public',
  moderation_status: null, location: null, badge_refs: null, fact_id: null, strap_id: null,
}));
const PAYLOAD = {
  logs: POSTS, featured_id: null, featured_log: null,
  profiles: [{ id: OTHER, username: 'other', display_name: 'Other Person', avatar_url: null, is_official: false }],
  watches: [], likes: { 'p-1': { count: 7, liked: true } },
  comments: [{ id: 'c1', log_id: 'p-2', user_id: OTHER, body: 'nice', created_at: '2026-08-06T11:00:00+00:00', moderation_status: null }],
  comment_likes: [], facts: [],
};
// The arm reaches the boot through the per-user hint the previous visit wrote — the
// admin's exp_force override is ignored for every other account (audit 2026-09-20 C8).
const force = (page, variant) => page.addInitScript(v => localStorage.setItem('wrotate_feed_rpc_test-user-id-000', v === 'treatment' ? '1' : '0'), variant);
const spyPostHog = page => page.addInitScript(() => {
  window.__ph = [];
  window.posthog = { __SV: 1, init() {}, identify() {}, capture(name, props) { window.__ph.push({ name, props }); } };
});
const classicFeedReqs = page => {
  const seen = [];
  page.on('request', r => { if (r.method() === 'GET' && r.url().includes('/rest/v1/logs') && r.url().includes('select=id%2Cuser_id') && !r.url().includes('or=')) seen.push(r.url()); });   // load-more (or= cursor) stays classic
  return seen;
};

test('treatment: one feed_page call — fired from the head — renders the feed; no classic feed queries', async ({ page }) => {
  await injectSession(page);
  await force(page, 'treatment');
  await spyPostHog(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });   // classic path would render an EMPTY feed
  let calls = 0, fromHead = 0;
  // supabase-js stamps x-client-info on its requests; one without it came from the head script.
  await page.route('**/rest/v1/rpc/feed_page*', route => { calls++; if (!route.request().headers()['x-client-info']) fromHead++; route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) }); });
  const classic = classicFeedReqs(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  expect(fromHead).toBe(1);
  expect(await page.evaluate(() => ({ order: feedItems.map(i => i.id), author: feedItems[0].profile.display_name, likes: feedLikes['p-1'], comments: feedCommentCounts['p-2'], viaRpc: _feedViaRpc })))
    .toEqual({ order: ['p-1', 'p-2', 'p-3'], author: 'Other Person', likes: { count: 7, liked: true }, comments: 1, viaRpc: true });
  expect(calls).toBe(1);
  expect(classic).toEqual([]);
  const ev = () => page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));
  await expect.poll(() => ev().then(e => e.length)).toBe(1);
  const p = (await ev())[0].props;
  expect(p.feed_rpc).toBe(true);
  expect(p.early_feed).toBe(true);
  expect(p.enriched_ms).toBe(p.first_live_ms);   // one render: fresh posts ARE the complete posts
});

// The feed_page path renders once, before get_experiments() resolves, so the
// follow_suggest card has to be drawn when the arms arrive (audit 2026-09-20 C2).
test('treatment: the follow-suggestions card still appears on the boot load', async ({ page }) => {
  await injectSession(page);
  await force(page, 'treatment');
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
  await page.route('**/rest/v1/rpc/feed_page*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) }));
  await page.route('**/rest/v1/rpc/get_experiments*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'follow_suggest', variant: 'treatment' }]) }));
  await page.route('**/rest/v1/rpc/follow_suggestions*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'u-omega', username: 'omegafan', display_name: 'Omega Fan', avatar_url: null, profile_privacy: 'public', reason: 'liked', model_brand: null, model_name: null, likes: 3, followers: 0 },
  ]) }));
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect(page.locator('#follow-sugg-feed')).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => _feedViaRpc)).toBe(true);
});

test('treatment: a failing feed_page falls back to the classic load', async ({ page }) => {
  await injectSession(page);
  await force(page, 'treatment');
  await spyPostHog(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  await page.route('**/rest/v1/rpc/feed_page*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  const ev = () => page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));
  await expect.poll(() => ev().then(e => e.length)).toBe(1);
  expect((await ev())[0].props.feed_rpc).toBe(false);
});

test('treatment: a failed early feed_page is retried once through the SDK before any fallback', async ({ page }) => {
  await injectSession(page);
  await force(page, 'treatment');
  await spyPostHog(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: [] });
  await page.route('**/rest/v1/rpc/feed_page*', route => route.request().headers()['x-client-info']
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) })
    : route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  const ev = () => page.evaluate(() => window.__ph.filter(e => e.name === 'boot_timing'));
  await expect.poll(() => ev().then(e => e.length)).toBe(1);
  expect((await ev())[0].props).toMatchObject({ feed_rpc: true, early_feed: false });
});

test('control and unassigned users never call feed_page', async ({ page }) => {
  await injectSession(page);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  let calls = 0;
  await page.route('**/rest/v1/rpc/feed_page*', route => { calls++; route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) }); });
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  expect(calls).toBe(0);
});

test("the admin's force override is ignored for another account on the same device", async ({ page }) => {
  await injectSession(page);
  await page.addInitScript(() => { localStorage.setItem('exp_force_feed_rpc', 'treatment'); localStorage.setItem('exp_force_uid', 'someone-else'); });
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: POSTS });
  let calls = 0;
  await page.route('**/rest/v1/rpc/feed_page*', route => { calls++; route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) }); });
  await page.goto('/');
  await waitForAppBoot(page);
  await expect(page.locator('#feed-list > .feed-card')).toHaveCount(3);
  expect(calls).toBe(0);
});
