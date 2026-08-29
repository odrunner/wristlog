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
const STATS = {
  owners: 4, public_owners: 2, wishlisted: 2, wishlisted_by_me: false, top_ref: '124060',
  wears: { w90: 12, wearers90: 3, all_time: 40 },
  wear_strip: [0,0,1,0,0,2,0,0,0,1,0,0,3,0,2], wear_weeks: [0,1,2,1,3,0,2,1,0,2,0,3],
  accuracy: { n_sessions: 20, n_measurers: 4, med_rate: -2.9, med_abs_rate: 4.1, med_amp: 260, hist: [0,1,2,3,5,4,3,1,1,0,0,0,0], hist_min: -25, hist_max: 14 },
  value: { median_now: 9000, n_contributors: 5, series: [{ ym: '2026-06', median: 8500, n: 3 }, { ym: '2026-07', median: 8800, n: 4 }, { ym: '2026-08', median: 9000, n: 4 }] },
  cost_per_wear: { median: 96, n_owners: 6, wears: 1204 },
  wear_share: { index: 2.8, share: 34, fair: 12, n_owners: 14, wears: 340, pct_rank: 96, n_models: 1412,
    bench: { brand: 22, type: 19, type_label: 'Dive watch', all: 14 },
    retention: [{ bucket: 'yr 1', share: 41, n: 5 }, { bucket: 'yr 2', share: 36, n: 4 }, { bucket: '5+', share: 31, n: 3 }] },
  era: [0, 1, 0, 0, 1, 2], tenure: { years: 6.5, n: 4 },
  specs_agg: { caliber: { v: '3230', n: 3 } },
  photos: [], brand_models: 14,
  related: [{ id: 'aaaaaaaa-0000-0000-0000-000000000009', brand: 'Rolex', name: 'Submariner Date', slug: 'rolex-submariner-date', owners: 11 }],
  mine: [{ id: 'watch-001', brand: 'Rolex', name: 'Submariner', ref: '124060', last_rate: -1.2 }],
};

async function openEditModal(page, ownersPayload) {
  await mockSupabase(page, { watches: [WATCH] });
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ownersPayload),
  }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(MODEL_ROW),
  }));
  await page.route('**/rest/v1/rpc/model_stats*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(STATS),
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

test('row shows count + era, tap opens in-app model page with facts and owners', async ({ page }) => {
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
  await expect(mp.locator('h1, div').filter({ hasText: /^Submariner$/ }).first()).toBeVisible();
  // stat grid
  await expect(mp).toContainText('−2.9');
  await expect(mp).toContainText('20 measurements · 4 members');
  await expect(mp).toContainText('$9,000');
  await expect(mp).toContainText('▲ 6% since Jun');
  await expect(mp.locator('svg[data-tile-spark]')).toHaveCount(1);
  await expect(mp).toContainText('by 3 of 4 owners');
  await expect(mp).toContainText('$96');
  // fun-fact band + Data tab
  await expect(mp.locator('#mp-story')).toContainText('The watch');
  await expect(mp.locator('#mp-story')).toContainText('Launched in 1953');
  await expect(mp.locator('#mp-tabs')).not.toContainText('Lore');
  const kicker = mp.locator('#mp-fact-kicker');
  const before = await kicker.textContent();
  const bodyBefore = await mp.locator('#mp-fact-body').textContent();
  await mp.locator('[data-mp=fact-next]').click();
  expect(await kicker.textContent()).not.toBe(before);
  expect(await mp.locator('#mp-fact-body').textContent()).not.toBe(bodyBefore);
  await mp.locator('[data-mp=fact-next]').click();
  expect(await kicker.textContent()).toBe(before); // wraps around
  await mp.locator('[data-mp=fact-prev]').click();
  expect(await kicker.textContent()).not.toBe(before); // previous wraps back to the other fact
  await mp.locator('[data-mp=fact-prev]').click();
  expect(await kicker.textContent()).toBe(before);
  await expect(mp).toContainText('2.8×');
  await expect(mp).toContainText('Top 4%');
  await expect(mp).toContainText('of 1,412 models · 340 wears from 14 collections');
  await expect(mp).toContainText('Dive watches');
  await expect(mp).toContainText('Does it last');
  await expect(mp).toContainText('Rate distribution');
  await expect(mp).toContainText('Wear pattern');
  // tabs
  await mp.locator('#mp-tab-specs').click();
  await expect(mp).toContainText('Member-verified');
  await expect(mp).toContainText('3 watches');
  await expect(mp).toContainText('References by era');
  await expect(mp).toContainText('5513');
  await mp.locator('#mp-tab-owners').click();
  await expect(mp).toContainText('Ownership by era');
  await expect(mp).toContainText('6.5 yrs');
  await expect(mp).not.toContainText('@ana');       // no owner identities anywhere
  // more from brand + action bar
  await expect(mp).toContainText('All 14 Rolex models');
  await expect(mp).toContainText('Open your Submariner');
  await mp.getByText('‹ Back').click();
  await expect(page.locator('#page-collection')).toHaveClass(/active/); // back where we came from
});

test('sole owner: row shows rare-bird copy, page still opens with facts', async ({ page }) => {
  await openEditModal(page, { total_owners: 1, era_min: null, era_max: null, visible: [] });
  const row = page.locator('#wm-also-owned');
  await expect(row).toBeVisible();
  await expect(row).toContainText("You're the only one on WRotate with this one");
  await row.click();
  const mp = page.locator('#page-model');
  await expect(mp).toHaveClass(/active/);
  await mp.locator('#mp-tab-owners').click();
  await expect(mp).toContainText('1 owner');
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

test('story block: long history clamps to 3 lines with an expand toggle; short history has none', async ({ page }) => {
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
  await expect(mp.locator('#mp-story')).toContainText('The watch');
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
