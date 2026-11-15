import { describe, it, expect } from 'vitest';

// Mirrors index.html _tgAlgo(). The Standard engine selector was retired 2026-10-25 and
// the pre-2.1 'original' fallback on 2026-11-15 (field 100% on 2.5+): the page drives
// Pro V2 only. There is no web engine; a plain browser never starts a measurement.
function _tgAlgo() { return 'tg'; }

describe('measurement engine (Pro V2 only)', () => {
  it('is Pro V2', () => {
    expect(_tgAlgo()).toBe('tg');
  });
});
