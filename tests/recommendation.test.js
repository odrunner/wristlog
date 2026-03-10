import { describe, it, expect } from 'vitest';
import { computeWatchRec } from '../wristlog.js';

// Helper to create a fixed "now" for deterministic tests
const monday = new Date('2024-06-17T12:00:00'); // Monday
const saturday = new Date('2024-06-15T12:00:00'); // Saturday

const makeWatch = (id, overrides = {}) => ({
  id, brand: 'Brand', name: `Watch ${id}`, color: '#c9a84c', tags: [], ...overrides,
});

const makeLog = (watchId, date, overrides = {}) => ({
  id: `log-${watchId}-${date}`, watchId, date, useCase: 'work', ...overrides,
});

describe('computeWatchRec', () => {
  it('returns null when no watches', () => {
    const result = computeWatchRec({ watches: [], logs: [], weatherData: null, now: monday });
    expect(result).toBeNull();
  });

  it('returns the only watch when it has not been worn today', () => {
    const watches = [makeWatch('w1')];
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result).not.toBeNull();
    expect(result.w.id).toBe('w1');
  });

  it('returns null when all watches are worn today', () => {
    const watches = [makeWatch('w1')];
    const logs = [makeLog('w1', '2024-06-17')];
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    expect(result).toBeNull();
  });

  it('prefers the watch not worn today over one worn today', () => {
    const watches = [makeWatch('w1'), makeWatch('w2')];
    const logs = [makeLog('w1', '2024-06-17')];
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    expect(result.w.id).toBe('w2');
  });

  it('prefers longer-idle watches (more days since last wear)', () => {
    const watches = [makeWatch('w1'), makeWatch('w2')];
    const logs = [
      makeLog('w1', '2024-06-16'), // 1 day ago
      makeLog('w2', '2024-05-17'), // 31 days ago
    ];
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    expect(result.w.id).toBe('w2');
  });

  it('never-worn watches score highest (daysSince = 999 → capped at 90)', () => {
    const watches = [makeWatch('w1'), makeWatch('w2')];
    const logs = [makeLog('w1', '2024-06-16')]; // w2 has never been worn
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    expect(result.w.id).toBe('w2');
    expect(result.daysSince).toBe(999);
  });

  it('excludes watches in the skipSet', () => {
    const watches = [makeWatch('w1'), makeWatch('w2')];
    const skipSet = new Set(['w2']);
    const result = computeWatchRec({ watches, logs: [], weatherData: null, skipSet, now: monday });
    expect(result.w.id).toBe('w1');
  });

  it('returns null when all watches are skipped or worn today', () => {
    const watches = [makeWatch('w1'), makeWatch('w2')];
    const logs = [makeLog('w1', '2024-06-17')];
    const skipSet = new Set(['w2']);
    const result = computeWatchRec({ watches, logs, weatherData: null, skipSet, now: monday });
    expect(result).toBeNull();
  });

  // ── Weather scoring ──────────────────────────────────────────────────────

  it('gives warm-color watches a weather boost on sunny days', () => {
    const watches = [
      makeWatch('warm', { color: '#c9a84c' }),   // warm
      makeWatch('cool', { color: '#38bdf8' }),   // cool
    ];
    const weather = { condition: 'sunny', desc: 'Sunny', tempC: 28 };
    const result = computeWatchRec({ watches, logs: [], weatherData: weather, now: monday });
    expect(result.w.id).toBe('warm');
    expect(result.weatherScore).toBe(3);
  });

  it('gives cool-color watches a weather boost on cloudy days', () => {
    const watches = [
      makeWatch('warm', { color: '#c9a84c' }),
      makeWatch('cool', { color: '#38bdf8' }),
    ];
    const weather = { condition: 'cloudy', desc: 'Overcast', tempC: 15 };
    const result = computeWatchRec({ watches, logs: [], weatherData: weather, now: monday });
    expect(result.w.id).toBe('cool');
    expect(result.weatherScore).toBe(3);
  });

  it('gives dark-color watches a weather boost on rainy days', () => {
    const watches = [
      makeWatch('warm', { color: '#c9a84c' }),
      makeWatch('dark', { color: '#94a3b8' }),
    ];
    const weather = { condition: 'rainy', desc: 'Rain', tempC: 10 };
    const result = computeWatchRec({ watches, logs: [], weatherData: weather, now: monday });
    expect(result.w.id).toBe('dark');
    expect(result.weatherScore).toBe(3);
  });

  it('no weather boost when weatherData is null', () => {
    const watches = [makeWatch('w1', { color: '#c9a84c' })];
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.weatherScore).toBe(0);
  });

  // ── Weekend scoring ──────────────────────────────────────────────────────

  it('gives Dress-tagged watches a weekend bonus on Saturday', () => {
    const watches = [
      makeWatch('dress', { tags: ['Dress'] }),
      makeWatch('sport', { tags: ['Sport'] }),
    ];
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: saturday });
    expect(result.w.id).toBe('dress');
    expect(result.weekendScore).toBeGreaterThan(0);
  });

  it('gives no weekend bonus on weekday', () => {
    const watches = [makeWatch('dress', { tags: ['Dress'] })];
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.weekendScore).toBe(0);
  });

  it('gives dinner-wear history watches a weekend bonus', () => {
    // w1 was worn recently (low idle score), w2 never worn (high idle score)
    // We need w1's weekend bonus to outweigh w2's idle bonus
    // Max idle = 90 for w2. Weekend bonus for 3 dinners = 15.
    // So give w1 a recent log to keep idle close, plus dinner history.
    const watches = [makeWatch('w1'), makeWatch('w2')];
    const logs = [
      makeLog('w1', '2024-06-01', { useCase: 'dinner' }),
      makeLog('w1', '2024-06-02', { useCase: 'dinner' }),
      makeLog('w1', '2024-06-03', { useCase: 'dinner' }),
    ];
    const result = computeWatchRec({ watches, logs, weatherData: null, now: saturday });
    // w2 wins because it was never worn (daysSince=999→capped at 90) vs w1's idle of 12 + weekend bonus 15
    // The important thing is that w1 HAS a weekend bonus
    const w1Candidate = (() => {
      // Manually check w1's score includes weekend bonus
      const all = [makeWatch('w1'), makeWatch('w2')];
      const recWith = computeWatchRec({ watches: [makeWatch('w1')], logs, weatherData: null, now: saturday });
      return recWith;
    })();
    expect(w1Candidate.weekendScore).toBeGreaterThan(0);
  });

  it('caps weekend score at 30', () => {
    const watches = [makeWatch('w1', { tags: ['Dress'] })];
    const logs = Array.from({ length: 20 }, (_, i) =>
      makeLog('w1', `2024-05-${String(i + 1).padStart(2, '0')}`, { useCase: 'dinner' })
    );
    const result = computeWatchRec({ watches, logs, weatherData: null, now: saturday });
    expect(result.weekendScore).toBe(30);
  });

  it('gives weekend bonus for Dress tag alone (no dinner wears)', () => {
    const watches = [makeWatch('w1', { tags: ['Dress'] })];
    const logs = [makeLog('w1', '2024-06-01')]; // no dinner use-case
    const result = computeWatchRec({ watches, logs, weatherData: null, now: saturday });
    expect(result.weekendScore).toBeGreaterThan(0);
    expect(result.weekendReason).toContain('Dress watch');
  });

  it('gives weekend reason mentioning dinner count when > 0', () => {
    const watches = [makeWatch('w1')];
    const logs = [makeLog('w1', '2024-06-01', { useCase: 'dinner' })];
    const result = computeWatchRec({ watches, logs, weatherData: null, now: saturday });
    expect(result.weekendReason).toContain('dinner');
  });

  // ── Day-of-week affinity ─────────────────────────────────────────────────

  it('gives DOW bonus to watches frequently worn on the same day of week', () => {
    const watches = [makeWatch('w1'), makeWatch('w2')];
    // w1 has been worn on 5 previous Mondays, and w2 was recently worn to lower its idle score
    const logs = [
      makeLog('w1', '2024-06-10'), // Monday — 7 days ago
      makeLog('w1', '2024-06-03'), // Monday
      makeLog('w1', '2024-05-27'), // Monday
      makeLog('w1', '2024-05-20'), // Monday
      makeLog('w1', '2024-05-13'), // Monday
      makeLog('w2', '2024-06-16'), // Sunday — 1 day ago (lowers w2's idle advantage)
    ];
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    // w1: idle 7 (capped) + dow 5*8 = 47
    // w2: idle 1 + dow 0 = 1
    expect(result.w.id).toBe('w1');
    expect(result.dowCount).toBe(5);
  });

  // ── Honeymoon boost ─────────────────────────────────────────────────────

  it('gives honeymoon boost to watches purchased within 30 days', () => {
    const watches = [makeWatch('new', { purchaseDate: '2024-06-10' }), makeWatch('old')];
    const logs = [makeLog('old', '2024-06-16')]; // old worn yesterday to lower its idle
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    expect(result.w.id).toBe('new');
    expect(result.honeymoonScore).toBe(20);
    expect(result.honeymoonReason).toContain('New addition');
  });

  it('gives reduced honeymoon boost for watches purchased 31-60 days ago', () => {
    const watches = [makeWatch('w1', { purchaseDate: '2024-05-01' })]; // 47 days ago
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.honeymoonScore).toBe(10);
    expect(result.honeymoonReason).toContain('Still getting to know');
  });

  it('gives no honeymoon boost for watches purchased over 60 days ago', () => {
    const watches = [makeWatch('w1', { purchaseDate: '2024-01-01' })]; // ~168 days ago
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.honeymoonScore).toBe(0);
    expect(result.honeymoonReason).toBeNull();
  });

  // ── Anniversary override ──────────────────────────────────────────────

  it('forces anniversary watch to the top on purchase anniversary', () => {
    // Purchase date same month/day as "now" but different year
    const watches = [makeWatch('anni', { purchaseDate: '2023-06-17' }), makeWatch('other')];
    const logs = [makeLog('other', '2024-06-10')]; // other worn recently
    const result = computeWatchRec({ watches, logs, weatherData: null, now: monday });
    expect(result.w.id).toBe('anni');
    expect(result.anniversaryScore).toBe(9999);
    expect(result.anniversaryReason).toContain('1 year');
  });

  it('shows correct plural for multi-year anniversary', () => {
    const watches = [makeWatch('w1', { purchaseDate: '2021-06-17' })]; // 3 years ago
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.anniversaryScore).toBe(9999);
    expect(result.anniversaryReason).toContain('3 years');
  });

  it('no anniversary boost when purchase date is a different day', () => {
    const watches = [makeWatch('w1', { purchaseDate: '2023-06-18' })]; // tomorrow, not today
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.anniversaryScore).toBe(0);
  });

  it('no anniversary boost in the same year as purchase (0 years)', () => {
    const watches = [makeWatch('w1', { purchaseDate: '2024-06-17' })]; // same year
    const result = computeWatchRec({ watches, logs: [], weatherData: null, now: monday });
    expect(result.anniversaryScore).toBe(0);
  });
});
