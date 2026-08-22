// Feed videos must not download until they are on screen, must not be
// re-fetched on every feed refresh, and must survive a re-render.
// Evidence 2026-08-22: one 8 MB looping clip in the top-50 public posts was
// downloaded by EVERY boot (`preload="auto" autoplay`), and a Mac session
// streamed 13–24 range chunks/min for 8 minutes while it looped.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('feed hero <video> markup', () => {
  const heroTags = html.match(/<video id="feed-hero-[^>]*>/g) || [];
  it('exists for both the initial render and the thumb-swap render', () => {
    expect(heroTags.length).toBeGreaterThanOrEqual(2);
  });
  it('is preload="none" — nothing downloads until the observer plays it', () => {
    for (const tag of heroTags) expect(tag).toMatch(/\bpreload="none"/);
  });
  it('has no autoplay attribute (the IntersectionObserver plays it at ≥50 % visible)', () => {
    for (const tag of heroTags) expect(tag).not.toMatch(/\bautoplay\b/);
  });
});

describe('feed video wiring', () => {
  it('never calls v.load() on feed-card videos (load() discards the buffer and refetches)', () => {
    const sites = html.match(/\.feed-card-photo > video'\)\.forEach\([^;]*;/g) || [];
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const s of sites) expect(s).not.toMatch(/v\.load\(\)/);
  });
  it('renderFeed carries an existing same-source <video> node across the innerHTML replace', () => {
    const i = html.indexOf('function renderFeed()');
    const body = html.slice(i, html.indexOf('\nfunction ', i + 1));
    expect(body).toMatch(/carryFeedVideos\(/);
  });
});
