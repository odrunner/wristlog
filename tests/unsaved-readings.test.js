// "Unsaved readings" on the watch accuracy panel — converged measurement sessions the
// user never saved (measurement_sessions, via unsaved_measurement_sessions RPC).
import { describe, it, expect } from 'vitest';
import { unsavedReadingLabel } from '../wrotate_test.js';

describe('unsavedReadingLabel', () => {
  const now = new Date('2026-08-16T12:00:00');
  it('formats a positive rate with sign and one decimal', () => {
    const l = unsavedReadingLabel({ rate: 6.24, amplitude: 301, created_at: '2026-08-14T09:00:00Z' }, now);
    expect(l.rateStr).toBe('+6.2 s/d');
    expect(l.ampStr).toBe('Amp: 301°');
  });
  it('formats a negative rate and no amplitude', () => {
    const l = unsavedReadingLabel({ rate: -2, amplitude: null, created_at: '2026-08-14T09:00:00Z' }, now);
    expect(l.rateStr).toBe('-2.0 s/d');
    expect(l.ampStr).toBe('');
  });
  it('rate arrives as a string from PostgREST (numeric)', () => {
    expect(unsavedReadingLabel({ rate: '-2.4', created_at: '2026-08-14T09:00:00Z' }, now).rateStr).toBe('-2.4 s/d');
  });
  it('says Today / Yesterday / N days ago', () => {
    expect(unsavedReadingLabel({ rate: 1, created_at: '2026-08-16T08:00:00' }, now).dateStr).toBe('Today');
    expect(unsavedReadingLabel({ rate: 1, created_at: '2026-08-15T08:00:00' }, now).dateStr).toBe('Yesterday');
    expect(unsavedReadingLabel({ rate: 1, created_at: '2026-08-10T08:00:00' }, now).dateStr).toBe('6 days ago');
  });
});
