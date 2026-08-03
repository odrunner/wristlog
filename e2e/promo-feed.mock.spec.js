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
