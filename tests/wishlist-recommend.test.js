// "Recommend me (from wishlist)" — shipped to everyone 2026-09-28.
// Pure payload/cache helpers (mirrored in index.html) + wiring assertions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { buildRecommendPayload, recommendCacheKey } from '../wrotate_test.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 28); // 2026-09-28

const WATCHES = [
  { id: 'a', brand: 'Omega', name: 'Speedmaster', ref: '310.30', tags: ['Chronograph', 'Sport'], movementType: 'automatic', caseDiameter: 42, price: 5000, marketPrice: 6000 },
  { id: 'b', brand: 'Seiko', name: '5', tags: [], movement: 'NH36' },
];
const WISHLIST = [
  { id: 'w1', brand: 'Tudor', name: 'Black Bay 58', ref: '79030N', price: 3000, marketPrice: 3400, tags: ['Dive'] },
  { id: 'w2', brand: 'Cartier', name: 'Tank', tags: ['Dress'] },
];

function logsFor(dates, watchId = 'a', useCase = 'work') {
  return dates.map((d, i) => ({ id: 'l' + watchId + i, watchId, date: d, useCase }));
}
const dstr = (ms) => new Date(ms).toISOString().slice(0, 10);

describe('buildRecommendPayload', () => {
  it('counts unique wear dates: 90-day window vs all-time', () => {
    const logs = [
      ...logsFor([dstr(NOW - 5 * DAY), dstr(NOW - 5 * DAY), dstr(NOW - 10 * DAY)]), // dup date counts once
      ...logsFor([dstr(NOW - 200 * DAY)]),                                          // old: all-time only
    ];
    const p = buildRecommendPayload(WATCHES, logs, WISHLIST, NOW);
    expect(p.collection[0].wears90).toBe(2);
    expect(p.collection[0].wearsTotal).toBe(3);
    expect(p.collection[1].wears90).toBe(0);
    expect(p.collection[1].wearsTotal).toBe(0);
  });

  it('includes a wear exactly 90 days old in the window', () => {
    const p = buildRecommendPayload(WATCHES, logsFor([dstr(NOW - 90 * DAY)]), WISHLIST, NOW);
    expect(p.collection[0].wears90).toBe(1);
  });

  it('ignores measurement entries and logs without a date', () => {
    const logs = [
      { id: 'm', watchId: 'a', date: dstr(NOW - DAY), useCase: 'measurement' },
      { id: 'n', watchId: 'a', useCase: 'work' },
    ];
    const p = buildRecommendPayload(WATCHES, logs, WISHLIST, NOW);
    expect(p.collection[0].wearsTotal).toBe(0);
  });

  it('tallies only the four real use-case chips', () => {
    const logs = [
      ...logsFor([dstr(NOW - 1 * DAY)], 'a', 'work'),
      ...logsFor([dstr(NOW - 2 * DAY)], 'a', 'dinner'),
      ...logsFor([dstr(NOW - 3 * DAY)], 'a', 'unspecified'),
    ];
    const p = buildRecommendPayload(WATCHES, logs, WISHLIST, NOW);
    expect(p.collection[0].useCases).toEqual({ work: 1, dinner: 1 });
  });

  it('maps fields: movementType wins over movement, size from caseDiameter', () => {
    const p = buildRecommendPayload(WATCHES, [], WISHLIST, NOW);
    expect(p.collection[0]).toMatchObject({ brand: 'Omega', name: 'Speedmaster', ref: '310.30', movement: 'automatic', size: '42' });
    expect(p.collection[1].movement).toBe('NH36');
    expect(p.collection[1].size).toBe('');
  });

  it('collection price prefers marketPrice, falls back to price, else null', () => {
    const p = buildRecommendPayload(WATCHES, [], WISHLIST, NOW);
    expect(p.collection[0].price).toBe(6000);
    expect(p.collection[1].price).toBe(null);
  });

  it('wishlist price prefers marketPrice, falls back to price, else null', () => {
    const p = buildRecommendPayload(WATCHES, [], WISHLIST, NOW);
    expect(p.wishlist[0]).toEqual({ id: 'w1', brand: 'Tudor', name: 'Black Bay 58', ref: '79030N', price: 3400, tags: ['Dive'] });
    expect(p.wishlist[1].price).toBe(null);
  });

  it('caps lists (300 collection / 100 wishlist) and trims tags to 6', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: 'c' + i, brand: 'B', name: 'N', tags: ['1', '2', '3', '4', '5', '6', '7'] }));
    const wl = Array.from({ length: 150 }, (_, i) => ({ id: 'w' + i, brand: 'B', name: 'N' }));
    const p = buildRecommendPayload(many, [], wl, NOW);
    expect(p.collection.length).toBe(300);
    expect(p.wishlist.length).toBe(100);
    expect(p.collection[0].tags.length).toBe(6);
  });

  it('tolerates null/empty inputs', () => {
    expect(buildRecommendPayload(null, null, null, NOW)).toEqual({ collection: [], wishlist: [] });
  });
});

describe('recommendCacheKey', () => {
  it('is deterministic for the same payload', () => {
    const p = buildRecommendPayload(WATCHES, [], WISHLIST, NOW);
    expect(recommendCacheKey(p)).toBe(recommendCacheKey(buildRecommendPayload(WATCHES, [], WISHLIST, NOW)));
  });
  it('changes when the underlying data changes', () => {
    const a = recommendCacheKey(buildRecommendPayload(WATCHES, [], WISHLIST, NOW));
    const b = recommendCacheKey(buildRecommendPayload(WATCHES, logsFor([dstr(NOW - DAY)]), WISHLIST, NOW));
    expect(a).not.toBe(b);
  });
});

// ── Wiring: the app actually uses all of this ────────────────────────────────
describe('index.html wiring', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('ships ungated: What-if auto-loads picks, the Wishlist has the AI Picks toggle', () => {
    expect(html).not.toMatch(/experiment\('wishlist_recommend'\)/);
    const enter = html.slice(html.indexOf('function enterCollectionSim'));
    expect(enter.slice(0, 500)).toMatch(/primeRecommendations\(\)/);
    expect(html).toMatch(/id="wl-rec-btn"[^>]*onclick="toggleWishlistRecs\(\)"/);
    // The wishlist render itself never spends a call — only the button does.
    const wl = html.slice(html.indexOf('function _renderWishlistBody'));
    expect(wl.slice(0, 2000)).not.toMatch(/primeRecommendations\(\)/);
  });
  it('the toggle hides the rail on the second tap and blocks demo mode', () => {
    const fn = html.slice(html.indexOf('function toggleWishlistRecs'));
    const body = fn.slice(0, 400);
    expect(body).toMatch(/demoGuard\(\)/);
    expect(body).toMatch(/_recWlVisible = false/);
    expect(body).toMatch(/primeRecommendations\(\)/);
  });
  it('rail and tile decorations render only while toggled on', () => {
    expect(html).toMatch(/recPanel\.innerHTML = \(_recWlVisible && canRec\)/);
    const dec = html.slice(html.indexOf('function decorateWishlistPicks'));
    expect(dec.slice(0, 300)).toMatch(/if \(!_recWlVisible\) return;/);
  });
  it('calls the recommend-wishlist edge function via authedFetch', () => {
    expect(html).toMatch(/authedFetch\(SUPABASE_URL \+ '\/functions\/v1\/recommend-wishlist'/);
  });
  it('never spends a paid call in demo mode', () => {
    const fn = html.slice(html.indexOf('function primeRecommendations'));
    expect(fn.slice(0, 300)).toMatch(/_isDemoMode/);
  });
  it('rail renders names and one-liners through escHtml, thumbnails with fallback', () => {
    const fn = html.slice(html.indexOf('function recRailHTML'));
    const body = fn.slice(0, 3000);
    expect(body).toMatch(/escHtml\(/);
    expect(body).toMatch(/rec-pick-avatar/);
    expect(body).toMatch(/rec-card-thumb/);
  });
  it('sim cards toggle the scenario; wishlist cards toggle the tile highlight', () => {
    const fn = html.slice(html.indexOf('function recRailHTML'));
    const body = fn.slice(0, 3000);
    expect(body).toMatch(/In simulation ✓/);
    expect(body).toMatch(/\+ Add/);
    expect(body).toMatch(/simToggleWish\(/);
    expect(body).toMatch(/recToggleHighlight\(/);
  });
  it('wishlist render decorates picked tiles after every view branch', () => {
    expect(html).toMatch(/function renderWishlist\(force\) \{\s*_renderWishlistBody\(force\);\s*decorateWishlistPicks\(\);/);
  });
  it('rail is built from existing design pieces, no bespoke scheme', () => {
    expect(html).toMatch(/class="panel rec-card/);
    expect(html).toMatch(/<span class="eyebrow">✦/);
    expect(html).not.toMatch(/var\(--ai\)/);
  });
  it('pre-redesign cached results (no oneLiner) are treated as a cache miss', () => {
    const fn = html.slice(html.indexOf('function primeRecommendations'));
    expect(fn.slice(0, 1200)).toMatch(/oneLiner !== undefined/);
  });
});
