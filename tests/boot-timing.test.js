import { describe, it, expect } from 'vitest';
import { bootTimingPayload } from '../wrotate_test.js';

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
      sw_controlled: true, cached_feed: true, feed_error: false, optimistic_boot: false,
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
      sw_controlled: false, cached_feed: false, feed_error: false, optimistic_boot: false,
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

  it('records a boot that started from the stored session', () => {
    expect(bootTimingPayload({ marks, nav, optimistic: true }).optimistic_boot).toBe(true);
  });
});
