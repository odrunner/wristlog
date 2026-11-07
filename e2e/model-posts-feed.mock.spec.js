import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, FAKE_USER } from './helpers.js';

// The "N photos" count in the model page's "On members' wrists" header links to
// the Feed tab filtered to that model (model_feed_page RPC), with a banner to
// clear it — the see-all path next to the single-post photo taps.

const MODEL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_USER = 'other-user-111';

const WATCH = {
  id: 'watch-001', user_id: FAKE_USER.id,
  brand: 'Rolex', name: 'Submariner', ref: '124060',
  color: '#c9a84c', model_id: MODEL_ID,
};
const MODEL_ROW = {
  id: MODEL_ID, brand: 'Rolex', name: 'Submariner',
  specs: {}, facts_key: null, hero_image: null,
  description: 'The archetypal dive watch.', history: null,
  refs_by_era: [], calibers_by_era: [],
};
const STATS = {
  owners: 3, wishlisted: 0, wishlisted_by_me: false, top_ref: '124060',
  accuracy: null, caliber: null, specs_agg: {},
  photos: [], shots: [{ id: 'log-model-1', url: 'https://example.com/wrist.jpg' }], shots_total: 21,
  brand_models: 2, related: [], mine: [],
};

// Public posts featuring this model, as model_feed_page would return them.
const MODEL_LOGS = [
  { id: 'log-model-1', user_id: OTHER_USER, watch_id: 'watch-other-9', date: '2025-03-13',
    use_case: 'work', notes: 'Their Submariner on the wrist', photo_url: null, visibility: 'public',
    club_id: null, created_at: '2025-03-13T10:00:00Z' },
  { id: 'log-model-2', user_id: FAKE_USER.id, watch_id: 'watch-001', date: '2025-03-12',
    use_case: 'leisure', notes: 'My Submariner at the beach', photo_url: null, visibility: 'public',
    club_id: null, created_at: '2025-03-12T10:00:00Z' },
];
// The normal feed carries an unrelated post so clearing the filter is observable.
const FEED_LOGS = [
  { id: 'log-unrelated', user_id: FAKE_USER.id, watch_id: 'watch-001', date: '2025-03-15',
    use_case: 'work', notes: 'Unrelated post', photo_url: null, visibility: 'public',
    club_id: null, created_at: '2025-03-15T10:00:00Z' },
];

async function boot(page) {
  await mockSupabase(page, { watches: [WATCH], logs: FEED_LOGS });
  const rpcCalls = [];
  await page.route('**/rest/v1/rpc/model_feed_page*', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    rpcCalls.push(body);
    const from = body.p_offset || 0;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(MODEL_LOGS.slice(from, from + (body.p_limit || 20))) });
  });
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(MODEL_ROW) }));
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(STATS) }));
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 3, visible: [] }) }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(id => openModelPage(id), MODEL_ID);
  await expect(page.locator('#page-model')).toHaveClass(/active/);
  await expect(page.locator('#mp-shots')).toBeVisible();
  return rpcCalls;
}

test('photos count links to the feed filtered to this model, and Show all posts clears it', async ({ page }) => {
  const rpcCalls = await boot(page);

  const link = page.locator('#mp-shots [data-mp="shots-all"]');
  await expect(link).toHaveCount(1);
  await expect(link).toContainText('21 photos');
  await link.click();

  // Lands on the Feed tab with the filter bar naming the model.
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
  const bar = page.locator('#feed-list .feed-stale');
  await expect(bar).toContainText('Posts with Rolex Submariner');

  // Only the model's posts render, served by model_feed_page with the model id.
  await expect(page.locator('#feed-list [id^="feedcard-"]')).toHaveCount(2);
  await expect(page.locator('#feedcard-log-model-1')).toBeVisible();
  await expect(page.locator('#feedcard-log-model-2')).toBeVisible();
  await expect(page.locator('#feedcard-log-unrelated')).toHaveCount(0);
  expect(rpcCalls.length).toBeGreaterThan(0);
  expect(rpcCalls[0].p_model_id).toBe(MODEL_ID);

  // Clearing the filter restores the normal feed.
  await bar.getByRole('button', { name: 'Show all posts' }).click();
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feedcard-log-unrelated')).toBeVisible();
});

test('on the public w/ page the photos count falls back to the homepage (sign-in)', async ({ page }) => {
  await page.route('**/rest/v1/rpc/model_page*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ model: MODEL_ROW, owners: { total_owners: 3, visible: [] }, teasers: [] }) }));
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(STATS) }));
  await page.route('**/rest/v1/page_visits*', route => route.fulfill({
    status: 201, contentType: 'application/json', body: '[]' }));
  // The fallback navigates to the production homepage — serve a stub instead.
  await page.route('https://wrotate.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<title>stub home</title>' }));

  await page.goto('/w/?m=rolex-submariner');
  const link = page.locator('#mp-shots [data-mp="shots-all"]');
  await expect(link).toContainText('21 photos');
  await link.click();
  await page.waitForURL('https://wrotate.com/**');
});

test('leaving the feed for another tab drops the model filter', async ({ page }) => {
  await boot(page);
  await page.locator('#mp-shots [data-mp="shots-all"]').click();
  await expect(page.locator('#feed-list .feed-stale')).toContainText('Posts with Rolex Submariner');

  await page.click('nav button[data-page="collection"]');
  await page.click('nav button[data-page="feed"]');
  await expect(page.locator('#feed-list .feed-stale')).toHaveCount(0);
  await expect(page.locator('#feedcard-log-unrelated')).toBeVisible();
});
