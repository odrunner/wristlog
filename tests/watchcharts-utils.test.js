import { describe, it, expect } from 'vitest';
import {
  normalizeWatchChartsUrl,
  extractMarketPriceFromHtml,
  buildWatchSearchQueries,
  filterWatchChartsUrls,
} from '../wrotate_test.js';

describe('normalizeWatchChartsUrl', () => {
  it('strips /overview suffix', () => {
    expect(normalizeWatchChartsUrl('https://watchcharts.com/watch_model/rolex/submariner/overview'))
      .toBe('https://watchcharts.com/watch_model/rolex/submariner');
  });

  it('strips /prices with query string', () => {
    expect(normalizeWatchChartsUrl('https://watchcharts.com/watch_model/rolex/submariner/prices?range=1y'))
      .toBe('https://watchcharts.com/watch_model/rolex/submariner');
  });

  it('strips /history', () => {
    expect(normalizeWatchChartsUrl('https://watchcharts.com/watch_model/omega/speedmaster/history'))
      .toBe('https://watchcharts.com/watch_model/omega/speedmaster');
  });

  it('strips /specs', () => {
    expect(normalizeWatchChartsUrl('https://watchcharts.com/watch_model/tudor/bb58/specs'))
      .toBe('https://watchcharts.com/watch_model/tudor/bb58');
  });

  it('strips /charts', () => {
    expect(normalizeWatchChartsUrl('https://watchcharts.com/watch_model/rolex/daytona/charts'))
      .toBe('https://watchcharts.com/watch_model/rolex/daytona');
  });

  it('strips trailing slash', () => {
    expect(normalizeWatchChartsUrl('https://watchcharts.com/watch_model/rolex/sub/'))
      .toBe('https://watchcharts.com/watch_model/rolex/sub');
  });

  it('returns unchanged if no suffix to strip', () => {
    const url = 'https://watchcharts.com/watch_model/rolex/submariner';
    expect(normalizeWatchChartsUrl(url)).toBe(url);
  });
});

describe('extractMarketPriceFromHtml', () => {
  it('extracts price from "Market Price. $XX,XXX" pattern', () => {
    const html = '<div>Market Price.    $12,500</div>';
    expect(extractMarketPriceFromHtml(html)).toEqual({ price: 12500, src: 'WatchCharts' });
  });

  it('extracts large prices', () => {
    const html = 'Market Price. $1,234,567';
    expect(extractMarketPriceFromHtml(html)).toEqual({ price: 1234567, src: 'WatchCharts' });
  });

  it('returns null when no price found', () => {
    expect(extractMarketPriceFromHtml('<div>No price here</div>')).toBeNull();
  });

  it('returns null for prices <= 100', () => {
    expect(extractMarketPriceFromHtml('Market Price. $50')).toBeNull();
  });

  it('returns null for prices >= 10,000,000', () => {
    expect(extractMarketPriceFromHtml('Market Price. $10,000,000')).toBeNull();
  });

  it('handles price at boundary ($101)', () => {
    expect(extractMarketPriceFromHtml('Market Price. $101')).toEqual({ price: 101, src: 'WatchCharts' });
  });
});

describe('buildWatchSearchQueries', () => {
  it('uses reference number as primary query', () => {
    const result = buildWatchSearchQueries('Rolex', 'Submariner Date', '126610LN');
    expect(result).toEqual(['126610LN']);
  });

  it('falls back to brand + first 3 name words when no ref', () => {
    const result = buildWatchSearchQueries('Omega', 'Speedmaster Professional Moonwatch Co-Axial', '');
    expect(result).toEqual(['Omega Speedmaster Professional Moonwatch']);
  });

  it('handles short model names', () => {
    const result = buildWatchSearchQueries('Rolex', 'Daytona', '');
    expect(result).toEqual(['Rolex Daytona']);
  });

  it('trims ref whitespace', () => {
    const result = buildWatchSearchQueries('Rolex', 'Sub', '  126610LN  ');
    expect(result).toEqual(['126610LN']);
  });

  it('treats whitespace-only ref as empty', () => {
    const result = buildWatchSearchQueries('Tudor', 'Black Bay', '   ');
    expect(result).toEqual(['Tudor Black Bay']);
  });
});

describe('filterWatchChartsUrls', () => {
  it('extracts matching model URL from HTML', () => {
    const html = `
      <a href="https://watchcharts.com/watch_model/rolex/submariner/overview">Submariner</a>
      <a href="https://watchcharts.com/watch_model/omega/speedmaster/overview">Speedmaster</a>
    `;
    expect(filterWatchChartsUrls(html, 'rolex')).toBe('https://watchcharts.com/watch_model/rolex/submariner');
  });

  it('returns null when no brand match', () => {
    const html = '<a href="https://watchcharts.com/watch_model/omega/seamaster/overview">Seamaster</a>';
    expect(filterWatchChartsUrls(html, 'rolex')).toBeNull();
  });

  it('returns null when no WatchCharts URLs in HTML', () => {
    expect(filterWatchChartsUrls('<div>No links</div>', 'rolex')).toBeNull();
  });

  it('strips last path segment from matched URL', () => {
    const html = '<a href="https://watchcharts.com/watch_model/tudor/black-bay/58">BB58</a>';
    expect(filterWatchChartsUrls(html, 'tudor')).toBe('https://watchcharts.com/watch_model/tudor/black-bay');
  });
});
