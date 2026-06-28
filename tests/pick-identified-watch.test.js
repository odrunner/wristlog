import { describe, it, expect } from 'vitest';
import { pickIdentifiedWatch } from '../wrotate_test.js';

describe('pickIdentifiedWatch', () => {
  it('extracts brand/model/reference from a watches[] response', () => {
    const data = { watches: [{ brand: 'Rolex', model: 'Submariner Date', reference: '126610LN', estimatedColor: '#0b132b' }] };
    expect(pickIdentifiedWatch(data)).toEqual({
      brand: 'Rolex', model: 'Submariner Date', reference: '126610LN', color: '#0b132b',
    });
  });

  it('uses the first watch when several are returned', () => {
    const data = { watches: [{ brand: 'Omega', model: 'Speedmaster' }, { brand: 'Tudor', model: 'Black Bay' }] };
    expect(pickIdentifiedWatch(data).brand).toBe('Omega');
  });

  it('accepts a bare single-watch object (no watches[] wrapper)', () => {
    const data = { brand: 'Seiko', model: 'Presage', reference: 'SPB167' };
    expect(pickIdentifiedWatch(data)).toMatchObject({ brand: 'Seiko', model: 'Presage', reference: 'SPB167' });
  });

  it('falls back from model→name and reference→ref', () => {
    const data = { watches: [{ brand: 'Cartier', name: 'Tank', ref: 'WSTA0041' }] };
    expect(pickIdentifiedWatch(data)).toMatchObject({ brand: 'Cartier', model: 'Tank', reference: 'WSTA0041' });
  });

  it('trims whitespace and defaults missing fields to empty strings', () => {
    const data = { watches: [{ brand: '  Grand Seiko  ', model: '  Snowflake ' }] };
    expect(pickIdentifiedWatch(data)).toEqual({ brand: 'Grand Seiko', model: 'Snowflake', reference: '', color: '' });
  });

  it('treats a literal "Unknown" brand/model as empty (no junk prefill)', () => {
    // Real brand, unidentified model → keep the brand, drop the junk model.
    expect(pickIdentifiedWatch({ watches: [{ brand: 'Rolex', model: 'unknown', reference: '126610LN' }] }))
      .toEqual({ brand: 'Rolex', model: '', reference: '126610LN', color: '' });
    // Both unknown → unusable, even with a reference (modal needs brand + name).
    expect(pickIdentifiedWatch({ watches: [{ brand: 'Unknown', model: 'unknown', reference: '126610LN' }] }))
      .toBeNull();
  });

  it('returns null when there is no usable brand or model', () => {
    expect(pickIdentifiedWatch({ watches: [{ reference: '126610LN' }] })).toBeNull();
    expect(pickIdentifiedWatch({ watches: [] })).toBeNull();
    expect(pickIdentifiedWatch({})).toBeNull();
    expect(pickIdentifiedWatch(null)).toBeNull();
  });

  it('still returns a result when only one of brand/model is present', () => {
    expect(pickIdentifiedWatch({ watches: [{ brand: 'Patek Philippe' }] }))
      .toMatchObject({ brand: 'Patek Philippe', model: '' });
    expect(pickIdentifiedWatch({ watches: [{ model: 'Nautilus' }] }))
      .toMatchObject({ brand: '', model: 'Nautilus' });
  });
});
