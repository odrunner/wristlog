// Wishlist gallery view: tiles reorder by drag-and-drop like list cards.
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Daytona', wish_privacy: 'public', sort_order: 0 },
  { id: 'wl2', brand: 'Omega', name: 'Speedmaster', wish_privacy: 'public', sort_order: 1 },
  { id: 'wl3', brand: 'Tudor', name: 'Black Bay', wish_privacy: 'public', sort_order: 2 },
];

async function open(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
  await injectSession(page); await page.goto('/'); await waitForAppBoot(page);
  await navigateTo(page, 'wishlist');
  await page.evaluate(() => setWishlistView('gallery'));
  await expect(page.locator('.wl-gallery .wl-tile')).toHaveCount(3);
}

test('gallery tiles are draggable and carry a touch handle', async ({ page }) => {
  await open(page);
  const tiles = page.locator('.wl-tile');
  await expect(tiles.first()).toHaveAttribute('draggable', 'true');
  await expect(tiles.first()).toHaveAttribute('data-id', 'wl1');
  await expect(page.locator('.wl-tile .wl-tile-handle')).toHaveCount(3);
});

test('mouse drag moves a tile and persists the new order', async ({ page }) => {
  await open(page);
  await page.locator('.wl-tile[data-id="wl3"]').dragTo(page.locator('.wl-tile[data-id="wl1"]'));
  await expect(page.locator('.wl-tile')).toHaveCount(3);
  const order = await page.locator('.wl-tile').evaluateAll(els => els.map(e => e.dataset.id));
  expect(order).toEqual(['wl3', 'wl1', 'wl2']);
  const model = await page.evaluate(() => wishlist.map(w => w.id));
  expect(model).toEqual(['wl3', 'wl1', 'wl2']);
  // list view shows the same order
  await page.evaluate(() => setWishlistView('list'));
  const listOrder = await page.locator('.wl-card').evaluateAll(els => els.map(e => e.dataset.id));
  expect(listOrder).toEqual(['wl3', 'wl1', 'wl2']);
});

test('touch drag via the handle reorders tiles', async ({ page }) => {
  await open(page);
  const from = await page.locator('.wl-tile[data-id="wl1"] .wl-tile-handle').boundingBox();
  const to = await page.locator('.wl-tile[data-id="wl3"]').boundingBox();
  await page.evaluate(({ from, to }) => {
    const mk = (type, x, y, target) => {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true });
    };
    const handle = document.querySelector('.wl-tile[data-id="wl1"] .wl-tile-handle');
    handle.dispatchEvent(mk('touchstart', from.x + 5, from.y + 5, handle));
    document.dispatchEvent(mk('touchmove', to.x + to.width / 2, to.y + to.height / 2, handle));
    document.dispatchEvent(mk('touchend', to.x + to.width / 2, to.y + to.height / 2, handle));
  }, { from, to });
  const order = await page.locator('.wl-tile').evaluateAll(els => els.map(e => e.dataset.id));
  expect(order).toEqual(['wl2', 'wl3', 'wl1']);
});

test('no drag while share-selecting', async ({ page }) => {
  await open(page);
  await page.evaluate(() => enterWishlistSelect());
  await expect(page.locator('.wl-tile[draggable="true"]')).toHaveCount(0);
  await expect(page.locator('.wl-tile-handle')).toHaveCount(0);
});
