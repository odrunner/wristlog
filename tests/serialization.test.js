import { describe, it, expect } from 'vitest';
import {
  watchToRow, rowToWatch,
  logToRow, rowToLog,
  wishToRow, rowToWish,
} from '../wrotate_test.js';

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
  insurance: 'insured', insuredValue: 7000, insuranceNotes: null,
  receipts: [{ id: 'r1', name: 'Purchase receipt' }],
  watchPrivacy: 'public',
  yearRange: '2019-present', movementType: 'Automatic',
  caliber: '1861', caseMaterial: 'Stainless Steel',
  caseDiameter: '42mm', caseLength: '47.8mm',
  caseThickness: '13.2mm', weight: '155g',
  waterResistance: '50m', crystalType: 'Hesalite',
  gender: "Men's", origin: 'Switzerland',
  description: 'Legendary moonwatch', background: 'First watch on the moon',
  functions: 'chronograph, tachymeter',
};

const fullRow = {
  id: 'w1', user_id: 'u1', brand: 'Omega', name: 'Speedmaster', ref: '311.30.42.30.01.005',
  price: 6500, purchase_date: '2024-01-15', color: '#c9a84c',
  image: 'https://example.com/speedy.jpg', url: 'https://omega.com/speedy',
  tags: ['Chrono', 'Sport'], straps: [{ id: 's1', name: 'OEM', isOn: true }],
  owner: 'John', market_price: 7200, market_price_date: '2024-06-01',
  market_price_src: 'WatchCharts', watch_charts_url: 'https://watchcharts.com/omega',
  price_history: [{ price: 6800, date: '2024-03-01', src: 'WatchCharts' }],
  warranty_expiry: '2029-01-15', has_box: true, has_papers: true,
  insurance: 'insured', insured_value: 7000, insurance_notes: null,
  receipts: [{ id: 'r1', name: 'Purchase receipt' }],
  watch_privacy: 'public',
  year_range: '2019-present', movement_type: 'Automatic',
  caliber: '1861', case_material: 'Stainless Steel',
  case_diameter: '42mm', case_length: '47.8mm',
  case_thickness: '13.2mm', weight: '155g',
  water_resistance: '50m', crystal_type: 'Hesalite',
  gender: "Men's", origin: 'Switzerland',
  description: 'Legendary moonwatch', background: 'First watch on the moon',
  functions: 'chronograph, tachymeter',
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
    expect(row.has_box).toBe(true);
    expect(row.has_papers).toBe(true);
    expect(row.insurance).toBe('insured');
    expect(row.insured_value).toBe(7000);
    expect(row.receipts).toEqual([{ id: 'r1', name: 'Purchase receipt' }]);
    expect(row.watch_privacy).toBe('public');
    expect(row.year_range).toBe('2019-present');
    expect(row.movement_type).toBe('Automatic');
    expect(row.caliber).toBe('1861');
    expect(row.case_material).toBe('Stainless Steel');
    expect(row.case_diameter).toBe('42mm');
    expect(row.case_length).toBe('47.8mm');
    expect(row.case_thickness).toBe('13.2mm');
    expect(row.weight).toBe('155g');
    expect(row.water_resistance).toBe('50m');
    expect(row.crystal_type).toBe('Hesalite');
    expect(row.gender).toBe("Men's");
    expect(row.origin).toBe('Switzerland');
    expect(row.description).toBe('Legendary moonwatch');
    expect(row.background).toBe('First watch on the moon');
    expect(row.functions).toBe('chronograph, tachymeter');
  });

  it('converts hasBox/hasPapers yes/no to boolean', () => {
    const w = { ...fullWatch, hasBox: 'no', hasPapers: 'no' };
    const row = watchToRow(w, 'u1');
    expect(row.has_box).toBe(false);
    expect(row.has_papers).toBe(false);
  });

  it('converts hasBox/hasPapers null to null', () => {
    const w = { ...fullWatch, hasBox: null, hasPapers: null };
    const row = watchToRow(w, 'u1');
    expect(row.has_box).toBeNull();
    expect(row.has_papers).toBeNull();
  });

  it('uses ELO rating from ratings map when provided', () => {
    const row = watchToRow(fullWatch, 'u1', { w1: 1350 });
    expect(row.elo_rating).toBe(1350);
  });

  it('defaults ELO to 1000 when not in ratings map', () => {
    const row = watchToRow(fullWatch, 'u1', {});
    expect(row.elo_rating).toBe(1000);
  });

  it('preserves null watch_privacy (Default state)', () => {
    const w = { ...fullWatch, watchPrivacy: null };
    const row = watchToRow(w, 'u1');
    expect(row.watch_privacy).toBeNull();
  });

  it('handles null/undefined fields with safe defaults', () => {
    const minimal = { id: 'w2' };
    const row = watchToRow(minimal, 'u1');
    expect(row.brand).toBeNull();
    expect(row.tags).toEqual([]);
    expect(row.straps).toEqual([]);
    expect(row.price_history).toEqual([]);
    expect(row.receipts).toEqual([]);
    expect(row.has_box).toBeNull();
    expect(row.has_papers).toBeNull();
    expect(row.insured_value).toBeNull();
    expect(row.insurance_notes).toBeNull();
    expect(row.year_range).toBeNull();
    expect(row.movement_type).toBeNull();
    expect(row.caliber).toBeNull();
    expect(row.case_material).toBeNull();
    expect(row.case_diameter).toBeNull();
    expect(row.weight).toBeNull();
    expect(row.description).toBeNull();
    expect(row.functions).toBeNull();
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
    expect(w.insuredValue).toBe(7000);
    expect(w.watchPrivacy).toBe('public');
    expect(w.yearRange).toBe('2019-present');
    expect(w.movementType).toBe('Automatic');
    expect(w.caliber).toBe('1861');
    expect(w.caseMaterial).toBe('Stainless Steel');
    expect(w.caseDiameter).toBe('42mm');
    expect(w.caseLength).toBe('47.8mm');
    expect(w.caseThickness).toBe('13.2mm');
    expect(w.weight).toBe('155g');
    expect(w.waterResistance).toBe('50m');
    expect(w.crystalType).toBe('Hesalite');
    expect(w.gender).toBe("Men's");
    expect(w.origin).toBe('Switzerland');
    expect(w.description).toBe('Legendary moonwatch');
    expect(w.background).toBe('First watch on the moon');
    expect(w.functions).toBe('chronograph, tachymeter');
  });

  it('converts has_box/has_papers booleans to yes/no strings', () => {
    const row = { ...fullRow, has_box: false, has_papers: false };
    const w = rowToWatch(row);
    expect(w.hasBox).toBe('no');
    expect(w.hasPapers).toBe('no');
  });

  it('converts has_box/has_papers null to null', () => {
    const row = { ...fullRow, has_box: null, has_papers: null };
    const w = rowToWatch(row);
    expect(w.hasBox).toBeNull();
    expect(w.hasPapers).toBeNull();
  });

  it('upgrades http:// image URLs to https://', () => {
    const row = { ...fullRow, image: 'http://example.com/photo.jpg' };
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

  it('preserves null watch_privacy (Default state)', () => {
    const row = { ...fullRow, watch_privacy: null };
    const w = rowToWatch(row);
    expect(w.watchPrivacy).toBeNull();
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
    expect(restored.hasBox).toBe(fullWatch.hasBox);
    expect(restored.hasPapers).toBe(fullWatch.hasPapers);
    expect(restored.insuredValue).toBe(fullWatch.insuredValue);
    expect(restored.yearRange).toBe(fullWatch.yearRange);
    expect(restored.movementType).toBe(fullWatch.movementType);
    expect(restored.caliber).toBe(fullWatch.caliber);
    expect(restored.caseMaterial).toBe(fullWatch.caseMaterial);
    expect(restored.caseDiameter).toBe(fullWatch.caseDiameter);
    expect(restored.weight).toBe(fullWatch.weight);
    expect(restored.description).toBe(fullWatch.description);
    expect(restored.functions).toBe(fullWatch.functions);
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
  visibility: 'public', clubId: null,
};

const fullLogRow = {
  id: 'log1', user_id: 'u1', watch_id: 'w1', date: '2024-06-15',
  use_case: 'work', notes: 'Great day at the office',
  strap_id: 's1', photo_url: 'https://example.com/photo.jpg',
  visibility: 'public', club_id: null,
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

  it('defaults visibility to public', () => {
    const row = logToRow({ id: 'l2', watchId: 'w1', date: '2024-01-01' }, 'u1');
    expect(row.visibility).toBe('public');
  });

  it('includes club_id when provided', () => {
    const row = logToRow({ ...fullLog, clubId: 'club1' }, 'u1');
    expect(row.club_id).toBe('club1');
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
    expect(log.visibility).toBe('public');
    expect(log.clubId).toBeNull();
  });

  it('defaults useCase to unspecified when null', () => {
    const log = rowToLog({ ...fullLogRow, use_case: null });
    expect(log.useCase).toBe('unspecified');
  });

  it('defaults visibility to public when column is null', () => {
    const log = rowToLog({ ...fullLogRow, visibility: null });
    expect(log.visibility).toBe('public');
  });

  it('includes clubId from row', () => {
    const log = rowToLog({ ...fullLogRow, club_id: 'club42' });
    expect(log.clubId).toBe('club42');
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
    expect(restored.visibility).toBe(fullLog.visibility);
  });
});

// ── wishToRow / rowToWish ───────────────────────────────────────────────────

const fullWish = {
  id: 'wl1', brand: 'Rolex', name: 'Submariner', ref: '124060',
  price: 9500, url: 'https://rolex.com/sub', image: 'https://example.com/sub.jpg',
  notes: 'Grail watch', color: '#38bdf8', tags: ['Diver'],
  marketPrice: 13500, marketPriceDate: '2024-05-01',
  marketPriceSrc: 'WatchCharts', watchChartsUrl: 'https://watchcharts.com/rolex',
  wishPrivacy: 'public', addedDate: '2024-01-01',
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
    expect(row.wish_privacy).toBe('public');
    expect(row.added_date).toBe('2024-01-01');
  });
});

describe('rowToWish', () => {
  it('maps DB row to wishlist model', () => {
    const row = wishToRow(fullWish, 'u1');
    const w = rowToWish(row);
    expect(w.id).toBe('wl1');
    expect(w.brand).toBe('Rolex');
    expect(w.marketPrice).toBe(13500);
    expect(w.wishPrivacy).toBe('public');
    expect(w.addedDate).toBe('2024-01-01');
  });

  it('defaults color to gold', () => {
    const w = rowToWish({ id: 'wl2', color: null });
    expect(w.color).toBe('#c9a84c');
  });
});

// ── Branch coverage: null/undefined field fallbacks ──

describe('rowToLog null field fallbacks', () => {
  it('defaults notes and strapId to null when missing', () => {
    const log = rowToLog({ id: 'l1', watch_id: 'w1', date: '2024-01-01', use_case: 'work', notes: null, strap_id: null, photo_url: null, visibility: 'public', club_id: null });
    expect(log.notes).toBeNull();
    expect(log.strapId).toBeNull();
    expect(log.photoUrl).toBeNull();
  });

  it('defaults notes and strapId to null when undefined', () => {
    const log = rowToLog({ id: 'l1', watch_id: 'w1', date: '2024-01-01' });
    expect(log.notes).toBeNull();
    expect(log.strapId).toBeNull();
    expect(log.photoUrl).toBeNull();
    expect(log.clubId).toBeNull();
  });
});

describe('wishToRow null field fallbacks', () => {
  it('nullifies all optional fields when missing', () => {
    const row = wishToRow({ id: 'wl99' }, 'u1');
    expect(row.brand).toBeNull();
    expect(row.name).toBeNull();
    expect(row.ref).toBeNull();
    expect(row.price).toBeNull();
    expect(row.url).toBeNull();
    expect(row.image).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.color).toBeNull();
    expect(row.tags).toEqual([]);
    expect(row.market_price).toBeNull();
    expect(row.market_price_date).toBeNull();
    expect(row.market_price_src).toBeNull();
    expect(row.watch_charts_url).toBeNull();
    expect(row.wish_privacy).toBeNull();
    expect(row.added_date).toBeNull();
  });
});
