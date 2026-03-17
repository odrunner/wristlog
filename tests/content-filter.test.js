import { describe, it, expect } from 'vitest';
import { checkContent } from '../wrotate_test.js';

describe('checkContent', () => {
  it('returns clean for normal text', () => {
    expect(checkContent('Beautiful Rolex Submariner today').clean).toBe(true);
  });

  it('returns clean for empty string', () => {
    expect(checkContent('').clean).toBe(true);
  });

  it('returns clean for null/undefined', () => {
    expect(checkContent(null).clean).toBe(true);
    expect(checkContent(undefined).clean).toBe(true);
  });

  it('catches profanity', () => {
    const result = checkContent('what the fuck');
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('catches harassment patterns', () => {
    expect(checkContent('go die loser').clean).toBe(false);
    expect(checkContent('kys nobody likes you').clean).toBe(false);
  });

  it('catches spam patterns', () => {
    expect(checkContent('buy now at cheap prices').clean).toBe(false);
    expect(checkContent('click here for free stuff').clean).toBe(false);
  });

  it('is case insensitive', () => {
    expect(checkContent('CLICK HERE for free').clean).toBe(false);
    expect(checkContent('Buy Now').clean).toBe(false);
  });

  it('allows watch-related terms', () => {
    expect(checkContent('This is a nice piece').clean).toBe(true);
    expect(checkContent('The movement is beautiful').clean).toBe(true);
    expect(checkContent('Caseback is stunning').clean).toBe(true);
    expect(checkContent('Great strap and buckle').clean).toBe(true);
  });

  it('allows normal social text', () => {
    expect(checkContent('Love your collection!').clean).toBe(true);
    expect(checkContent('Which one did you wear today?').clean).toBe(true);
    expect(checkContent('The dial color is amazing').clean).toBe(true);
  });

  it('catches slurs', () => {
    expect(checkContent('you stupid n1gger').clean).toBe(false);
  });

  it('returns matches array with caught terms', () => {
    const result = checkContent('this is shit and also click here');
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBe(2);
  });
});
