import { describe, it, expect } from 'vitest';
import { sanitizeSearch } from '../wrotate_test.js';

describe('sanitizeSearch', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeSearch(null)).toBe('');
    expect(sanitizeSearch(undefined)).toBe('');
    expect(sanitizeSearch('')).toBe('');
  });

  it('passes through normal text', () => {
    expect(sanitizeSearch('Rolex Submariner')).toBe('Rolex Submariner');
  });

  it('strips SQL wildcards', () => {
    expect(sanitizeSearch('%admin%')).toBe('admin');
    expect(sanitizeSearch('test_user')).toBe('testuser');
  });

  it('strips parentheses', () => {
    expect(sanitizeSearch('watch (blue)')).toBe('watch blue');
  });

  it('strips dots, asterisks, and backslashes', () => {
    expect(sanitizeSearch('a.*b')).toBe('ab');
    expect(sanitizeSearch('path\\to')).toBe('pathto');
  });

  it('strips commas', () => {
    expect(sanitizeSearch('brand, model')).toBe('brand model');
  });

  it('trims whitespace', () => {
    expect(sanitizeSearch('  hello  ')).toBe('hello');
  });

  it('handles a string of only special characters', () => {
    expect(sanitizeSearch('%_().*\\')).toBe('');
  });
});
