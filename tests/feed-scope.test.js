import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scopeChipLabel } from '../wrotate_test.js';

// The banner's "Show all posts" control is gone — no copy may still point at it.
describe('no stale banner copy', () => {
  it('index.html never mentions Show all posts', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html.includes('Show all posts')).toBe(false);
  });
});

// The feed scope chip's label. Filters (profile → Posts, model → photos)
// win over the selected scope; raw text, the caller escapes.

describe('scopeChipLabel', () => {
  it('names each scope', () => {
    expect(scopeChipLabel('all', null, null)).toBe('All posts');
    expect(scopeChipLabel('following', null, null)).toBe('People I follow');
    expect(scopeChipLabel('friends', null, null)).toBe('Close friends');
    expect(scopeChipLabel('mine', null, null)).toBe('My posts');
  });

  it('falls back to All posts for an unknown scope', () => {
    expect(scopeChipLabel('bogus', null, null)).toBe('All posts');
  });

  it('a user filter beats the scope', () => {
    expect(scopeChipLabel('following', { uname: 'steve', dname: 'Steve X' }, null)).toBe('@steve’s posts');
  });

  it('user filter without a username uses the display name', () => {
    expect(scopeChipLabel('all', { uname: '', dname: 'Steve' }, null)).toBe('Steve’s posts');
  });

  it('user filter with no names at all', () => {
    expect(scopeChipLabel('all', { uname: '', dname: '' }, null)).toBe('this member’s posts');
  });

  it('a model filter beats the scope', () => {
    expect(scopeChipLabel('mine', null, { brand: 'Rolex', name: 'Datejust' })).toBe('Rolex Datejust posts');
  });

  it('model filter with no names', () => {
    expect(scopeChipLabel('all', null, { brand: '', name: null })).toBe('this watch posts');
  });

  it('user filter wins over model filter (invariant: never both set)', () => {
    expect(scopeChipLabel('all', { uname: 'steve', dname: '' }, { brand: 'Rolex', name: 'Datejust' })).toBe('@steve’s posts');
  });
});
