import { describe, it, expect } from 'vitest';
import { trackDateChipState, npShouldShowDetails, newPostUseCase } from '../wrotate_test.js';

// Spec: 2026-06-27-harmonize-track-post-design.md

describe('trackDateChipState', () => {
  const today = '2026-06-27';

  it('selects Today for today / empty value', () => {
    expect(trackDateChipState('2026-06-27', today)).toBe('today');
    expect(trackDateChipState('', today)).toBe('today');
    expect(trackDateChipState(null, today)).toBe('today');
  });

  it('selects Yesterday for the day before', () => {
    expect(trackDateChipState('2026-06-26', today)).toBe('yesterday');
  });

  it('falls to the Pick chip for any other date', () => {
    expect(trackDateChipState('2026-06-12', today)).toBe('pick');
    expect(trackDateChipState('2026-07-01', today)).toBe('pick'); // future too
  });

  it('handles month boundaries via addDaysStr', () => {
    expect(trackDateChipState('2026-05-31', '2026-06-01')).toBe('yesterday');
  });
});

describe('npShouldShowDetails', () => {
  it('shows occasion/strap only when a watch is tagged', () => {
    expect(npShouldShowDetails({ watchId: 'w1', source: null })).toBe(true);
    expect(npShouldShowDetails({ watchId: null, source: null })).toBe(false);
  });

  it('never shows for measurement shares (not a wear)', () => {
    expect(npShouldShowDetails({ watchId: 'w1', source: 'measurement' })).toBe(false);
  });
});

describe('newPostUseCase', () => {
  it('keeps measurement shares as measurement', () => {
    expect(newPostUseCase({ source: 'measurement', watchId: 'w1', occasion: 'work' })).toBe('measurement');
  });

  it('uses the chosen occasion when a watch is tagged', () => {
    expect(newPostUseCase({ source: null, watchId: 'w1', occasion: 'dinner' })).toBe('dinner');
  });

  it('defaults to unspecified when details never opened', () => {
    expect(newPostUseCase({ source: null, watchId: 'w1', occasion: 'unspecified' })).toBe('unspecified');
    expect(newPostUseCase({ source: null, watchId: 'w1', occasion: null })).toBe('unspecified');
  });

  it('stays unspecified when no watch is tagged (occasion is meaningless)', () => {
    expect(newPostUseCase({ source: null, watchId: null, occasion: 'travel' })).toBe('unspecified');
  });
});

// ── Guard rails on the index.html wiring ─────────────────────────────────────
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Track date — index.html wiring', () => {
  it('renders the Today / Yesterday / Pick date chip row', () => {
    expect(html).toContain('id="track-date-chips"');
    expect(html).toContain('data-dval="today"');
    expect(html).toContain('data-dval="yesterday"');
    expect(html).toContain('data-dval="pick"');
  });

  it('keeps the native date input (hidden) and still fires onDateChange', () => {
    expect(html).toContain('id="track-date"');
    expect(html).toContain('function selectTrackDateChip');
    expect(html).toContain('function syncTrackDateChips');
  });

  it('drops the cramped .tl-modal date override', () => {
    expect(html).not.toContain('.tl-modal input[type=date]');
  });
});

describe('Post occasion + strap — index.html wiring', () => {
  it('has a collapsed Details block with occasion + strap chips', () => {
    expect(html).toContain('id="np-details"');
    expect(html).toContain('id="np-usecase-chips"');
    expect(html).toContain('id="np-strap-chips"');
    expect(html).toContain('function toggleNpDetails');
    expect(html).toContain('function renderNpDetails');
  });

  it('saves use_case and strap_id on the new-post upsert', () => {
    expect(html).toMatch(/use_case: entry\.useCase/);
    expect(html).toMatch(/strap_id:/);
  });
});

describe('Private notes — removed from Track', () => {
  it('has no private-notes field or references', () => {
    expect(html).not.toContain('track-private-notes');
    expect(html).not.toContain('privateNotes');
  });
});
