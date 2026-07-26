import { describe, it, expect } from 'vitest';
import { badgeRevealNames } from '../wrotate_test.js';

// ── Badge reveal names line ──────────────────────────────────────────────────
// 2026-07-25 audit #13: the modal rendered 8 medallions but every name, so the
// retroactive first batch (most earned badges were never marked seen) read
// "15 badges unlocked" over 8 medallions and 15 names in a 340px dialog.
describe('badgeRevealNames', () => {
  const names = (n) => Array.from({ length: n }, (_, i) => `Badge ${i + 1}`);

  it('lists every name when at or under the cap', () => {
    expect(badgeRevealNames(names(1))).toBe('Badge 1');
    expect(badgeRevealNames(names(3))).toBe('Badge 1 · Badge 2 · Badge 3');
    expect(badgeRevealNames(names(8))).toBe(names(8).join(' · '));
  });

  it('caps past the limit and says how many are left', () => {
    expect(badgeRevealNames(names(9))).toBe(names(8).join(' · ') + ' · and 1 more');
    expect(badgeRevealNames(names(15))).toBe(names(8).join(' · ') + ' · and 7 more');
  });

  it('never lists more names than medallions shown', () => {
    // The invariant the finding was about: name count <= shown count, always.
    for (const n of [1, 5, 8, 9, 20, 100]) {
      const shownNames = badgeRevealNames(names(n)).split(' · ')
        .filter((s) => !s.startsWith('and '));
      expect(shownNames.length).toBeLessThanOrEqual(8);
    }
  });

  it('honours a custom cap', () => {
    expect(badgeRevealNames(names(4), 2)).toBe('Badge 1 · Badge 2 · and 2 more');
    expect(badgeRevealNames(names(2), 2)).toBe('Badge 1 · Badge 2');
  });

  it('is safe on empty and malformed input', () => {
    expect(badgeRevealNames([])).toBe('');
    expect(badgeRevealNames(null)).toBe('');
    expect(badgeRevealNames(undefined)).toBe('');
    // A badge with no name must not produce a stray separator.
    expect(badgeRevealNames(['A', null, 'B', ''])).toBe('A · B');
  });
});
