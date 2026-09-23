import { describe, it, expect } from 'vitest';
import { marketPriceRowHTML } from '../wrotate_test.js';



// ── marketPriceRowHTML ────────────────────────────────────────────────────────

describe('marketPriceRowHTML', () => {
  it('returns empty when no market price', () => {
    expect(marketPriceRowHTML({ marketPrice: null })).toBe('');
    expect(marketPriceRowHTML({ marketPrice: 0 })).toBe('');
  });

  it('shows market price value', () => {
    const html = marketPriceRowHTML({ marketPrice: 10000 });
    expect(html).toContain('Market');
    expect(html).toContain('$10,000');
  });

  it('shows positive delta when market > paid', () => {
    const html = marketPriceRowHTML({ marketPrice: 12000, price: 10000 });
    expect(html).toContain('mp-up');
    expect(html).toContain('+');
    expect(html).toContain('$2,000');
    expect(html).toContain('20%');
  });

  it('shows negative delta when market < paid', () => {
    const html = marketPriceRowHTML({ marketPrice: 8000, price: 10000 });
    expect(html).toContain('mp-down');
    expect(html).toContain('-');
  });

  it('shows no delta when no purchase price', () => {
    const html = marketPriceRowHTML({ marketPrice: 10000, price: null });
    expect(html).not.toContain('mp-delta');
  });

  it('shows source info when available', () => {
    const html = marketPriceRowHTML({
      marketPrice: 10000, marketPriceSrc: 'WatchCharts',
      marketPriceDate: '2024-06-01',
    });
    expect(html).toContain('mp-src');
    expect(html).toContain('Jun');
  });
});
