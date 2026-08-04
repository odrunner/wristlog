import { test, expect } from '@playwright/test';

// Signing out and back in as a different account calls clearUserState() and
// never reloads the page. Every other per-session cache is wiped there —
// _factImpSeen carries the comment "must not survive an account switch" — but
// the promo session state was not, so account B inherited account A's spent
// max_per_session budget, A's impressions and A's modal flag. That silently
// breaks the two-test-account UAT loop this project runs on.

const SLOT = {
  id: 'p1', heading: 'Promo one', body: 'b', audience: 'all', status: 'active',
  priority: 0, starts_at: null, ends_at: null, max_impressions: null,
  cta_label: 'Go', cta_action: 'open_wishlist', images: [],
  created_at: '2026-01-01T00:00:00Z',
};

const CFG = {
  enabled: true, first_position: 2, repeat_every: 0, max_per_session: 1,
  default_max_impressions: 3, suppress_after_modal: true,
};

test('clearUserState() wipes every piece of promo session state', async ({ page }) => {
  await page.goto('/');
  const after = await page.evaluate(() => {
    _promoPlaced = new Set(['p1']);
    _promoImpressed = new Set(['p1']);
    _promoIsInternal = true;
    window._modalShownThisSession = true;
    window.__disconnected = false;
    // A live observer must be disconnected, not merely dropped — dropping the
    // reference leaves the old account's card nodes registered.
    _promoObserver = {
      disconnect() { window.__disconnected = true; },
      observe() {}, unobserve() {},
    };

    clearUserState();

    return {
      placed: _promoPlaced.size,
      impressed: _promoImpressed.size,
      observerCleared: _promoObserver === null,
      disconnected: window.__disconnected,
      modalFlag: window._modalShownThisSession,
      isInternal: _promoIsInternal,
    };
  });
  expect(after).toEqual({
    placed: 0, impressed: 0,
    observerCleared: true, disconnected: true, modalFlag: false,
    isInternal: false,
  });
});

test('the second account still gets a card after an in-page account switch', async ({ page }) => {
  // The reviewer's scenario end to end: testuser sees a card (impression
  // logged, so the prune loop deliberately will NOT refund the budget), then
  // signs out and testuser2 signs in without a reload.
  await page.goto('/');
  const counts = await page.evaluate(({ SLOT, CFG }) => {
    const posts = () => Array.from({ length: 6 },
      (_, i) => `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
    db.from = () => ({ insert: async () => ({ error: null }) });
    document.getElementById('auth-screen').style.display = 'none';

    // ── account A ──
    currentUser = { id: 'u1' };
    _promoConfig = CFG; _promoSlots = [SLOT]; _promoEvents = [];
    _promoPlaced = new Set(); _promoImpressed = new Set();
    document.getElementById('feed-list').innerHTML = posts();
    window.injectPromoCards();
    const a = document.querySelectorAll('.promo-card').length;
    _promoImpressed.add('p1');            // A actually saw it — budget is spent

    // ── sign out, sign in as B (no page reload) ──
    clearUserState();
    currentUser = { id: 'u2' };
    // loadPromoSlots() re-runs for B and refills these from B's own rows.
    _promoConfig = CFG; _promoSlots = [SLOT]; _promoEvents = [];
    document.getElementById('feed-list').innerHTML = posts();
    window.injectPromoCards();
    const b = document.querySelectorAll('.promo-card').length;

    return { a, b };
  }, { SLOT, CFG });
  expect(counts.a).toBe(1);
  expect(counts.b).toBe(1);
});
