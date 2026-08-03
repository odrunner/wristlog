import { describe, it, expect } from 'vitest';
import { eligiblePromoSlots } from '../wrotate_test.js';

const NOW = Date.parse('2026-08-02T12:00:00Z');
const CFG = {
  enabled: true, first_position: 2, repeat_every: 0, max_per_session: 1,
  default_max_impressions: 3, suppress_after_modal: true,
};
const CTX = { wearCount: 0, wishlistCount: 0, followingCount: 0, clubCount: 0, measureCount: 0, rankedEver: false, isIos: true };
const slot = (o = {}) => ({
  id: 's1', heading: 'H', audience: 'all', priority: 0, status: 'active',
  starts_at: null, ends_at: null, max_impressions: null,
  created_at: '2026-01-01T00:00:00Z', ...o,
});
const run = (o = {}) => eligiblePromoSlots({
  slots: [slot()], config: CFG, ctx: CTX, events: [], now: NOW, modalShown: false, ...o,
});

describe('eligiblePromoSlots', () => {
  it('returns an eligible slot', () => {
    expect(run().map((s) => s.id)).toEqual(['s1']);
  });

  // The admin's own account matches BOTH the user SELECT policy and the
  // is_admin "for all" policy, and RLS policies OR together — so select('*')
  // hands the owner every row, drafts and archives included. status is the one
  // field the client used to trust RLS to have filtered, which meant the admin
  // published every draft to their own feed and archiving never removed a card.
  // The filter is here rather than only in the query so it holds whatever the
  // caller was handed.
  it('excludes a draft slot even when RLS handed it to us', () => {
    expect(run({ slots: [slot({ status: 'draft' })] })).toEqual([]);
  });

  it('excludes an archived slot even when RLS handed it to us', () => {
    expect(run({ slots: [slot({ status: 'archived' })] })).toEqual([]);
  });

  it('excludes a slot with no status at all', () => {
    expect(run({ slots: [slot({ status: undefined })] })).toEqual([]);
  });

  it('includes an active slot alongside a draft and an archived one', () => {
    const out = run({ slots: [
      slot({ id: 'd', status: 'draft' }),
      slot({ id: 'a', status: 'active' }),
      slot({ id: 'z', status: 'archived' }),
    ] });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('returns nothing when the feature is disabled', () => {
    expect(run({ config: { ...CFG, enabled: false } })).toEqual([]);
  });

  it('returns nothing when a modal already fired and suppression is on', () => {
    expect(run({ modalShown: true })).toEqual([]);
  });

  it('still returns a slot after a modal when suppression is off', () => {
    expect(run({ modalShown: true, config: { ...CFG, suppress_after_modal: false } })).toHaveLength(1);
  });

  it('excludes a slot whose window has not opened', () => {
    expect(run({ slots: [slot({ starts_at: '2026-09-01T00:00:00Z' })] })).toEqual([]);
  });

  it('excludes a slot whose window has closed', () => {
    expect(run({ slots: [slot({ ends_at: '2026-07-01T00:00:00Z' })] })).toEqual([]);
  });

  it('includes a slot inside its window', () => {
    expect(run({ slots: [slot({ starts_at: '2026-08-01T00:00:00Z', ends_at: '2026-08-03T00:00:00Z' })] })).toHaveLength(1);
  });

  it('excludes a slot whose audience does not match', () => {
    expect(run({ slots: [slot({ audience: 'never_logged' })], ctx: { ...CTX, wearCount: 5 } })).toEqual([]);
  });

  it('excludes a slot with an unknown audience key', () => {
    expect(run({ slots: [slot({ audience: 'typo' })] })).toEqual([]);
  });

  it('excludes a dismissed slot', () => {
    expect(run({ events: [{ slot_id: 's1', event: 'dismiss' }] })).toEqual([]);
  });

  it('excludes a slot at the default impression cap', () => {
    const seen = [1, 2, 3].map(() => ({ slot_id: 's1', event: 'impression' }));
    expect(run({ events: seen })).toEqual([]);
  });

  it('still includes a slot one impression below the cap', () => {
    const seen = [1, 2].map(() => ({ slot_id: 's1', event: 'impression' }));
    expect(run({ events: seen })).toHaveLength(1);
  });

  it('honours a per-slot cap over the config default', () => {
    expect(run({ slots: [slot({ max_impressions: 1 })], events: [{ slot_id: 's1', event: 'impression' }] })).toEqual([]);
  });

  it('ignores clicks and dismissals of OTHER slots when counting impressions', () => {
    expect(run({ events: [{ slot_id: 'other', event: 'impression' }, { slot_id: 's1', event: 'click' }] })).toHaveLength(1);
  });

  it('sorts by priority descending', () => {
    const out = run({ slots: [slot({ id: 'lo', priority: 1 }), slot({ id: 'hi', priority: 9 })] });
    expect(out.map((s) => s.id)).toEqual(['hi', 'lo']);
  });

  it('breaks a priority tie with the newer slot first', () => {
    const out = run({ slots: [
      slot({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      slot({ id: 'new', created_at: '2026-06-01T00:00:00Z' }),
    ] });
    expect(out.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('tolerates missing slots, events and config without throwing', () => {
    expect(eligiblePromoSlots({ slots: null, config: null, ctx: CTX, events: null, now: NOW, modalShown: false })).toEqual([]);
  });
});
