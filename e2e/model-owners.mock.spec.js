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
  owners: 4, wishlisted: 2,
  wears: { w90: 12, wearers90: 3, all_time: 40 },
  accuracy: { n_sessions: 20, n_measurers: 4, med_rate: -2.9, med_abs_rate: 4.1, med_amp: 260 },
  value: { median_now: 9000, n_contributors: 5, series: [{ ym: '2026-06', median: 8500, n: 3 }, { ym: '2026-07', median: 8800, n: 4 }, { ym: '2026-08', median: 9000, n: 4 }] },
  wear_index: { index: 2.23, n_owners: 3, pct_rank: 90 },
  specs_agg: { caliber: { v: '3230', n: 3 } },
  photos: [], related: [{ id: 'aaaaaaaa-0000-0000-0000-000000000009', brand: 'Rolex', name: 'Submariner Date', slug: 'rolex-submariner-date', owners: 11 }],
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
    body: JSON.stringify([{ fact: 'It once dove very deep indeed.', position: 0 }]),
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
  await expect(mp).toContainText('Rolex');
  await expect(mp).toContainText('Submariner');
  await expect(mp).toContainText('It once dove very deep indeed.');
  await expect(mp).toContainText('Steve');
  await expect(mp).toContainText('@ana');
  await expect(mp).toContainText('You and 3 other members have this watch');
  // v2 sections: numbers, yours, about, specs, related
  await expect(mp).toContainText('The archetypal dive watch.');
  await expect(mp).toContainText('Wear Index');
  await expect(mp).toContainText('more than twice its share');
  await expect(mp).toContainText('worn more than 90% of models');
  await expect(mp).toContainText('-2.9 s/d');
  await expect(mp).toContainText('20 measurements from 4 members');
  await expect(mp).toContainText('$9,000');
  await expect(mp).toContainText('▲ 6% since Jun');
  await expect(mp.locator('svg[data-tile-spark]')).toHaveCount(1);
  await expect(mp).toContainText('12 wears in the last 90 days');
  await expect(mp).toContainText('2 more want it');
  await expect(mp).toContainText('Yours: -1.2 s/d');
  await expect(mp).toContainText('Launched in 1953');
  await expect(mp).toContainText('5513');
  await expect(mp).toContainText('1520');
  await expect(mp).toContainText("from 3 members' watches");
  await expect(mp).toContainText('Submariner Date');
  await mp.getByText('← Back').click();
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
  await expect(mp).toContainText("You're the only one on WRotate with this one");
  await expect(mp).toContainText('It once dove very deep indeed.');
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
