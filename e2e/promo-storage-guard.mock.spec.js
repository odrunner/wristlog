import { test, expect } from '@playwright/test';

// promoCtx() (index.html) read localStorage.getItem('wristlog_msr_count')
// unguarded. With storage disabled (Safari private browsing throws on every
// localStorage access) that threw INSIDE injectPromoCards() — which runs on
// every renderFeed() — before the properly-guarded local-impression helpers
// (_readLocalPromoImpressions/_incrementLocalPromoImpression) ever got a
// chance to run. A promo targeting signal must never be able to take the
// whole feed down with it.

const SLOT = {
  id: 'p1', heading: 'Promo one', body: 'b', audience: 'all', status: 'active',
  priority: 0, starts_at: null, ends_at: null, max_impressions: null,
  cta_label: 'Go', cta_action: 'open_wishlist', images: [],
  created_at: '2026-01-01T00:00:00Z',
};

const CFG = {
  enabled: true, first_position: 2, repeat_every: 0, max_per_session: 1,
  default_max_impressions: 3, suppress_after_modal: false,
};

test('injectPromoCards() does not throw when localStorage throws on every access, and the feed still renders', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(({ SLOT, CFG }) => {
    const posts = () => Array.from({ length: 6 },
      (_, i) => `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
    db.from = () => ({ insert: async () => ({ error: null }) });
    document.getElementById('auth-screen').style.display = 'none';

    currentUser = { id: 'u1' };
    _promoConfig = CFG; _promoSlots = [SLOT]; _promoEvents = [];
    _promoPlaced = new Set(); _promoImpressed = new Set();
    window._modalShownThisSession = false;
    document.getElementById('feed-list').innerHTML = posts();

    const realGetItem = Storage.prototype.getItem;
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => { throw new Error('SecurityError: storage disabled'); };
    Storage.prototype.setItem = () => { throw new Error('SecurityError: storage disabled'); };

    let threw = false;
    let thrownMessage = null;
    try {
      window.injectPromoCards();
    } catch (e) {
      threw = true;
      thrownMessage = e && e.message;
    } finally {
      Storage.prototype.getItem = realGetItem;
      Storage.prototype.setItem = realSetItem;
    }

    return {
      threw,
      thrownMessage,
      feedIntact: document.querySelectorAll('.feed-card').length,
      cardCount: document.querySelectorAll('.promo-card').length,
    };
  }, { SLOT, CFG });

  expect(result.threw, `injectPromoCards() threw: ${result.thrownMessage}`).toBe(false);
  expect(result.feedIntact).toBe(6);
  // The feed degrades gracefully rather than crashing — the card still places
  // (audience 'all' doesn't depend on measureCount), proving promoCtx()'s
  // guard returns a usable ctx instead of letting the whole function abort.
  expect(result.cardCount).toBe(1);
});

test('promoCtx() itself returns a safe default instead of throwing when storage is unavailable', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    const realGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('SecurityError: storage disabled'); };
    let threw = false;
    let ctx = null;
    try {
      ctx = window.promoCtx();
    } catch (e) {
      threw = true;
    } finally {
      Storage.prototype.getItem = realGetItem;
    }
    return { threw, measureCount: ctx && ctx.measureCount };
  });
  expect(result.threw).toBe(false);
  expect(result.measureCount).toBe(0);
});
