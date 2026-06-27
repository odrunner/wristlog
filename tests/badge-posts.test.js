import { describe, it, expect } from 'vitest';
import { badgePostPlan } from '../wrotate_test.js';

const B = (ref, category, isHidden = false) => ({ ref, category, isHidden, name: 'X', flavor: 'y' });

describe('badgePostPlan', () => {
  it('excludes onboarding and hidden badges', () => {
    const r = badgePostPlan([B(1, 'onboarding'), B(2, 'habit'), B(3, 'collection', true)], 'watch', null);
    expect(r.standalone).toEqual([2]); expect(r.inline).toEqual([]);
  });
  it('retroactive context → nothing', () => {
    expect(badgePostPlan([B(2, 'habit')], 'retroactive', null)).toEqual({ inline: [], standalone: [] });
  });
  it('with postId → inline', () => {
    expect(badgePostPlan([B(2, 'habit'), B(4, 'timegrapher')], 'wear', 'log-1'))
      .toEqual({ inline: [2, 4], standalone: [] });
  });
  it('without postId → standalone', () => {
    expect(badgePostPlan([B(2, 'habit')], 'watch', null)).toEqual({ inline: [], standalone: [2] });
  });
  it('no notable badges → empty', () => {
    expect(badgePostPlan([B(1, 'onboarding')], 'wear', 'log-1')).toEqual({ inline: [], standalone: [] });
  });
  it('empty / null input → empty', () => {
    expect(badgePostPlan([], 'wear', 'log-1')).toEqual({ inline: [], standalone: [] });
    expect(badgePostPlan(null, 'watch', null)).toEqual({ inline: [], standalone: [] });
  });
});
