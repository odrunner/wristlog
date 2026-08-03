import { describe, it, expect } from 'vitest';
import { PROMO_AUDIENCES, promoAudienceMatches } from '../wrotate_test.js';

// A fully-engaged user: every audience below should reject them except `all`.
const FULL = {
  watchCount: 5, wearCount: 40, wishlistCount: 3, followingCount: 9,
  measureCount: 7, clubCount: 2, rankedEver: true, daysSinceSignup: 90, isIos: true,
};

describe('promoAudienceMatches', () => {
  it('matches everyone for `all`', () => {
    expect(promoAudienceMatches('all', FULL)).toBe(true);
    expect(promoAudienceMatches('all', { ...FULL, watchCount: 0 })).toBe(true);
  });

  it('returns false for an unknown key — a typo hides the card, never shows it to everyone', () => {
    expect(promoAudienceMatches('nope', FULL)).toBe(false);
    expect(promoAudienceMatches('', FULL)).toBe(false);
    expect(promoAudienceMatches(undefined, FULL)).toBe(false);
  });

  it('rejects a fully-engaged user for every targeted audience', () => {
    for (const key of Object.keys(PROMO_AUDIENCES)) {
      if (key === 'all') continue;
      expect(promoAudienceMatches(key, FULL), `${key} should not match a fully-engaged user`).toBe(false);
    }
  });

  it('never_logged targets people with no wears', () => {
    expect(promoAudienceMatches('never_logged', { ...FULL, wearCount: 0 })).toBe(true);
    expect(promoAudienceMatches('never_logged', { ...FULL, wearCount: 1 })).toBe(false);
  });

  it('no_wishlist targets an empty wishlist', () => {
    expect(promoAudienceMatches('no_wishlist', { ...FULL, wishlistCount: 0 })).toBe(true);
  });

  it('never_measured only targets iOS — Measure is hidden on web, so the CTA would be dead', () => {
    expect(promoAudienceMatches('never_measured', { ...FULL, measureCount: 0, isIos: true })).toBe(true);
    expect(promoAudienceMatches('never_measured', { ...FULL, measureCount: 0, isIos: false })).toBe(false);
  });

  it('no_clubs targets people in no club', () => {
    expect(promoAudienceMatches('no_clubs', { ...FULL, clubCount: 0 })).toBe(true);
  });

  it('follows_few targets fewer than 3 follows, at the boundary', () => {
    expect(promoAudienceMatches('follows_few', { ...FULL, followingCount: 2 })).toBe(true);
    expect(promoAudienceMatches('follows_few', { ...FULL, followingCount: 3 })).toBe(false);
  });

  it('never_ranked targets people who never played the ranking game', () => {
    expect(promoAudienceMatches('never_ranked', { ...FULL, rankedEver: false })).toBe(true);
  });

  it('treats missing ctx fields as zero rather than throwing', () => {
    expect(promoAudienceMatches('never_logged', {})).toBe(true);
    expect(promoAudienceMatches('no_wishlist', {})).toBe(true);
  });
});
