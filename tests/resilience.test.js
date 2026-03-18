import { describe, it, expect } from 'vitest';
import {
  safeParseJSON,
  markDirty,
  filterDirtyItems,
  shouldStopNotifPolling,
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
