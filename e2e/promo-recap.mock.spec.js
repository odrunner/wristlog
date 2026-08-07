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
// Date.now is stubbed so the first-week gate resolves identically whatever day
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
const LOGS = [
  { watchId: 'a', date: '2026-07-01', useCase: 'work' },
  { watchId: 'a', date: '2026-07-02', useCase: 'work' },
  { watchId: 'a', date: '2026-07-03', useCase: 'work' },
  { watchId: 'b', date: '2026-07-04', useCase: 'work' },
  { watchId: 'b', date: '2026-07-05', useCase: 'casual' },
  { watchId: 'c', date: '2026-07-06', useCase: 'casual' },
];

// Renders into a fixed-width host attached to the document, so the scroll-snap
// track has a real clientWidth to page against.
async function mount(page, opts = {}) {
  const arg = { watches: WATCHES, logs: LOGS, day: 3, slot: SLOT, ...opts };
  await page.goto('/');
  await page.evaluate((a) => {
    // Local-time construction: "the first week of the month" is a wall-clock
    // idea, so a UTC literal would move the gate with the runner's timezone.
    const fixed = new Date(2026, 7, a.day, 12).getTime();
    Date.now = () => fixed;
    watches = a.watches;
    logs = a.logs;
    _promoRecapMemo = null;
    const host = document.createElement('div');
    host.id = 'recap-host';
    host.style.width = '320px';
    document.body.appendChild(host);
    host.innerHTML = window.renderPromoCard(a.slot);
  }, arg);
}

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
      .concat([{ watchId: 'b', date: '2026-07-07', useCase: 'work' }]);
    await mount(page, { logs });
    await expect(q(page, '.promo-recap-slide')).toHaveCount(4);
    await expect(q(page, '.promo-recap-podium-item')).toHaveCount(2);
    await expect(q(page, '.promo-recap-slide-lbl').nth(1)).toHaveText('Your top two');
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

test.describe('month-in-review card — nothing to show', () => {
  // Only the admin composer's preview can reach this: eligiblePromoSlots()
  // drops a recap slot whenever there is no recap, so the feed never renders
  // one without data.
  test('shows the explainer instead of an empty deck outside the window', async ({ page }) => {
    await mount(page, { day: 20 });
    await expect(q(page, '.promo-recap-track')).toHaveCount(0);
    await expect(q(page, '[data-recap-dot]')).toHaveCount(0);
    await expect(q(page, '.promo-recap-note')).toContainText('1st–7th');
  });

  test('shows the explainer for a month below the wear threshold', async ({ page }) => {
    await mount(page, { logs: LOGS.slice(0, 4) });
    await expect(q(page, '.promo-recap-track')).toHaveCount(0);
    await expect(q(page, '.promo-recap-note')).toHaveCount(1);
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
