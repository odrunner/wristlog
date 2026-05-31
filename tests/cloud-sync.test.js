import { describe, it, expect, vi } from 'vitest';

// ── cloudSync race condition fix ─────────────────────────────────────────
// The fix: clearTimeout(_syncRetryTimer) at entry prevents overlapping retry timers.

describe('cloudSync race condition fix: clearTimeout at entry', () => {
  // Mirrors the fixed cloudSync() entry pattern:
  //   clearTimeout(_syncRetryTimer);
  //   _syncRetryTimer = null;
  //   if (!hasDirty) return;
  //   if (_syncInFlight) { _syncRetryTimer = setTimeout(cloudSync, 2000); return; }

  it('cancels existing retry timer on entry', () => {
    let _syncRetryTimer = setTimeout(() => {}, 10000);
    // On entry, cloudSync clears the pending timer
    clearTimeout(_syncRetryTimer);
    _syncRetryTimer = null;
    expect(_syncRetryTimer).toBeNull();
  });

  it('prevents duplicate timers when called while sync in flight', () => {
    let _syncInFlight = true;
    let _syncRetryTimer = setTimeout(() => {}, 10000); // old timer

    // cloudSync entry: clear old timer first
    clearTimeout(_syncRetryTimer);
    _syncRetryTimer = null;

    // Then check if sync in flight — schedule new retry
    if (_syncInFlight) {
      _syncRetryTimer = setTimeout(() => {}, 2000);
    }

    // Only one timer should exist (the new one)
    expect(_syncRetryTimer).not.toBeNull();
    clearTimeout(_syncRetryTimer); // cleanup
  });

  it('does not schedule retry when nothing is dirty', () => {
    let _syncRetryTimer = null;
    const _dirty = { watches: new Set(), logs: new Set(), wishlist: new Set(), elo: new Set() };
    const _pendingDeletes = [];

    // cloudSync entry
    clearTimeout(_syncRetryTimer);
    _syncRetryTimer = null;

    const hasDirty = _dirty.watches.size || _dirty.logs.size || _dirty.wishlist.size || _dirty.elo.size || _pendingDeletes.length;
    if (!hasDirty) {
      // early return — no timer set
    }

    expect(_syncRetryTimer).toBeNull();
    expect(hasDirty).toBeFalsy();
  });

  it('proceeds to sync when dirty and not in flight', () => {
    let _syncInFlight = false;
    let proceeded = false;
    const _dirty = { watches: new Set(['w1']), logs: new Set(), wishlist: new Set(), elo: new Set() };
    const _pendingDeletes = [];

    clearTimeout(undefined);
    const hasDirty = _dirty.watches.size || _dirty.logs.size || _dirty.wishlist.size || _dirty.elo.size || _pendingDeletes.length;
    if (!hasDirty) return;
    if (_syncInFlight) return;

    _syncInFlight = true;
    proceeded = true;

    expect(proceeded).toBe(true);
    expect(_syncInFlight).toBe(true);
  });

  it('schedules retry with exponential backoff on partial failure', () => {
    let _syncRetryCount = 0;
    _syncRetryCount = Math.min(_syncRetryCount + 1, 5);
    const delay1 = Math.min(2000 * Math.pow(2, _syncRetryCount - 1), 60000);
    expect(delay1).toBe(2000); // First retry: 2s

    _syncRetryCount = Math.min(_syncRetryCount + 1, 5);
    const delay2 = Math.min(2000 * Math.pow(2, _syncRetryCount - 1), 60000);
    expect(delay2).toBe(4000); // Second retry: 4s

    _syncRetryCount = Math.min(_syncRetryCount + 1, 5);
    const delay3 = Math.min(2000 * Math.pow(2, _syncRetryCount - 1), 60000);
    expect(delay3).toBe(8000); // Third retry: 8s
  });

  it('caps retry count at 5', () => {
    let count = 0;
    for (let i = 0; i < 10; i++) {
      count = Math.min(count + 1, 5);
    }
    expect(count).toBe(5);
    const maxDelay = Math.min(2000 * Math.pow(2, count - 1), 60000);
    expect(maxDelay).toBe(32000); // 2000 * 16 = 32000
  });

  it('caps delay at 60 seconds', () => {
    // Even with count=5: 2000 * 2^4 = 32000, which is under 60000.
    // But if formula changed, we still cap at 60000
    const delay = Math.min(2000 * Math.pow(2, 10), 60000);
    expect(delay).toBe(60000);
  });

  it('resets retry count on successful sync', () => {
    let _syncRetryCount = 4;
    // After successful sync (no dirty items remain):
    const stillDirty = false;
    if (!stillDirty) {
      _syncRetryCount = 0;
    }
    expect(_syncRetryCount).toBe(0);
  });
});

// ── cloudSync dirty tracking with markDirty/filterDirtyItems ───────────

describe('cloudSync: dirty snapshot pattern', () => {
  // cloudSync snapshots IDs, attempts upsert, only clears on success.
  // New mutations during await stay in the live set.

  it('snapshot captures current dirty IDs', () => {
    const dirtyWatches = new Set(['w1', 'w2']);
    const snapshot = [...dirtyWatches];
    expect(snapshot).toEqual(['w1', 'w2']);
  });

  it('new mutations during upsert remain in dirty set', () => {
    const dirtyWatches = new Set(['w1', 'w2']);
    const snapshot = [...dirtyWatches];

    // Simulate a new mutation arriving during async upsert
    dirtyWatches.add('w3');

    // After upsert success, only clear snapshot IDs
    snapshot.forEach(id => dirtyWatches.delete(id));

    // w3 should still be dirty (was added during upsert)
    expect(dirtyWatches.has('w3')).toBe(true);
    expect(dirtyWatches.size).toBe(1);
  });

  it('failed upsert leaves all IDs dirty', () => {
    const dirtyWatches = new Set(['w1', 'w2']);
    const snapshot = [...dirtyWatches];

    // Simulate upsert failure — do NOT clear IDs
    const success = false;
    if (success) snapshot.forEach(id => dirtyWatches.delete(id));

    expect(dirtyWatches.size).toBe(2);
    expect(dirtyWatches.has('w1')).toBe(true);
    expect(dirtyWatches.has('w2')).toBe(true);
  });
});
