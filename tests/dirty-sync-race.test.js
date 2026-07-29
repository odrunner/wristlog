import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { syncedIds } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Regression (@chrisdd, 2026-07-29 06:20 UTC): cloudSync snapshots the dirty
// ids, builds the payload, awaits the upsert, then deletes those ids on
// success. attachFunFact resolved DURING that await, set factId and re-marked
// the same log dirty — and the completing sync cleared the id anyway, dropping
// fact_id on the floor. His fact cursor advanced but his post never got a fact.
describe('syncedIds', () => {
  it('clears ids whose version is unchanged since the payload was built', () => {
    const snapshot = new Map([['a', 1], ['b', 2]]);
    const versions = new Map([['a', 1], ['b', 2]]);
    expect(syncedIds(snapshot, versions).sort()).toEqual(['a', 'b']);
  });

  it('keeps an id that was re-marked while the write was in flight', () => {
    const snapshot = new Map([['log1', 1]]);
    const versions = new Map([['log1', 2]]); // attachFunFact bumped it mid-flight
    expect(syncedIds(snapshot, versions)).toEqual([]);
  });

  it('clears only the untouched ids when a batch is partially re-marked', () => {
    const snapshot = new Map([['a', 1], ['b', 1], ['c', 1]]);
    const versions = new Map([['a', 1], ['b', 3], ['c', 1]]);
    expect(syncedIds(snapshot, versions).sort()).toEqual(['a', 'c']);
  });

  it('treats a missing version as 0 so ids restored from localStorage still clear', () => {
    const snapshot = new Map([['restored', 0]]);
    expect(syncedIds(snapshot, new Map())).toEqual(['restored']);
  });

  it('returns nothing for an empty snapshot', () => {
    expect(syncedIds(new Map(), new Map([['a', 1]]))).toEqual([]);
  });
});

describe('cloudSync wiring', () => {
  it('markDirty bumps a per-id version', () => {
    const i = html.indexOf('function markDirty(');
    expect(i).toBeGreaterThan(-1);
    expect(html.slice(i, i + 400)).toMatch(/_dirtyVer/);
  });

  it('every dirty type clears through syncedIds, not a blind delete-by-id', () => {
    const i = html.indexOf('async function cloudSync(');
    const j = html.indexOf('APP_VERSION', i);
    const body = html.slice(i, j);
    for (const type of ['watches', 'logs', 'wishlist', 'elo']) {
      expect(body, `${type} must clear via clearSynced`).toContain(`clearSynced('${type}'`);
      expect(body, `${type} must snapshot versions before the upsert`)
        .toContain(`snapDirty('${type}'`);
    }
    // The old unconditional clear must be gone for all four.
    expect(body).not.toMatch(/ids\.forEach\(id => _dirty\.\w+\.delete\(id\)\)/);
  });
});
