import { describe, it, expect } from 'vitest';
import { bootTimingPayload, firstLoadCardHtml } from '../wrotate_test.js';

// boot_timing is the one event that tells us what a first load costs on real
// phones: how long until the boot script runs, until the session resolves,
// until something is on screen. These tests pin the payload shape so a
// dashboard built on it keeps reading the same fields.
describe('bootTimingPayload', () => {
  const marks = { script: 812.4, session: 901.6, cached_paint: 950.2, first_live: 1610.9, enriched: 2100.1 };
  const nav = { type: 'navigate', transferSize: 561234, responseEnd: 640.7 };

  it('rounds every mark to whole milliseconds', () => {
    const p = bootTimingPayload({ marks, nav, swControlled: true, feedError: false, cachedFeed: true });
    expect(p).toMatchObject({
      script_ms: 812, session_ms: 902, cached_paint_ms: 950, first_live_ms: 1611, enriched_ms: 2100,
      nav_type: 'navigate', shell_kb: 548, shell_from: 'network', response_end_ms: 641,
      sw_controlled: true, cached_feed: true, feed_error: false, optimistic_boot: false, early_feed: false,
    });
  });

  it('reports a zero-byte navigation as served from cache', () => {
    const p = bootTimingPayload({ marks, nav: { type: 'reload', transferSize: 0, responseEnd: 12 } });
    expect(p.shell_from).toBe('cache');
    expect(p.shell_kb).toBe(0);
    expect(p.nav_type).toBe('reload');
  });

  it('nulls marks that never happened instead of sending NaN or negatives', () => {
    const p = bootTimingPayload({ marks: { script: 500, session: -1, first_live: NaN, enriched: 'x' }, nav });
    expect(p.script_ms).toBe(500);
    expect(p.session_ms).toBeNull();
    expect(p.cached_paint_ms).toBeNull();
    expect(p.first_live_ms).toBeNull();
    expect(p.enriched_ms).toBeNull();
  });

  it('survives a missing navigation entry and missing marks', () => {
    const p = bootTimingPayload({ marks: null, nav: null });
    expect(p).toEqual({
      script_ms: null, session_ms: null, cached_paint_ms: null, first_live_ms: null, enriched_ms: null,
      nav_type: null, shell_kb: null, shell_from: null, response_end_ms: null,
      sw_controlled: false, cached_feed: false, feed_error: false, optimistic_boot: false, early_feed: false,
    });
  });

  it('tolerates a navigation entry with no type or transferSize', () => {
    const p = bootTimingPayload({ marks, nav: { responseEnd: 300 }, feedError: true });
    expect(p.nav_type).toBeNull();
    expect(p.shell_kb).toBeNull();
    expect(p.shell_from).toBeNull();
    expect(p.response_end_ms).toBe(300);
    expect(p.feed_error).toBe(true);
  });

  it('records that the early-fetched feed queries were used', () => {
    expect(bootTimingPayload({ marks, nav, earlyFeed: true }).early_feed).toBe(true);
  });

  it('records a boot that started from the stored session', () => {
    expect(bootTimingPayload({ marks, nav, optimistic: true }).optimistic_boot).toBe(true);
  });
});

// Admin → Traffic → "First load": rows come from admin_boot_timing_daily().
describe('firstLoadCardHtml', () => {
  const day = (extra = {}) => ({
    day: '2026-09-18', loads: 42, users: 30, script_p50: 812, script_p90: 2440, cached_paint_p50: 1040,
    first_live_p50: 1611, first_live_p90: 4020, enriched_p50: 2100, enriched_p90: 5160,
    cached_pct: 71, early_pct: 64, optimistic_pct: 88, shell_cache_pct: 12, error_pct: 2, ...extra,
  });

  it('renders nothing when there is no data yet', () => {
    expect(firstLoadCardHtml([])).toBe('');
    expect(firstLoadCardHtml(null)).toBe('');
    expect(firstLoadCardHtml({ day: 'x' })).toBe('');
    expect(firstLoadCardHtml([null, {}])).toBe('');
  });

  it('shows one row per day with median / p90 in seconds and shares in percent', () => {
    const html = firstLoadCardHtml([day(), day({ day: '2026-09-17', loads: 7 })]);
    expect(html).toContain('First load (last 2 days, UTC)');
    expect(html).toContain('>09-18<');
    expect(html).toContain('>09-17<');
    expect(html).toContain('>42<');
    expect(html).toContain('0.8s <span style="color:var(--muted);">/ 2.4s</span>');   // page ready
    expect(html).toContain('1.6s <span style="color:var(--muted);">/ 4.0s</span>');   // first posts
    expect(html).toContain('2.1s <span style="color:var(--muted);">/ 5.2s</span>');   // feed complete
    expect(html).toContain('>1.0s<');                                                  // cached feed paint
    expect(html).toContain('>71%<');
    expect(html).toContain('>64%<');
    expect(html).toContain('>2%<');
  });

  it('shows a dash for anything a day has no value for', () => {
    const html = firstLoadCardHtml([day({ cached_paint_p50: null, enriched_p50: null, enriched_p90: 'n/a', cached_pct: '', loads: undefined, error_pct: null })]);
    expect(html).toContain('>–<');
    expect(html).toContain('– <span style="color:var(--muted);">/ –</span>');
    expect(html).not.toContain('NaN');
  });

  it('accepts numeric strings (PostgREST returns numerics as strings) and escapes the day', () => {
    const html = firstLoadCardHtml([day({ day: '2026-<b>x', script_p50: '1500', script_p90: '3000', cached_pct: '50' })]);
    expect(html).toContain('1.5s <span style="color:var(--muted);">/ 3.0s</span>');
    expect(html).toContain('>50%<');
    expect(html).not.toContain('<b>x');
  });
});
