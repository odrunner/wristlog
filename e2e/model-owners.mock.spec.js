import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo } from './helpers.js';

// "Also owned by" row in the watch edit modal + the in-app model PAGE it
// opens — fed by the model_owners RPC (count-always, names-gated) plus
// authed reads of watch_models and watch_facts.

const MODEL_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const WATCH = {
  id: 'watch-001', user_id: 'test-user-id-000',
  brand: 'Rolex', name: 'Submariner', ref: '124060',
  color: '#c9a84c', model_id: MODEL_ID,
};
const MODEL_ROW = {
  id: MODEL_ID, brand: 'Rolex', name: 'Submariner',
  specs: { type: 'Dive watch', size: '40–41mm' }, facts_key: 'rolex|submariner', hero_image: null,
  description: 'The archetypal dive watch.',
  history: 'Launched in 1953, it set the template for every diver since.',
  refs_by_era: [{ reference: '5513', years: '1962–1989', note: 'no-date' }, { reference: '124060', years: '2020–present', note: '41mm' }],
  calibers_by_era: [{ caliber: '1520', years: '1962–1989' }, { caliber: '3230', years: '2020–present' }],
};
const RECENT = new Date(Date.now() - 3 * 86400000).toISOString();
const STATS = {
  owners: 4, wishlisted: 2, wishlisted_by_me: false, top_ref: '124060',
  accuracy: { n_members: 4, n_sessions: 20, med: -2.9, members: [-6, -3, -2.8, 1.1] },
  caliber: null,
  specs_agg: { caliber: { v: '3230', n: 3 } },
  photos: [], shots: [{ id: 'log-shot-1', url: 'https://example.com/wrist.jpg' }], shots_total: 1,
  brand_models: 14,
  related: [{ id: 'aaaaaaaa-0000-0000-0000-000000000009', brand: 'Rolex', name: 'Submariner Date', slug: 'rolex-submariner-date', owners: 11 }],
  mine: [{ id: 'watch-001', brand: 'Rolex', name: 'Submariner', ref: '124060', caliber: '3230', last_rate: -1.2, last_amp: 280, last_at: RECENT }],
};

async function openEditModal(page, ownersPayload, stats = STATS) {
  await mockSupabase(page, { watches: [WATCH] });
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ownersPayload),
  }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(MODEL_ROW),
  }));
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(stats),
  }));
  await page.route('**/rest/v1/watch_facts*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ fact: 'It once dove very deep indeed.', position: 0 }, { fact: 'Second fact about the bezel.', position: 1 }]),
  }));
  await page.addInitScript(() => { try { localStorage.setItem('ff_watch_db', 'true'); } catch (e) {} });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  await page.locator('.card-edit-btn, .card-edit-btn-noimg').first().click();
  await expect(page.locator('#watch-modal')).toBeVisible();
}

test('row shows count + era, tap opens the one-scroll model page', async ({ page }) => {
  await openEditModal(page, {
    total_owners: 4, era_min: '1988', era_max: '2024',
    visible: [
      { user_id: 'u2', username: 'steve', display_name: 'Steve', avatar_url: null, photo: null, year: '2001' },
      { user_id: 'u3', username: 'ana', display_name: 'Ana', avatar_url: null, photo: null, year: '2024' },
    ],
  });
  const row = page.locator('#wm-also-owned');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Also owned by 3 other members');
  await expect(row).toContainText('examples from 1988 to 2024');
  await row.click();
  const mp = page.locator('#page-model');
  await expect(mp).toHaveClass(/active/);
  // hero
  await expect(mp).toContainText('Rolex · ref. 124060');
  await expect(mp.locator('h1.mp-title')).toHaveText('Submariner');
  // your watch vs members: one dot per member, a marker for you
  const yours = mp.locator('#mp-yours');
  await expect(yours).toContainText('Your Submariner');
  await expect(yours).toContainText('124060 · cal. 3230');
  await expect(yours).toContainText('−1.2');
  await expect(yours).toContainText('Measured 3 days ago · 280° amplitude');
  await expect(yours).toContainText('4 members’ Submariner · median −2.9 s/d');
  await expect(yours.locator('.mp-dot')).toHaveCount(4);
  await expect(yours.locator('.mp-you')).toHaveCount(1);
  await expect(yours.locator('.mp-med')).toHaveCount(1);
  // story + facts rotate both ways and wrap
  await expect(mp.locator('#mp-story')).toContainText('The story');
  await expect(mp.locator('#mp-story')).toContainText('Launched in 1953');
  const kicker = mp.locator('#mp-fact-kicker');
  const before = await kicker.textContent();
  const bodyBefore = await mp.locator('#mp-fact-body').textContent();
  await mp.locator('[data-mp=fact-next]').click();
  expect(await kicker.textContent()).not.toBe(before);
  expect(await mp.locator('#mp-fact-body').textContent()).not.toBe(bodyBefore);
  await mp.locator('[data-mp=fact-next]').click();
  expect(await kicker.textContent()).toBe(before); // wraps around
  await mp.locator('[data-mp=fact-prev]').click();
  expect(await kicker.textContent()).not.toBe(before);
  await mp.locator('[data-mp=fact-prev]').click();
  expect(await kicker.textContent()).toBe(before);
  // wrist shots, owners you can follow
  await expect(mp.locator('#mp-shots .mp-shot')).toHaveCount(1);
  const own = mp.locator('#mp-owners');
  await expect(own).toContainText('4 members own one');
  await expect(own).toContainText('Steve');
  await expect(own).toContainText('@ana');
  await expect(own.locator('[data-mp=follow]')).toHaveCount(2);
  // references (yours highlighted), calibres, spec — inline, no tabs
  await expect(mp.locator('#mp-refs')).toContainText('5513');
  await expect(mp.locator('#mp-refs .mp-ref.mine')).toContainText('Yours');
  await expect(mp.locator('#mp-refs')).toContainText('3230');
  await expect(mp.locator('#mp-spec')).toContainText('Reference spec');
  await expect(mp.locator('#mp-tabs')).toHaveCount(0);
  // the cut figures are gone
  for (const gone of ['Wear share', 'Median value', 'Cost per wear', 'Wear pattern', 'Ownership by era', 'Wears / 90 days']) {
    await expect(mp).not.toContainText(gone);
  }
  // more from brand + action bar (web: no timegrapher, so Open your watch)
  await expect(mp.locator('#mp-more')).toContainText('Submariner Date');
  await expect(mp).toContainText('All 14 models');
  await expect(mp.locator('.mp-actions')).toContainText('Open your Submariner');
  await mp.getByText('‹ Back').click();
  await expect(page.locator('#page-collection')).toHaveClass(/active/); // back where we came from
});

test('browsing a model you do not own: calibre fallback, I own one / Want one', async ({ page }) => {
  await mockSupabase(page, {});
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ total_owners: 2, era_min: null, era_max: null, visible: [] }) }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...MODEL_ROW, history: null, refs_by_era: [], calibers_by_era: [] }) }));
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...STATS, owners: 2, accuracy: null, mine: [], shots: [], shots_total: 0,
      caliber: { key: '3230', n_members: 3, n_models: 2, med: 1.5, members: [-4, 1.5, 7] } }) }));
  await page.route('**/rest/v1/watch_facts*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.addInitScript(() => { try { localStorage.setItem('ff_watch_db', 'true'); } catch (e) {} });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(id => openModelPage(id), MODEL_ID);
  const mp = page.locator('#page-model');
  await expect(mp).toHaveClass(/active/);
  const card = mp.locator('#mp-yours');
  await expect(card).toContainText('How calibre 3230 runs');
  await expect(card).toContainText('3 members measured one · 2 of 3 within ±5 s/d');
  await expect(card).toContainText('compares the movement inside — 2 models on WRotate');
  await expect(card.locator('.mp-dot')).toHaveCount(3);
  await expect(card.locator('.mp-you')).toHaveCount(0);
  await expect(mp.locator('#mp-shots')).toHaveCount(0);
  await expect(mp.locator('#mp-owners')).toContainText('Their collections aren’t visible to you.');
  await expect(mp.locator('.mp-actions')).toContainText('I own one');
  await expect(mp.locator('.mp-actions')).toContainText('♡ Want one');
});

test('sole owner: row shows rare-bird copy, page still opens with facts', async ({ page }) => {
  await openEditModal(page, { total_owners: 1, era_min: null, era_max: null, visible: [] }, { ...STATS, owners: 1, accuracy: null });
  const row = page.locator('#wm-also-owned');
  await expect(row).toBeVisible();
  await expect(row).toContainText("You're the only one on WRotate with this one");
  await row.click();
  const mp = page.locator('#page-model');
  await expect(mp).toHaveClass(/active/);
  await expect(mp.locator('.mp-solo')).toHaveText("You're the only member with one");
  await expect(mp.locator('#mp-owners')).toHaveCount(0);
  await expect(mp.locator('.mp-quote')).toContainText(/It once dove very deep indeed\.|Second fact about the bezel\./); // daily rotation picks either
});

test('no model_id -> row stays hidden', async ({ page }) => {
  await mockSupabase(page, { watches: [{ ...WATCH, model_id: null }] });
  await page.addInitScript(() => { try { localStorage.setItem('ff_watch_db', 'true'); } catch (e) {} });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  await page.locator('.card-edit-btn, .card-edit-btn-noimg').first().click();
  await expect(page.locator('#watch-modal')).toBeVisible();
  await expect(page.locator('#wm-also-owned')).toBeHidden();
});

test('story block: long history clamps to 4 lines with an expand toggle; short history has none', async ({ page }) => {
  const LONG = Array(6).fill('Launched in 1953, it set the template for every diver since, and each generation refined the case, bezel and movement without abandoning the original silhouette.').join(' ');
  await mockSupabase(page, { watches: [WATCH] });
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total_owners: 2, era_min: null, era_max: null, visible: [] }) }));
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATS) }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...MODEL_ROW, history: LONG }) }));
  await page.route('**/rest/v1/watch_facts*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.addInitScript(() => { try { localStorage.setItem('ff_watch_db', 'true'); } catch (e) {} });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  await page.locator('.card-edit-btn, .card-edit-btn-noimg').first().click();
  await page.locator('#wm-also-owned').click();
  const mp = page.locator('#page-model');
  await expect(mp.locator('#mp-story')).toContainText('The story');
  await expect(mp.locator('.mp-quote')).toHaveCount(0);            // no facts → no pull-quote
  const toggle = mp.locator('#mp-history-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('Read the full history');
  const hist = mp.locator('#mp-history');
  const clampedH = await hist.evaluate(e => e.clientHeight);
  await toggle.click();
  await expect(toggle).toHaveText('Less');
  expect(await hist.evaluate(e => e.clientHeight)).toBeGreaterThan(clampedH);
  await toggle.click();
  await expect(toggle).toHaveText('Read the full history');
});
