import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Reported 2026-07-18 (iPhone screenshots):
//   1. Edit Wishlist Item — the bottom action row (Save / Cancel / Move to
//      Collection / delete) runs off the right edge; the delete button is cut off.
//   2. Wishlist page — the top toolbar (view toggle + Add from Photo +
//      "+ Add to Wishlist") runs off the right edge on landing.
//
// Root causes:
//   1. #wishlist-modal .modal-actions carried an INLINE flex-wrap:nowrap, which
//      beats the @media (max-width:640px) `.modal-actions { flex-wrap: wrap }`
//      rule — inline styles win over media queries.
//   2. .wl-actions was hard-coded flex-wrap:nowrap with no mobile override.

const PHONE = { width: 390, height: 844 };   // iPhone 14/15 logical size
const NARROW = { width: 320, height: 720 };  // iPhone SE 1st gen — worst case

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

// True when any child sticks out past its container's right/left edge.
async function overflowReport(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const box = el.getBoundingClientRect();
    const kids = [...el.children].filter(c => c.offsetParent !== null || c.getClientRects().length);
    const spills = kids
      .map(c => {
        const r = c.getBoundingClientRect();
        return { text: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 28),
                 right: Math.round(r.right), left: Math.round(r.left) };
      })
      .filter(k => k.right > Math.round(box.right) + 1 || k.left < Math.round(box.left) - 1);
    return {
      missing: false,
      containerRight: Math.round(box.right),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      spills,
    };
  }, selector);
}

test.describe('Wishlist layout on phones (mocked)', () => {
  for (const [label, vp] of [['390px', PHONE], ['320px', NARROW]]) {
    test(`top toolbar does not overflow at ${label}`, async ({ page }) => {
      await openWishlist(page, vp);
      // With flex-wrap:nowrap the container itself grows past the viewport, so
      // the children "fit" inside it — measure against the viewport instead.
      const r = await page.evaluate(() => {
        const el = document.querySelector('.wl-actions');
        if (!el) return { missing: true };
        const box = el.getBoundingClientRect();
        const spills = [...el.children]
          .map(c => {
            const cr = c.getBoundingClientRect();
            return { text: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 28),
                     right: Math.round(cr.right) };
          })
          .filter(k => k.right > window.innerWidth + 1);
        return { missing: false, right: Math.round(box.right), viewport: window.innerWidth, spills };
      });
      expect(r.missing).toBe(false);
      expect(r.spills).toEqual([]);
      expect(r.right).toBeLessThanOrEqual(r.viewport + 1);
    });

    test(`page does not scroll horizontally at ${label}`, async ({ page }) => {
      await openWishlist(page, vp);
      const over = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(over.scrollWidth).toBeLessThanOrEqual(over.clientWidth + 1);
    });

    test(`edit-item action buttons do not overflow at ${label}`, async ({ page }) => {
      await openWishlist(page, vp);
      // Open the edit modal for the first item.
      await page.locator('.wl-name, .wl-item-name, .wl-tile-name').first().click();
      await expect(page.locator('#wishlist-modal')).toBeVisible();
      // Edit mode shows Move to Collection + Delete alongside Save/Cancel.
      await expect(page.locator('#wl-move-btn')).toBeVisible();
      await expect(page.locator('#wl-delete-btn')).toBeVisible();

      const r = await overflowReport(page, '#wishlist-modal .modal-actions');
      expect(r.missing).toBe(false);
      expect(r.spills).toEqual([]);
      expect(r.scrollWidth).toBeLessThanOrEqual(r.clientWidth + 1);
    });
  }

  test('the whole page never scrolls horizontally at 320px', async ({ page }) => {
    await openWishlist(page, NARROW);
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows).toBe(false);
  });
});
