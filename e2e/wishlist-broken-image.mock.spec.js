// ── Wishlist gallery: a wishlist image that fails to load ────────────────────
// The gallery tile's image area is also its tap target — it's what opens Edit.
// It has no size of its own and takes its height from the <img> inside it, so
// an image that 404s (dead retailer link, host down, hotlink blocked) used to
// collapse the tile to zero height and silently remove the tap target. The
// no-image case already renders an initials avatar; a FAILED image now falls
// back to the same one.
//
// This also fixes an app.mock.spec.js flake: the fixtures point at example.com,
// so whether the tile was clickable depended on whether that request had failed
// yet by the time the test clicked — it only broke under full-suite load.
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Submariner', url: 'https://www.rolex.com/sub',
    image: 'https://example.com/broken-sub.jpg', color: '#c9a84c', wish_privacy: 'public', sort_order: 0 },
];

test.describe('Wishlist gallery with a broken image (mocked)', () => {
  test('a failed image keeps the tile clickable and shows the initials avatar', async ({ page }) => {
    // Fail the image request outright, so onerror is guaranteed to have fired
    // before the click — the condition that only appeared under load before.
    await page.route('https://example.com/**', route => route.abort());

    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'wishlist');
    await page.evaluate(() => setWishlistView('gallery'));
    await expect(page.locator('.wl-gallery .wl-tile')).toHaveCount(1);

    // The broken <img> is replaced by the same avatar the no-image case uses.
    const avatar = page.locator('.wl-tile-imglink .wl-tile-avatar');
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveText('RS');
    await expect(page.locator('.wl-tile-imglink img')).toHaveCount(0);

    // The tap target kept its box — this is what regressed to height 0.
    const box = await page.locator('.wl-tile-imglink').boundingBox();
    expect(box.height).toBeGreaterThan(50);

    // And it still opens Edit.
    await page.locator('.wl-tile-imglink').click();
    await expect(page.locator('#wishlist-modal')).toBeVisible();
  });
});
