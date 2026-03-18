import { describe, it, expect } from 'vitest';
import { formatPriceString, parsePrice, fmtMoney } from '../wrotate_test.js';

describe('formatPriceString', () => {
  it('adds commas to thousands', () => {
    expect(formatPriceString('1234567')).toBe('1,234,567');
  });

  it('handles small numbers without commas', () => {
    expect(formatPriceString('999')).toBe('999');
  });

  it('handles exact thousands', () => {
    expect(formatPriceString('1000')).toBe('1,000');
  });

  it('preserves decimal portion', () => {
    expect(formatPriceString('1234.56')).toBe('1,234.56');
  });

  it('handles decimals with no integer commas needed', () => {
    expect(formatPriceString('123.45')).toBe('123.45');
  });

  it('strips non-numeric characters except dots', () => {
    expect(formatPriceString('$1,234,567')).toBe('1,234,567');
  });

  it('handles empty string', () => {
    expect(formatPriceString('')).toBe('');
  });

  it('handles already-formatted input (strips then re-formats)', () => {
    expect(formatPriceString('1,234,567')).toBe('1,234,567');
  });

  it('handles value with multiple dots (only first dot preserved by regex)', () => {
    // The regex strips everything except digits and dots, so "1.2.3" becomes "1.2.3"
    // but dotIdx finds the first dot: intPart="1", decPart=".2.3"
    const result = formatPriceString('1.2.3');
    expect(result).toBe('1.2.3');
  });

  it('handles leading zeros (preserves them as regex only adds commas)', () => {
    expect(formatPriceString('007500')).toBe('007,500');
  });
});

describe('parsePrice', () => {
  it('parses a plain number', () => {
    expect(parsePrice('1234')).toBe(1234);
  });

  it('strips commas and parses', () => {
    expect(parsePrice('1,234,567')).toBe(1234567);
  });

  it('handles decimals', () => {
    expect(parsePrice('1,234.56')).toBeCloseTo(1234.56);
  });

  it('returns 0 for empty string', () => {
    expect(parsePrice('')).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(parsePrice('abc')).toBe(0);
  });

  it('returns 0 for just commas', () => {
    expect(parsePrice(',,,,')).toBe(0);
  });
});

describe('fmtMoney', () => {
  it('formats a number with dollar sign', () => {
    expect(fmtMoney(1234)).toBe('$1,234');
  });

  it('formats large numbers with commas', () => {
    expect(fmtMoney(1234567)).toBe('$1,234,567');
  });

  it('returns dash for 0', () => {
    expect(fmtMoney(0)).toBe('—');
  });

  it('returns dash for null', () => {
    expect(fmtMoney(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(fmtMoney(undefined)).toBe('—');
  });

  it('handles small numbers', () => {
    expect(fmtMoney(5)).toBe('$5');
  });

  it('handles string number input', () => {
    expect(fmtMoney('6500')).toBe('$6,500');
  });
});
