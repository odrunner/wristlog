import { describe, it, expect } from 'vitest';
import { cleanBrandList } from '../wrotate_test.js';

describe('cleanBrandList', () => {
  it('drops "<brand> <colour>" junk when the bare brand is present', () => {
    // The reported mess: "Rolex blue" sitting next to "Rolex".
    const out = cleanBrandList(['Rolex', 'Rolex blue', 'Omega', 'Tudor', 'Tudor black']);
    expect(out).toEqual(['Omega', 'Rolex', 'Tudor']);
  });

  it('keeps a colour-suffixed name when its bare brand is NOT listed', () => {
    // Don't guess: without an anchor brand, leave the entry alone.
    const out = cleanBrandList(['Rolex blue', 'Omega']);
    expect(out).toEqual(['Omega', 'Rolex blue']);
  });

  it('merges case-insensitive duplicates, preferring an uppercase-initial label', () => {
    expect(cleanBrandList(['rolex', 'Rolex', 'ROLEX'])).toEqual(['Rolex']);
    expect(cleanBrandList(['rolex'])).toEqual(['rolex']);
  });

  it('trims and collapses whitespace, dropping blanks and nullish entries', () => {
    const out = cleanBrandList(['  Omega  ', 'Grand   Seiko', '', '   ', null, undefined]);
    expect(out).toEqual(['Grand Seiko', 'Omega']);
  });

  it('does not treat a non-colour second word as junk', () => {
    // "Seiko" is present but "Grand" isn't a colour → keep both.
    const out = cleanBrandList(['Seiko', 'Grand Seiko']);
    expect(out).toEqual(['Grand Seiko', 'Seiko']);
  });

  it('sorts case-insensitively and handles empty input', () => {
    expect(cleanBrandList(['zenith', 'Apple', 'Breitling'])).toEqual(['Apple', 'Breitling', 'zenith']);
    expect(cleanBrandList([])).toEqual([]);
    expect(cleanBrandList(null)).toEqual([]);
  });
});
