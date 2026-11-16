import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

// Brand page (2026-11-15): a model page's "All N models" opens the brand page
// when brand_page() has one, else Explore filtered to the brand (as before).

const MODEL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_ID = 'aaaaaaaa-0000-0000-0000-000000000009';
const MODEL_ROW = {
  id: MODEL_ID, brand: 'Tudor', name: 'Pelagos', slug: 'tudor-pelagos', specs: {}, facts_key: null, hero_image: null,
  description: 'A titanium diver.', history: 'Launched in 2012.', refs_by_era: [], calibers_by_era: [],
};
const STATS = {
  owners: 3, accuracy: null, caliber: null, specs_agg: {}, photos: [], shots: [], shots_total: 0, mine: [],
  brand_models: 12, related: [{ id: OTHER_ID, brand: 'Tudor', name: 'Black Bay', slug: 'tudor-black-bay', owners: 9 }],
};
const PLAIN = Array.from({ length: 10 }, (_, i) => ({
  id: `bbbbbbbb-0000-0000-0000-00000000001${i}`, name: `Line ${i + 1}`, slug: `tudor-line-${i + 1}`,
  hero_image: null, has_page: false, owners: 1, med: null, n_measured: 0,
}));
const BRAND = {
  brand: { id: 'cccccccc-0000-0000-0000-000000000001', brand: 'Tudor', slug: 'tudor', founded: '1926', country: 'Switzerland',
    description: 'A Swiss maker of tool watches.',
    history: 'Registered in 1926 by Hans Wilsdorf.\n\nRelaunched around 2010.',
    translations: {} },
  hero: { image: 'https://example.com/bb.jpg', credit: 'Photo: someone', model: 'Black Bay' },
  owners: 40,
  accuracy: { n_members: 5, n_sessions: 30, med: 1.2, members: [-4, -1, 1.2, 2, 9] },
  models: [
    { id: OTHER_ID, name: 'Black Bay', slug: 'tudor-black-bay', hero_image: 'https://example.com/bb.jpg', has_page: true, owners: 9, med: 1.5, n_measured: 4 },
    { id: MODEL_ID, name: 'Pelagos', slug: 'tudor-pelagos', hero_image: 'https://example.com/pel.jpg', has_page: true, owners: 3, med: null, n_measured: 1 },
    ...PLAIN,
  ],
  shots: [{ id: 'log-1', url: 'https://example.com/w1.jpg' }, { id: 'log-2', url: 'https://example.com/w2.jpg' }],
  shots_total: 25, shots_shared: 1,
};

async function openModel(page, brandPayload) {
  await mockSupabase(page, {});
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 3, era_min: null, era_max: null, visible: [] }) }));
  await page.route('**/rest/v1/watch_models*', route => {
    const id = new URL(route.request().url()).searchParams.get('id') || '';
    const row = id.includes(OTHER_ID) ? { ...MODEL_ROW, id: OTHER_ID, name: 'Black Bay', slug: 'tudor-black-bay' } : MODEL_ROW;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row) });
  });
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATS) }));
  await page.route('**/rest/v1/rpc/brand_page*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(brandPayload) }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => nav(document.querySelector('nav button[data-page="collection"]')));
  await page.evaluate(id => openModelPage(id), MODEL_ID);
  await expect(page.locator('#page-model h1.mp-title')).toHaveText('Pelagos');
}

test('All N models opens the brand page; models open and Back walks the way back', async ({ page }) => {
  await openModel(page, BRAND);
  await page.locator('#page-model [data-mp=brand]').click();
  const bp = page.locator('#page-brand');
  await expect(bp).toHaveClass(/active/);
  // hero
  await expect(bp.locator('h1.mp-title')).toHaveText('Tudor');
  await expect(bp).toContainText('Since 1926');
  await expect(bp).toContainText('12 models on WRotate · 40 members own one');
  await expect(bp).toContainText('Photo: someone');
  await expect(bp.locator('.mp-desc')).toHaveText('A Swiss maker of tool watches.');
  // how members' watches run
  const acc = bp.locator('#bp-acc');
  await expect(acc).toContainText('How members’ Tudor watches run');
  await expect(acc).toContainText('5 members measured theirs · 4 of 5 within ±5 s/d');
  await expect(acc.locator('.mp-dot')).toHaveCount(5);
  await expect(acc.locator('.mp-you')).toHaveCount(0);
  // story keeps its paragraphs
  await expect(bp.locator('#bp-history')).toContainText('Registered in 1926');
  expect(await bp.locator('#bp-history').evaluate(e => getComputedStyle(e).whiteSpace)).toBe('pre-line');
  // models with a photo, then the rest (8 shown, then all)
  await expect(bp.locator('#bp-models .bp-card')).toHaveCount(2);
  await expect(bp.locator('#bp-models')).toContainText('9 members · +1.5 s/d');
  await expect(bp.locator('#bp-more .mp-rel-card')).toHaveCount(8);
  await bp.locator('[data-bp=all]').click();
  await expect(bp.locator('#bp-more .mp-rel-card')).toHaveCount(10);
  await expect(bp.locator('[data-bp=all]')).toHaveCount(0);
  // wrist shots
  await expect(bp.locator('#bp-shots .mp-shot')).toHaveCount(2);
  await expect(bp.locator('#bp-shots')).toContainText('25 photos');
  await expect(bp.locator('#bp-shots')).toContainText('Includes posts shared with you');
  // the photo count opens the image-only grid for the brand; Back returns here
  let shotArgs = null;
  await page.route('**/rest/v1/rpc/wrist_shots_page*', async route => {
    shotArgs = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'log-1', url: 'https://example.com/w1.jpg' }]) });
  });
  await bp.locator('#bp-shots [data-bp=shots-all]').click();
  await expect(page.locator('#page-shots')).toHaveClass(/active/);
  await expect(page.locator('#shots-title')).toHaveText('Tudor');
  await expect(page.locator('#page-shots .shots-cell')).toHaveCount(1);
  expect(shotArgs).toMatchObject({ p_model_id: null, p_brand: 'Tudor', p_offset: 0 });
  await page.locator('#shots-grid-view .shots-back').click();
  await expect(bp).toHaveClass(/active/);
  // no public CTA inside the app
  await expect(bp.locator('.mp-actions')).toHaveCount(0);

  // brand → another model → Back → brand → Back → the model we started on → Back → Collection
  await bp.locator('#bp-models .bp-card').first().click();
  await expect(page.locator('#page-model h1.mp-title')).toHaveText('Black Bay');
  await page.locator('#page-model').getByText('‹ Back').click();
  await expect(bp).toHaveClass(/active/);
  await bp.getByText('‹ Back').click();
  await expect(page.locator('#page-model h1.mp-title')).toHaveText('Pelagos');
  await page.locator('#page-model').getByText('‹ Back').click();
  await expect(page.locator('#page-collection')).toHaveClass(/active/);
});

test('a brand without a page still opens Explore filtered to it', async ({ page }) => {
  await openModel(page, null);
  await page.locator('#page-model [data-mp=brand]').click();
  await expect(page.locator('#page-explore')).toHaveClass(/active/);
  await expect(page.locator('#page-brand')).not.toHaveClass(/active/);
});

// ── The Watches page's brand card: chip selected, or the search names a brand ──
const CARDS = [
  { brand: 'Tudor', slug: 'tudor', founded: '1926', models: 12, owners: 40, image: null },
  { brand: 'Timex', slug: 'timex', founded: '1854', models: 3, owners: 9, image: null },
];
async function openWatches(page) {
  await mockSupabase(page, {});
  await page.route('**/rest/v1/rpc/model_brands*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ brand: 'Tudor' }, { brand: 'Swatch' }]) }));
  await page.route('**/rest/v1/rpc/browse_watch_models*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ id: MODEL_ID, brand: 'Tudor', name: 'Pelagos', slug: 'tudor-pelagos', owners: 3, image: null }]) }));
  await page.route('**/rest/v1/rpc/brand_cards*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CARDS) }));
  await page.route('**/rest/v1/rpc/brand_page*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BRAND) }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => nav(document.querySelector('nav button[data-page="explore"]')));
  await expect(page.locator('#explore-brands .chip')).toHaveCount(3);
}

test('Watches: a brand chip shows its card; the card opens the brand page and Back returns', async ({ page }) => {
  await openWatches(page);
  const card = page.locator('#explore-brand-card .brand-card');
  await expect(card).toHaveCount(0);                       // All: no card
  await page.locator('#explore-brands .chip', { hasText: 'Swatch' }).click();
  await expect(card).toHaveCount(0);                       // a brand without a page: no card
  await page.locator('#explore-brands .chip', { hasText: 'Tudor' }).click();
  await expect(card).toContainText('Since 1926');
  await expect(card).toContainText('12 models on WRotate · 40 members own one');
  await card.click();
  const bp = page.locator('#page-brand');
  await expect(bp).toHaveClass(/active/);
  await expect(bp.locator('h1.mp-title')).toHaveText('Tudor');
  await bp.getByText('‹ Back').click();
  await expect(page.locator('#page-explore')).toHaveClass(/active/);
  await expect(card).toHaveCount(1);                       // still on the Tudor filter
});

test('Watches: the search shows the card for the brand it names', async ({ page }) => {
  await openWatches(page);
  const card = page.locator('#explore-brand-card .brand-card');
  const search = page.locator('#explore-search');
  await search.fill('tu');
  await page.waitForTimeout(450);
  await expect(card).toHaveCount(0);                       // under three letters
  await search.fill('tud');
  await expect(card).toContainText('Tudor');
  await search.fill('tudor pelagos');
  await expect(card).toContainText('Tudor');
  await search.fill('tim');
  await expect(card).toContainText('Timex');
  await search.fill('pelagos');
  await expect(card).toHaveCount(0);
});

test('brand page: the section title opens the feed filtered to the brand', async ({ page }) => {
  await openModel(page, BRAND);
  let args = null;
  await page.route('**/rest/v1/rpc/brand_feed_page*', async route => {
    args = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.locator('#page-model [data-mp=brand]').click();
  await page.locator('#page-brand [data-bp=shots-feed]').click();
  await expect(page.locator('#page-feed')).toHaveClass(/active/);
  await expect(page.locator('#feed-scope-chip')).toContainText('Tudor posts');
  expect(args).toMatchObject({ p_brand: 'Tudor', p_offset: 0 });
});
