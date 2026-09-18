import { describe, it, expect } from 'vitest';
import { cardPathFor, cardUrlFor, cardSrcAttrs, CARD_FOLDERS, CARD_MAX, CARD_QUALITY, CARD_SUFFIX } from '../wrotate_test.js';

const BASE = 'https://api.wrotate.com/storage/v1/object/public/media/';

// Post photos are the feed's biggest byte cost; the card-size sibling is what
// the feed card loads, with the original kept as data-full for the fallback.
describe('card image constants', () => {
  it('cover post photos only, at a size that fills the 470 px column at 2x', () => {
    expect(CARD_FOLDERS).toEqual(['logs/']);
    expect(CARD_MAX).toBe(1000);
    expect(CARD_QUALITY).toBe(0.72);
    expect(CARD_SUFFIX).toBe('_card');
  });
});

describe('cardPathFor', () => {
  it('adds _card.jpg for post photos, whatever the source extension', () => {
    expect(cardPathFor('logs/u1/l1.jpg')).toBe('logs/u1/l1_card.jpg');
    expect(cardPathFor('logs/u1/l1_1.JPG')).toBe('logs/u1/l1_1_card.jpg');
    expect(cardPathFor('logs/u1/l1.png')).toBe('logs/u1/l1_card.jpg');
    expect(cardPathFor('logs/u1/l1.webp')).toBe('logs/u1/l1_card.jpg');
  });
  it('leaves videos, posters and other folders alone', () => {
    expect(cardPathFor('logs/u1/l1.mp4')).toBeNull();
    expect(cardPathFor('logs/u1/l1.mov')).toBeNull();
    expect(cardPathFor('logs/u1/l1_poster.jpg')).toBeNull();
    expect(cardPathFor('watches/u1/w1.jpg')).toBeNull();
    expect(cardPathFor('avatars/u1.jpg')).toBeNull();
  });
  it('never nests siblings or breaks on odd paths', () => {
    expect(cardPathFor('logs/u1/l1_card.jpg')).toBeNull();
    expect(cardPathFor('logs/u1/l1_thumb.jpg')).toBeNull();
    expect(cardPathFor('logs/u1/noext')).toBeNull();
    expect(cardPathFor('logs/u.1/noext')).toBeNull();
    expect(cardPathFor('')).toBeNull();
    expect(cardPathFor(null)).toBeNull();
  });
});

describe('cardUrlFor', () => {
  it('rewrites a storage URL and keeps the cache-bust query', () => {
    expect(cardUrlFor(BASE + 'logs/u1/l1.jpg?v=123')).toBe(BASE + 'logs/u1/l1_card.jpg?v=123');
    expect(cardUrlFor(BASE + 'logs/u1/l1.jpg')).toBe(BASE + 'logs/u1/l1_card.jpg');
  });
  it('returns null for external, data:, video and chip-folder URLs', () => {
    expect(cardUrlFor('https://cdn.example.com/rolex.jpg')).toBeNull();
    expect(cardUrlFor('data:image/jpeg;base64,abc')).toBeNull();
    expect(cardUrlFor(BASE + 'logs/u1/clip.mp4?v=1')).toBeNull();
    expect(cardUrlFor(BASE + 'watches/u1/w1.jpg')).toBeNull();
    expect(cardUrlFor('')).toBeNull();
    expect(cardUrlFor(null)).toBeNull();
  });
});

describe('cardSrcAttrs', () => {
  it('emits src + data-full for post photos', () => {
    expect(cardSrcAttrs(BASE + 'logs/u1/l1.jpg?v=9'))
      .toBe(`src="${BASE}logs/u1/l1_card.jpg?v=9" data-full="${BASE}logs/u1/l1.jpg?v=9"`);
  });
  it('emits a plain src for anything else', () => {
    expect(cardSrcAttrs('https://cdn.example.com/x.jpg')).toBe('src="https://cdn.example.com/x.jpg"');
    expect(cardSrcAttrs('')).toBe('src=""');
  });
  it('HTML-escapes both attributes', () => {
    expect(cardSrcAttrs('https://x.test/a"b.jpg')).toBe('src="https://x.test/a&quot;b.jpg"');
    expect(cardSrcAttrs(BASE + 'logs/u1/l"1.jpg')).toContain('l&quot;1_card.jpg');
  });
});
