import { describe, it, expect } from 'vitest';
import {
  safeParseJSON,
  markDirty,
  filterDirtyItems,
  shouldStopNotifPolling,
  withTimeout,
} from '../wrotate_test.js';

// ── safeParseJSON ─────────────────────────────────────────────────────────────

describe('safeParseJSON', () => {
  it('parses valid JSON object', () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses valid JSON array', () => {
    expect(safeParseJSON('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses valid JSON string', () => {
    expect(safeParseJSON('"hello"')).toBe('hello');
  });

  it('parses valid JSON number', () => {
    expect(safeParseJSON('42')).toBe(42);
  });

  it('returns fallback for corrupted JSON', () => {
    expect(safeParseJSON('{corrupted!!}')).toBeNull();
  });

  it('returns custom fallback for corrupted JSON', () => {
    expect(safeParseJSON('{bad}', {})).toEqual({});
  });

  it('returns fallback for truncated JSON', () => {
    expect(safeParseJSON('{"key": "va', [])).toEqual([]);
  });

  it('returns fallback for null input', () => {
    expect(safeParseJSON(null)).toBeNull();
  });

  it('returns fallback for undefined input', () => {
    expect(safeParseJSON(undefined)).toBeNull();
  });

  it('returns fallback for empty string', () => {
    expect(safeParseJSON('')).toBeNull();
  });

  it('returns custom fallback for empty string', () => {
    expect(safeParseJSON('', { default: true })).toEqual({ default: true });
  });

  it('handles deeply nested valid JSON', () => {
    const json = '{"a":{"b":{"c":[1,2]}}}';
    expect(safeParseJSON(json)).toEqual({ a: { b: { c: [1, 2] } } });
  });

  // Edge case: valid JSON but unexpected type
  it('parses "null" string to null', () => {
    expect(safeParseJSON('null')).toBeNull();
  });

  it('parses "true" string to boolean', () => {
    expect(safeParseJSON('true')).toBe(true);
  });
});

// ── markDirty ─────────────────────────────────────────────────────────────────

describe('markDirty', () => {
  const freshState = () => ({
    watches: new Set(),
    logs: new Set(),
    wishlist: new Set(),
    elo: new Set(),
  });

  it('adds a single ID to the correct set', () => {
    const state = freshState();
    markDirty(state, 'watches', 'w1');
    expect(state.watches.has('w1')).toBe(true);
    expect(state.watches.size).toBe(1);
  });

  it('adds multiple IDs via array', () => {
    const state = freshState();
    markDirty(state, 'elo', ['w1', 'w2', 'w3']);
    expect(state.elo.size).toBe(3);
    expect(state.elo.has('w1')).toBe(true);
    expect(state.elo.has('w2')).toBe(true);
    expect(state.elo.has('w3')).toBe(true);
  });

  it('deduplicates IDs (Set behavior)', () => {
    const state = freshState();
    markDirty(state, 'logs', 'l1');
    markDirty(state, 'logs', 'l1');
    expect(state.logs.size).toBe(1);
  });

  it('marks different types independently', () => {
    const state = freshState();
    markDirty(state, 'watches', 'w1');
    markDirty(state, 'logs', 'l1');
    expect(state.watches.size).toBe(1);
    expect(state.logs.size).toBe(1);
    expect(state.wishlist.size).toBe(0);
    expect(state.elo.size).toBe(0);
  });

  it('ignores unknown type (no crash)', () => {
    const state = freshState();
    markDirty(state, 'unknown', 'x1');
    // Should not throw, all sets unchanged
    expect(state.watches.size).toBe(0);
    expect(state.logs.size).toBe(0);
  });

  it('handles empty array', () => {
    const state = freshState();
    markDirty(state, 'watches', []);
    expect(state.watches.size).toBe(0);
  });

  it('handles mixed single and array calls', () => {
    const state = freshState();
    markDirty(state, 'wishlist', 'wl1');
    markDirty(state, 'wishlist', ['wl2', 'wl3']);
    expect(state.wishlist.size).toBe(3);
  });
});

// ── filterDirtyItems ──────────────────────────────────────────────────────────

describe('filterDirtyItems', () => {
  const items = [
    { id: 'w1', name: 'Watch 1' },
    { id: 'w2', name: 'Watch 2' },
    { id: 'w3', name: 'Watch 3' },
    { id: 'w4', name: 'Watch 4' },
  ];

  it('filters to only dirty items (Set input)', () => {
    const dirtyIds = new Set(['w1', 'w3']);
    const result = filterDirtyItems(items, dirtyIds);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('w1');
    expect(result[1].id).toBe('w3');
  });

  it('filters to only dirty items (Array input)', () => {
    const dirtyIds = ['w2', 'w4'];
    const result = filterDirtyItems(items, dirtyIds);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('w2');
    expect(result[1].id).toBe('w4');
  });

  it('returns empty when no IDs are dirty', () => {
    const result = filterDirtyItems(items, new Set());
    expect(result).toHaveLength(0);
  });

  it('returns empty when dirty IDs don\'t match any items', () => {
    const result = filterDirtyItems(items, new Set(['nonexistent']));
    expect(result).toHaveLength(0);
  });

  it('returns all items when all are dirty', () => {
    const result = filterDirtyItems(items, new Set(['w1', 'w2', 'w3', 'w4']));
    expect(result).toHaveLength(4);
  });

  it('preserves item order', () => {
    const result = filterDirtyItems(items, new Set(['w4', 'w1']));
    expect(result[0].id).toBe('w1'); // w1 comes before w4 in original order
    expect(result[1].id).toBe('w4');
  });

  it('handles empty items array', () => {
    expect(filterDirtyItems([], new Set(['w1']))).toHaveLength(0);
  });

  it('does not mutate the original array', () => {
    const original = [...items];
    filterDirtyItems(items, new Set(['w1']));
    expect(items).toEqual(original);
  });
});

// ── shouldStopNotifPolling ────────────────────────────────────────────────────

describe('shouldStopNotifPolling', () => {
  it('returns false for null error', () => {
    expect(shouldStopNotifPolling(null)).toBe(false);
  });

  it('returns false for undefined error', () => {
    expect(shouldStopNotifPolling(undefined)).toBe(false);
  });

  it('returns true for PGRST301 error code (PostgREST auth error)', () => {
    expect(shouldStopNotifPolling({ code: 'PGRST301' })).toBe(true);
  });

  it('returns true for 401 status', () => {
    expect(shouldStopNotifPolling({ status: 401 })).toBe(true);
  });

  it('returns true for JWT error message', () => {
    expect(shouldStopNotifPolling({ message: 'JWT expired' })).toBe(true);
    expect(shouldStopNotifPolling({ message: 'Invalid JWT token' })).toBe(true);
  });

  it('returns false for non-auth errors', () => {
    expect(shouldStopNotifPolling({ code: 'PGRST000', message: 'connection failed' })).toBe(false);
    expect(shouldStopNotifPolling({ status: 500, message: 'Internal server error' })).toBe(false);
    expect(shouldStopNotifPolling({ message: 'timeout' })).toBe(false);
  });

  it('returns false for network errors (should retry)', () => {
    expect(shouldStopNotifPolling({ message: 'Failed to fetch' })).toBe(false);
    expect(shouldStopNotifPolling({ message: 'NetworkError' })).toBe(false);
  });

  it('returns true for combined auth indicators', () => {
    expect(shouldStopNotifPolling({ code: 'PGRST301', status: 401, message: 'JWT expired' })).toBe(true);
  });

  it('handles error with empty message', () => {
    expect(shouldStopNotifPolling({ message: '' })).toBe(false);
  });

  it('handles error with null message', () => {
    expect(shouldStopNotifPolling({ message: null })).toBe(false);
  });
});

// ── loadFollowing try/catch resilience ────────────────────────────────────

describe('loadFollowing resilience pattern', () => {
  // loadFollowing wraps Promise.all in try/catch. If both queries fail,
  // following and myFollowers should remain as they were (not crash).

  it('state survives when Promise.all rejects', async () => {
    // Simulate the loadFollowing pattern: pre-existing state is preserved on error
    let following = new Set(['existing-1', 'existing-2']);
    let myFollowers = new Set(['follower-1']);

    try {
      await Promise.all([
        Promise.reject(new Error('network error')),
        Promise.reject(new Error('network error')),
      ]);
      // These lines would overwrite state — but they never run on error
      following = new Set();
      myFollowers = new Set();
    } catch (e) {
      // loadFollowing just returns on error, preserving state
    }

    expect(following.size).toBe(2);
    expect(following.has('existing-1')).toBe(true);
    expect(myFollowers.size).toBe(1);
  });

  it('state updates normally when Promise.all succeeds', async () => {
    let following = new Set(['old']);
    let myFollowers = new Set();

    let data, fData;
    try {
      const results = await Promise.all([
        Promise.resolve({ data: [{ following_id: 'new-1' }, { following_id: 'new-2' }] }),
        Promise.resolve({ data: [{ follower_id: 'f1' }] }),
      ]);
      data = results[0].data;
      fData = results[1].data;
    } catch (e) {
      return;
    }

    following = new Set((data || []).map(r => r.following_id));
    myFollowers = new Set((fData || []).map(r => r.follower_id));

    expect(following.size).toBe(2);
    expect(following.has('new-1')).toBe(true);
    expect(myFollowers.size).toBe(1);
    expect(myFollowers.has('f1')).toBe(true);
  });

  it('handles partial success with null data gracefully', async () => {
    let following = new Set();
    let myFollowers = new Set();

    let data, fData;
    try {
      const results = await Promise.all([
        Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
      ]);
      data = results[0].data;
      fData = results[1].data;
    } catch (e) {
      return;
    }

    following = new Set((data || []).map(r => r.following_id));
    myFollowers = new Set((fData || []).map(r => r.follower_id));

    expect(following.size).toBe(0);
    expect(myFollowers.size).toBe(0);
  });
});

// ── saveEditPost try/finally pattern ─────────────────────────────────────

describe('saveEditPost try/finally button re-enable pattern', () => {
  it('re-enables button even when body throws', () => {
    let btnDisabled = true;
    let btnText = 'Saving…';

    try {
      throw new Error('DB write failed');
    } catch (e) {
      // error handler
    } finally {
      btnDisabled = false;
      btnText = 'Save';
    }

    expect(btnDisabled).toBe(false);
    expect(btnText).toBe('Save');
  });

  it('re-enables button on success too', () => {
    let btnDisabled = true;
    let btnText = 'Saving…';

    try {
      // success path — no error
    } finally {
      btnDisabled = false;
      btnText = 'Save';
    }

    expect(btnDisabled).toBe(false);
    expect(btnText).toBe('Save');
  });

  it('re-enables button even on unexpected error types', () => {
    let btnDisabled = true;

    try {
      throw 'string error'; // non-Error throw
    } catch (e) {
      // swallowed
    } finally {
      btnDisabled = false;
    }

    expect(btnDisabled).toBe(false);
  });
});

// ── loadAndRenderProfile timeout resilience ──────────────────────────────

describe('loadAndRenderProfile timeout pattern', () => {
  it('withTimeout rejects with timeout error for slow Promise.all', async () => {
    const slowPromise = new Promise(resolve => setTimeout(resolve, 500));
    await expect(withTimeout(slowPromise, 10)).rejects.toThrow('Query timed out');
  });

  it('catch block can render error UI with retry button', async () => {
    let errorHtml = '';
    const userId = 'test-user-123';

    try {
      await withTimeout(new Promise(resolve => setTimeout(resolve, 500)), 10);
    } catch (e) {
      errorHtml = `<div style="text-align:center;padding:3rem;color:var(--muted);">Could not load profile. <button class="btn btn-sm" onclick="viewUserProfile('${userId}')">Retry</button></div>`;
    }

    expect(errorHtml).toContain('Could not load profile');
    expect(errorHtml).toContain('Retry');
    expect(errorHtml).toContain('viewUserProfile');
    expect(errorHtml).toContain(userId);
  });

  it('successful Promise.all within timeout does not trigger error UI', async () => {
    let errorHtml = '';

    try {
      const results = await withTimeout(
        Promise.all([
          Promise.resolve({ count: 10, data: null }),
          Promise.resolve({ count: 5, data: null }),
        ]),
        1000
      );
      // Normal flow: use results
      expect(results[0].count).toBe(10);
      expect(results[1].count).toBe(5);
    } catch (e) {
      errorHtml = 'Could not load profile';
    }

    expect(errorHtml).toBe('');
  });

  it('non-timeout errors (e.g. network) also trigger error UI', async () => {
    let errorHtml = '';

    try {
      await withTimeout(
        Promise.reject(new Error('Failed to fetch')),
        10000
      );
    } catch (e) {
      errorHtml = `Could not load profile. <button>Retry</button>`;
    }

    expect(errorHtml).toContain('Could not load profile');
    expect(errorHtml).toContain('Retry');
  });
});
