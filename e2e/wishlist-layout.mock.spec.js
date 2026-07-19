import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Reported 2026-07-18 (iPhone screenshots):
//   1. Edit Wishlist Item — the bottom action row (Save / Cancel / Move to
//      Collection / delete) ran off the right edge; delete was cut off.
//   2. Wishlist page — the top toolbar (view toggle + Add from Photo +
//      "+ Add to Wishlist") ran off the right edge on landing.
//
// First fix let both rows wrap, which stopped the clipping but looked bad
// (a lone trash button / lone "+ Add to Wishlist" on a second line). The
// requirement is ONE LINE on a phone, so the controls are sized down on
// small screens instead of wrapping.
//
// flex-wrap:wrap is kept as a safety net: on very narrow/old devices (320px)
// wrapping is still preferable to clipping, so those only assert no overflow.

const SIZES = [
  { label: '430px', vp: { width: 430, height: 932 }, oneLine: true },  // iPhone Pro Max
  { label: '390px', vp: { width: 390, height: 844 }, oneLine: true },  // iPhone 14/15 — reported
  { label: '375px', vp: { width: 375, height: 812 }, oneLine: true },  // iPhone SE 2/3, 13 mini
  { label: '320px', vp: { width: 320, height: 720 }, oneLine: false }, // iPhone SE 1st gen
];

const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Cosmograph Daytona', ref: '126519LN',
    price: 42700, url: 'https://www.rolex.com/en-us/watches/daytona',
    added_date: '2026-03-18', wish_privacy: 'public', sort_order: 0 },
  { id: 'wl2', brand: 'A. Lange & Söhne', name: 'Datograph',
    wish_privacy: 'public', sort_order: 1 },
];

async function openWishlist(page, viewport) {
  await page.setViewportSize(viewport);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'wishlist');
  await expect(page.locator('#page-wishlist')).toBeVisible();
}

// Rows: how many distinct offsetTop values the visible children occupy.
// Spills: children extending past the viewport's right edge.
async function rowReport(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const kids = [...el.children].filter(c => c.getClientRects().length);
    // Cluster by vertical CENTER, not top: children of different heights are
    // centred on the same row, so their `top` values legitimately differ by a
    // few px. Anything within 12px is the same visual row.
    const centers = kids
      .map(c => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; })
      .sort((a, b) => a - b);
    const tops = centers.reduce((acc, y) => {
      if (!acc.length || y - acc[acc.length - 1] > 12) acc.push(y);
      return acc;
    }, []);
    const spills = kids
      .map(c => ({
        text: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 24),
        right: Math.round(c.getBoundingClientRect().right),
      }))
      .filter(k => k.right > window.innerWidth + 1);
    return { missing: false, rows: tops.length, spills, count: kids.length };
  }, selector);
}

test.describe('Wishlist layout on phones (mocked)', () => {
  for (const { label, vp, oneLine } of SIZES) {
    test(`top toolbar fits at ${label}`, async ({ page }) => {
      await openWishlist(page, vp);
      const r = await rowReport(page, '.wl-actions');
      expect(r.missing).toBe(false);
      expect(r.spills).toEqual([]);
      if (oneLine) expect(r.rows).toBe(1);
    });

    test(`edit-item actions fit at ${label}`, async ({ page }) => {
      await openWishlist(page, vp);
      await page.evaluate(() => openEditWishlist('wl1'));
      await expect(page.locator('#wishlist-modal')).toBeVisible();
      await expect(page.locator('#wl-move-btn')).toBeVisible();
      await expect(page.locator('#wl-delete-btn')).toBeVisible();

      const r = await rowReport(page, '#wishlist-modal .modal-actions');
      expect(r.missing).toBe(false);
      expect(r.count).toBe(4);          // Save, Cancel, Move to Collection, delete
      expect(r.spills).toEqual([]);
      if (oneLine) expect(r.rows).toBe(1);
    });

    test(`page does not scroll horizontally at ${label}`, async ({ page }) => {
      await openWishlist(page, vp);
      const o = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth + 1);
    });
  }

  test('buttons stay comfortably tappable at 375px', async ({ page }) => {
    await openWishlist(page, { width: 375, height: 812 });
    await page.evaluate(() => openEditWishlist('wl1'));
    await expect(page.locator('#wishlist-modal')).toBeVisible();
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('#wishlist-modal .modal-actions > *')]
        .filter(c => c.getClientRects().length)
        .map(c => Math.round(c.getBoundingClientRect().height)));
    // Shrinking to fit must not produce sub-32px tap targets.
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(32);
  });
});
