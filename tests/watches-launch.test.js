import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.html'), 'utf8');

// ── 2026-10-03: Watches (the model database) launched to everyone. The
// watch_db dev flag is gone — launch means the flag is removed, not defaulted
// on. Clubs is parked at the same time: button hidden, feature intact.

describe('Watches is launched', () => {
  it('the watch_db flag is fully removed', () => {
    expect(src).not.toContain('watch_db');
    expect(src).not.toContain('applyWatchDbFlag');
  });

  it('the feed Watches button is visible and marked Beta', () => {
    const btn = src.match(/<button id="feed-watches-btn"[^>]*>[\s\S]*?<\/button>/)[0];
    expect(btn).not.toContain('display:none');
    expect(btn).toContain('tag-beta');
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
