// Collection simulation ("what-if", experiment collection_sim): temporarily mark
// collection watches as potential sales and pull wishlist watches in, then see the
// hypothetical collection and its value on one screen. Pure logic only — the state
// never touches the DB.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { simStateFromStore, simulatedCollection, simCollectionValue } from '../wrotate_test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('simStateFromStore', () => {
  it('normalises missing / corrupted state to empty lists', () => {
    expect(simStateFromStore(null)).toEqual({ hidden: [], added: [] });
    expect(simStateFromStore(undefined)).toEqual({ hidden: [], added: [] });
    expect(simStateFromStore('junk')).toEqual({ hidden: [], added: [] });
    expect(simStateFromStore({ hidden: 'a', added: 42 })).toEqual({ hidden: [], added: [] });
  });
  it('keeps valid ids and fills a missing key', () => {
    expect(simStateFromStore({ hidden: ['a', 'b'] })).toEqual({ hidden: ['a', 'b'], added: [] });
    expect(simStateFromStore({ added: ['w1'] })).toEqual({ hidden: [], added: ['w1'] });
  });
  it('drops junk entries and duplicates', () => {
    expect(simStateFromStore({ hidden: ['a', '', null, 7, 'a', 'b'], added: [{}, 'x'] }))
      .toEqual({ hidden: ['a', 'b'], added: ['x'] });
  });
});

describe('simulatedCollection', () => {
  const watches = [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }];
  const wishlist = [{ id: 'l1' }, { id: 'l2' }];
  it('splits kept vs selling by hidden ids and appends added wishlist items', () => {
    const r = simulatedCollection(watches, wishlist, { hidden: ['w2'], added: ['l1'] });
    expect(r.kept.map(w => w.id)).toEqual(['w1', 'w3']);
    expect(r.selling.map(w => w.id)).toEqual(['w2']);
    expect(r.added.map(w => w.id)).toEqual(['l1']);
    expect(r.list.map(w => w.id)).toEqual(['w1', 'w3', 'l1']);
  });
  it('ignores hidden/added ids that no longer exist (deleted watch, wishlist item moved)', () => {
    const r = simulatedCollection(watches, wishlist, { hidden: ['gone'], added: ['also-gone'] });
    expect(r.kept.length).toBe(3);
    expect(r.selling).toEqual([]);
    expect(r.added).toEqual([]);
  });
  it('handles null inputs and null rows', () => {
    const r = simulatedCollection(null, null, null);
    expect(r).toEqual({ kept: [], selling: [], added: [], list: [] });
    const r2 = simulatedCollection([null, { id: 'w1' }], [null], { hidden: [], added: [] });
    expect(r2.kept.map(w => w.id)).toEqual(['w1']);
  });
  it('handles a state with missing keys', () => {
    const r = simulatedCollection(watches, wishlist, {});
    expect(r.list.length).toBe(3);
  });
});

describe('simCollectionValue', () => {
  it('prefers market price, falls back to what was paid', () => {
    const v = simCollectionValue([
      { id: 'a', price: 5000, marketPrice: 6000 },  // market wins
      { id: 'b', price: 3000 },                     // falls back to paid
      { id: 'c', marketPrice: 800 },                // market only
    ]);
    expect(v.total).toBe(9800);
    expect(v.valuedCount).toBe(3);
    expect(v.unvaluedCount).toBe(0);
  });
  it('counts watches with no usable number as unvalued', () => {
    const v = simCollectionValue([
      { id: 'a', price: '', marketPrice: 'abc' },
      { id: 'b', price: 100, marketPrice: null },
    ]);
    expect(v.total).toBe(100);
    expect(v.valuedCount).toBe(1);
    expect(v.unvaluedCount).toBe(1);
  });
  it('accepts numeric strings (PostgREST numerics)', () => {
    expect(simCollectionValue([{ id: 'a', marketPrice: '150' }]).total).toBe(150);
    expect(simCollectionValue([{ id: 'a', price: '90' }]).total).toBe(90);
  });
  it('empty / null input and null rows', () => {
    expect(simCollectionValue([])).toEqual({ total: 0, valuedCount: 0, unvaluedCount: 0 });
    expect(simCollectionValue(null)).toEqual({ total: 0, valuedCount: 0, unvaluedCount: 0 });
    expect(simCollectionValue([null, { id: 'a', price: 10 }]).total).toBe(10);
  });
});

describe('collection_sim wiring in index.html', () => {
  it('gates the What-if entry point behind experiment("collection_sim")', () => {
    expect(html).toMatch(/experiment\('collection_sim'\)/);
  });
  it('logs a sim_opened feature_event, never in demo mode', () => {
    expect(html).toMatch(/function logSimOpened\(\) \{\s*(?:\/\/[^\n]*\n\s*)*if \(!currentUser \|\| _isDemoMode\) return;/);
    expect(html).toContain("db.from('feature_events').insert({ user_id: currentUser.id, event: 'sim_opened'");
  });
  it('scopes the persisted scenario to the signed-in user', () => {
    expect(html).toContain("function simKey() { return currentUser ? 'wr_sim_' + currentUser.id : null; }");
    // No un-scoped key anywhere.
    expect(html).not.toMatch(/safeLS\.(get|set)\('wr_sim'/);
  });
  it('exits share-selection when entering the simulation (two modes on one grid)', () => {
    expect(html).toMatch(/function enterCollectionSim\(\) \{[\s\S]*?exitCollectionSelect\(\)/);
  });
});
