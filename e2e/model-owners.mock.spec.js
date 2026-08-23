import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo } from './helpers.js';

// "Also owned by" row in the watch edit modal + the in-app model sheet it
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
  specs: { type: 'Dive watch', size: '40–41mm' }, facts_key: 'rolex|submariner',
};

async function openEditModal(page, ownersPayload) {
  await mockSupabase(page, { watches: [WATCH] });
  await page.route('**/rest/v1/rpc/model_owners*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ownersPayload),
  }));
  await page.route('**/rest/v1/watch_models*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(MODEL_ROW),
  }));
  await page.route('**/rest/v1/watch_facts*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ fact: 'It once dove very deep indeed.', position: 0 }]),
  }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  await page.locator('.card-edit-btn, .card-edit-btn-noimg').first().click();
  await expect(page.locator('#watch-modal')).toBeVisible();
}

test('row shows count + era, tap opens in-app model sheet with facts and owners', async ({ page }) => {
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
  const sheet = page.locator('#model-sheet-modal');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Rolex');
  await expect(sheet).toContainText('Submariner');
  await expect(sheet).toContainText('It once dove very deep indeed.');
  await expect(sheet).toContainText('Steve');
  await expect(sheet).toContainText('@ana');
  await expect(sheet).toContainText('3 other members have this watch');
  await sheet.locator('[aria-label="Close"]').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#watch-modal')).toBeVisible(); // back to the watch modal
});

test('sole owner: row shows rare-bird copy, sheet still opens with facts', async ({ page }) => {
  await openEditModal(page, { total_owners: 1, era_min: null, era_max: null, visible: [] });
  const row = page.locator('#wm-also-owned');
  await expect(row).toBeVisible();
  await expect(row).toContainText("You're the only one on WRotate with this one");
  await row.click();
  const sheet = page.locator('#model-sheet-modal');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("You're the only one on WRotate with this one");
  await expect(sheet).toContainText('It once dove very deep indeed.');
});

test('no model_id -> row stays hidden', async ({ page }) => {
  await mockSupabase(page, { watches: [{ ...WATCH, model_id: null }] });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  await page.locator('.card-edit-btn, .card-edit-btn-noimg').first().click();
  await expect(page.locator('#watch-modal')).toBeVisible();
  await expect(page.locator('#wm-also-owned')).toBeHidden();
});
