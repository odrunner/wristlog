// Suggested follows (A/B follow_suggest, 2026-09-13): reason copy and the Feed-card gate.
import { describe, it, expect } from 'vitest';
import { followSuggestReason, followSuggestVisible } from '../wrotate_test.js';
describe('followSuggestReason', () => {
  it('same model names the watch, falls back when the model has no name', () => {
    expect(followSuggestReason({ reason: 'same_model', model_brand: 'Omega', model_name: 'Speedmaster' })).toBe('Also owns the Omega Speedmaster');
    expect(followSuggestReason({ reason: 'same_model', model_brand: 'Omega', model_name: null })).toBe('Also owns the Omega');
    expect(followSuggestReason({ reason: 'same_model', model_brand: null, model_name: '' })).toBe('Owns the same watch');
  });
  it('likes and followers pluralise, numeric strings from PostgREST are fine', () => {
    expect(followSuggestReason({ reason: 'liked', likes: 1 })).toBe('1 like this month');
    expect(followSuggestReason({ reason: 'liked', likes: '7' })).toBe('7 likes this month');
    expect(followSuggestReason({ reason: 'followed', followers: '1' })).toBe('Followed by 1 member');
    expect(followSuggestReason({ reason: 'followed', followers: 4 })).toBe('Followed by 4 members');
  });
  it('unknown or missing reason → empty', () => {
    expect(followSuggestReason({ reason: 'x' })).toBe('');
    expect(followSuggestReason(null)).toBe('');
  });
});
describe('followSuggestVisible', () => {
  const now = 1_800_000_000_000;
  const ok = { variant: 'treatment', count: 3, followingCount: 2, dismissedAt: 0, now };
  it('treatment with people to show', () => { expect(followSuggestVisible(ok)).toBe(true); });
  it('never for control, never when empty', () => {
    expect(followSuggestVisible({ ...ok, variant: 'control' })).toBe(false);
    expect(followSuggestVisible({ ...ok, count: 0 })).toBe(false);
  });
  it('stops once the user follows 10 people', () => {
    expect(followSuggestVisible({ ...ok, followingCount: 9 })).toBe(true);
    expect(followSuggestVisible({ ...ok, followingCount: 10 })).toBe(false);
  });
  it('dismiss hides it for 14 days, then it may return', () => {
    expect(followSuggestVisible({ ...ok, dismissedAt: now - 13 * 86400000 })).toBe(false);
    expect(followSuggestVisible({ ...ok, dismissedAt: now - 15 * 86400000 })).toBe(true);
  });
});
