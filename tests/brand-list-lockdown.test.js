import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { buildBrandList } from '../wrotate_test.js';

// Bug (2026-07-18): the brand list was never meant to be user-editable, but
// ensureBrand() upserted every brand a user typed into the GLOBAL brands table
// (RLS allowed any authenticated insert), and loadUserData merged the whole
// table into every user's picker. One user's "Rolex op blue" showed up for
// everyone. Fix: brands.is_canonical gates the shared list; a user's own
// non-canonical brands come from their own collection only.
//
// Spec: docs/2026-07-18-brand-list-lockdown-plan.md

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('buildBrandList', () => {
  const canonical = ['Rolex', 'Omega', 'Seiko'];

  it('returns the canonical list when the user owns nothing unusual', () => {
    expect(buildBrandList(canonical, [{ brand: 'Rolex' }], [])).toEqual(['Omega', 'Rolex', 'Seiko']);
  });

  it("does NOT include another user's junk brand", () => {
    // "Rolex op blue" is non-canonical and not in this user's collection.
    const out = buildBrandList(canonical, [{ brand: 'Rolex' }], []);
    expect(out).not.toContain('Rolex op blue');
  });

  it('DOES include the owner\'s own non-canonical brand', () => {
    const out = buildBrandList(canonical, [{ brand: 'Rolex op blue' }], []);
    expect(out).toContain('Rolex op blue');
  });

  it('includes non-canonical brands from the wishlist too', () => {
    const out = buildBrandList(canonical, [], [{ brand: 'Omega blue strap' }]);
    expect(out).toContain('Omega blue strap');
  });

  it('dedupes case-insensitively, preferring the canonical spelling', () => {
    const out = buildBrandList(canonical, [{ brand: 'rolex' }], []);
    expect(out.filter(b => b.toLowerCase() === 'rolex')).toEqual(['Rolex']);
  });

  it('keeps the user\'s own casing for a brand that is not canonical', () => {
    const out = buildBrandList(canonical, [{ brand: 'Rolex Smurf' }], []);
    expect(out).toContain('Rolex Smurf');
  });

  it('is sorted case-insensitively', () => {
    const out = buildBrandList(['Zenith', 'anOrdinaryBrand'], [], []);
    expect(out).toEqual(['anOrdinaryBrand', 'Zenith']);
  });

  it('ignores blank / whitespace / missing brand values', () => {
    const out = buildBrandList(canonical, [{ brand: '' }, { brand: '   ' }, {}], []);
    expect(out).toEqual(['Omega', 'Rolex', 'Seiko']);
  });

  it('trims surrounding whitespace on own brands', () => {
    const out = buildBrandList(canonical, [{ brand: '  Rolex Smurf  ' }], []);
    expect(out).toContain('Rolex Smurf');
    expect(out).not.toContain('  Rolex Smurf  ');
  });

  it('tolerates null/undefined inputs', () => {
    expect(buildBrandList(null, null, null)).toEqual([]);
    expect(buildBrandList(canonical, undefined, undefined)).toEqual(['Omega', 'Rolex', 'Seiko']);
  });

  it('never mutates the caller\'s canonical array', () => {
    const src = ['Rolex'];
    buildBrandList(src, [{ brand: 'Rolex Smurf' }], []);
    expect(src).toEqual(['Rolex']);
  });
});

describe('brand write-path lockdown (index.html)', () => {
  const start = html.indexOf('function ensureBrand(');
  const fn = html.slice(start, html.indexOf('\n}', start));

  it('ensureBrand exists', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('ensureBrand no longer writes to the brands table', () => {
    expect(fn).not.toContain("from('brands')");
    expect(fn).not.toContain('.upsert(');
  });

  it('no code path anywhere writes to the brands table', () => {
    expect(html).not.toMatch(/from\('brands'\)\s*\.\s*(upsert|insert|update|delete)/);
  });

  it('the brands select is filtered to canonical rows', () => {
    expect(html).toMatch(/from\('brands'\)\s*\.select\('name'\)\s*\.eq\('is_canonical',\s*true\)/);
  });

  it('the picker is built via buildBrandList, not an append-only merge', () => {
    expect(html).toContain('buildBrandList(');
  });

  it('defines buildBrandList in the page', () => {
    expect(html).toContain('function buildBrandList(');
  });

  it('runs a one-time rebuild of the cached local list', () => {
    expect(html).toContain('wristlog_brands_rebuilt_v1');
  });
});

describe('auto-add-brand remains the only way into the shared list', () => {
  const fn = readFileSync(
    join(__dirname, '..', 'supabase', 'functions', 'auto-add-brand', 'index.ts'), 'utf8');

  it('inserts verified brands as canonical (default is false)', () => {
    expect(fn).toMatch(/\.insert\(\{\s*name:\s*finalName,\s*is_canonical:\s*true\s*\}\)/);
  });

  it('promotes an already-existing personal row once verified', () => {
    expect(fn).toMatch(/\.update\(\{\s*is_canonical:\s*true\s*\}\)/);
  });
});
