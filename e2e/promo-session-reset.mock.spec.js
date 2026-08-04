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
    _promoSlotPositionMemo = { p1: 5 };
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
      positionMemo: Object.keys(_promoSlotPositionMemo).length,
    };
  });
  expect(after).toEqual({
    placed: 0, impressed: 0,
    observerCleared: true, disconnected: true, modalFlag: false,
    isInternal: false, positionMemo: 0,
  });
});

test('an in-page account switch does not let account B inherit account A\'s stale card position', async ({ page }) => {
  // Same root cause as the reviewer's position-drift scenario, but via the
  // OTHER path that could leak a remembered position across sessions: an
  // account switch without a page reload. Account A places p1 at a position
  // driven by repeat_every (so a stale, unreset memo would visibly mis-place
  // it); B must place the SAME slot id fresh, at the formula's own answer.
  const SLOT2 = { ...SLOT, id: 'p1' };
  const CFG2 = { ...CFG, first_position: 2, repeat_every: 3, max_per_session: 1 };
  await page.goto('/');
  const positions = await page.evaluate(({ SLOT2, CFG2 }) => {
    const posts = () => Array.from({ length: 10 },
      (_, i) => `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
    const posBefore = () => {
      const kids = [...document.getElementById('feed-list').children];
      const idx = kids.findIndex((n) => n.dataset && n.dataset.promoId === 'p1');
      return kids.slice(0, idx).filter((n) => n.classList.contains('feed-card')).length;
    };
    db.from = () => ({ insert: async () => ({ error: null }) });
    document.getElementById('auth-screen').style.display = 'none';

    // ── account A: places p1 at post-2 and corrupts the memo as if a later,
    // shorter-feed reclaim had clamped it — this is exactly the stale state
    // that must NOT leak to B. ──
    currentUser = { id: 'u1' };
    _promoConfig = CFG2; _promoSlots = [SLOT2]; _promoEvents = [];
    _promoPlaced = new Set(); _promoImpressed = new Set(); _promoBudgetUsed = new Set();
    document.getElementById('feed-list').innerHTML = posts();
    window.injectPromoCards();
    const a = posBefore();
    _promoSlotPositionMemo.p1 = 99;   // simulate a stale/corrupted memo entry

    // ── sign out, sign in as B (no page reload) ──
    clearUserState();
    currentUser = { id: 'u2' };
    _promoConfig = CFG2; _promoSlots = [SLOT2]; _promoEvents = [];
    document.getElementById('feed-list').innerHTML = posts();
    window.injectPromoCards();
    const b = posBefore();

    return { a, b };
  }, { SLOT2, CFG2 });
  expect(positions.a).toBe(2);
  expect(positions.b).toBe(2);   // B computed its own position, not A's corrupted 99
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
