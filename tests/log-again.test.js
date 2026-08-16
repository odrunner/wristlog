// One-tap "wearing it again?" banner (Track + foreground after 5pm). Same audience rule as
// the server-side wear reminder: a log in the last 14 days, none today.
import { describe, it, expect } from 'vitest';
import { logAgainCandidate } from '../wrotate_test.js';
const watches = [{ id: 'w1', brand: 'Omega', name: 'Seamaster' }, { id: 'w2', brand: 'Seiko', name: 'SKX' }];
const base = { watches, today: '2026-08-16', hour: 18 };
describe('logAgainCandidate', () => {
  it('returns the most recently worn watch when nothing is logged today', () => {
    const logs = [{ watchId: 'w2', date: '2026-08-10' }, { watchId: 'w1', date: '2026-08-15' }];
    expect(logAgainCandidate({ ...base, logs }).id).toBe('w1');
  });
  it('is null before 5pm', () => {
    const logs = [{ watchId: 'w1', date: '2026-08-15' }];
    expect(logAgainCandidate({ ...base, logs, hour: 16 })).toBeNull();
    expect(logAgainCandidate({ ...base, logs, hour: 17 })).not.toBeNull();
  });
  it('is null when something is already logged today', () => {
    const logs = [{ watchId: 'w1', date: '2026-08-15' }, { watchId: 'w2', date: '2026-08-16' }];
    expect(logAgainCandidate({ ...base, logs })).toBeNull();
  });
  it('is null when the last log is older than 14 days', () => {
    const logs = [{ watchId: 'w1', date: '2026-07-20' }];
    expect(logAgainCandidate({ ...base, logs })).toBeNull();
    expect(logAgainCandidate({ ...base, logs: [{ watchId: 'w1', date: '2026-08-02' }] })).not.toBeNull();
  });
  it('is null when the last-worn watch no longer exists', () => {
    const logs = [{ watchId: 'gone', date: '2026-08-15' }];
    expect(logAgainCandidate({ ...base, logs })).toBeNull();
  });
  it('ignores future-dated logs and handles empty inputs', () => {
    expect(logAgainCandidate({ ...base, logs: [] })).toBeNull();
    expect(logAgainCandidate({ ...base, logs: [{ watchId: 'w1', date: '2026-08-20' }] })).toBeNull();
  });
  it('tolerates null logs / watches / malformed entries and same-date ties', () => {
    expect(logAgainCandidate({ ...base, logs: null })).toBeNull();
    expect(logAgainCandidate({ ...base, logs: [null, { watchId: 'w1' }, { watchId: 'w1', date: '2026-08-15' }], watches: null })).toBeNull();
    const tie = [{ watchId: 'w2', date: '2026-08-15' }, { watchId: 'w1', date: '2026-08-15' }, { watchId: 'w2', date: '2026-08-14' }];
    expect(['w1', 'w2']).toContain(logAgainCandidate({ ...base, logs: tie }).id);
  });
});
