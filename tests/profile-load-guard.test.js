import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { classifyProfileLoad } from '../wrotate_test.js';

// Bug (2026-07-15): loadMyProfile ignored the select error, treated any empty
// result (expired JWT, network blip, 5xx) as "new OAuth user", and upserted
// with onConflict:'id' — overwriting a real user's username, display name and
// privacy settings with Google-metadata defaults. The guard below is the fix:
// only a genuine "0 rows" (PGRST116) may enter the auto-create path, and the
// create must be an insert, never an upsert.

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('classifyProfileLoad', () => {
  it('returns ok when the profile row is present', () => {
    expect(classifyProfileLoad({ id: 'x', username: 'od' }, null)).toBe('ok');
  });

  it('returns missing on PGRST116 (0 rows) — the only true "no profile" signal', () => {
    expect(classifyProfileLoad(null, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toBe('missing');
  });

  it('returns missing when there is no data and no error', () => {
    expect(classifyProfileLoad(null, null)).toBe('missing');
  });

  it('returns error on an expired-JWT failure — must NOT trigger auto-create', () => {
    expect(classifyProfileLoad(null, { code: 'PGRST301', message: 'JWT expired' })).toBe('error');
  });

  it('returns error on a network-ish failure — must NOT trigger auto-create', () => {
    expect(classifyProfileLoad(null, { message: 'TypeError: Failed to fetch' })).toBe('error');
  });
});

describe('loadMyProfile source guard (index.html)', () => {
  // Slice out the loadMyProfile function body up to where the loaded/created
  // profile is assigned, so assertions target this code path only.
  const start = html.indexOf('async function loadMyProfile()');
  const end = html.indexOf('myProfile = data;', start);
  const fn = html.slice(start, end);

  it('loadMyProfile exists and the slice is sane', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('captures the select error instead of ignoring it', () => {
    expect(fn).toMatch(/let\s*\{\s*data\s*,\s*error\s*\}/);
  });

  it('gates the auto-create path on classifyProfileLoad', () => {
    expect(fn).toContain('classifyProfileLoad');
  });

  it('creates via insert, never upsert (upsert clobbered existing profiles)', () => {
    expect(fn).not.toContain('.upsert(');
    expect(fn).toContain('.insert(');
  });

  it('no onConflict:id escape hatch remains in the create path', () => {
    expect(fn).not.toContain("onConflict: 'id'");
  });

  it('defines classifyProfileLoad in the page itself', () => {
    expect(html).toContain('function classifyProfileLoad(');
  });
});
