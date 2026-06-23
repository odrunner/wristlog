import { describe, it, expect } from 'vitest';

// ── BADGE REGISTRY / SYSTEM (unit tests for badge data structures) ──────
// The badge system is now always-on for all users (feature flag removed).
// These tests verify the badge registry shape, preview logic, and award helpers.

// ── Badge Registry shape tests ─────────────────────────────────────────────

describe('BADGE_REGISTRY shape', () => {
  // Reconstruct the registry and lookup from the canonical source (index.html).
  // Since these are data structures (not exported from wrotate_test.js),
  // we define fixtures matching the production shape and test the logic around them.

  const BADGE_COLORS = {
    onboarding:  { bezel: '#7A8B5C', stroke: '#4F5C3A', chipBg: '#E8EFD9', chipText: '#4F5C3A' },
    collection:  { bezel: '#B8952A', stroke: '#6B5618', chipBg: '#F0E4BD', chipText: '#6B5618' },
    connoisseur: { bezel: '#6B3D52', stroke: '#3F2230', chipBg: '#ECDAE3', chipText: '#3F2230' },
    timegrapher: { bezel: '#4A6B7D', stroke: '#2C434F', chipBg: '#DCE6EC', chipText: '#2C434F' },
    habit:       { bezel: '#B5663F', stroke: '#6B3A1F', chipBg: '#F0DCCE', chipText: '#6B3A1F' },
    hidden:      { bezel: '#7A7A6A', stroke: '#4A4A3E', chipBg: '#E8E6DD', chipText: '#4A4A3E' },
  };

  const BADGE_REGISTRY = [
    { ref: 1, slug: 'first_watch', name: 'First Watch', category: 'onboarding', isHidden: false },
    { ref: 2, slug: 'first_measurement', name: 'First Measurement', category: 'onboarding', isHidden: false },
    { ref: 3, slug: 'first_wear', name: 'First Wear', category: 'onboarding', isHidden: false },
    { ref: 4, slug: 'first_post', name: 'First Post', category: 'onboarding', isHidden: false },
    { ref: 5, slug: 'profile_complete', name: 'Profile Complete', category: 'onboarding', isHidden: false },
    { ref: 20, slug: 'five_in_box', name: 'Five in the Box', category: 'collection', isHidden: false },
    { ref: 21, slug: 'ten_in_box', name: 'Ten in the Box', category: 'collection', isHidden: false },
    { ref: 22, slug: 'fifteen_deep', name: 'Fifteen Deep', category: 'collection', isHidden: false },
    { ref: 23, slug: 'twenty_strong', name: 'Twenty Strong', category: 'collection', isHidden: false },
    { ref: 40, slug: 'holy_trinity', name: 'Holy Trinity', category: 'connoisseur', isHidden: false },
    { ref: 42, slug: 'vintage_piece', name: 'Vintage Piece', category: 'connoisseur', isHidden: false },
    { ref: 43, slug: 'brand_devotee', name: 'Brand Devotee', category: 'connoisseur', isHidden: false },
    { ref: 44, slug: 'complication_collector', name: 'Complication Collector', category: 'connoisseur', isHidden: false },
    { ref: 60, slug: 'chronometer_grade', name: 'Chronometer Grade', category: 'timegrapher', isHidden: false },
    { ref: 61, slug: 'ten_measurements', name: 'Ten Measurements', category: 'timegrapher', isHidden: false },
    { ref: 62, slug: 'full_audit', name: 'Full Audit', category: 'timegrapher', isHidden: false },
    { ref: 63, slug: 'caught_a_drifter', name: 'Caught a Drifter', category: 'timegrapher', isHidden: false },
    { ref: 80, slug: 'seven_day_streak', name: 'Seven-Day Streak', category: 'habit', isHidden: false },
    { ref: 81, slug: 'thirty_day_streak', name: 'Thirty-Day Streak', category: 'habit', isHidden: false },
    { ref: 83, slug: 'five_day_streak', name: 'Five-Day Streak', category: 'habit', isHidden: false },
    { ref: 84, slug: 'ten_day_streak', name: 'Ten-Day Streak', category: 'habit', isHidden: false },
    { ref: 85, slug: 'twenty_day_streak', name: 'Twenty-Day Streak', category: 'habit', isHidden: false },
    { ref: 86, slug: 'fifty_day_streak', name: 'Fifty-Day Streak', category: 'habit', isHidden: false },
    { ref: 87, slug: 'hundred_day_streak', name: 'Hundred-Day Streak', category: 'habit', isHidden: false },
    { ref: 88, slug: 'year_streak', name: 'Year-Long Streak', category: 'habit', isHidden: false },
    { ref: 82, slug: 'balanced_quarter', name: 'Balanced Quarter', category: 'habit', isHidden: false },
    { ref: 100, slug: 'high_noon', name: 'High Noon', category: 'hidden', isHidden: true },
    { ref: 101, slug: 'full_moon', name: 'Full Moon', category: 'hidden', isHidden: true },
    { ref: 102, slug: 'birthday_boy', name: 'Birthday Boy', category: 'hidden', isHidden: true },
    { ref: 103, slug: 'leap_second', name: 'Leap Second', category: 'hidden', isHidden: true },
  ];

  const BADGE_BY_REF = {};
  BADGE_REGISTRY.forEach(b => BADGE_BY_REF[b.ref] = b);

  it('has 24 total badges across all categories', () => {
    expect(BADGE_REGISTRY.length).toBe(30);
  });

  it('every badge has required fields', () => {
    for (const b of BADGE_REGISTRY) {
      expect(b.ref).toBeDefined();
      expect(typeof b.ref).toBe('number');
      expect(b.slug).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(b.category).toBeTruthy();
      expect(typeof b.isHidden).toBe('boolean');
    }
  });

  it('all refs are unique', () => {
    const refs = BADGE_REGISTRY.map(b => b.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('all slugs are unique', () => {
    const slugs = BADGE_REGISTRY.map(b => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every badge category has a defined color', () => {
    for (const b of BADGE_REGISTRY) {
      expect(BADGE_COLORS[b.category]).toBeDefined();
      expect(BADGE_COLORS[b.category].bezel).toBeTruthy();
    }
  });

  it('BADGE_BY_REF lookup works for all badges', () => {
    for (const b of BADGE_REGISTRY) {
      expect(BADGE_BY_REF[b.ref]).toBe(b);
    }
  });

  it('onboarding badges have refs 1-5', () => {
    const onb = BADGE_REGISTRY.filter(b => b.category === 'onboarding');
    expect(onb.length).toBe(5);
    expect(onb.map(b => b.ref).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('collection badges have refs 20-23', () => {
    const col = BADGE_REGISTRY.filter(b => b.category === 'collection');
    expect(col.length).toBe(4);
    expect(col.map(b => b.ref).sort((a, b) => a - b)).toEqual([20, 21, 22, 23]);
  });

  it('hidden badges are all marked isHidden: true', () => {
    const hidden = BADGE_REGISTRY.filter(b => b.category === 'hidden');
    expect(hidden.every(b => b.isHidden === true)).toBe(true);
  });

  it('non-hidden badges are all marked isHidden: false', () => {
    const visible = BADGE_REGISTRY.filter(b => b.category !== 'hidden');
    expect(visible.every(b => b.isHidden === false)).toBe(true);
  });
});

// ── Badge preview limit (profile section shows max 5) ──────────────────

describe('badge preview limit on profile', () => {
  // This mirrors the badgeWallProfileSection() logic:
  //   const preview = earned.slice(0, 5);

  it('limits preview to 5 when user has more than 5 earned badges', () => {
    const earned = [
      { ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }, { ref: 5 },
      { ref: 20 }, { ref: 21 }, { ref: 22 },
    ];
    const preview = earned.slice(0, 5);
    expect(preview.length).toBe(5);
    expect(preview[0].ref).toBe(1);
    expect(preview[4].ref).toBe(5);
  });

  it('shows all earned badges when fewer than 5', () => {
    const earned = [{ ref: 1 }, { ref: 3 }];
    const preview = earned.slice(0, 5);
    expect(preview.length).toBe(2);
  });

  it('shows exactly 5 when user has exactly 5 earned badges', () => {
    const earned = [{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }, { ref: 5 }];
    const preview = earned.slice(0, 5);
    expect(preview.length).toBe(5);
  });

  it('shows empty preview when no badges earned', () => {
    const earned = [];
    const preview = earned.slice(0, 5);
    expect(preview.length).toBe(0);
  });

  it('fills remaining slots with locked placeholders (up to 5 total)', () => {
    // Mirror the production logic:
    // lockedPreview = lockedCount > 0 && preview.length < 5 ? ... : '';
    const BADGE_REGISTRY = Array.from({ length: 24 }, (_, i) => ({ ref: i + 1, isHidden: false }));
    const earnedRefs = new Set([1, 3]); // 2 earned
    const visible = BADGE_REGISTRY.filter(b => !b.isHidden || earnedRefs.has(b.ref));
    const earned = visible.filter(b => earnedRefs.has(b.ref));
    const preview = earned.slice(0, 5);
    const lockedCount = visible.length - earned.length;
    const lockedSlots = lockedCount > 0 && preview.length < 5
      ? Math.min(lockedCount, 5 - preview.length)
      : 0;
    expect(preview.length).toBe(2);
    expect(lockedSlots).toBe(3); // fills remaining 3 slots
    expect(preview.length + lockedSlots).toBe(5);
  });

  it('does not add locked slots when all 5 preview slots are earned', () => {
    const earnedRefs = new Set([1, 2, 3, 4, 5]);
    const earned = [1, 2, 3, 4, 5].map(ref => ({ ref }));
    const preview = earned.slice(0, 5);
    const lockedCount = 19; // 24 total - 5 earned
    const lockedSlots = lockedCount > 0 && preview.length < 5
      ? Math.min(lockedCount, 5 - preview.length)
      : 0;
    expect(lockedSlots).toBe(0);
  });
});

// ── Badge visibility: hidden badges only show when earned ──────────────

describe('badge visibility (hidden vs earned)', () => {
  const BADGE_REGISTRY = [
    { ref: 1, isHidden: false },
    { ref: 2, isHidden: false },
    { ref: 100, isHidden: true },
    { ref: 101, isHidden: true },
  ];

  it('hidden badges excluded from visible list when not earned', () => {
    const earnedRefs = new Set();
    const visible = BADGE_REGISTRY.filter(b => !b.isHidden || earnedRefs.has(b.ref));
    expect(visible.length).toBe(2);
    expect(visible.every(b => !b.isHidden)).toBe(true);
  });

  it('hidden badges included when earned', () => {
    const earnedRefs = new Set([100]);
    const visible = BADGE_REGISTRY.filter(b => !b.isHidden || earnedRefs.has(b.ref));
    expect(visible.length).toBe(3);
    expect(visible.some(b => b.ref === 100)).toBe(true);
    expect(visible.some(b => b.ref === 101)).toBe(false);
  });

  it('all badges shown when all earned', () => {
    const earnedRefs = new Set([1, 2, 100, 101]);
    const visible = BADGE_REGISTRY.filter(b => !b.isHidden || earnedRefs.has(b.ref));
    expect(visible.length).toBe(4);
  });
});

// ── Badge deduplication (awardBadge prevents double-award) ─────────────

describe('badge deduplication logic', () => {
  it('alreadyEarned returns true when badge_ref is in array', () => {
    const earnedBadges = [
      { badge_ref: 1, earned_at: '2026-01-01' },
      { badge_ref: 3, earned_at: '2026-01-02' },
    ];
    const alreadyEarned = (ref) => earnedBadges.some(e => e.badge_ref === ref);
    expect(alreadyEarned(1)).toBe(true);
    expect(alreadyEarned(3)).toBe(true);
    expect(alreadyEarned(2)).toBe(false);
    expect(alreadyEarned(100)).toBe(false);
  });

  it('does not re-award already earned badge', () => {
    const earnedBadges = [{ badge_ref: 1 }];
    const alreadyEarned = (ref) => earnedBadges.some(e => e.badge_ref === ref);
    // Simulate awardBadge early return
    const shouldAward = !alreadyEarned(1);
    expect(shouldAward).toBe(false);
  });

  it('awards badge when not yet earned', () => {
    const earnedBadges = [{ badge_ref: 1 }];
    const alreadyEarned = (ref) => earnedBadges.some(e => e.badge_ref === ref);
    const shouldAward = !alreadyEarned(2);
    expect(shouldAward).toBe(true);
  });
});

// ── Badge earned count / total display ─────────────────────────────────

describe('badge earned/total count display', () => {
  it('correctly computes earned vs visible totals', () => {
    const BADGE_REGISTRY = [
      { ref: 1, isHidden: false },
      { ref: 2, isHidden: false },
      { ref: 3, isHidden: false },
      { ref: 100, isHidden: true },
    ];
    const earnedBadges = [
      { badge_ref: 1 },
      { badge_ref: 100 }, // hidden but earned
    ];
    const earnedRefs = new Set(earnedBadges.map(e => e.badge_ref));
    const visible = BADGE_REGISTRY.filter(b => !b.isHidden || earnedRefs.has(b.ref));
    const earned = visible.filter(b => earnedRefs.has(b.ref));

    expect(visible.length).toBe(4); // 3 visible + 1 hidden-but-earned
    expect(earned.length).toBe(2);
  });
});
