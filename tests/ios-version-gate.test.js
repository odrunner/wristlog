import { describe, it, expect } from 'vitest';
import { iosAtLeast } from '../wrotate_test.js';

// ── iOS version gate ─────────────────────────────────────────────────────────
// Regression cover for the 2026-07-25 audit finding: four feature gates compared
// window._iosAppVersion with parseFloat(), which silently misorders any version
// with a two-digit minor. The gates it guards are the push primer (>= 2.3), the
// Pro V2 beta toggle (>= 2.1), the Pro V2 beat-error readout (>= 2.3) and the V2
// convergence path (>= 2.0) — all of which would have quietly switched themselves
// off on a 2.10 build.
describe('iosAtLeast', () => {
  it('orders two-digit minors correctly — the parseFloat bug', () => {
    // parseFloat('2.10') === 2.1, which is < 2.3. Componentwise, 2.10 > 2.3.
    expect(iosAtLeast('2.10', '2.3')).toBe(true);
    expect(iosAtLeast('2.10', '2.1')).toBe(true);
    expect(iosAtLeast('2.9', '2.10')).toBe(false);
    expect(iosAtLeast('2.25', '2.3')).toBe(true);
  });

  it('holds the gates that ship today', () => {
    expect(iosAtLeast('2.3', '2.3')).toBe(true);    // push primer, BE readout
    expect(iosAtLeast('2.2', '2.3')).toBe(false);
    expect(iosAtLeast('2.1', '2.1')).toBe(true);    // Pro V2 beta toggle
    expect(iosAtLeast('2.0', '2.1')).toBe(false);
    expect(iosAtLeast('2.0', '2.0')).toBe(true);    // V2 convergence
    expect(iosAtLeast('1.9', '2.0')).toBe(false);
  });

  it('treats web and older shells as version 0', () => {
    expect(iosAtLeast(undefined, '2.3')).toBe(false);
    expect(iosAtLeast(null, '2.3')).toBe(false);
    expect(iosAtLeast('', '2.3')).toBe(false);
    expect(iosAtLeast('garbage', '2.3')).toBe(false);
    expect(iosAtLeast(undefined, '0')).toBe(true);
  });

  it('compares across major versions', () => {
    expect(iosAtLeast('3.0', '2.9')).toBe(true);
    expect(iosAtLeast('10.0', '9.9')).toBe(true);   // the same trap one level up
    expect(iosAtLeast('2.99', '3.0')).toBe(false);
  });

  it('handles differing component counts and patch versions', () => {
    expect(iosAtLeast('2.3.1', '2.3')).toBe(true);
    expect(iosAtLeast('2.3', '2.3.0')).toBe(true);
    expect(iosAtLeast('2.3', '2.3.1')).toBe(false);
    expect(iosAtLeast('2', '2.0')).toBe(true);
  });

  it('accepts a numeric version without throwing', () => {
    // window._iosAppVersion is a string today, but a numeric literal must not crash.
    expect(iosAtLeast(2.3, '2.3')).toBe(true);
    expect(iosAtLeast(2, '2.1')).toBe(false);
  });
});
