import { describe, it, expect } from 'vitest';
import { rankWishlistByElo } from '../wrotate_test.js';

describe('rankWishlistByElo — wishlist ranking game "Save Ranking"', () => {
  it('orders highest Elo first and rewrites _rank to the new position', () => {
    const out = rankWishlistByElo([
      { id: 'a', elo: 990, _rank: 0 },
      { id: 'b', elo: 1040, _rank: 1 },
      { id: 'c', elo: 1010, _rank: 2 },
    ]);
    expect(out.map(w => w.id)).toEqual(['b', 'c', 'a']);
    expect(out.map(w => w._rank)).toEqual([0, 1, 2]);
  });

  it('treats unrated items (null/undefined elo) as 1000 and keeps ties in current order', () => {
    const out = rankWishlistByElo([
      { id: 'a', elo: null },
      { id: 'b', elo: 1000 },
      { id: 'c' },
      { id: 'd', elo: 1001 },
    ]);
    expect(out.map(w => w.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('does not mutate the input and tolerates null/empty', () => {
    const src = [{ id: 'a', elo: 900 }, { id: 'b', elo: 1100 }];
    const out = rankWishlistByElo(src);
    expect(src[0].id).toBe('a');
    expect(out).not.toBe(src);
    expect(rankWishlistByElo(null)).toEqual([]);
    expect(rankWishlistByElo([])).toEqual([]);
  });
});

import { wishToRow, rowToWish } from '../wrotate_test.js';
describe('wishlist elo round-trips through the row mappers', () => {
  it('rowToWish reads elo_rating (null when absent) and wishToRow writes it back', () => {
    expect(rowToWish({ id: 'x', elo_rating: 1032 }).elo).toBe(1032);
    expect(rowToWish({ id: 'x' }).elo).toBeNull();
    expect(wishToRow({ id: 'x', elo: 1032 }, 'u', 0).elo_rating).toBe(1032);
    expect(wishToRow({ id: 'x' }, 'u', 0).elo_rating).toBeNull();
  });
});
