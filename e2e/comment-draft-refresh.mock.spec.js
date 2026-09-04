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
});
