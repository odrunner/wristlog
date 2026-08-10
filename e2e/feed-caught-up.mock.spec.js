import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  FAKE_USER, SAMPLE_WATCHES,
} from './helpers.js';

// Steve's feedback: "add a you're caught up bar in the scroll".
// Drives the real two-visit flow — first load establishes the watermark in
// localStorage, second load renders the divider from it — rather than poking
// the pure function, so the storage read/write wiring is covered too.

const OTHER = '00000000-0000-4000-8000-0000000000ff';

function log({ id, day, createdAt, user = OTHER }) {
  return {
    id, user_id: user, watch_id: 'watch-001',
    date: `2026-08-${String(day).padStart(2, '0')}`,
    created_at: createdAt,
    use_case: 'work', notes: `Post ${id}. `.repeat(4),
    strap_id: null, photo_url: null, visibility: 'public', club_id: null,
  };
}

// Three older posts, present on both visits.
const SEEN = [
  log({ id: 'seen-1', day: 7, createdAt: '2026-08-07T10:00:00Z' }),
  log({ id: 'seen-2', day: 6, createdAt: '2026-08-06T10:00:00Z' }),
  log({ id: 'seen-3', day: 5, createdAt: '2026-08-05T10:00:00Z' }),
];
// Two posts that only exist on the second visit.
const NEW = [
  log({ id: 'new-1', day: 9, createdAt: '2026-08-09T11:00:00Z' }),
  log({ id: 'new-2', day: 9, createdAt: '2026-08-09T10:00:00Z' }),
];

async function visit(page, logs) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs });
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'feed');
  await expect(page.locator('.feed-card').first()).toBeVisible();
}

test('divider appears between the new posts and the ones already seen', async ({ page }) => {
  await injectSession(page);

  // Visit 1: only the older posts. Nothing to mark yet — no prior watermark.
  await visit(page, SEEN);
  await expect(page.locator('.feed-caught-up')).toHaveCount(0);

  // Visit 2: two newer posts have arrived on top.
  await visit(page, [...NEW, ...SEEN]);
  const divider = page.locator('.feed-caught-up');
  await expect(divider).toHaveCount(1);
  await expect(divider).toContainText("You're all caught up");

  // It must sit below both new posts and above the first seen one.
  const order = await page.evaluate(() => {
    const kids = [...document.querySelectorAll('#feed-list > *')];
    return kids.map(k => k.classList.contains('feed-caught-up')
      ? 'DIVIDER'
      : (k.id || '').replace('feedcard-', '')).filter(Boolean);
  });
  const line = order.indexOf('DIVIDER');
  expect(line).toBeGreaterThan(order.indexOf('new-2'));
  expect(line).toBeLessThan(order.indexOf('seen-1'));
});

test('nothing new since last visit → divider sits at the very top', async ({ page }) => {
  await injectSession(page);

  await visit(page, SEEN);
  await visit(page, SEEN);   // identical feed, so nothing is new

  const order = await page.evaluate(() => {
    const kids = [...document.querySelectorAll('#feed-list > *')];
    return kids.map(k => k.classList.contains('feed-caught-up')
      ? 'DIVIDER'
      : (k.id || '').replace('feedcard-', '')).filter(Boolean);
  });
  expect(order[0]).toBe('DIVIDER');
});

test('your own new post does not push the divider down', async ({ page }) => {
  await injectSession(page);

  await visit(page, SEEN);
  const mine = log({ id: 'mine-1', day: 9, createdAt: '2026-08-09T12:00:00Z', user: FAKE_USER.id });
  await visit(page, [mine, ...SEEN]);

  const order = await page.evaluate(() => {
    const kids = [...document.querySelectorAll('#feed-list > *')];
    return kids.map(k => k.classList.contains('feed-caught-up')
      ? 'DIVIDER'
      : (k.id || '').replace('feedcard-', '')).filter(Boolean);
  });
  // Own post is not "new to you", so the line stays above everything.
  expect(order[0]).toBe('DIVIDER');
});
