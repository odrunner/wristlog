import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { isMeasurementCardImage } from '../wrotate_test.js';

// Reported 2026-07-19: a measurement share rendered cropped in the feed.
//
// The accuracy graph is a wide, compact card. `.feed-card-photo--accuracy`
// renders it uncropped (aspect-ratio:auto + object-fit:contain), but the check
// that applied the class was:
//
//   _urls.length === 1 && /_accuracy\.jpg(\?|$)/.test(heroUrl)
//
// Both halves failed for jayray's post. He shared a measurement (the composer
// prefills the accuracy card as file 0) and then added a wrist shot, so:
//   - there were 2 images, not 1
//   - the multi-image upload path names files `_0.jpg` / `_1.jpg`, never
//     `_accuracy.jpg`
// so the card fell back to the fixed 4:5 slot with object-fit:cover and got
// cropped. Detection now keys off use_case, which is authoritative, instead of
// the filename.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const MULTI = [
  'https://x/logs/u/abc_0.jpg?v=1',
  'https://x/logs/u/abc_1.jpg?v=2',
];
const LEGACY = ['https://x/logs/u/abc_accuracy.jpg?v=1'];

describe('isMeasurementCardImage', () => {
  it('treats the first image of a measurement post as the card', () => {
    expect(isMeasurementCardImage('measurement', MULTI, 0)).toBe(true);
  });

  it('does NOT treat the second image as the card — that is the wrist shot', () => {
    expect(isMeasurementCardImage('measurement', MULTI, 1)).toBe(false);
  });

  it('still recognises legacy single _accuracy.jpg posts', () => {
    expect(isMeasurementCardImage('measurement', LEGACY, 0)).toBe(true);
  });

  it('recognises an _accuracy.jpg even when the use case is missing', () => {
    // Older rows predate the use_case convention.
    expect(isMeasurementCardImage(null, LEGACY, 0)).toBe(true);
    expect(isMeasurementCardImage('unspecified', LEGACY, 0)).toBe(true);
  });

  it('leaves ordinary wear photos alone', () => {
    expect(isMeasurementCardImage('work', MULTI, 0)).toBe(false);
    expect(isMeasurementCardImage('leisure', ['https://x/a.jpg'], 0)).toBe(false);
  });

  it('handles a measurement post whose card is a plain .jpg', () => {
    // masont 2026-06-13 uploaded as `<id>.jpg` with no suffix at all.
    expect(isMeasurementCardImage('measurement', ['https://x/logs/u/abc.jpg?v=1'], 0)).toBe(true);
  });

  it('tolerates bad input', () => {
    expect(isMeasurementCardImage('measurement', [], 0)).toBe(false);
    expect(isMeasurementCardImage('measurement', null, 0)).toBe(false);
    expect(isMeasurementCardImage('measurement', MULTI, 9)).toBe(false);
  });
});

describe('feed wiring (index.html)', () => {
  it('the feed hero uses the shared check, not a length+filename test', () => {
    expect(html).toContain('isMeasurementCardImage(');
    expect(html).not.toMatch(/_urls\.length === 1 && \/_accuracy/);
  });

  it('switching thumbnails re-evaluates the accuracy class', () => {
    const start = html.indexOf('function feedThumbTap(');
    const fn = html.slice(start, html.indexOf('\n}', start));
    expect(fn).toContain('isMeasurementCardImage(');
    expect(fn).toContain('feed-card-photo--accuracy');
  });

  it('the uncropped styling still exists', () => {
    expect(html).toMatch(/\.feed-card-photo--accuracy img \{[^}]*object-fit:\s*contain/);
  });
});
