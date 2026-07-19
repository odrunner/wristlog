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
async function rows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#wear-leaderboard > div')]
      .filter(d => d.textContent.trim().startsWith('#'))
      .map(d => {
        const spans = [...d.querySelectorAll('span')].map(s => s.textContent.trim());
        // The name lives inside the flex:1 wrapper. A plain 'div > div' would
        // match the avatar fallback first and yield its initials.
        const nameEl = d.querySelector('[style*="flex:1"] > div');
        return {
          rank: spans[0],
          name: nameEl ? nameEl.textContent.trim() : '',
          wears: spans[spans.length - 2],
          share: spans[spans.length - 1],
        };
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
    const r = await rows(page);
    const ro = r[r.length - 1];
    expect(ro.name).toContain('Royal Oak');
    expect(ro.wears).toBe('0 wears');
    expect(ro.share).toBe('—');
  });

  test('shortening the window re-ranks — the point of the feature', async ({ page }) => {
    await openStats(page);
    await setPeriod(page, '30');
    const r = await rows(page);
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
