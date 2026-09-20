// ── Comment box survives the background comment refetch (mocked) ─────────
// Expanding a post whose comments are cached shows the box at once and refetches
// the thread in the background (bcbfa4d). That refetch used to rebuild the whole
// card ~1s later, replacing the input the user was already typing in: focus,
// the iOS keyboard, the typed text and the @mention picker all vanished.
// Reported 2026-09-04 ("@ didn't work when replying to a comment").

import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

const COMMENT = {
  id: 'c-race-1', log_id: 'log-001', user_id: 'u-other',
  body: 'Lovely dial', created_at: '2026-05-20T10:00:00Z', moderation_status: null,
};

test.describe('Comment draft vs background refetch (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
    await injectSession(page);
    await page.route('**/rest/v1/comments*', async route => {
      if (route.request().method() !== 'GET') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      // The per-post refetch (select=*) is the background one — make it land
      // well after the user has started typing, like a real round-trip does.
      if (route.request().url().includes('select=*')) await new Promise(r => setTimeout(r, 800));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([COMMENT]) });
    });
    await page.route('**/rest/v1/comment_likes*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.goto('/');
    await waitForAppBoot(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden')));
  });

  test('typing in the comment box is not wiped when the thread refetch lands', async ({ page }) => {
    const card = page.locator('#feedcard-log-001');
    await expect(card).toBeVisible({ timeout: 8000 });

    await card.locator('.comments-add-prompt').click();
    const input = card.locator('#comment-input-log-001');
    await expect(input).toBeVisible();
    await input.evaluate(el => { el.dataset.marker = 'original'; el.focus(); });
    await page.keyboard.type('@lo');

    // Let the delayed background refetch resolve and try to rebuild the card.
    await page.waitForTimeout(2000);

    const state = await page.evaluate(() => {
      const inp = document.getElementById('comment-input-log-001');
      return {
        sameNode: !!(inp && inp.dataset.marker === 'original'),
        focused: document.activeElement === inp,
        value: inp ? inp.value : null,
      };
    });
    expect(state.value).toBe('@lo');
    expect(state.focused).toBe(true);
    expect(state.sameNode).toBe(true);
  });

  // Safari/WKWebView leave focus in the comment box when a button is tapped, so
  // the like is driven by a direct call here — a Chromium click would move focus
  // to the button and hide the bug (audit 2026-09-20 C1).
  test('a like while the comment box is focused still updates the card', async ({ page }) => {
    const card = page.locator('#feedcard-log-001');
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.locator('.comments-add-prompt').click();
    const input = card.locator('#comment-input-log-001');
    await expect(input).toBeVisible();
    await page.waitForTimeout(1500);   // let the background refetch settle first
    await input.evaluate(el => { el.dataset.marker = 'original'; el.focus(); });
    await page.keyboard.type('nice');

    await page.evaluate(() => toggleLike('log-001'));
    await expect(card.locator('.feed-action-btn.liked')).toHaveCount(1);
    // The thread refetched in the background is rendered too, not held back.
    await expect(card.locator('.comment-item')).toHaveCount(1);

    const state = await page.evaluate(() => {
      const inp = document.getElementById('comment-input-log-001');
      return {
        sameNode: !!(inp && inp.dataset.marker === 'original'),
        focused: document.activeElement === inp,
        value: inp ? inp.value : null,
        cards: document.querySelectorAll('#feedcard-log-001').length,
      };
    });
    expect(state).toEqual({ sameNode: true, focused: true, value: 'nice', cards: 1 });
  });
});
