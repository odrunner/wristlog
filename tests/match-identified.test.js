import { describe, it, expect } from 'vitest';
import { matchIdentifiedToCollection } from '../wrotate_test.js';

const collection = [
  { id: 'w1', brand: 'Rolex', name: 'Submariner Date', ref: '126610LN' },
  { id: 'w2', brand: 'Omega', name: 'Speedmaster Professional', ref: '310.30.42.50.01.001' },
  { id: 'w3', brand: 'Tudor', name: 'Black Bay Fifty-Eight', ref: '79030N' },
  { id: 'w4', brand: 'Seiko', name: 'Presage Sharp Edged', ref: 'SPB167' },
  { id: 'w5', brand: 'Rolex', name: 'Datejust 41', ref: '126334' },
];

describe('matchIdentifiedToCollection', () => {
  describe('Tier 1: reference match', () => {
    it('matches by exact reference number', () => {
      const identified = [{ brand: 'Rolex', model: 'Sub', reference: '126610LN' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w1');
      expect(results[0].matchType).toBe('reference');
      expect(results[0].confidence).toBe('high');
    });

    it('matches reference ignoring whitespace and hyphens', () => {
      // Ref with hyphens instead of dots — normalization strips spaces/hyphens only
      const watches = [
        { id: 'w1', brand: 'Omega', name: 'Speedmaster', ref: 'CK-2998' },
      ];
      const identified = [{ brand: 'Omega', model: 'Speedy', reference: 'CK 2998' }];
      const results = matchIdentifiedToCollection(identified, watches);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w1');
      expect(results[0].matchType).toBe('reference');
    });

    it('is case-insensitive for references', () => {
      const identified = [{ brand: 'Rolex', model: 'Sub', reference: '126610ln' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w1');
    });

    it('uses provided confidence level', () => {
      const identified = [{ brand: 'Rolex', model: 'Sub', reference: '126610LN', confidence: 'medium' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results[0].confidence).toBe('medium');
    });
  });

  describe('Tier 2: brand + model match', () => {
    it('matches when all identified model words are in the collection name', () => {
      const identified = [{ brand: 'Omega', model: 'Speedmaster Professional', reference: '' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w2');
      expect(results[0].matchType).toBe('brand+model');
    });

    it('matches when collection name words are a subset of identified model', () => {
      const identified = [{ brand: 'Tudor', model: 'Black Bay Fifty-Eight 39mm', reference: '' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w3');
    });

    it('does not match across different brands', () => {
      const identified = [{ brand: 'Casio', model: 'Submariner Date', reference: '' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(0);
    });

    it('is case-insensitive', () => {
      const identified = [{ brand: 'ROLEX', model: 'SUBMARINER DATE', reference: '' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w1');
    });
  });

  describe('Tier 2.5: dial text match', () => {
    it('matches when dial text contains brand and model words', () => {
      const identified = [{ brand: 'Seiko', model: '', reference: '', dialText: 'SEIKO Presage Sharp Edged Automatic' }];
      const results = matchIdentifiedToCollection(identified, collection);
      expect(results).toHaveLength(1);
      expect(results[0].watch.id).toBe('w4');
      expect(results[0].matchType).toBe('dial-text');
    });

    it('requires at least 2 matching words and 50% of name words', () => {
      // Use collection with 2 Seiko watches to prevent brand-only fallback
      const twoSeikos = [
        { id: 'w4', brand: 'Seiko', name: 'Presage Sharp Edged', ref: 'SPB167' },
        { id: 'w6', brand: 'Seiko', name: 'Prospex Alpinist', ref: 'SPB117' },
      ];
      const identified = [{ brand: 'Seiko', model: '', reference: '', dialText: 'SEIKO Quartz' }];
      const results = matchIdentifiedToCollection(identified, twoSeikos);
      // Only "seiko" matches → matchCount=1, below threshold of 2
      expect(results).toHaveLength(0);
    });
  });

  describe('Tier 3: brand-only match', () => {
    it('matches when exactly one watch of that brand exists', () => {
      const smallCollection = [
        { id: 'w1', brand: 'Grand Seiko', name: 'Snowflake', ref: 'SBGA211' },
      ];
      const identified = [{ brand: 'Grand Seiko', model: '', reference: '' }];
      const results = matchIdentifiedToCollection(identified, smallCollection);
      expect(results).toHaveLength(1);
      expect(results[0].matchType).toBe('brand-only');
      expect(results[0].confidence).toBe('low');
    });

    it('does not match when multiple watches of the brand exist', () => {
      const identified = [{ brand: 'Rolex', model: '', reference: '' }];
      const results = matchIdentifiedToCollection(identified, collection);
      // Two Rolex watches → no brand-only match
      expect(results).toHaveLength(0);
    });
  });

  describe('sorting', () => {
    it('sorts by match type then confidence', () => {
      const watches = [
        { id: 'w1', brand: 'Omega', name: 'Speedmaster', ref: '310.30' },
        { id: 'w2', brand: 'Omega', name: 'Seamaster', ref: '' },
      ];
      const identified = [
        { brand: 'Omega', model: 'Speedmaster', reference: '310.30', confidence: 'medium' },
        { brand: 'Omega', model: 'Seamaster', reference: '', confidence: 'high' },
      ];
      const results = matchIdentifiedToCollection(identified, watches);
      // Reference match should come first regardless of confidence
      expect(results[0].matchType).toBe('reference');
    });
  });

  describe('deduplication', () => {
    it('does not return the same watch twice', () => {
      const identified = [
        { brand: 'Rolex', model: 'Submariner', reference: '126610LN' },
        { brand: 'Rolex', model: 'Submariner Date', reference: '' },
      ];
      const results = matchIdentifiedToCollection(identified, collection);
      const ids = results.map(r => r.watch.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('edge cases', () => {
    it('returns empty for empty inputs', () => {
      expect(matchIdentifiedToCollection([], collection)).toEqual([]);
      expect(matchIdentifiedToCollection([{ brand: '', model: '', reference: '' }], [])).toEqual([]);
    });

    it('handles missing fields gracefully', () => {
      const identified = [{ brand: 'Rolex' }];
      const results = matchIdentifiedToCollection(identified, collection);
      // No model, no ref, 2 Rolex → no match
      expect(results).toHaveLength(0);
    });
  });
});
