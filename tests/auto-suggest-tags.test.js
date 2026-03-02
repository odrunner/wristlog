import { describe, it, expect } from 'vitest';
import { autoSuggestTags } from '../wristlog.js';

describe('autoSuggestTags', () => {
  it('suggests Dive for submariner', () => {
    expect(autoSuggestTags('Rolex', 'Submariner', '')).toContain('Dive');
  });

  it('suggests Dive for dive keyword', () => {
    expect(autoSuggestTags('Seiko', 'Diver 200m', '')).toContain('Dive');
  });

  it('suggests Dive for Fifty Fathoms', () => {
    expect(autoSuggestTags('Blancpain', 'Fifty Fathoms', '')).toContain('Dive');
  });

  it('suggests Chronograph for chrono keyword', () => {
    expect(autoSuggestTags('Omega', 'Speedmaster Chronograph', '')).toContain('Chronograph');
  });

  it('suggests GMT for gmt keyword', () => {
    expect(autoSuggestTags('Rolex', 'GMT-Master II', '')).toContain('GMT');
  });

  it('suggests GMT for dual time', () => {
    expect(autoSuggestTags('JLC', 'Dual Time', '')).toContain('GMT');
  });

  it('suggests Pilot for pilot keyword', () => {
    expect(autoSuggestTags('IWC', 'Pilot Mark XVIII', '')).toContain('Pilot');
  });

  it('suggests Pilot for navitimer', () => {
    expect(autoSuggestTags('Breitling', 'Navitimer', '')).toContain('Pilot');
  });

  it('suggests Pilot for flieger', () => {
    expect(autoSuggestTags('Stowa', 'Flieger Classic', '')).toContain('Pilot');
  });

  it('suggests Field for field keyword', () => {
    expect(autoSuggestTags('Hamilton', 'Khaki Field', '')).toContain('Field');
  });

  it('suggests Dress for dress keyword', () => {
    expect(autoSuggestTags('Nomos', 'Dress Watch', '')).toContain('Dress');
  });

  it('suggests Dress for Calatrava', () => {
    expect(autoSuggestTags('Patek Philippe', 'Calatrava', '')).toContain('Dress');
  });

  it('suggests Dress for Tank', () => {
    expect(autoSuggestTags('Cartier', 'Tank Francaise', '')).toContain('Dress');
  });

  it('suggests Dress for Datejust', () => {
    expect(autoSuggestTags('Rolex', 'Datejust 41', '')).toContain('Dress');
  });

  it('suggests Skeleton for skeleton keyword', () => {
    expect(autoSuggestTags('Roger Dubuis', 'Skeleton Tourbillon', '')).toContain('Skeleton');
  });

  it('suggests Vintage for vintage keyword', () => {
    expect(autoSuggestTags('Omega', 'Vintage Seamaster', '')).toContain('Vintage');
  });

  it('suggests Complication for tourbillon', () => {
    expect(autoSuggestTags('A. Lange', 'Tourbillon', '')).toContain('Complication');
  });

  it('suggests Complication for moonphase', () => {
    expect(autoSuggestTags('JLC', 'Master Ultra Thin Moonphase', '')).toContain('Complication');
  });

  it('suggests Sport-Luxury for Royal Oak', () => {
    const tags = autoSuggestTags('Audemars Piguet', 'Royal Oak', '');
    expect(tags).toContain('Sport-Luxury');
    expect(tags).not.toContain('Sport');
  });

  it('suggests Sport-Luxury for Nautilus', () => {
    expect(autoSuggestTags('Patek', 'Nautilus', '')).toContain('Sport-Luxury');
  });

  it('suggests Sport for generic sport watch', () => {
    expect(autoSuggestTags('Casio', 'G-Shock Sport', '')).toContain('Sport');
  });

  it('returns empty for unrecognized watch', () => {
    expect(autoSuggestTags('Generic', 'Simple Watch', '')).toEqual([]);
  });

  it('checks ref field too', () => {
    expect(autoSuggestTags('AP', 'Some Watch', 'aquanaut-ref')).toContain('Sport-Luxury');
  });

  it('can return multiple tags', () => {
    const tags = autoSuggestTags('Omega', 'Vintage Skeleton Chronograph', '');
    expect(tags).toContain('Chronograph');
    expect(tags).toContain('Skeleton');
    expect(tags).toContain('Vintage');
  });
});
