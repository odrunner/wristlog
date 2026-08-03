import { test, expect } from '@playwright/test';

// Drives injection directly against a stubbed feed. Top-level let/const in
// index.html are NOT window properties, so these are set as bare identifiers.
async function setup(page, { postCount = 6, config = {}, slots = null } = {}) {
  await page.goto('/');
  await page.evaluate(({ postCount, config, slots }) => {
    currentUser = { id: 'u1' };
    document.getElementById('auth-screen').style.display = 'none';
    _promoConfig = { enabled: true, first_position: 2, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true, ...config };
    _promoSlots = slots || [{
      id: 'p1', heading: 'Promo one', body: 'b', audience: 'all',
      priority: 0, starts_at: null, ends_at: null, max_impressions: null,
      cta_label: 'Go', cta_action: 'open_wishlist', images: [],
      created_at: '2026-01-01T00:00:00Z',
    }];
    _promoEvents = [];
    _promoPlaced = new Set();
    _modalShownThisSession = false;

    window.__events = [];
    db.from = (t) => ({ insert: async (row) => { window.__events.push({ t, row }); return { error: null }; } });

    const el = document.getElementById('feed-list');
    el.innerHTML = Array.from({ length: postCount },
      (_, i) => `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
    window.injectPromoCards();
  }, { postCount, config, slots });
}

const order = (page) => page.evaluate(() =>
  [...document.getElementById('feed-list').children].map((n) =>
    n.classList.contains('promo-card') ? 'PROMO' : 'post'));

test.describe('promo feed injection (mocked)', () => {
  test('places the card after the configured number of posts', async ({ page }) => {
    await setup(page);
    expect(await order(page)).toEqual(['post', 'post', 'PROMO', 'post', 'post', 'post', 'post']);
  });

  test('places at the top when the feed is shorter than first_position', async ({ page }) => {
    await setup(page, { postCount: 1 });
    expect(await order(page)).toEqual(['PROMO', 'post']);
  });

  test('is idempotent — a second call does not duplicate the card', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.injectPromoCards());
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(1);
  });

  test('respects max_per_session with repeat_every', async ({ page }) => {
    await setup(page, {
      postCount: 12,
      config: { repeat_every: 4, max_per_session: 2 },
      slots: [1, 2, 3].map((n) => ({
        id: `p${n}`, heading: `Promo ${n}`, audience: 'all', priority: 0,
        starts_at: null, ends_at: null, max_impressions: null, images: [],
        created_at: '2026-01-01T00:00:00Z',
      })),
    });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(2);
  });

  test('injects nothing when disabled', async ({ page }) => {
    await setup(page, { config: { enabled: false } });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
  });

  test('dismiss removes the card and writes a dismiss event', async ({ page }) => {
    await setup(page);
    await page.click('.promo-dismiss');
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
    const evs = await page.evaluate(() => window.__events);
    expect(evs.some((e) => e.t === 'promo_events' && e.row.event === 'dismiss')).toBe(true);
  });

  test('a dismissed card does not come back on the next injection', async ({ page }) => {
    await setup(page);
    await page.click('.promo-dismiss');
    await page.evaluate(() => window.injectPromoCards());
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
  });

  test('the dedupe filter prevents a slot from being placed twice across repeat_every passes', async ({ page }) => {
    // Regression for a mutant that deletes the `.filter((s) => !_promoPlaced.has(s.id))`
    // line from injectPromoCards(). promoInjectPositions()'s `already >= max`
    // guard accidentally makes idempotency look enforced even without the
    // filter — but with repeat_every>0 and a second injection pass, the
    // mutant re-derives eligible[0] from the UNFILTERED list for the new
    // position, landing on p1 again instead of advancing to p2.
    await setup(page, {
      postCount: 4,
      config: { repeat_every: 4, max_per_session: 2 },
      slots: [1, 2].map((n) => ({
        id: `p${n}`, heading: `Promo ${n}`, audience: 'all', priority: 0,
        starts_at: null, ends_at: null, max_impressions: null, images: [],
        created_at: '2026-01-01T00:00:00Z',
      })),
    });
    // First pass (inside setup) places p1 at pos=2 (postCount=4). Grow the
    // feed so the second repeat position (pos=2+4=6) becomes reachable, then
    // run a second pass — mirrors a loadMoreFeed() page landing afterward.
    await page.evaluate(() => {
      const el = document.getElementById('feed-list');
      el.insertAdjacentHTML('beforeend', Array.from({ length: 4 }, (_, i) =>
        `<div class="feed-card" id="feedcard-extra-${i}">post extra ${i}</div>`).join(''));
      window.injectPromoCards();
    });

    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.promo-card')].map((c) => c.dataset.promoId));
    expect(ids).toEqual(['p1', 'p2']);
  });

  test('a full innerHTML replace followed by injectPromoCards() re-places the card', async ({ page }) => {
    // Regression for renderFeed()'s full innerHTML replace (also reachable via
    // block-user, report/flag, scrollToFeedPost, or any loadFeed past the 60s
    // cache): it wipes a placed card's DOM node while _promoPlaced still
    // remembers the slot id, silently losing a card the user may never have
    // seen for the rest of the session.
    await setup(page);
    await page.evaluate(() => {
      const el = document.getElementById('feed-list');
      el.innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
      window.injectPromoCards();
    });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(1);
  });

  test('a dismissed card does not get its session budget refunded by a full DOM replace', async ({ page }) => {
    // Regression for the prune loop treating a DISMISSED slot the same as any
    // other slot whose DOM node is gone: dismissPromo() already removed the
    // node, so an unconditional prune would drop it from _promoPlaced and
    // "un-spend" the max_per_session budget, letting a second slot silently
    // fill the dismissed one's place after the next full re-render. (The
    // dismissed slot p1 itself can never reappear either way — eligiblePromoSlots
    // permanently excludes it via the recorded dismiss event — so the
    // observable regression is the budget leak, not p1 resurrecting.)
    await setup(page, {
      config: { max_per_session: 1 },
      slots: ['p1', 'p2'].map((id, i) => ({
        id, heading: `Promo ${id}`, audience: 'all', priority: 1 - i,
        starts_at: null, ends_at: null, max_impressions: null, images: [],
        created_at: '2026-01-01T00:00:00Z',
      })),
    });
    await page.click('.promo-dismiss'); // dismisses p1 (placed first: higher priority)
    await page.evaluate(() => {
      const el = document.getElementById('feed-list');
      el.innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
      window.injectPromoCards();
    });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
  });

  test('a trailing card lands above the load-more sentinel, not pinned below it', async ({ page }) => {
    // Regression for a 2-post feed with default first_position:2 — pos===postCount
    // whenever first_position equals the post count, so the card takes the
    // `pos >= posts.length` branch. Without inserting before the sentinel, the
    // card lands below it (via `beforeend`) and stays pinned to the very
    // bottom of the feed forever, below the infinite-scroll spinner.
    await page.goto('/');
    await page.evaluate(() => {
      currentUser = { id: 'u1' };
      document.getElementById('auth-screen').style.display = 'none';
      _promoConfig = { enabled: true, first_position: 2, repeat_every: 0,
                       max_per_session: 1, default_max_impressions: 3,
                       suppress_after_modal: true };
      _promoSlots = [{
        id: 'p1', heading: 'Promo one', body: 'b', audience: 'all',
        priority: 0, starts_at: null, ends_at: null, max_impressions: null,
        cta_label: 'Go', cta_action: 'open_wishlist', images: [],
        created_at: '2026-01-01T00:00:00Z',
      }];
      _promoEvents = [];
      _promoPlaced = new Set();
      _modalShownThisSession = false;
      db.from = () => ({ insert: async () => ({ error: null }) });

      const el = document.getElementById('feed-list');
      el.innerHTML =
        '<div class="feed-card" id="feedcard-0">post 0</div>' +
        '<div class="feed-card" id="feedcard-1">post 1</div>' +
        '<div id="feed-load-sentinel">spinner</div>';
      window.injectPromoCards();
    });

    const ids = await page.evaluate(() =>
      [...document.getElementById('feed-list').children].map((n) => n.id));
    const promoIdx = ids.findIndex((id) => id.startsWith('promocard-'));
    const sentinelIdx = ids.indexOf('feed-load-sentinel');
    expect(promoIdx).toBeGreaterThan(-1);
    expect(sentinelIdx).toBeGreaterThan(-1);
    expect(promoIdx).toBeLessThan(sentinelIdx);
  });

  test('a failed slot fetch leaves the feed intact', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      currentUser = { id: 'u1' };
      db.from = () => ({ select: () => ({ eq: () => Promise.reject(new Error('boom')) }) });
      await window.loadPromoSlots();          // must not throw
      document.getElementById('feed-list').innerHTML = '<div class="feed-card">p</div>';
      window.injectPromoCards();
    });
    expect(await order(page)).toEqual(['post']);
  });
});
