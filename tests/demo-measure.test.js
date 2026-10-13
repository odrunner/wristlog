import { describe, it, expect } from 'vitest';
import { demoMeasureAllowed, demoMeasureCta, demoRateBand } from '../wrotate_test.js';

// Demo-mode measurement (usage review 2026-10-10 P1): a demo visitor may RUN
// the timegrapher; keeping/sharing stays gated. These helpers decide whether a
// run may start (cap support, off by default), what the post-reading signup
// CTA says, and the telemetry rate band.

describe('demoMeasureAllowed', () => {
  it('always allows outside demo mode', () => {
    expect(demoMeasureAllowed({ isDemo: false, completedRuns: 999, cap: 1 }))
      .toEqual({ allow: true, capped: false });
  });

  it('allows demo runs when no cap is set (cap 0 = off)', () => {
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: 50, cap: 0 }))
      .toEqual({ allow: true, capped: false });
  });

  it('allows demo runs under the cap', () => {
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: 2, cap: 3 }))
      .toEqual({ allow: true, capped: false });
  });

  it('blocks demo runs at the cap', () => {
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: 3, cap: 3 }))
      .toEqual({ allow: false, capped: true });
  });

  it('treats a missing/garbage run count as zero', () => {
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: NaN, cap: 3 }))
      .toEqual({ allow: true, capped: false });
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: undefined, cap: 3 }))
      .toEqual({ allow: true, capped: false });
  });

  it('treats a negative or non-finite cap as off', () => {
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: 10, cap: -1 }))
      .toEqual({ allow: true, capped: false });
    expect(demoMeasureAllowed({ isDemo: true, completedRuns: 10, cap: NaN }))
      .toEqual({ allow: true, capped: false });
  });
});

describe('demoMeasureCta', () => {
  it('quotes the live rate, sign derived after rounding', () => {
    expect(demoMeasureCta(4.23)).toEqual({
      title: 'Your watch is running +4.2 s/day',
      sub: 'Sign up free to save this reading:',
    });
    expect(demoMeasureCta(-3.97)).toEqual({
      title: 'Your watch is running -4.0 s/day',
      sub: 'Sign up free to save this reading:',
    });
  });

  it('shows no sign when the rounded rate is 0.0 (audit F7 convention)', () => {
    expect(demoMeasureCta(-0.04).title).toBe('Your watch is running 0.0 s/day');
  });

  it('falls back to generic copy when there is no rate', () => {
    expect(demoMeasureCta(null)).toEqual({
      title: 'Measure complete',
      sub: 'Sign up free to save your readings:',
    });
    expect(demoMeasureCta('nope').title).toBe('Measure complete');
  });
});

describe('demoRateBand', () => {
  it('bands a rate for telemetry', () => {
    expect(demoRateBand(0)).toBe('le5');
    expect(demoRateBand(-5)).toBe('le5');
    expect(demoRateBand(5.1)).toBe('le15');
    expect(demoRateBand(-15)).toBe('le15');
    expect(demoRateBand(15.1)).toBe('gt15');
  });

  it('returns none for a missing or non-numeric rate', () => {
    expect(demoRateBand(null)).toBe('none');
    expect(demoRateBand(undefined)).toBe('none');
    expect(demoRateBand(NaN)).toBe('none');
  });
});

// Demo funnel leak fixes (weekly agents A2, 2026-10-12): wiring assertions on
// index.html so a refactor can't silently reintroduce either leak.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('demo funnel wiring (index.html)', () => {
  it('banner "Sign Up Free" opens the signup modal, not exit', () => {
    const banner = html.slice(html.indexOf('id="demo-banner"'), html.indexOf('id="reminder-banner"'));
    expect(banner).toContain('onclick="showDemoSignupModal()"');
    // exactly one exit button remains in the banner
    expect(banner.match(/onclick="exitDemoMode\(\)"/g)?.length).toBe(1);
  });

  it('banner copy is current (demo is not read-only; no persona name)', () => {
    expect(html).not.toContain('read-only preview of Alex Rivera');
    expect(html).toContain('explore a sample collection. Nothing here is saved.');
  });

  it('demo-measure modal has no backdrop-tap dismissal (a stray tap must not wipe the reading)', () => {
    const fn = html.slice(html.indexOf('function showDemoMeasureModal'), html.indexOf('function dismissDemoMeasureModal'));
    expect(fn).toContain('Discard reading');
    expect(fn).not.toMatch(/addEventListener\('click'/);
  });
});
