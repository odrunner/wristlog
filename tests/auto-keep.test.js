// Auto-keep with a gate: a converged, plausible measurement is written to history without a
// Save tap (Wi-Fi-scale model — everything is kept, the user can discard). The gate keeps
// junk (mis-locks, thin sessions, back-to-back identical retries) in the "Unsaved readings"
// tray instead of the history.
import { describe, it, expect } from 'vitest';
import { shouldAutoKeepReading } from '../wrotate_test.js';
const ok = { converged: true, rate: 3.2, ticks: 120, watchId: 'w1', loggedIn: true, demo: false, runnerActive: false, lastKept: null, nowMs: 1_000_000 };
describe('shouldAutoKeepReading', () => {
  it('keeps a converged, plausible reading', () => {
    expect(shouldAutoKeepReading(ok)).toBe(true);
    expect(shouldAutoKeepReading({ ...ok, rate: -59.9 })).toBe(true);
    expect(shouldAutoKeepReading({ ...ok, ticks: 40 })).toBe(true);
  });
  it('rejects unconverged, implausible or thin sessions', () => {
    expect(shouldAutoKeepReading({ ...ok, converged: false })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, rate: 61 })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, rate: NaN })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, rate: null })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, ticks: 39 })).toBe(false);
  });
  it('never in demo / signed-out / runner / no watch', () => {
    expect(shouldAutoKeepReading({ ...ok, demo: true })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, loggedIn: false })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, runnerActive: true })).toBe(false);
    expect(shouldAutoKeepReading({ ...ok, watchId: '' })).toBe(false);
  });
  it('skips a near-identical retry on the same watch within 10 minutes (kept already)', () => {
    const lastKept = { watchId: 'w1', rate: 3.4, atMs: 1_000_000 - 5 * 60_000 };
    expect(shouldAutoKeepReading({ ...ok, lastKept })).toBe(false);                    // Δ0.2 within 10 min
    expect(shouldAutoKeepReading({ ...ok, lastKept: { ...lastKept, rate: 4.0 } })).toBe(true);   // Δ0.8 → keep
    expect(shouldAutoKeepReading({ ...ok, lastKept: { ...lastKept, atMs: 1_000_000 - 11 * 60_000 } })).toBe(true); // older
    expect(shouldAutoKeepReading({ ...ok, lastKept: { ...lastKept, watchId: 'w2' } })).toBe(true);  // other watch
  });
});
