import { describe, it, expect } from 'vitest';

// Mirrors index.html _tgSource(): the start message's `source` is 'piezo'
// only when the tg_piezo flag is on AND the user picked Piezo; otherwise 'mic'.
function _tgStartSource(flagOn, selected) {
  return (flagOn && selected === 'piezo') ? 'piezo' : 'mic';
}

describe('piezo source selection', () => {
  it('mic when flag off even if piezo selected', () => {
    expect(_tgStartSource(false, 'piezo')).toBe('mic');
  });
  it('piezo when flag on and piezo selected', () => {
    expect(_tgStartSource(true, 'piezo')).toBe('piezo');
  });
  it('mic when flag on but mic selected', () => {
    expect(_tgStartSource(true, 'mic')).toBe('mic');
  });
  it('defaults to mic when nothing selected', () => {
    expect(_tgStartSource(true, null)).toBe('mic');
  });
});
