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

// Posts and the divider, top to bottom. Scoped to those two classes on
// purpose: mountFeedLoadMoreSentinel() also appends #feed-load-sentinel to
// #feed-list, and a bare `> *` picks it up or not depending on when the read
// lands. Read through expect.poll below rather than once, since the feed
// renders twice (phase 1 placeholders, then phase 2 enrichment).
function feedOrder(page) {
  return page.evaluate(() => {
    const sel = '#feed-list > .feed-card, #feed-list > .feed-caught-up';
    return [...document.querySelectorAll(sel)].map(k =>
      k.classList.contains('feed-caught-up') ? 'DIVIDER' : (k.id || '').replace('feedcard-', ''));
  });
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
  await expect.poll(() => feedOrder(page))
    .toEqual(['new-1', 'new-2', 'DIVIDER', 'seen-1', 'seen-2', 'seen-3']);
});

test('nothing new since last visit → divider sits at the very top', async ({ page }) => {
  await injectSession(page);

  await visit(page, SEEN);
  await visit(page, SEEN);   // identical feed, so nothing is new

  await expect.poll(() => feedOrder(page))
    .toEqual(['DIVIDER', 'seen-1', 'seen-2', 'seen-3']);
});

test('your own new post does not push the divider down', async ({ page }) => {
  await injectSession(page);

  await visit(page, SEEN);
  const mine = log({ id: 'mine-1', day: 9, createdAt: '2026-08-09T12:00:00Z', user: FAKE_USER.id });
  await visit(page, [mine, ...SEEN]);

  // Own post is not "new to you", so the line stays above everything.
  await expect.poll(() => feedOrder(page))
    .toEqual(['DIVIDER', 'mine-1', 'seen-1', 'seen-2', 'seen-3']);
});
