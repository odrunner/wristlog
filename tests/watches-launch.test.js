import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.html'), 'utf8');

// ── 2026-10-03: Watches (the model database) launched to everyone. The
// watch_db dev flag is gone — launch means the flag is removed, not defaulted
// on. Clubs is parked at the same time: button hidden, feature intact.
// ── 2026-11-06: Watches moved from the feed header into the main nav, taking
// the slot Wishlist vacated; the wishlist is reached through the Collection
// tab's segmented toggle (collSeg).

describe('Watches is launched', () => {
  it('the watch_db flag is fully removed', () => {
    expect(src).not.toContain('watch_db');
    expect(src).not.toContain('applyWatchDbFlag');
  });

  it('Watches is a main-nav tab; the old feed-header button is gone', () => {
    const navBtn = src.match(/<button[^>]*data-page="explore"[^>]*>[\s\S]*?<\/button>/)[0];
    expect(navBtn).toContain('onclick="nav(this)"');
    expect(navBtn).toContain('Watches');
    expect(src).not.toContain('feed-watches-btn');
  });
});

describe('Wishlist lives under Collection', () => {
  it('the wishlist nav button is gone and nothing still targets it', () => {
    expect(src).not.toContain('data-page="wishlist"');
  });

  it('both pages carry the Collection ⇄ Wishlist segmented toggle', () => {
    const segs = src.match(/class="coll-seg[^"]*"/g) || [];
    expect(segs.length).toBe(2);
    expect(src).toContain(`data-seg="wishlist" onclick="collSeg('wishlist')"`);
    expect(src).toContain(`data-seg="collection" onclick="collSeg('collection')"`);
    expect(src).toContain('function collSeg(');
  });
});

describe('Clubs is parked, not deleted', () => {
  it('the feed Clubs button is hidden', () => {
    const btn = src.match(/<button [^>]*onclick="showClubsPage\(\)"[^>]*>/)[0];
    expect(btn).toContain('hidden');
  });

  it('the clubs page itself still exists (deep links keep working)', () => {
    expect(src).toContain('function showClubsPage()');
    expect(src).toContain('open_clubs');
  });
});
