import { test, expect } from '@playwright/test';

test('a modal that fired this session suppresses the slot', async ({ page }) => {
  await page.goto('/');
  const injected = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    _promoConfig = { enabled: true, first_position: 0, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true };
    _promoSlots = [{ id: 'p1', heading: 'H', audience: 'all', status: 'active', priority: 0,
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
      _promoSlots = [{ id: 'p1', heading: 'H', audience: 'all', status: 'active', priority: 0,
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

// ── Ordering, not just wiring ───────────────────────────────────────────────
// The tests above set the flag BEFORE injection, which is the one ordering that
// never happens in production. renderFeed() calls maybeShowFactModal() and then
// injectPromoCards() in the same synchronous pass, but every opener defers — a
// setTimeout, then an awaited peek_watch_fact RPC — so the flag is still false
// at injection time and flips seconds later, with the card already on screen.
// suppress_after_modal then loses the exact race it exists to win. The fix is a
// retraction: an opener pulls back any card the user has not yet SEEN and
// refunds its session budget.
test.describe('a modal that fires AFTER injection still wins', () => {
  const SLOT = {
    id: 'p1', heading: 'H', audience: 'all', status: 'active', priority: 0,
    starts_at: null, ends_at: null, max_impressions: null, images: [],
    created_at: '2026-01-01T00:00:00Z',
  };

  async function placeThenOpenModal(page, { suppress = true, seen = false } = {}) {
    await page.goto('/');
    return page.evaluate(({ SLOT, suppress, seen }) => {
      currentUser = { id: 'u1' };
      document.getElementById('auth-screen').style.display = 'none';
      _promoConfig = { enabled: true, first_position: 0, repeat_every: 0,
                       max_per_session: 1, default_max_impressions: 3,
                       suppress_after_modal: suppress };
      _promoSlots = [SLOT]; _promoEvents = [];
      _promoPlaced = new Set(); _promoDismissed = new Set(); _promoImpressed = new Set();
      window._modalShownThisSession = false;
      db.from = () => ({ insert: async () => ({ error: null }) });
      document.getElementById('feed-list').innerHTML = '<div class="feed-card">p</div>';

      window.injectPromoCards();                       // 1. card lands first
      const placed = document.querySelectorAll('.promo-card').length;
      if (seen) _promoImpressed.add('p1');             // the user scrolled it into view

      window.openFactModal({ id: 'w1', brand: 'Seiko', name: 'SKX' }, 'A fact.'); // 2. modal, later

      return {
        placed,
        after: document.querySelectorAll('.promo-card').length,
        budget: _promoPlaced.size,
        flag: window._modalShownThisSession,
        modalOpen: !document.getElementById('fact-modal').classList.contains('hidden'),
      };
    }, { SLOT, suppress, seen });
  }

  test('an unseen card is retracted and its session budget refunded', async ({ page }) => {
    const r = await placeThenOpenModal(page);
    expect(r.placed).toBe(1);        // the card really was on screen first
    expect(r.modalOpen).toBe(true);  // the real opener really ran
    expect(r.flag).toBe(true);
    expect(r.after).toBe(0);         // ...and the card is gone again
    expect(r.budget).toBe(0);        // refunded, so it can appear next session
  });

  test('a card the user has already SEEN is left alone', async ({ page }) => {
    // Pulling a card out from under someone mid-read is worse than the double
    // surface it would prevent, and the impression is already logged and paid for.
    const r = await placeThenOpenModal(page, { seen: true });
    expect(r.after).toBe(1);
    expect(r.budget).toBe(1);
  });

  test('suppress_after_modal:false leaves the card in place', async ({ page }) => {
    const r = await placeThenOpenModal(page, { suppress: false });
    expect(r.flag).toBe(true);
    expect(r.after).toBe(1);
    expect(r.budget).toBe(1);
  });
});
