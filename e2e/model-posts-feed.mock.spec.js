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

test('the section title links to the feed filtered to this model, and All posts clears it', async ({ page }) => {
  const rpcCalls = await boot(page);

  await expect(page.locator('#mp-shots [data-mp="shots-all"]')).toContainText('21 photos');
  const link = page.locator('#mp-shots [data-mp="shots-feed"]');
  await expect(link).toHaveText('On members’ wrists');
  await link.click();

  // Lands on the Feed tab with the scope chip naming the model.
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
  await expect(page.locator('#feed-scope-chip')).toContainText('Rolex Submariner posts');
  await expect(page.locator('#feed-scope-chip')).toHaveClass(/feed-scope-chip--active/);

  // Only the model's posts render, served by model_feed_page with the model id.
  await expect(page.locator('#feed-list [id^="feedcard-"]')).toHaveCount(2);
  await expect(page.locator('#feedcard-log-model-1')).toBeVisible();
  await expect(page.locator('#feedcard-log-model-2')).toBeVisible();
  await expect(page.locator('#feedcard-log-unrelated')).toHaveCount(0);
  expect(rpcCalls.length).toBeGreaterThan(0);
  expect(rpcCalls[0].p_model_id).toBe(MODEL_ID);

  // Clearing the filter from the chip menu restores the normal feed.
  await page.locator('#feed-scope-chip').click();
  await page.locator('#feed-scope-menu .feed-menu-item', { hasText: 'All posts' }).click();
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
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
  await page.locator('#mp-shots [data-mp="shots-feed"]').click();
  await expect(page.locator('#feed-scope-chip')).toContainText('Rolex Submariner posts');

  await page.click('nav button[data-page="collection"]');
  await page.click('nav button[data-page="feed"]');
  await expect(page.locator('#feed-scope-chip')).toContainText('All posts');
  await expect(page.locator('#feedcard-log-unrelated')).toBeVisible();
});

test('photos count opens the image-only grid: loads more on scroll, a photo opens full, Back steps out', async ({ page }) => {
  await boot(page);
  const calls = [];
  await page.route('**/rest/v1/rpc/wrist_shots_page*', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    const n = body.p_offset === 0 ? 60 : 5;
    const rows = Array.from({ length: n }, (_, i) => ({ id: `s-${body.p_offset + i}`, url: `https://example.com/shot-${body.p_offset + i}.jpg` }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.locator('#mp-shots [data-mp="shots-all"]').click();
  const gal = page.locator('#page-shots');
  await expect(gal).toHaveClass(/active/);
  await expect(gal.locator('#shots-title')).toHaveText('Rolex Submariner');
  await expect(gal.locator('#shots-count')).toHaveText('21 photos');
  // First page, then the next one as the end comes into view; a short page ends it.
  await expect(gal.locator('.shots-cell')).toHaveCount(60);
  expect(calls[0]).toMatchObject({ p_model_id: MODEL_ID, p_brand: null, p_offset: 0 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(gal.locator('.shots-cell')).toHaveCount(65);
  expect(calls[1].p_offset).toBe(60);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  expect(calls.length).toBe(2);
  // A photo opens full; Back returns to the grid, Back again to the model page.
  await gal.locator('.shots-cell').nth(3).click();
  await expect(gal.locator('#shots-full-img')).toHaveAttribute('src', 'https://example.com/shot-3.jpg');
  await expect(gal.locator('#shots-grid-view')).toBeHidden();
  await gal.locator('#shots-full .shots-back').click();
  await expect(gal.locator('#shots-grid-view')).toBeVisible();
  await expect(gal.locator('.shots-cell')).toHaveCount(65);
  await gal.locator('#shots-grid-view .shots-back').click();
  await expect(page.locator('#page-model')).toHaveClass(/active/);
});
