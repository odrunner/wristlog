import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Collection sort bar (2026-09-29, from user feedback): the sort chips show
// even when the Ranking Game was never played (only "My Ranking" needs it),
// a "Last Worn" sort joins the bar with a recency badge on each card, and a
// report button beside Share points to the sortable Stats table where
// purchase price / market value / purchase date sorting already lives.

// A third watch that has never been worn and was bought most recently.
const UNWORN_WATCH = {
  ...SAMPLE_WATCHES[0],
  id: 'watch-unworn',
  brand: 'Tudor',
  name: 'Black Bay 58',
  ref: '79030N',
  purchase_date: '2026-01-01',
  elo_rating: null,
};

async function openCollection(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  // No elo_rating anywhere: this user never played the Ranking Game
  const watches = [...SAMPLE_WATCHES, UNWORN_WATCH].map(w => ({ ...w, elo_rating: null }));
  await mockSupabase(page, { watches, logs: SAMPLE_LOGS });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => setCollView('grid'));
  await navigateTo(page, 'collection');
  await expect(page.locator('#watches-grid .watch-card').first()).toBeVisible();
}

test('sort chips show without a ranking; My Ranking appears only once ranked', async ({ page }) => {
  await openCollection(page);
  const chips = page.locator('#coll-sort-bar .coll-sort-chip:not(.coll-rank-chip)');
  await expect(chips).toHaveText(['Newest', 'Most Worn', 'Last Worn']);
  // Playing the Ranking Game adds the My Ranking chip
  await page.evaluate(() => { eloRatings[watches[0].id] = 1500; renderCollection(true); });
  await expect(chips).toHaveText(['Newest', 'My Ranking', 'Most Worn', 'Last Worn']);
});

test('Last Worn sorts most-recent first, never-worn last, with recency badges', async ({ page }) => {
  await openCollection(page);
  // Default Newest: the 2026 purchase leads
  const names = page.locator('#watches-grid .watch-card .watch-card-name');
  await expect(names.first()).toHaveText('Black Bay 58');

  await page.locator('#coll-sort-bar .coll-sort-chip', { hasText: 'Last Worn' }).click();
  await expect(names).toHaveText(['Submariner Date', 'Speedmaster Professional', 'Black Bay 58']);
  // Recency badge on worn cards, "Never" on the unworn one
  const badges = page.locator('#watches-grid .watch-card .rank-badge-card');
  await expect(badges).toHaveCount(3);
  await expect(badges.first()).toHaveText(/\d+d ago|Today/);
  await expect(badges.last()).toHaveText('Never');
});

test('report button beside Share jumps to the sortable Stats table with a Last Worn column', async ({ page }) => {
  await openCollection(page);
  await expect(page.locator('#coll-report-btn')).toBeVisible();
  await page.locator('#coll-report-btn').click();
  await expect(page.locator('#page-stats')).toHaveClass(/active/);
  await expect(page.locator('#coll-report-card')).toBeVisible();
  const lastTh = page.locator('#coll-report-table th', { hasText: 'Last Worn' });
  await expect(lastTh).toBeVisible();
  await lastTh.click();
  await expect(lastTh).toHaveClass(/active-sort/);
  // Never-worn rows sink to the bottom regardless of direction
  const lastRowName = page.locator('#coll-report-table tbody tr:nth-last-child(2) td').first();
  await expect(lastRowName).toContainText('Black Bay 58');
});
