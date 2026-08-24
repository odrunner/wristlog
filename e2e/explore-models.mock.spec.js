import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Explore — browse/search the watch database from the Feed header's Watches
// button. browse_watch_models / model_brands are SECURITY DEFINER RPCs.

const MODELS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', brand: 'Rolex', name: 'Submariner', slug: 'rolex-submariner', owners: 23, image: null },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', brand: 'Seiko', name: '5', slug: 'seiko-5', owners: 10, image: null },
];
const BRANDS = [
  { brand: 'Rolex', models: 40, owners: 60 },
  { brand: 'Seiko', models: 55, owners: 41 },
];

async function openExplore(page, onBrowse) {
  await mockSupabase(page, {});
  await page.route('**/rest/v1/rpc/model_brands*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(BRANDS),
  }));
  await page.route('**/rest/v1/rpc/browse_watch_models*', async route => {
    const body = route.request().postDataJSON() || {};
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(onBrowse(body)) });
  });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.getByRole('button', { name: 'Watches' }).click();
  await expect(page.locator('#page-explore')).toHaveClass(/active/);
}

test('browse grid renders models and brand chips', async ({ page }) => {
  await openExplore(page, () => MODELS);
  const grid = page.locator('#explore-grid');
  await expect(grid.locator('.explore-card')).toHaveCount(2);
  await expect(grid).toContainText('Submariner');
  await expect(grid).toContainText('23 members');
  await expect(page.locator('#explore-brands')).toContainText('Rolex');
  await expect(page.locator('#explore-brands')).toContainText('Seiko');
});

test('search filters via the RPC and empty state shows', async ({ page }) => {
  await openExplore(page, body => {
    if (body.p_q === 'submariner') return [MODELS[0]];
    if (body.p_q === 'zzz') return [];
    return MODELS;
  });
  await page.fill('#explore-search', 'submariner');
  await expect(page.locator('#explore-grid .explore-card')).toHaveCount(1);
  await expect(page.locator('#explore-grid')).toContainText('Submariner');
  await page.fill('#explore-search', 'zzz');
  await expect(page.locator('#explore-empty')).toBeVisible();
});

test('brand chip filters and card tap opens the model page', async ({ page }) => {
  await openExplore(page, body => body.p_brand === 'Seiko' ? [MODELS[1]] : MODELS);
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 10, era_min: null, era_max: null, visible: [] }),
  }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: MODELS[1].id, brand: 'Seiko', name: '5', specs: {}, facts_key: null }),
  }));
  await page.locator('#explore-brands .chip', { hasText: 'Seiko' }).click();
  await expect(page.locator('#explore-grid .explore-card')).toHaveCount(1);
  await page.locator('#explore-grid .explore-card').first().click();
  const mp = page.locator('#page-model');
  await expect(mp).toHaveClass(/active/);
  await expect(mp).toContainText('Owned by 10 members on WRotate');
  await mp.getByText('← Back').click();
  await expect(page.locator('#page-explore')).toHaveClass(/active/); // back to Explore
});

test('feed watch preview links to the model page', async ({ page }) => {
  const MODEL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  await mockSupabase(page, {});
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  // Drive the preview modal directly with a model-linked watch — the same
  // object shape feed_watch_display now returns (model_id threaded through).
  await page.evaluate(id => previewWatch({
    id: 'w9', brand: 'Rolex', name: 'Submariner', ref: '', url: '', image: '',
    color: '#c9a84c', description: '', background: '', functions: '', modelId: id,
  }), MODEL_ID);
  await expect(page.locator('#watch-preview-modal')).toBeVisible();
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 23, era_min: '1962', era_max: '2026', visible: [] }),
  }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: MODEL_ID, brand: 'Rolex', name: 'Submariner', specs: {}, facts_key: null }),
  }));
  await page.getByText('See this model — who else owns it').click();
  await expect(page.locator('#watch-preview-modal')).toBeHidden();
  const mp = page.locator('#page-model');
  await expect(mp).toHaveClass(/active/);
  await expect(mp).toContainText('Owned by 23 members on WRotate');
  await expect(mp).toContainText('Members own examples from 1962 to 2026');
});
