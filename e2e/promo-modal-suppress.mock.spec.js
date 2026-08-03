import { test, expect } from '@playwright/test';

test('a modal that fired this session suppresses the slot', async ({ page }) => {
  await page.goto('/');
  const injected = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    _promoConfig = { enabled: true, first_position: 0, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true };
    _promoSlots = [{ id: 'p1', heading: 'H', audience: 'all', priority: 0,
                     starts_at: null, ends_at: null, max_impressions: null,
                     images: [], created_at: '2026-01-01T00:00:00Z' }];
    _promoEvents = []; _promoPlaced = new Set();

    window._modalShownThisSession = true;
    document.getElementById('feed-list').innerHTML = '<div class="feed-card">p</div>';
    window.injectPromoCards();
    return document.querySelectorAll('.promo-card').length;
  });
  expect(injected).toBe(0);
});

test('openFactModal marks the session as having shown a modal', async ({ page }) => {
  await page.goto('/');
  const flagged = await page.evaluate(() => {
    window._modalShownThisSession = false;
    window.openFactModal({ id: 'w1', brand: 'Seiko', name: 'SKX' }, 'A fact.');
    return window._modalShownThisSession;
  });
  expect(flagged).toBe(true);
});

// The two tests above only prove the variable exists and that injectPromoCards()
// reads it, and that ONE opener sets it when hand-driven. Neither proves the
// wiring end-to-end: that firing a REAL modal opener actually suppresses a
// card via injectPromoCards(), nor that the config flag genuinely
// discriminates rather than a card just happening to be absent for some
// other reason. This pair closes that gap by driving openFactModal() (a real
// opener, not a hand-set flag) and then calling injectPromoCards() twice —
// once with suppress_after_modal:true (must suppress) and once with it
// false (the identical modal-opened sequence must still produce a card).
test.describe('end-to-end: a real modal opener suppresses the promo slot, and only when configured to', () => {
  async function setupFeedAfterRealModal(page, { suppress }) {
    await page.goto('/');
    await page.evaluate(({ suppress }) => {
      currentUser = { id: 'u1' };
      document.getElementById('auth-screen').style.display = 'none';
      _promoConfig = { enabled: true, first_position: 0, repeat_every: 0,
                       max_per_session: 1, default_max_impressions: 3,
                       suppress_after_modal: suppress };
      _promoSlots = [{ id: 'p1', heading: 'H', audience: 'all', priority: 0,
                       starts_at: null, ends_at: null, max_impressions: null,
                       images: [], created_at: '2026-01-01T00:00:00Z' }];
      _promoEvents = []; _promoPlaced = new Set();
      window._modalShownThisSession = false; // starts unset — only the real opener below may flip it

      // Drive a REAL modal opener, not a hand-set flag.
      window.openFactModal({ id: 'w1', brand: 'Seiko', name: 'SKX' }, 'A fact.');

      document.getElementById('feed-list').innerHTML = '<div class="feed-card">p</div>';
    }, { suppress });
  }

  test('suppress_after_modal:true — a real modal opener suppresses the slot', async ({ page }) => {
    await setupFeedAfterRealModal(page, { suppress: true });
    // The opener really ran and really set the flag — not a given, since the
    // rest of this test would pass vacuously (no card for an unrelated
    // reason) if it silently hadn't.
    expect(await page.evaluate(() =>
      !document.getElementById('fact-modal').classList.contains('hidden') &&
      window._modalShownThisSession)).toBe(true);

    const count = await page.evaluate(() => {
      window.injectPromoCards();
      return document.querySelectorAll('.promo-card').length;
    });
    expect(count).toBe(0);
  });

  test('suppress_after_modal:false — the identical modal-opened sequence still produces a card', async ({ page }) => {
    await setupFeedAfterRealModal(page, { suppress: false });
    expect(await page.evaluate(() => window._modalShownThisSession)).toBe(true);

    const count = await page.evaluate(() => {
      window.injectPromoCards();
      return document.querySelectorAll('.promo-card').length;
    });
    expect(count).toBe(1);
  });
});
