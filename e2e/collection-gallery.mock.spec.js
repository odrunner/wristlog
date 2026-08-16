import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Collection "gallery" (images-only) view — mirrors the wishlist gallery.
// The header toggle is a single icon slot (replaced the Ranking Game button),
// so the icon row must not wrap on a 390px phone; Ranking Game moved to a
// "Rank" chip in the sort bar.

async function openCollection(page, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport);
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'collection');
  await expect(page.locator('#watches-grid .watch-card').first()).toBeVisible();
}

test.describe('collection gallery view', () => {
  test('toggle switches to image tiles and back, and persists across reload', async ({ page }) => {
    await openCollection(page);
    const btn = page.locator('#coll-view-btn');
    await expect(btn).toHaveAttribute('data-view', 'grid');
    await expect(btn).toHaveAttribute('aria-label', 'Gallery view');

    await btn.click();
    await expect(btn).toHaveAttribute('data-view', 'gallery');
    await expect(btn).toHaveAttribute('aria-label', 'Card view');
    const grid = page.locator('#watches-grid');
    await expect(grid).toHaveClass(/wl-gallery/);
    const tiles = grid.locator('.wl-tile');
    await expect(tiles).toHaveCount(SAMPLE_WATCHES.length);
    await expect(grid.locator('.watch-card')).toHaveCount(0);
    // Every tile has an image or the initials avatar, and a name
    await expect(tiles.first().locator('.wl-tile-img, .wl-tile-avatar')).toHaveCount(1);
    await expect(tiles.first().locator('.wl-tile-name')).toBeVisible();

    // Tapping a tile opens Edit
    await tiles.first().locator('.wl-tile-imglink').click();
    await expect(page.locator('#watch-modal')).toBeVisible();

    // Persists across reload
    await page.reload();
    await waitForAppBoot(page);
    await navigateTo(page, 'collection');
    await expect(page.locator('#watches-grid')).toHaveClass(/wl-gallery/);
    await expect(page.locator('#coll-view-btn')).toHaveAttribute('data-view', 'gallery');

    // Back to cards
    await page.locator('#coll-view-btn').click();
    await expect(page.locator('#watches-grid .watch-card').first()).toBeVisible();
    await expect(page.locator('#watches-grid .wl-tile')).toHaveCount(0);
  });

  test('Ranking Game lives in the sort bar and the header icons stay on one row at 390px', async ({ page }) => {
    await openCollection(page);
    // No Ranking Game button in the header any more
    await expect(page.locator('#page-collection .page-header button[title="Ranking Game"]')).toHaveCount(0);
    const rank = page.locator('#coll-sort-bar .coll-rank-chip');
    await expect(rank).toBeVisible();
    await rank.click();
    await expect(page.locator('#game-overlay')).toBeVisible();
    await page.locator('#game-overlay').evaluate(el => el.style.display = 'none');

    // Header action icons: one visual row, nothing past the right edge
    const report = await page.evaluate(() => {
      const wrap = document.querySelector('#page-collection .page-header > div');
      const kids = [...wrap.children].filter(c => c.getClientRects().length);
      const centers = kids.map(c => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; }).sort((a, b) => a - b);
      const rows = centers.reduce((acc, y) => { if (!acc.length || y - acc[acc.length - 1] > 12) acc.push(y); return acc; }, []);
      const spills = kids.filter(c => c.getBoundingClientRect().right > window.innerWidth + 1).length;
      return { rows: rows.length, spills, count: kids.length };
    });
    expect(report.rows, `header icons wrapped: ${JSON.stringify(report)}`).toBe(1);
    expect(report.spills).toBe(0);
  });
});
