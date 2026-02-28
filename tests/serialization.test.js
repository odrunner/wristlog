import { describe, it, expect } from 'vitest';
import {
  watchToRow, rowToWatch,
  logToRow, rowToLog,
  wishToRow, rowToWish,
} from '../wristlog.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const fullWatch = {
  id: 'w1', brand: 'Omega', name: 'Speedmaster', ref: '311.30.42.30.01.005',
  price: 6500, purchaseDate: '2024-01-15', color: '#c9a84c',
  image: 'https://example.com/speedy.jpg', url: 'https://omega.com/speedy',
  tags: ['Chrono', 'Sport'], straps: [{ id: 's1', name: 'OEM', isOn: true }],
  owner: 'John', marketPrice: 7200, marketPriceDate: '2024-06-01',
  marketPriceSrc: 'WatchCharts', watchChartsUrl: 'https://watchcharts.com/omega',
  priceHistory: [{ price: 6800, date: '2024-03-01', src: 'WatchCharts' }],
  warrantyExpiry: '2029-01-15', hasBox: 'yes', hasPapers: 'yes',
  insurance: 'insured', receipts: [{ id: 'r1', name: 'Purchase receipt' }],
  watchPrivacy: 'public',
};

const fullRow = {
  id: 'w1', user_id: 'u1', brand: 'Omega', name: 'Speedmaster', ref: '311.30.42.30.01.005',
  price: 6500, purchase_date: '2024-01-15', color: '#c9a84c',
  image: 'https://example.com/speedy.jpg', url: 'https://omega.com/speedy',
  tags: ['Chrono', 'Sport'], straps: [{ id: 's1', name: 'OEM', isOn: true }],
  owner: 'John', market_price: 7200, market_price_date: '2024-06-01',
  market_price_src: 'WatchCharts', watch_charts_url: 'https://watchcharts.com/omega',
  price_history: [{ price: 6800, date: '2024-03-01', src: 'WatchCharts' }],
  warranty_expiry: '2029-01-15', has_box: 'yes', has_papers: 'yes',
  insurance: 'insured', receipts: [{ id: 'r1', name: 'Purchase receipt' }],
  watch_privacy: 'public', is_public: true,
};

// ── watchToRow / rowToWatch ─────────────────────────────────────────────────

describe('watchToRow', () => {
  it('maps all fields from app model to DB row', () => {
    const row = watchToRow(fullWatch, 'u1');
    expect(row.id).toBe('w1');
    expect(row.user_id).toBe('u1');
    expect(row.brand).toBe('Omega');
    expect(row.name).toBe('Speedmaster');
    expect(row.ref).toBe('311.30.42.30.01.005');
    expect(row.price).toBe(6500);
    expect(row.purchase_date).toBe('2024-01-15');
    expect(row.color).toBe('#c9a84c');
    expect(row.image).toBe('https://example.com/speedy.jpg');
    expect(row.tags).toEqual(['Chrono', 'Sport']);
    expect(row.straps).toEqual([{ id: 's1', name: 'OEM', isOn: true }]);
    expect(row.market_price).toBe(7200);
    expect(row.warranty_expiry).toBe('2029-01-15');
    expect(row.has_box).toBe('yes');
    expect(row.has_papers).toBe('yes');
    expect(row.insurance).toBe('insured');
    expect(row.receipts).toEqual([{ id: 'r1', name: 'Purchase receipt' }]);
    expect(row.watch_privacy).toBe('public');
    expect(row.is_public).toBe(true);
  });

  it('uses ELO rating from ratings map when provided', () => {
    const row = watchToRow(fullWatch, 'u1', { w1: 1350 });
    expect(row.elo_rating).toBe(1350);
  });

  it('defaults ELO to 1000 when not in ratings map', () => {
    const row = watchToRow(fullWatch, 'u1', {});
    expect(row.elo_rating).toBe(1000);
  });

  it('defaults privacy to private when not set', () => {
    const w = { ...fullWatch, watchPrivacy: undefined };
    const row = watchToRow(w, 'u1');
    expect(row.watch_privacy).toBe('private');
    expect(row.is_public).toBe(false);
  });

  it('handles null/undefined fields with safe defaults', () => {
    const minimal = { id: 'w2' };
    const row = watchToRow(minimal, 'u1');
    expect(row.brand).toBeNull();
    expect(row.tags).toEqual([]);
    expect(row.straps).toEqual([]);
    expect(row.price_history).toEqual([]);
    expect(row.receipts).toEqual([]);
    expect(row.has_box).toBe(false);
    expect(row.has_papers).toBe(false);
  });
});

describe('rowToWatch', () => {
  it('maps all fields from DB row to app model', () => {
    const w = rowToWatch(fullRow);
    expect(w.id).toBe('w1');
    expect(w.brand).toBe('Omega');
    expect(w.name).toBe('Speedmaster');
    expect(w.purchaseDate).toBe('2024-01-15');
    expect(w.marketPrice).toBe(7200);
    expect(w.watchChartsUrl).toBe('https://watchcharts.com/omega');
    expect(w.warrantyExpiry).toBe('2029-01-15');
    expect(w.hasBox).toBe('yes');
    expect(w.hasPapers).toBe('yes');
    expect(w.watchPrivacy).toBe('public');
    expect(w.isPublic).toBe(true);
  });

  it('upgrades http:// image URLs to https://', () => {
    const row = { ...fullRow, image: 'http://example.com/photo.jpg' };
    const w = rowToWatch(row);
    expect(w.image).toBe('https://example.com/photo.jpg');
  });

  it('leaves https:// image URLs unchanged', () => {
    const row = { ...fullRow, image: 'https://example.com/photo.jpg' };
    const w = rowToWatch(row);
    expect(w.image).toBe('https://example.com/photo.jpg');
  });

  it('handles null image gracefully', () => {
    const row = { ...fullRow, image: null };
    const w = rowToWatch(row);
    expect(w.image).toBeNull();
  });

  it('defaults color to gold when null', () => {
    const row = { ...fullRow, color: null };
    const w = rowToWatch(row);
    expect(w.color).toBe('#c9a84c');
  });

  it('defaults privacy to private when not set', () => {
    const row = { ...fullRow, watch_privacy: null };
    const w = rowToWatch(row);
    expect(w.watchPrivacy).toBe('private');
    expect(w.isPublic).toBe(false);
  });

  it('defaults arrays to empty when null', () => {
    const row = { ...fullRow, tags: null, straps: null, price_history: null, receipts: null };
    const w = rowToWatch(row);
    expect(w.tags).toEqual([]);
    expect(w.straps).toEqual([]);
    expect(w.priceHistory).toEqual([]);
    expect(w.receipts).toEqual([]);
  });
});

describe('watchToRow/rowToWatch round-trip', () => {
  it('preserves all data through a full round-trip', () => {
    const row = watchToRow(fullWatch, 'u1');
    const restored = rowToWatch(row);
    // Check key fields preserved
    expect(restored.id).toBe(fullWatch.id);
    expect(restored.brand).toBe(fullWatch.brand);
    expect(restored.name).toBe(fullWatch.name);
    expect(restored.ref).toBe(fullWatch.ref);
    expect(restored.price).toBe(fullWatch.price);
    expect(restored.purchaseDate).toBe(fullWatch.purchaseDate);
    expect(restored.tags).toEqual(fullWatch.tags);
    expect(restored.marketPrice).toBe(fullWatch.marketPrice);
    expect(restored.warrantyExpiry).toBe(fullWatch.warrantyExpiry);
    expect(restored.watchPrivacy).toBe(fullWatch.watchPrivacy);
  });

  it('round-trip with minimal watch preserves id', () => {
    const minimal = { id: 'w99' };
    const row = watchToRow(minimal, 'u1');
    const restored = rowToWatch(row);
    expect(restored.id).toBe('w99');
  });
});

// ── logToRow / rowToLog ─────────────────────────────────────────────────────

const fullLog = {
  id: 'log1', watchId: 'w1', date: '2024-06-15',
  useCase: 'work', notes: 'Great day at the office',
  strapId: 's1', photoUrl: 'https://example.com/photo.jpg',
  isPublic: true,
};

const fullLogRow = {
  id: 'log1', user_id: 'u1', watch_id: 'w1', date: '2024-06-15',
  use_case: 'work', notes: 'Great day at the office',
  strap_id: 's1', photo_url: 'https://example.com/photo.jpg',
  is_public: true,
};

describe('logToRow', () => {
  it('maps all log fields to DB row format', () => {
    const row = logToRow(fullLog, 'u1');
    expect(row).toEqual(fullLogRow);
  });

  it('defaults useCase to unspecified', () => {
    const row = logToRow({ id: 'l2', watchId: 'w1', date: '2024-01-01' }, 'u1');
    expect(row.use_case).toBe('unspecified');
  });

  it('defaults isPublic to true when not explicitly false', () => {
    const row = logToRow({ id: 'l2', watchId: 'w1', date: '2024-01-01' }, 'u1');
    expect(row.is_public).toBe(true);
  });

  it('sets isPublic false when explicitly false', () => {
    const row = logToRow({ ...fullLog, isPublic: false }, 'u1');
    expect(row.is_public).toBe(false);
  });
});

describe('rowToLog', () => {
  it('maps all DB row fields to log model', () => {
    const log = rowToLog(fullLogRow);
    expect(log.id).toBe('log1');
    expect(log.watchId).toBe('w1');
    expect(log.date).toBe('2024-06-15');
    expect(log.useCase).toBe('work');
    expect(log.notes).toBe('Great day at the office');
    expect(log.strapId).toBe('s1');
    expect(log.photoUrl).toBe('https://example.com/photo.jpg');
    expect(log.isPublic).toBe(true);
  });

  it('defaults useCase to unspecified when null', () => {
    const log = rowToLog({ ...fullLogRow, use_case: null });
    expect(log.useCase).toBe('unspecified');
  });
});

describe('logToRow/rowToLog round-trip', () => {
  it('preserves all data', () => {
    const row = logToRow(fullLog, 'u1');
    const restored = rowToLog(row);
    expect(restored.id).toBe(fullLog.id);
    expect(restored.watchId).toBe(fullLog.watchId);
    expect(restored.date).toBe(fullLog.date);
    expect(restored.useCase).toBe(fullLog.useCase);
    expect(restored.notes).toBe(fullLog.notes);
    expect(restored.strapId).toBe(fullLog.strapId);
  });
});

// ── wishToRow / rowToWish ───────────────────────────────────────────────────

const fullWish = {
  id: 'wl1', brand: 'Rolex', name: 'Submariner', ref: '124060',
  price: 9500, url: 'https://rolex.com/sub', image: 'https://example.com/sub.jpg',
  notes: 'Grail watch', color: '#38bdf8', tags: ['Diver'],
  marketPrice: 13500, marketPriceDate: '2024-05-01',
  marketPriceSrc: 'WatchCharts', watchChartsUrl: 'https://watchcharts.com/rolex',
};

describe('wishToRow', () => {
  it('maps all wishlist fields to DB row', () => {
    const row = wishToRow(fullWish, 'u1');
    expect(row.id).toBe('wl1');
    expect(row.user_id).toBe('u1');
    expect(row.brand).toBe('Rolex');
    expect(row.name).toBe('Submariner');
    expect(row.market_price).toBe(13500);
    expect(row.tags).toEqual(['Diver']);
  });
});

describe('rowToWish', () => {
  it('maps DB row to wishlist model', () => {
    const row = wishToRow(fullWish, 'u1');
    const w = rowToWish(row);
    expect(w.id).toBe('wl1');
    expect(w.brand).toBe('Rolex');
    expect(w.marketPrice).toBe(13500);
  });

  it('defaults color to gold', () => {
    const w = rowToWish({ id: 'wl2', color: null });
    expect(w.color).toBe('#c9a84c');
  });
});
