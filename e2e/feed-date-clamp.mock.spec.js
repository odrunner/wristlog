// ── Feed ordering vs. timezone-ahead posters (mocked) ────────────────────────
// The feed's primary sort key is `logs.date` — the POSTER's local calendar wear
// date. Someone in a timezone ahead of the viewer stamps a date the viewer
// hasn't reached yet, which pinned their post to the top of the viewer's feed
// for most of the viewer's day, above posts made hours later.
//
// Reproduces the 2026-08-08 report end to end through the real loadFeed(): two
// Sydney posts dated "tomorrow" but created six and two hours EARLIER sat above
// the viewer's own post. Asserts they now fall into post-time order, and that a
// backdated post still sinks (the reason the feed keys on `date` at all).
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo, FAKE_USER } from './helpers.js';

const OTHER_USER = '7337041a-710f-40a3-a02e-98021bd0a230';

function log({ id, user_id, date, created_at, notes }) {
  return {
    id, user_id, watch_id: null, date, use_case: 'work', notes,
    photo_url: null, visibility: 'public', club_id: null, created_at,
  };
}

// Log ids of the rendered feed cards, top to bottom.
async function feedOrder(page) {
  return page.locator('#feed-list .feed-card[id^="feedcard-"]')
    .evaluateAll(els => els.map(el => el.id.replace('feedcard-', '')));
}

test.describe('Feed date clamping (mocked)', () => {
  test('a tomorrow-dated post made earlier no longer outranks a post made now', async ({ page }) => {
    // Freeze the viewer's clock so "today" is deterministic regardless of the
    // machine's timezone — the clamp is relative to the VIEWER's calendar day.
    await page.addInitScript(() => {
      const FIXED = new Date('2026-08-08T20:00:00-07:00').getTime(); // Vancouver
      const _D = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends _D {
        constructor(...a) { return a.length ? new _D(...a) : new _D(FIXED); }
        static now() { return FIXED; }
      };
      Date.parse = _D.parse; Date.UTC = _D.UTC;
    });

    const logs = [
      log({ id: 'l1', user_id: OTHER_USER, date: '2026-08-09',
            created_at: '2026-08-08T21:25:27.108794+00:00', notes: 'POST-SYDNEY-LATE' }),
      log({ id: 'l2', user_id: OTHER_USER, date: '2026-08-09',
            created_at: '2026-08-08T17:14:26.282492+00:00', notes: 'POST-SYDNEY-EARLY' }),
      log({ id: 'l3', user_id: FAKE_USER.id, date: '2026-08-08',
            created_at: '2026-08-09T03:29:25.272337+00:00', notes: 'POST-MINE' }),
      log({ id: 'l4', user_id: OTHER_USER, date: '2026-08-05',
            created_at: '2026-08-09T03:40:00.000000+00:00', notes: 'POST-BACKDATED' }),
    ];

    await mockSupabase(page, { logs });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'feed');

    await expect.poll(() => feedOrder(page), { timeout: 15_000 }).toEqual([
      'l3', // POST-MINE — newest by post time, wins outright
      'l1', // POST-SYDNEY-LATE  — clamps to today, falls to its real post time
      'l2', // POST-SYDNEY-EARLY — same
      'l4', // POST-BACKDATED — newest post of all, still sinks on its wear date
    ]);
  });
});
