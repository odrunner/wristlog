import { describe, it, expect } from 'vitest';
import { streakChipState } from '../wrotate_test.js';

describe('streakChipState', () => {
  it('flag off → hidden regardless of streak', () => {
    expect(streakChipState({ current: 12, best: 12, status: 'active' }, false).visible).toBe(false);
  });
  it('active → bright chip with count', () => {
    expect(streakChipState({ current: 12, best: 20, status: 'active' }, true))
      .toEqual({ visible: true, count: 12, dim: false, atRisk: false, invite: false });
  });
  it('at_risk → dim/amber chip with count', () => {
    expect(streakChipState({ current: 12, best: 20, status: 'at_risk' }, true))
      .toEqual({ visible: true, count: 12, dim: true, atRisk: true, invite: false });
  });
  it('none but has logged before → dim invite, no number', () => {
    expect(streakChipState({ current: 0, best: 5, status: 'none' }, true))
      .toEqual({ visible: true, count: null, dim: true, atRisk: false, invite: true });
  });
  it('never logged → hidden', () => {
    expect(streakChipState({ current: 0, best: 0, status: 'none' }, true).visible).toBe(false);
  });
  it('null streak → hidden', () => {
    expect(streakChipState(null, true).visible).toBe(false);
  });
});
