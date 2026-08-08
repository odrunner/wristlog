import { test, expect } from '@playwright/test';

// "Your month in review" — the automated promo card.
// Spec: docs/superpowers/specs/2026-08-07-month-in-review-promo-design.md
//
// monthRecap()'s own logic is covered exhaustively in tests/promo-recap.test.js.
// What this file covers is the part a unit test can't reach: the markup the
// renderer actually produces, and the scroll→dot sync, driven in a real browser.
//
// Top-level let/const in index.html are NOT window properties, so app state is
// set here as bare identifiers (same approach as promo-feed.mock.spec.js).
// Date.now is stubbed so the window gate resolves identically whatever day
// the suite runs on — 3 August 2026, recapping July.

const SLOT = {
  id: 'r1', variant: 'recap', eyebrow: '', heading: '', body: '', images: [],
  cta_label: 'See the full month', cta_action: 'open_stats',
};

// Three watches over six wear-days: clears both thresholds. 'a' carries a
// picture and the other two don't, so one card exercises both thumbnail paths.
const WATCHES = [
  { id: 'a', name: 'Overseas Dual Time', brand: 'Vacheron', color: '#c9a84c', image: 'https://x.test/a.jpg' },
  { id: 'b', name: 'Speedmaster', brand: 'Omega', color: '#38bdf8' },
  { id: 'c', name: 'Explorer', brand: 'Rolex', color: '#94a3b8' },
];
// Dates are deliberately spaced: consecutive days would trip the streak slide
// into every test, and each conditional slide should be exercised by its own
// fixture rather than by accident.
const LOGS = [
  { watchId: 'a', date: '2026-07-01', useCase: 'work',   id: 'p1' },
  { watchId: 'a', date: '2026-07-05', useCase: 'work',   id: 'p2' },
  { watchId: 'a', date: '2026-07-09', useCase: 'work',   id: 'p3' },
  { watchId: 'b', date: '2026-07-13', useCase: 'work',   id: 'p4' },
  { watchId: 'b', date: '2026-07-17', useCase: 'casual', id: 'p5', photoUrl: 'https://x.test/shot.jpg' },
  { watchId: 'c', date: '2026-07-21', useCase: 'casual', id: 'p6' },
];

// Renders into a fixed-width host attached to the document, so the scroll-snap
// track has a real clientWidth to page against.
async function mount(page, opts = {}) {
  const arg = { watches: WATCHES, logs: LOGS, day: 3, slot: SLOT, likes: null, ...opts };
  await page.goto('/');
  await page.evaluate((a) => {
    // Local-time construction: "the opening days of the month" is a wall-clock
    // idea, so a UTC literal would move the gate with the runner's timezone.
    const fixed = new Date(2026, 7, a.day, 12).getTime();
    Date.now = () => fixed;
    watches = a.watches;
    logs = a.logs;
    _promoRecapMemo = null;
    _promoRecapLikes = a.likes ? { period: '2026-07', counts: a.likes } : null;
    // The signed-out auth screen covers the viewport and would swallow every
    // click aimed at the card below it.
    const auth = document.getElementById('auth-screen');
    if (auth) auth.style.display = 'none';
    const host = document.createElement('div');
    host.id = 'recap-host';
    host.style.width = '320px';
    document.body.appendChild(host);
    host.innerHTML = window.renderPromoCard(a.slot);
  }, arg);
}

const labels = (page) => page.locator('#recap-host .promo-recap-slide-lbl');

const q = (page, sel) => page.locator(`#recap-host ${sel}`);

test.describe('month-in-review card', () => {
  test('renders four slides and four dots', async ({ page }) => {
    await mount(page);
    await expect(q(page, '.promo-recap-slide')).toHaveCount(4);
    await expect(q(page, '[data-recap-dot]')).toHaveCount(4);
    await expect(q(page, '.promo-recap-dot.is-on')).toHaveCount(1);
  });

  test('the cover names the month that ended and counts it', async ({ page }) => {
    await mount(page);
    await expect(q(page, '.promo-recap-month')).toHaveText('July');
    await expect(q(page, '.promo-recap-year')).toHaveText('2026');
    await expect(q(page, '.promo-recap-cover-line')).toHaveText('6 wears · 3 watches · 6 days');
  });

  test('the header carries the period, not the current month', async ({ page }) => {
    await mount(page);
    await expect(q(page, '.promo-recap-period')).toHaveText('July 2026');
  });

  test('the most-worn slide shows the watch and its own picture', async ({ page }) => {
    await mount(page);
    await expect(q(page, '.promo-recap-hero-name')).toHaveText('Overseas Dual Time');
    await expect(q(page, '.promo-recap-hero-sub')).toHaveText('Vacheron · 3 wears');
    await expect(q(page, '.promo-recap-thumb--hero img')).toHaveAttribute('src', 'https://x.test/a.jpg');
  });

  test('the podium ranks three, most-worn first', async ({ page }) => {
    await mount(page);
    await expect(q(page, '.promo-recap-podium-item')).toHaveCount(3);
    await expect(q(page, '.promo-recap-podium-name')).toHaveText([
      'Overseas Dual Time', 'Speedmaster', 'Explorer',
    ]);
    await expect(q(page, '.promo-recap-podium-count')).toHaveText(['3 wears', '2 wears', '1 wear']);
  });

  // A watch with no picture falls back to the initials avatar, exactly as the
  // By Day of Week card does — a collection with no photos still reads.
  test('falls back to an initials avatar when a watch has no picture', async ({ page }) => {
    await mount(page);
    const tiles = q(page, '.promo-recap-podium-item .promo-recap-thumb');
    await expect(tiles.nth(0).locator('img')).toHaveCount(1);
    await expect(tiles.nth(1)).toHaveClass(/promo-recap-thumb--initials/);
    await expect(tiles.nth(1)).toHaveText('OS');
  });

  test('the rhythm slide reports days, busiest weekday and top use case', async ({ page }) => {
    await mount(page);
    const rows = q(page, '.promo-recap-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Days logged');
    await expect(rows.nth(1)).toContainText('Busiest day');
    await expect(rows.nth(2)).toContainText('Top use case');
  });

  // The ≥2-watches gate guarantees a second tile, so the podium never shows a
  // single watch — it just renders shorter.
  test('collapses to two tiles when only two watches were worn', async ({ page }) => {
    const logs = LOGS.filter((l) => l.watchId !== 'c')
      .concat([{ watchId: 'b', date: '2026-07-25', useCase: 'work', id: 'p7' }]);
    await mount(page, { logs });
    await expect(q(page, '.promo-recap-slide')).toHaveCount(4);
    await expect(q(page, '.promo-recap-podium-item')).toHaveCount(2);
    await expect(labels(page).nth(1)).toHaveText('Your top two');
  });

  test('carries the CTA and the promo click hooks', async ({ page }) => {
    await mount(page);
    const cta = q(page, '[data-promo-cta]');
    await expect(cta).toHaveText('See the full month');
    await expect(q(page, '[data-promo-id="r1"]')).toHaveCount(1);
  });

  test('has no like, comment or share controls — the not-a-post signal', async ({ page }) => {
    await mount(page);
    const out = (await page.locator('#recap-host').innerHTML()).toLowerCase();
    for (const s of ['togglelike', 'comment-input', 'sharepost', 'feed-card-actions']) {
      expect(out, `recap card must not contain ${s}`).not.toContain(s);
    }
  });
});

// Each of the four extra slides appears only when its data exists, and the deck
// is built in one pass — so the thing worth asserting is that adding one slide
// leaves the others, and the ordering, alone.
test.describe('month-in-review card — the conditional slides', () => {
  const JUNE = [
    { watchId: 'a', date: '2026-06-02', useCase: 'work', id: 'j1' },
    { watchId: 'b', date: '2026-06-06', useCase: 'work', id: 'j2' },
  ];
  const STREAK = [
    { watchId: 'a', date: '2026-07-01', useCase: 'work', id: 's1' },
    { watchId: 'a', date: '2026-07-02', useCase: 'work', id: 's2' },
    { watchId: 'b', date: '2026-07-03', useCase: 'work', id: 's3' },
    { watchId: 'b', date: '2026-07-04', useCase: 'work', id: 's4' },
    { watchId: 'c', date: '2026-07-10', useCase: 'work', id: 's5' },
    { watchId: 'c', date: '2026-07-20', useCase: 'work', id: 's6' },
  ];
  const ARRIVED = WATCHES.map((w, i) =>
    i === 1 ? { ...w, createdAt: '2026-07-04T10:00:00Z' } : w);

  test('the bare month shows only the four unconditional slides', async ({ page }) => {
    await mount(page);
    await expect(q(page, '.promo-recap-slide')).toHaveCount(4);
    await expect(labels(page)).toHaveText(['Most worn', 'Your top three', 'Your rhythm']);
  });

  test('vs. last month appears when the previous month has wears', async ({ page }) => {
    await mount(page, { logs: [...LOGS, ...JUNE] });
    await expect(labels(page)).toHaveText(['Most worn', 'Your top three', 'vs. June', 'Your rhythm']);
    await expect(q(page, '.promo-recap-delta')).toHaveText('▲ 4 wears');
    await expect(q(page, '.promo-recap-trend-sub')).toHaveText('across 1 more watch');
  });

  // A month spent on fewer watches is not a failure, so "level" says so rather
  // than forcing an arrow onto it.
  test('vs. last month says level when the counts match', async ({ page }) => {
    const june = LOGS.map((l, i) => ({ ...l, id: 'j' + i, date: l.date.replace('2026-07', '2026-06') }));
    await mount(page, { logs: [...LOGS, ...june] });
    await expect(q(page, '.promo-recap-flat')).toHaveText('Level with June');
    await expect(q(page, '.promo-recap-delta')).toHaveCount(0);
    await expect(q(page, '.promo-recap-trend-sub')).toHaveText('across the same 3 watches');
  });

  test('the streak slide appears and names its span', async ({ page }) => {
    await mount(page, { logs: STREAK });
    await expect(labels(page)).toHaveText(['Most worn', 'Your top three', 'Longest streak', 'Your rhythm']);
    await expect(q(page, '.promo-recap-streak')).toHaveText('4');
    await expect(q(page, '.promo-recap-slide').nth(3)).toContainText('Jul 1 – Jul 4');
  });

  test('the top-post slide appears once a post has a like, with its photo', async ({ page }) => {
    await mount(page, { likes: { p5: 7, p1: 2 } });
    await expect(labels(page)).toHaveText(['Most worn', 'Your top three', 'Your top post', 'Your rhythm']);
    await expect(q(page, '.promo-recap-shot img')).toHaveAttribute('src', 'https://x.test/shot.jpg');
    await expect(q(page, '.promo-recap-slide').nth(3)).toContainText('7 likes');
  });

  // A post with no photo still earns the slide — it falls back to the watch.
  test('the top-post slide falls back to the watch when there is no photo', async ({ page }) => {
    await mount(page, { likes: { p1: 4 } });
    await expect(q(page, '.promo-recap-shot')).toHaveCount(0);
    await expect(q(page, '.promo-recap-thumb--hero')).toHaveCount(2);   // most-worn + top-post
  });

  test('no top-post slide when nothing was liked', async ({ page }) => {
    await mount(page, { likes: {} });
    await expect(labels(page)).toHaveText(['Most worn', 'Your top three', 'Your rhythm']);
  });

  test('the new-arrivals slide lists what joined that month', async ({ page }) => {
    await mount(page, { watches: ARRIVED });
    await expect(labels(page)).toHaveText(['Most worn', 'Your top three', 'New this month', 'Your rhythm']);
    const tile = q(page, '.promo-recap-slide').nth(3);
    await expect(tile).toContainText('Speedmaster');
    await expect(tile).toContainText('joined the rotation');
  });

  // All four at once — the ordering is a deliberate narrative, so it is pinned.
  test('all four extras render in order, after the podium and before the rhythm', async ({ page }) => {
    await mount(page, { logs: [...STREAK, ...JUNE], watches: ARRIVED, likes: { s5: 3 } });
    await expect(labels(page)).toHaveText([
      'Most worn', 'Your top three', 'vs. June', 'Your top post',
      'New this month', 'Longest streak', 'Your rhythm',
    ]);
    await expect(q(page, '.promo-recap-slide')).toHaveCount(8);
    await expect(q(page, '[data-recap-dot]')).toHaveCount(8);
  });
});

test.describe('month-in-review card — nothing to show', () => {
  // Only the admin composer's preview can reach this: eligiblePromoSlots()
  // drops a recap slot whenever there is no recap, so the feed never renders
  // one without data.
  test('shows the explainer instead of an empty deck outside the window', async ({ page }) => {
    await mount(page, { day: 20 });
    await expect(q(page, '.promo-recap-track')).toHaveCount(0);
    await expect(q(page, '[data-recap-dot]')).toHaveCount(0);
    await expect(q(page, '.promo-recap-note')).toContainText('1st–10th');
  });

  test('shows the explainer for a month below the wear threshold', async ({ page }) => {
    await mount(page, { logs: LOGS.slice(0, 4) });
    await expect(q(page, '.promo-recap-track')).toHaveCount(0);
    await expect(q(page, '.promo-recap-note')).toHaveCount(1);
  });
});

// The renderer tests above prove the card is built correctly; these prove it
// actually reaches a feed. The two halves fail independently — a recap that
// renders beautifully and is never injected is still a card nobody sees.
test.describe('month-in-review card — injection into the feed', () => {
  async function feed(page, { day = 3, logs = LOGS } = {}) {
    await page.goto('/');
    await page.evaluate((a) => {
      const fixed = new Date(2026, 7, a.day, 12).getTime();
      Date.now = () => fixed;
      watches = a.watches;
      logs = a.logs;
      _promoRecapMemo = null;
      currentUser = { id: 'u1' };
      document.getElementById('auth-screen').style.display = 'none';
      _promoConfig = { enabled: true, first_position: 2, repeat_every: 0,
                       max_per_session: 1, default_max_impressions: 1,
                       suppress_after_modal: true };
      _promoSlots = [{
        id: 'r1', variant: 'recap', size: 'prompt', eyebrow: '', heading: '',
        audience: 'all', status: 'active', priority: 50, images: [],
        starts_at: null, ends_at: null, max_impressions: null,
        cta_label: 'See the full month', cta_action: 'open_stats',
        created_at: '2026-01-01T00:00:00Z',
      }];
      _promoEvents = [];
      _promoPlaced = new Set();
      _modalShownThisSession = false;
      db.from = () => ({ insert: async () => ({ error: null }) });

      const el = document.getElementById('feed-list');
      el.innerHTML = Array.from({ length: 6 },
        (_, i) => `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
      window.injectPromoCards();
    }, { watches: WATCHES, logs, day });
  }

  test('lands in the feed at the configured position', async ({ page }) => {
    await feed(page);
    const order = await page.evaluate(() =>
      [...document.getElementById('feed-list').children].map((n) =>
        n.classList.contains('promo-card') ? 'PROMO' : 'post'));
    expect(order).toEqual(['post', 'post', 'PROMO', 'post', 'post', 'post', 'post']);
    await expect(page.locator('#feed-list .promo-recap-month')).toHaveText('July');
  });

  // The existence gate, exercised through the real injection path rather than
  // through eligiblePromoSlots() in isolation.
  test('never reaches the feed outside the window', async ({ page }) => {
    await feed(page, { day: 20 });
    await expect(page.locator('#feed-list .promo-card')).toHaveCount(0);
  });

  test('never reaches the feed for a month below the threshold', async ({ page }) => {
    await feed(page, { logs: LOGS.slice(0, 4) });
    await expect(page.locator('#feed-list .promo-card')).toHaveCount(0);
  });

  // The empty-state note is a composer affordance; it must never be what a user
  // gets served.
  test('the feed never shows the composer explainer', async ({ page }) => {
    await feed(page, { day: 20 });
    await expect(page.locator('#feed-list .promo-recap-note')).toHaveCount(0);
  });
});

// Sharing hands the recipient a link the share-recap edge function renders as a
// card. What matters on this side is that the right URL is built, and that a
// profile whose page would 404 is stopped before the share sheet opens.
test.describe('month-in-review card — sharing', () => {
  async function armShare(page, profile) {
    await page.evaluate((p) => {
      myProfile = p;
      window.__shared = [];
      window.__toasts = [];
      navigator.share = async (payload) => { window.__shared.push(payload); };
      window.toast = (msg, kind) => { window.__toasts.push([msg, kind]); };
      toast = window.toast;
    }, profile);
    await page.locator('#recap-host [data-recap-share]').click();
    return page.evaluate(() => ({ shared: window.__shared, toasts: window.__toasts }));
  }

  test('the footer offers a share button naming the month', async ({ page }) => {
    await mount(page);
    await expect(q(page, '[data-recap-share]')).toHaveText(/Share July/);
  });

  test('shares a share-recap link for the viewer and the recap month', async ({ page }) => {
    await mount(page);
    const { shared } = await armShare(page, { username: 'od', profile_privacy: 'public' });
    expect(shared).toHaveLength(1);
    expect(shared[0].url).toBe('https://api.wrotate.com/functions/v1/share-recap?u=od&m=2026-07');
    expect(shared[0].title).toBe('My July on WRotate');
    expect(shared[0].text).toBe('6 wears across 3 watches in July.');
  });

  test('percent-encodes an awkward username', async ({ page }) => {
    await mount(page);
    const { shared } = await armShare(page, { username: 'a b&c', profile_privacy: 'public' });
    expect(shared[0].url).toContain('u=a%20b%26c');
  });

  // The page would serve a padlock, so the share is stopped here rather than
  // letting someone send a dead link and hear about it from a friend.
  test('refuses to share from a private profile', async ({ page }) => {
    await mount(page);
    const { shared, toasts } = await armShare(page, { username: 'od', profile_privacy: 'private' });
    expect(shared).toHaveLength(0);
    expect(toasts[0][0]).toContain('private');
  });

  test('refuses to share when the collection is hidden', async ({ page }) => {
    await mount(page);
    const { shared } = await armShare(page, {
      username: 'od', profile_privacy: 'public', collection_visibility: 'private',
    });
    expect(shared).toHaveLength(0);
  });

  test('the composer explainer has no share button', async ({ page }) => {
    await mount(page, { day: 20 });
    await expect(q(page, '[data-recap-share]')).toHaveCount(0);
  });
});

test.describe('month-in-review card — dot sync', () => {
  test('paging the track one slide over lights the second dot', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => {
      const track = document.querySelector('#recap-host [data-recap-track]');
      track.scrollLeft = track.clientWidth;
      // The listener is on document in the CAPTURE phase (scroll does not
      // bubble), so a dispatch on the track still reaches it.
      track.dispatchEvent(new Event('scroll'));
    });
    const dots = q(page, '[data-recap-dot]');
    await expect(dots.nth(0)).not.toHaveClass(/is-on/);
    await expect(dots.nth(1)).toHaveClass(/is-on/);
  });

  test('paging back to the start lights the first dot again', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => {
      const track = document.querySelector('#recap-host [data-recap-track]');
      track.scrollLeft = track.clientWidth;
      track.dispatchEvent(new Event('scroll'));
      track.scrollLeft = 0;
      track.dispatchEvent(new Event('scroll'));
    });
    await expect(q(page, '[data-recap-dot]').nth(0)).toHaveClass(/is-on/);
  });
});
