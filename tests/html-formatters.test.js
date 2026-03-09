import { describe, it, expect } from 'vitest';
import { boxPapersHTML, warrantyBadgeHTML, marketPriceRowHTML } from '../wristlog.js';

// ── boxPapersHTML ─────────────────────────────────────────────────────────────

describe('boxPapersHTML', () => {
  it('returns empty for no box and no papers', () => {
    expect(boxPapersHTML({ hasBox: null, hasPapers: null })).toBe('');
  });

  it('returns combined badge for both yes', () => {
    const html = boxPapersHTML({ hasBox: 'yes', hasPapers: 'yes' });
    expect(html).toContain('Box &amp; Papers');
    expect(html).toContain('bp-item-yes');
  });

  it('shows box yes only', () => {
    const html = boxPapersHTML({ hasBox: 'yes', hasPapers: null });
    expect(html).toContain('Box');
    expect(html).toContain('bp-item-yes');
    expect(html).not.toContain('Papers');
  });

  it('shows no box indicator', () => {
    const html = boxPapersHTML({ hasBox: 'no', hasPapers: null });
    expect(html).toContain('No Box');
    expect(html).toContain('bp-item-no');
  });

  it('shows papers yes only', () => {
    const html = boxPapersHTML({ hasBox: null, hasPapers: 'yes' });
    expect(html).toContain('Papers');
    expect(html).not.toContain('Box');
  });

  it('shows no papers indicator', () => {
    const html = boxPapersHTML({ hasBox: null, hasPapers: 'no' });
    expect(html).toContain('No Papers');
    expect(html).toContain('bp-item-no');
  });

  it('returns empty for non-standard values (edge case)', () => {
    // hasBox/hasPapers are truthy but not 'yes' or 'no', so no parts are generated
    const html = boxPapersHTML({ hasBox: 'unknown', hasPapers: 'unknown' });
    expect(html).toBe('');
  });

  it('shows box yes + no papers with separator', () => {
    const html = boxPapersHTML({ hasBox: 'yes', hasPapers: 'no' });
    expect(html).toContain('bp-item-yes');
    expect(html).toContain('bp-item-no');
    expect(html).toContain('·');
  });

  it('shows no box + papers yes with separator', () => {
    const html = boxPapersHTML({ hasBox: 'no', hasPapers: 'yes' });
    expect(html).toContain('No Box');
    expect(html).toContain('Papers');
  });
});

// ── warrantyBadgeHTML ─────────────────────────────────────────────────────────

describe('warrantyBadgeHTML', () => {
  const today = new Date('2024-06-15T12:00:00');

  it('returns empty when no warranty', () => {
    expect(warrantyBadgeHTML({}, today)).toBe('');
  });

  it('returns expired badge', () => {
    const html = warrantyBadgeHTML({ warrantyExpiry: '2024-01-01' }, today);
    expect(html).toContain('warranty-expired');
    expect(html).toContain('Warranty expired');
  });

  it('returns expiring badge', () => {
    const html = warrantyBadgeHTML({ warrantyExpiry: '2024-07-15' }, today);
    expect(html).toContain('warranty-expiring');
    expect(html).toContain('d left');
  });

  it('returns active badge', () => {
    const html = warrantyBadgeHTML({ warrantyExpiry: '2025-06-15' }, today);
    expect(html).toContain('warranty-active');
    expect(html).toContain('mo left');
  });
});

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
