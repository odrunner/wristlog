import { describe, it, expect } from 'vitest';
import { addDaysStr } from '../wrotate_test.js';

describe('addDaysStr', () => {
  it('subtracts a day', () => expect(addDaysStr('2026-06-22', -1)).toBe('2026-06-21'));
  it('adds a day', () => expect(addDaysStr('2026-06-22', 1)).toBe('2026-06-23'));
  it('crosses a month boundary backward', () => expect(addDaysStr('2026-06-01', -1)).toBe('2026-05-31'));
  it('crosses a year boundary backward', () => expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31'));
});
