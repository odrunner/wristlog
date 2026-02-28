import { describe, it, expect } from 'vitest';
import { validateLog, buildLogEntry, applyStrapSelection } from '../wristlog.js';

describe('validateLog', () => {
  it('returns error when date is missing', () => {
    expect(validateLog({ date: '', watchId: 'w1' })).toBe('Please select a date');
  });

  it('returns error when date is null', () => {
    expect(validateLog({ date: null, watchId: 'w1' })).toBe('Please select a date');
  });

  it('returns error when watchId is missing', () => {
    expect(validateLog({ date: '2024-06-15', watchId: '' })).toBe('Please select a watch');
  });

  it('returns error when watchId is null', () => {
    expect(validateLog({ date: '2024-06-15', watchId: null })).toBe('Please select a watch');
  });

  it('returns null when both are provided', () => {
    expect(validateLog({ date: '2024-06-15', watchId: 'w1' })).toBeNull();
  });
});

describe('buildLogEntry', () => {
  it('builds a complete log entry with all fields', () => {
    const entry = buildLogEntry({
      id: 'log1', watchId: 'w1', date: '2024-06-15',
      useCase: 'work', notes: 'Office day', strapId: 's1',
      photoUrl: 'https://example.com/photo.jpg',
    });
    expect(entry.id).toBe('log1');
    expect(entry.watchId).toBe('w1');
    expect(entry.date).toBe('2024-06-15');
    expect(entry.useCase).toBe('work');
    expect(entry.notes).toBe('Office day');
    expect(entry.strapId).toBe('s1');
    expect(entry.photoUrl).toBe('https://example.com/photo.jpg');
  });

  it('defaults useCase to unspecified', () => {
    const entry = buildLogEntry({ id: 'l', watchId: 'w1', date: '2024-01-01' });
    expect(entry.useCase).toBe('unspecified');
  });

  it('defaults notes to null when empty', () => {
    const entry = buildLogEntry({ id: 'l', watchId: 'w1', date: '2024-01-01', notes: '' });
    expect(entry.notes).toBeNull();
  });

  it('defaults photoUrl to null when empty', () => {
    const entry = buildLogEntry({ id: 'l', watchId: 'w1', date: '2024-01-01', photoUrl: '' });
    expect(entry.photoUrl).toBeNull();
  });

  it('does not include strapId when not provided', () => {
    const entry = buildLogEntry({ id: 'l', watchId: 'w1', date: '2024-01-01' });
    expect('strapId' in entry).toBe(false);
  });

  it('includes strapId when provided', () => {
    const entry = buildLogEntry({ id: 'l', watchId: 'w1', date: '2024-01-01', strapId: 's1' });
    expect(entry.strapId).toBe('s1');
  });
});

describe('applyStrapSelection', () => {
  const watches = [
    {
      id: 'w1', brand: 'Omega', name: 'Speedy',
      straps: [
        { id: 's1', name: 'Bracelet', isOn: true },
        { id: 's2', name: 'NATO', isOn: false },
      ],
    },
    {
      id: 'w2', brand: 'Seiko', name: 'SKX',
      straps: [{ id: 's3', name: 'Jubilee', isOn: true }],
    },
  ];

  it('sets the selected strap as isOn and others as false', () => {
    const result = applyStrapSelection(watches, 'w1', 's2');
    const w1 = result.find(w => w.id === 'w1');
    expect(w1.straps[0].isOn).toBe(false);
    expect(w1.straps[1].isOn).toBe(true);
  });

  it('does not modify other watches', () => {
    const result = applyStrapSelection(watches, 'w1', 's2');
    const w2 = result.find(w => w.id === 'w2');
    expect(w2).toEqual(watches[1]);
  });

  it('returns watches unchanged when strapId is null', () => {
    const result = applyStrapSelection(watches, 'w1', null);
    expect(result).toEqual(watches);
  });

  it('returns watches unchanged when watch has no straps', () => {
    const noStraps = [{ id: 'w1', brand: 'Casio', name: 'F91W', straps: [] }];
    const result = applyStrapSelection(noStraps, 'w1', 's1');
    expect(result[0].straps).toEqual([]);
  });

  it('does not mutate the original watches array', () => {
    const original = JSON.parse(JSON.stringify(watches));
    applyStrapSelection(watches, 'w1', 's2');
    expect(watches[0].straps[0].isOn).toBe(true); // original unchanged
    expect(watches).toEqual(original);
  });
});
