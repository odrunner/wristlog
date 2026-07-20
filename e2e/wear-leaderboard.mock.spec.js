import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, navigateTo } from './helpers.js';

// Spec: docs/superpowers/specs/2026-07-19-wear-leaderboard-design.md
//
// Unit tests cover periodCutoff/wearLeaderboard in isolation. They cannot catch
// a ReferenceError inside the render function — that shipped once already this
// session — so this drives the real Stats page.

const WATCHES = [
  { id: 'w1', brand: 'Rolex',  name: 'Submariner',   color: '#123456' },
  { id: 'w2', brand: 'Omega',  name: 'Speedmaster',  color: '#654321' },
  { id: 'w3', brand: 'AP',     name: 'Royal Oak',    color: '#abcdef' },
];

// today is stubbed per-test; dates below are relative to 2026-07-19.
const LOGS = [
  // w1: 3 wears, all recent
  { id: 'l1', watch_id: 'w1', date: '2026-07-18', use_case: 'work' },
  { id: 'l2', watch_id: 'w1', date: '2026-07-17', use_case: 'work' },
  { id: 'l3', watch_id: 'w1', date: '2026-07-16', use_case: 'work' },
  // w2: 2 wears, both old (outside 1M, inside YTD/1Y)
  { id: 'l4', watch_id: 'w2', date: '2026-02-10', use_case: 'leisure' },
  { id: 'l5', watch_id: 'w2', date: '2026-02-11', use_case: 'leisure' },
  // w3: measurement share only — must never count as a wear
  { id: 'l6', watch_id: 'w3', date: '2026-07-18', use_case: 'measurement' },
];

async function openStats(page) {
  await mockSupabase(page, { watches: WATCHES, logs: LOGS, wishlist: [] });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'stats');
  await expect(page.locator('#wear-leaderboard')).toBeVisible();
}

async function setPeriod(page, value) {
  await page.selectOption('#report-period', value);
  await page.waitForTimeout(150);
}

// [{ rank, name, wears, share }]
// Row layout: rank span, thumb, then a stacked name + "N wears · P%" line.
// Zero-wear watches are collapsed behind "Show all" — pass {all:true} to expand.
async function rows(page, opts = {}) {
  if (opts.all) {
    const btn = page.locator('#wear-leaderboard button', { hasText: /Show all/ });
    if (await btn.count()) await btn.click();
  }
  return page.evaluate(() =>
    [...document.querySelectorAll('#wear-leaderboard .wlb-row')].map(d => {
      const rank = d.querySelector('span')?.textContent.trim() || '';
      const divs = d.querySelectorAll('[style*="flex:1"] > div');
      const stats = (divs[1]?.textContent || '').trim();      // "4 wears · 57%"
      const [wears, share] = stats.split('·').map(t => t.trim());
      return { rank, name: (divs[0]?.textContent || '').trim(), wears, share };
    }));
}

test.describe('Wear leaderboard (mocked)', () => {
  test('renders without throwing, titled Most Worn', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openStats(page);
    await expect(page.locator('#wear-leaderboard')).toContainText('Most Worn');
    expect(errors).toEqual([]);
  });

  test('all-time ranks by wears and shows share', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, 'all');
    const r = await rows(page);
    expect(r[0].name).toContain('Submariner');
    expect(r[0].rank).toBe('#1');
    expect(r[0].wears).toBe('3 wears');
    expect(r[0].share).toBe('60%');
    expect(r[1].name).toContain('Speedmaster');
    expect(r[1].share).toBe('40%');
  });

  test('a measurement-only watch has zero wears and an em dash, ranked last', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, 'all');
    const r = await rows(page, { all: true });
    const ro = r[r.length - 1];
    expect(ro.name).toContain('Royal Oak');
    expect(ro.wears).toBe('0 wears');
    expect(ro.share).toBe('—');
  });

  test('shortening the window re-ranks — the point of the feature', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, '30');
    const r = await rows(page, { all: true });
    // Speedmaster's wears are from February, so at 1M it drops to zero.
    const speedy = r.find(x => x.name.includes('Speedmaster'));
    expect(speedy.wears).toBe('0 wears');
    const sub = r.find(x => x.name.includes('Submariner'));
    expect(sub.rank).toBe('#1');
    expect(sub.share).toBe('100%');
  });

  test('YTD includes the February wears that 1M excludes', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, 'ytd');
    const r = await rows(page);
    const speedy = r.find(x => x.name.includes('Speedmaster'));
    expect(speedy.wears).toBe('2 wears');
  });

  test('the period filter offers all five ranges', async ({ page }) => {
    await openStats(page);
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('#report-period option')].map(o => o.value));
    expect(opts).toEqual(['all', '30', '90', 'ytd', '365']);
  });

  test('a measurement share today does NOT show the "worn today" badge', async ({ page }) => {
    // The app keys off the LOCAL date (todayStr). toISOString() is UTC, so
    // between local midnight and UTC midnight it yields tomorrow and the log
    // matches nothing.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    await mockSupabase(page, {
      watches: WATCHES,
      wishlist: [],
      logs: [
        { id: 'm1', watch_id: 'w3', date: today, use_case: 'measurement' }, // not a wear
        { id: 'r1', watch_id: 'w1', date: today, use_case: 'work' },        // a real wear
      ],
    });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'track');

    const state = await page.evaluate(() =>
      [...document.querySelectorAll('#watch-selector .watch-option')].map(el => ({
        name: el.querySelector('.watch-info-name')?.textContent.trim() || '',
        badge: !!el.querySelector('.watch-worn-badge'),
      })));
    const ro = state.find(s => s.name.includes('Royal Oak'));
    const sub = state.find(s => s.name.includes('Submariner'));
    expect(ro.badge).toBe(false);  // measurement only
    expect(sub.badge).toBe(true);  // genuine wear
  });

  test('the date notice ignores a measurement-only day', async ({ page }) => {
    // The app keys off the LOCAL date (todayStr). toISOString() is UTC, so
    // between local midnight and UTC midnight it yields tomorrow and the log
    // matches nothing.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    await mockSupabase(page, {
      watches: WATCHES, wishlist: [],
      logs: [{ id: 'm1', watch_id: 'w3', date: today, use_case: 'measurement' }],
    });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'track');
    const notice = await page.evaluate(() =>
      document.getElementById('date-log-indicator')?.textContent.trim() || '');
    expect(notice).toBe('');
  });

  // 2026-07-19 audit U19-1/2/3/5/7 — the card shipped with truncated names, an
  // uncapped zero-wear tail, an unlabeled %, inert rows and no period shown.
  test('unworn watches are collapsed behind a toggle, not listed in full', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, 'all');
    const collapsed = await rows(page);
    expect(collapsed.every(r => r.wears !== '0 wears')).toBe(true);
    await expect(page.locator('#wear-leaderboard')).toContainText('not worn in this period');
    const expanded = await rows(page, { all: true });
    expect(expanded.length).toBeGreaterThan(collapsed.length);
  });

  test('watch names are not truncated', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStats(page);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('#wear-leaderboard .wlb-row [style*="flex:1"] > div')]
        .filter(d => d.scrollWidth > d.clientWidth + 1).length);
    expect(clipped).toBe(0);
  });

  test('the card states the active period and labels the percentage', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, '30');
    await expect(page.locator('#wear-leaderboard')).toContainText('last 30 days');
    await expect(page.locator('#wear-leaderboard')).toContainText('share of wears in this period');
    await setPeriod(page, 'ytd');
    await expect(page.locator('#wear-leaderboard')).toContainText('year to date');
  });

  test('rows are keyboard-reachable and open the watch', async ({ page }) => {
    await openStats(page);
    const a11y = await page.evaluate(() => {
      const r = document.querySelector('#wear-leaderboard .wlb-row');
      return { role: r.getAttribute('role'), tabindex: r.getAttribute('tabindex'),
               cursor: getComputedStyle(r).cursor, hasClick: !!r.getAttribute('onclick') };
    });
    expect(a11y).toEqual({ role: 'button', tabindex: '0', cursor: 'pointer', hasClick: true });
  });

  test('Track rows show wears and all-time share', async ({ page }) => {
    await openStats(page);
    await navigateTo(page, 'track');
    const subs = await page.evaluate(() =>
      [...document.querySelectorAll('#watch-selector .watch-info-sub')].map(e => e.textContent.trim()));
    expect(subs.some(s => /3 wears · 60%/.test(s))).toBe(true);
    expect(subs.some(s => /2 wears · 40%/.test(s))).toBe(true);
    // The measurement-only watch shows no share at all.
    expect(subs.some(s => s === '0 wears')).toBe(true);
  });
});

// High #5/#6 (2026-07-19 audit): By Day of Week, Year in Review and Monthly
// Review kept reading the raw `logs` array, so a measurement share counted as a
// wear. 4 of 5 measurement logs in production are the only log for that watch
// that date, so each produced a genuine phantom wear.
test.describe('Stats measurement rule, end to end (mocked)', () => {
  // Two watches, each with exactly one log on the same day. w1's is a real wear,
  // w3's is a measurement share — so every wear total must say 1, never 2.
  const DAY = '2026-06-13';   // a Saturday
  const LOGS_ONE_REAL_ONE_MEASUREMENT = [
    { id: 'r1', watch_id: 'w1', date: DAY, use_case: 'work' },
    { id: 'm1', watch_id: 'w3', date: DAY, use_case: 'measurement' },
  ];

  async function open(page) {
    await mockSupabase(page, {
      watches: WATCHES, wishlist: [], logs: LOGS_ONE_REAL_ONE_MEASUREMENT,
    });
    await injectSession(page);
    await page.goto('/');
    await waitForAppBoot(page);
    await navigateTo(page, 'stats');
    await setPeriod(page, 'all');
  }

  test('the stat row counts one wear, not two', async ({ page }) => {
    await open(page);
    const total = await page.evaluate(() =>
      document.querySelector('#stats-row .stat-card .stat-val')?.textContent.trim());
    expect(total).toBe('1');
  });

  test('By Day of Week counts one wear on that Saturday', async ({ page }) => {
    await open(page);
    const dow = await page.evaluate(() =>
      document.getElementById('dow-report')?.textContent.replace(/\s+/g, ' ') || '');
    // Two logs land on the same weekday; only the real wear may be counted.
    expect(dow).not.toMatch(/\b2\b/);
  });

  test('Year in Review counts one wear', async ({ page }) => {
    await open(page);
    const yir = await page.evaluate(() => {
      renderYearInReview();
      return document.getElementById('year-in-review')?.textContent.replace(/\s+/g, ' ') || '';
    });
    expect(yir).toMatch(/\b1\b/);
    expect(yir).not.toMatch(/2 wears/i);
  });

  test('the measurement-only watch is never the most worn', async ({ page }) => {
    await open(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#wear-leaderboard .wlb-row')]
        .map(d => d.textContent.replace(/\s+/g, ' ').trim()));
    expect(rows[0]).toContain('Submariner');       // the real wear
    expect(rows[0]).not.toContain('Royal Oak');    // the measurement share
  });
});
