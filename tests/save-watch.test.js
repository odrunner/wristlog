import { describe, it, expect } from 'vitest';
import { buildSaveWatchData } from '../wristlog.js';

const baseTodayFn = () => '2024-06-15';

const baseFormData = {
  brand: 'Omega', name: 'Speedmaster', ref: '311.30',
  price: 6500, purchaseDate: '2024-01-15', url: '',
  color: '#c9a84c', insurance: null, insuredValue: null,
  insuranceNotes: '', warrantyExpiry: null, hasBox: 'yes',
  hasPapers: 'yes', watchChartsUrl: null, tags: ['Chrono'],
  straps: [], image: null,
  manualMp: 0,
};

describe('buildSaveWatchData', () => {
  // ── Validation ─────────────────────────────────────────────────────────

  it('rejects missing brand', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, brand: '' },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.error).toBe('Please select or add a brand');
  });

  it('rejects __new__ as brand', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, brand: '__new__' },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.error).toBe('Please select or add a brand');
  });

  it('rejects missing name', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, name: '' },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.error).toBe('Model name is required');
  });

  // ── New watch creation ─────────────────────────────────────────────────

  it('creates new watch with isNew=true and id=null', () => {
    const result = buildSaveWatchData({
      formData: baseFormData,
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.error).toBeUndefined();
    expect(result.isNew).toBe(true);
    expect(result.data.id).toBeNull();
    expect(result.data.brand).toBe('Omega');
    expect(result.data.name).toBe('Speedmaster');
  });

  it('includes image when provided', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, image: 'data:image/png;base64,abc' },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.data.image).toBe('data:image/png;base64,abc');
  });

  it('does not include image key when null', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, image: null },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect('image' in result.data).toBe(false);
  });

  // ── Edit watch ────────────────────────────────────────────────────────

  it('edits existing watch and merges with existing data', () => {
    const existing = {
      id: 'w1', brand: 'Omega', name: 'Speedmaster', ref: '311',
      price: 6500, color: '#c9a84c', oldField: 'preserved',
    };
    const result = buildSaveWatchData({
      formData: { ...baseFormData, ref: '311.30.42' },
      editingId: 'w1', watches: [existing], todayFn: baseTodayFn,
    });
    expect(result.isNew).toBe(false);
    expect(result.data.ref).toBe('311.30.42');
    expect(result.data.oldField).toBe('preserved');
  });

  it('returns error when editing non-existent watch', () => {
    const result = buildSaveWatchData({
      formData: baseFormData,
      editingId: 'nonexistent', watches: [], todayFn: baseTodayFn,
    });
    expect(result.error).toBe('Watch not found');
  });

  // ── Market price logic ────────────────────────────────────────────────

  it('sets market price from manual entry with User Entry source', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, manualMp: 7500 },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.data.marketPrice).toBe(7500);
    expect(result.data.marketPriceSrc).toBe('User Entry');
    expect(result.data.marketPriceDate).toBe('2024-06-15');
  });

  it('always uses User Entry as source for manual prices', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, manualMp: 8000 },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.data.marketPriceSrc).toBe('User Entry');
  });

  it('does not set market price when manual is 0', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, manualMp: 0 },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.data.marketPrice).toBeUndefined();
  });

  // ── Price history archival ────────────────────────────────────────────

  it('archives previous market price when price changes on edit', () => {
    const existing = {
      id: 'w1', brand: 'Omega', name: 'Speedmaster',
      marketPrice: 7000, marketPriceDate: '2024-05-01', marketPriceSrc: 'WatchCharts',
      priceHistory: [],
    };
    const result = buildSaveWatchData({
      formData: { ...baseFormData, manualMp: 7500 },
      editingId: 'w1', watches: [existing], todayFn: baseTodayFn,
    });
    expect(result.data.priceHistory).toHaveLength(1);
    expect(result.data.priceHistory[0].price).toBe(7000);
    expect(result.data.priceHistory[0].date).toBe('2024-05-01');
  });

  it('preserves existing history when no new price is set on edit', () => {
    const existing = {
      id: 'w1', brand: 'Omega', name: 'Speedmaster',
      marketPrice: 7000, priceHistory: [{ price: 6500, date: '2024-01-01', src: 'WatchCharts' }],
    };
    const result = buildSaveWatchData({
      formData: baseFormData,
      editingId: 'w1', watches: [existing], todayFn: baseTodayFn,
    });
    expect(result.data.priceHistory).toEqual(existing.priceHistory);
  });

  it('appends to existing history (does not replace)', () => {
    const existing = {
      id: 'w1', brand: 'Omega', name: 'Speedmaster',
      marketPrice: 7000, marketPriceDate: '2024-05-01', marketPriceSrc: 'WatchCharts',
      priceHistory: [{ price: 6500, date: '2024-01-01', src: 'User Entry' }],
    };
    const result = buildSaveWatchData({
      formData: { ...baseFormData, manualMp: 7500 },
      editingId: 'w1', watches: [existing], todayFn: baseTodayFn,
    });
    expect(result.data.priceHistory).toHaveLength(2);
    expect(result.data.priceHistory[0].price).toBe(6500);
    expect(result.data.priceHistory[1].price).toBe(7000);
  });

  // ── Insurance ─────────────────────────────────────────────────────────

  it('includes insured value when insurance is insured', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, insurance: 'insured', insuredValue: 8000 },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.data.insuredValue).toBe(8000);
    expect(result.data.insuranceNotes).toBe('');
  });

  it('clears insured value when insurance is not_insured', () => {
    const result = buildSaveWatchData({
      formData: { ...baseFormData, insurance: 'not_insured', insuredValue: 8000, insuranceNotes: 'Too expensive' },
      editingId: null, watches: [], todayFn: baseTodayFn,
    });
    expect(result.data.insuredValue).toBeNull();
    expect(result.data.insuranceNotes).toBe('Too expensive');
  });
});
