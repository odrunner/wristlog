import { describe, it, expect } from 'vitest';
import { normalizeModelKey, modelSlug, factTeaser, MODEL_FILLER_TOKENS } from '../wrotate_test.js';

describe('normalizeModelKey', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalizeModelKey('  Rolex ', ' Submariner  Date ')).toBe('rolex submariner date');
  });
  it('strips punctuation to spaces (GMT-Master II == GMT Master II)', () => {
    expect(normalizeModelKey('Rolex', 'GMT-Master II')).toBe('rolex gmt master ii');
    expect(normalizeModelKey('Rolex', 'GMT Master II')).toBe('rolex gmt master ii');
  });
  it('drops filler tokens (Oyster Perpetual, Cosmograph)', () => {
    expect(normalizeModelKey('Rolex', 'Oyster Perpetual Datejust 41')).toBe('rolex datejust 41');
    expect(normalizeModelKey('Rolex', 'Cosmograph Daytona')).toBe('rolex daytona');
  });
  it('never strips numbers (Datejust 41 != Datejust 36)', () => {
    expect(normalizeModelKey('Rolex', 'Datejust 41')).not.toBe(normalizeModelKey('Rolex', 'Datejust 36'));
  });
  it('folds auto -> automatic, then drops automatic as filler', () => {
    expect(normalizeModelKey('Hamilton', 'Khaki Field Auto')).toBe('hamilton khaki field');
    expect(normalizeModelKey('Hamilton', 'Khaki Field Automatic')).toBe('hamilton khaki field');
    expect(normalizeModelKey('Hamilton', 'Khaki Field Mechanical')).toBe('hamilton khaki field mechanical');
  });
  it('de-dupes brand typed into the name field', () => {
    expect(normalizeModelKey('Rolex', 'Rolex Submariner')).toBe('rolex submariner');
  });
  it('keeps sibling lines separate', () => {
    expect(normalizeModelKey('Rolex', 'Submariner Date')).toBe('rolex submariner date');
    expect(normalizeModelKey('Rolex', 'Explorer II')).toBe('rolex explorer ii');
  });
  it('name that is only the brand collapses to brand key', () => {
    expect(normalizeModelKey('Rolex', 'Rolex')).toBe('rolex');
  });
  it('name that is only filler collapses to brand key', () => {
    expect(normalizeModelKey('Seiko', 'Automatic')).toBe('seiko');
  });
  it('empty/nullish inputs -> empty string', () => {
    expect(normalizeModelKey('', 'Submariner')).toBe('');
    expect(normalizeModelKey('Rolex', '')).toBe('');
    expect(normalizeModelKey(null, undefined)).toBe('');
  });
  it('exports the filler token list', () => {
    expect(MODEL_FILLER_TOKENS).toContain('oyster perpetual');
  });
});

describe('modelSlug', () => {
  it('is the key with dashes', () => {
    expect(modelSlug('Rolex', 'Oyster Perpetual Datejust 41')).toBe('rolex-datejust-41');
  });
  it('empty when key is empty', () => { expect(modelSlug('', '')).toBe(''); });
});

describe('factTeaser', () => {
  it('returns first sentence with ellipsis when more follows', () => {
    expect(factTeaser('It dove deep. It also flew high.')).toBe('It dove deep. …');
  });
  it('returns whole single-sentence fact unchanged', () => {
    expect(factTeaser('It dove deep.')).toBe('It dove deep.');
  });
  it('hard-caps overlong first sentences at max with ellipsis', () => {
    const long = 'A'.repeat(200) + '. More.';
    const t = factTeaser(long);
    expect(t.length).toBeLessThanOrEqual(140);
    expect(t.endsWith('…')).toBe(true);
  });
  it('handles no terminal punctuation and empty input', () => {
    expect(factTeaser('no period here')).toBe('no period here');
    expect(factTeaser('')).toBe('');
    expect(factTeaser(null)).toBe('');
  });
});
