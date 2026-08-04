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
      id: 'p1', heading: 'Promo one', body: 'b', audience: 'all', status: 'active',
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
        id: `p${n}`, heading: `Promo ${n}`, audience: 'all', status: 'active', priority: 0,
        starts_at: null, ends_at: null, max_impressions: null, images: [],
        created_at: '2026-01-01T00:00:00Z',
      })),
    });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(2);
  });

  test('two active slots with explicit first_position each land at their own spot', async ({ page }) => {
    // p1 (higher priority) wants position 1, p2 (lower priority) wants
    // position 4 — distinct explicit positions, so neither collides with the
    // other, and per-slot first_position must win over the config default
    // (2) for both.
    await setup(page, {
      postCount: 6,
      config: { max_per_session: 2 },
      slots: [
        { id: 'p1', heading: 'Promo 1', audience: 'all', status: 'active', priority: 1,
          starts_at: null, ends_at: null, max_impressions: null, images: [],
          first_position: 1, created_at: '2026-01-01T00:00:00Z' },
        { id: 'p2', heading: 'Promo 2', audience: 'all', status: 'active', priority: 0,
          starts_at: null, ends_at: null, max_impressions: null, images: [],
          first_position: 4, created_at: '2026-01-01T00:00:00Z' },
      ],
    });
    expect(await order(page)).toEqual(
      ['post', 'PROMO', 'post', 'post', 'post', 'PROMO', 'post', 'post']
    );
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.promo-card')].map((c) => c.dataset.promoId));
    expect(ids).toEqual(['p1', 'p2']);
  });

  test('injects nothing when disabled', async ({ page }) => {
    await setup(page, { config: { enabled: false } });
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
        id: `p${n}`, heading: `Promo ${n}`, audience: 'all', status: 'active', priority: 0,
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
    //
    // The prune loop refunds a slot's budget only when it's not yet impressed
    // (see the impression-cap test below) — so this scenario
    // must be deterministically UNSEEN. setup()'s card renders on-screen, and
    // its real IntersectionObserver (threshold 0.5) does fire — measured ~24ms
    // after injectPromoCards() — which is a race against the CDP round trip
    // to the next page.evaluate(), not a guarantee. Force "never seen" the
    // same way a genuinely-off-screen or not-yet-scrolled-to card would be:
    // clear _promoImpressed for this slot immediately before the replace.
    await setup(page);
    await page.evaluate(() => {
      _promoImpressed.delete('p1');
      const el = document.getElementById('feed-list');
      el.innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
      window.injectPromoCards();
    });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(1);
  });

  test('an IMPRESSED card wiped by a full DOM replace comes back — same slot, no second impression', async ({ page }) => {
    // Defect: the impression fires ~24ms after injection (the card sits in
    // the opening viewport, past the observer's 0.5 threshold) — long before
    // a human could actually read it. The old prune loop treated "impressed"
    // as "seen, never refund", so a wipe right after that early impression
    // lost the card for the rest of the session even though the owner never
    // really saw it. It must come back — the SAME slot — without logging a
    // second impression (_promoImpressed still guards that).
    await setup(page);
    await page.evaluate(() => {
      _promoImpressed.add('p1');
      logPromoEvent('p1', 'impression');
      const el = document.getElementById('feed-list');
      el.innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
      window.injectPromoCards();
    });
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.promo-card')].map((c) => c.dataset.promoId));
    expect(ids).toEqual(['p1']);
    const impressions = await page.evaluate(() =>
      window.__events.filter((e) => e.t === 'promo_events' && e.row.event === 'impression' && e.row.slot_id === 'p1'));
    expect(impressions).toHaveLength(1);
  });

  test('re-placing a returning card spends no new budget — a second slot still does not appear', async ({ page }) => {
    // Regression guard for the fix above: bringing the SAME slot back after a
    // wipe must not free a NEW max_per_session slot for a DIFFERENT card.
    await setup(page, {
      config: { max_per_session: 1 },
      slots: ['p1', 'p2'].map((id, i) => ({
        id, heading: `Promo ${id}`, audience: 'all', status: 'active', priority: 1 - i,
        starts_at: null, ends_at: null, max_impressions: null, images: [],
        created_at: '2026-01-01T00:00:00Z',
      })),
    });
    await page.evaluate(() => {
      _promoImpressed.add('p1');
      logPromoEvent('p1', 'impression');
      const el = document.getElementById('feed-list');
      el.innerHTML = Array.from({ length: 6 }, (_, i) =>
        `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
      window.injectPromoCards();
    });
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.promo-card')].map((c) => c.dataset.promoId));
    expect(ids).toEqual(['p1']);   // p1 back, p2 never got a chance
  });

  test('a slot that hit its impression cap this session keeps its session budget after a full DOM replace', async ({ page }) => {
    // Regression: the prune loop used to only guard against re-adding a slot
    // that still had a live DOM node, but not "seen and now capped" — a slot
    // that reached its max_impressions during the session would still get pruned from
    // _promoPlaced by the NEXT full re-render (any loadFeed past the 60s
    // cache), refunding its max_per_session budget slot to a DIFFERENT,
    // fresh slot. Reproduces the reviewer's repro verbatim: cap-hit p1 +
    // re-render with max_per_session:1 must yield zero cards, not a p2
    // substitute.
    await setup(page, {
      config: { max_per_session: 1 },
      slots: [
        { id: 'p1', heading: 'Promo 1', audience: 'all', status: 'active', priority: 1,
          starts_at: null, ends_at: null, max_impressions: 1, images: [],
          created_at: '2026-01-01T00:00:00Z' },
        { id: 'p2', heading: 'Promo 2', audience: 'all', status: 'active', priority: 0,
          starts_at: null, ends_at: null, max_impressions: null, images: [],
          created_at: '2026-01-01T00:00:00Z' },
      ],
    });
    // p1 is placed (priority 1 sorts first). Simulate the one impression its
    // own max_impressions:1 cap allows — exactly what observePromoImpressions()
    // does when the card scrolls into view.
    await page.evaluate(() => {
      _promoImpressed.add('p1');
      logPromoEvent('p1', 'impression');
    });
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
        id: 'p1', heading: 'Promo one', body: 'b', audience: 'all', status: 'active',
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

// ── The empty feed: the spec's highest-value case ───────────────────────────
// "Empty feed: append below the empty state. This is the highest-value case —
// users following nobody currently hit a dead end." promoInjectPositions()
// carries the `if (!postCount) return [0]` branch for it, but renderFeed()
// returned from the empty-state branch before ever calling injectPromoCards(),
// so the branch was unreachable in the app.
test('an empty feed gets a card appended below the empty state', async ({ page }) => {
  await page.goto('/');
  const res = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    document.getElementById('auth-screen').style.display = 'none';
    watches = []; logs = [];                 // keeps the fact modal / first-wear prompt out
    feedItems = []; feedError = false; feedHasMore = false;
    following = new Set();
    _promoConfig = { enabled: true, first_position: 2, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true };
    _promoSlots = [{
      id: 'p1', heading: 'Promo one', body: 'b', audience: 'all', status: 'active',
      priority: 0, starts_at: null, ends_at: null, max_impressions: null,
      cta_label: 'Go', cta_action: 'open_discover', images: [],
      created_at: '2026-01-01T00:00:00Z',
    }];
    _promoEvents = []; _promoPlaced = new Set();
    _promoImpressed = new Set();
    window._modalShownThisSession = false;
    db.from = () => ({ insert: async () => ({ error: null }) });

    window.renderFeed();

    const el = document.getElementById('feed-list');
    return {
      emptyState: !!el.querySelector('.feed-empty-state'),
      promos: el.querySelectorAll('.promo-card').length,
      lastIsPromo: !!el.lastElementChild?.classList.contains('promo-card'),
    };
  });
  expect(res.emptyState).toBe(true);   // the empty state still renders
  expect(res.promos).toBe(1);          // ...with the card below it
  expect(res.lastIsPromo).toBe(true);
});

test('a feed ERROR state still gets no card', async ({ page }) => {
  // The spec is explicit: "Feed error state: no injection." Wiring the empty
  // branch must not wire the error branch by accident.
  await page.goto('/');
  const promos = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    watches = []; logs = [];
    feedItems = []; feedError = true; following = new Set();
    _promoConfig = { enabled: true, first_position: 0, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true };
    _promoSlots = [{
      id: 'p1', heading: 'Promo one', audience: 'all', status: 'active', priority: 0,
      starts_at: null, ends_at: null, max_impressions: null, images: [],
      created_at: '2026-01-01T00:00:00Z',
    }];
    _promoEvents = []; _promoPlaced = new Set();
    db.from = () => ({ insert: async () => ({ error: null }) });
    window.renderFeed();
    return document.getElementById('feed-list').querySelectorAll('.promo-card').length;
  });
  expect(promos).toBe(0);
});
