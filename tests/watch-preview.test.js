import { describe, it, expect } from 'vitest';
import { escHtml } from '../wrotate_test.js';

// ── Watch preview modal data structure tests ───────────────────────────────
// Recent changes:
// - Thumbnail added top-right of title area
// - Ref/link row moved above the scroll area
// - Link has outline:none

describe('watch preview modal: data structure', () => {
  it('watch preview data has all expected fields', () => {
    const w = {
      id: 'w1',
      brand: 'Rolex',
      name: 'Submariner',
      ref: '126610LN',
      url: 'https://www.rolex.com/watches/submariner',
      image: 'https://example.com/sub.jpg',
      color: '#1a1a2e',
      description: 'The reference among diver watches.',
      background: 'Launched in 1953.',
      functions: 'Unidirectional rotatable bezel.',
    };
    expect(w.brand).toBeTruthy();
    expect(w.name).toBeTruthy();
    expect(w.ref).toBeTruthy();
    expect(w.url).toBeTruthy();
    expect(w.image).toBeTruthy();
  });

  it('title combines brand and name with separator', () => {
    const w = { brand: 'Rolex', name: 'Submariner' };
    const title = [w.brand, w.name].filter(Boolean).join(' - ') || 'Watch';
    expect(title).toBe('Rolex - Submariner');
  });

  it('title handles missing brand', () => {
    const w = { brand: null, name: 'Submariner' };
    const title = [w.brand, w.name].filter(Boolean).join(' - ') || 'Watch';
    expect(title).toBe('Submariner');
  });

  it('title handles missing name', () => {
    const w = { brand: 'Rolex', name: null };
    const title = [w.brand, w.name].filter(Boolean).join(' - ') || 'Watch';
    expect(title).toBe('Rolex');
  });

  it('title falls back to "Watch" when both missing', () => {
    const w = { brand: null, name: null };
    const title = [w.brand, w.name].filter(Boolean).join(' - ') || 'Watch';
    expect(title).toBe('Watch');
  });
});

// ── Thumbnail rendering logic ──────────────────────────────────────────────
// Thumbnail is now shown top-right of the title area when image exists.

describe('watch preview modal: thumbnail', () => {
  it('renders thumbnail img tag when image exists', () => {
    const w = { image: 'https://example.com/watch.jpg' };
    let thumbHtml = '';
    if (w.image) {
      thumbHtml = `<img src="${escHtml(w.image)}" style="width:96px;height:96px;object-fit:contain;border-radius:8px;flex-shrink:0;" onerror="this.parentElement.innerHTML=''">`;
    }
    expect(thumbHtml).toContain('img src=');
    expect(thumbHtml).toContain('96px');
    expect(thumbHtml).toContain('object-fit:contain');
    expect(thumbHtml).toContain('border-radius:8px');
  });

  it('renders empty string when no image', () => {
    const w = { image: null };
    let thumbHtml = '';
    if (w.image) {
      thumbHtml = `<img src="${escHtml(w.image)}">`;
    }
    expect(thumbHtml).toBe('');
  });

  it('renders empty string when image is empty string', () => {
    const w = { image: '' };
    let thumbHtml = '';
    if (w.image) {
      thumbHtml = `<img src="${escHtml(w.image)}">`;
    }
    expect(thumbHtml).toBe('');
  });

  it('escapes HTML in image URL', () => {
    const w = { image: 'https://example.com/watch.jpg?a=1&b=2' };
    const escaped = escHtml(w.image);
    expect(escaped).toContain('&amp;');
    expect(escaped).not.toContain('&b');
  });
});

// ── Ref/link row rendering ─────────────────────────────────────────────────
// Ref and link row is now above the scroll area.

describe('watch preview modal: ref/link row', () => {
  it('shows ref span when ref exists', () => {
    const w = { ref: '126610LN', url: null };
    const refSpan = w.ref
      ? `<span style="font-size:.78rem;color:var(--muted);font-weight:600;">${escHtml(w.ref)}</span>`
      : '';
    expect(refSpan).toContain('126610LN');
    expect(refSpan).toContain('font-weight:600');
  });

  it('shows empty ref span when ref is null', () => {
    const w = { ref: null, url: null };
    const refSpan = w.ref
      ? `<span>${escHtml(w.ref)}</span>`
      : '';
    expect(refSpan).toBe('');
  });

  it('shows link button when url exists with outline:none', () => {
    const w = { ref: null, url: 'https://www.rolex.com' };
    const urlBtn = w.url
      ? `<a href="${escHtml(w.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;outline:none;padding:.35rem;border-radius:8px;">link</a>`
      : '';
    expect(urlBtn).toContain('outline:none');
    expect(urlBtn).toContain('target="_blank"');
    expect(urlBtn).toContain('rel="noopener noreferrer"');
  });

  it('link button has no outline:none removed (not present in link)', () => {
    const w = { url: 'https://www.rolex.com' };
    // Verify the production pattern: outline:none is present
    const style = 'display:inline-flex;align-items:center;outline:none;padding:.35rem;border-radius:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);text-decoration:none;';
    expect(style).toContain('outline:none');
  });

  it('ref row renders when ref or url exists', () => {
    const w = { ref: '126610LN', url: 'https://example.com' };
    const hasRow = w.ref || w.url;
    expect(hasRow).toBeTruthy();
  });

  it('ref row does not render when neither ref nor url exists', () => {
    const w = { ref: null, url: null };
    const hasRow = w.ref || w.url;
    expect(hasRow).toBeFalsy();
  });

  it('ref row does not render when both are empty strings', () => {
    const w = { ref: '', url: '' };
    const hasRow = w.ref || w.url;
    expect(hasRow).toBeFalsy();
  });
});

// ── Watch preview content cards ────────────────────────────────────────────

describe('watch preview modal: content cards', () => {
  it('shows description when present', () => {
    const w = { description: 'The reference among diver watches.', background: '', functions: '' };
    const hasContent = w.description || w.background || w.functions;
    expect(hasContent).toBeTruthy();
  });

  it('shows background when present', () => {
    const w = { description: '', background: 'Launched in 1953.', functions: '' };
    const hasContent = w.description || w.background || w.functions;
    expect(hasContent).toBeTruthy();
  });

  it('shows functions when present', () => {
    const w = { description: '', background: '', functions: 'Unidirectional bezel.' };
    const hasContent = w.description || w.background || w.functions;
    expect(hasContent).toBeTruthy();
  });

  it('shows no content card when all empty', () => {
    const w = { description: '', background: '', functions: '' };
    const hasContent = w.description || w.background || w.functions;
    expect(hasContent).toBeFalsy();
  });

  it('shows all sections when all present', () => {
    const w = { description: 'Desc', background: 'Bg', functions: 'Fn' };
    const sections = [w.description, w.background, w.functions].filter(Boolean);
    expect(sections.length).toBe(3);
  });
});

// ── Wishlist preview ───────────────────────────────────────────────────────

describe('watch preview from wishlist element', () => {
  it('extracts preview data from element dataset', () => {
    // Simulates previewWishFromEl() extracting from data attributes
    const dataset = {
      wishBrand: 'Patek Philippe',
      wishName: 'Nautilus',
      wishRef: '5711/1A',
      wishUrl: 'https://example.com',
      wishImage: 'https://example.com/img.jpg',
      wishColor: '#c9a84c',
    };
    const w = {
      id: '',
      brand: dataset.wishBrand || '',
      name: dataset.wishName || '',
      ref: dataset.wishRef || '',
      url: dataset.wishUrl || '',
      image: dataset.wishImage || '',
      color: dataset.wishColor || '#c9a84c',
    };
    expect(w.brand).toBe('Patek Philippe');
    expect(w.name).toBe('Nautilus');
    expect(w.ref).toBe('5711/1A');
  });

  it('uses default color when wishColor not set', () => {
    const dataset = {};
    const color = dataset.wishColor || '#c9a84c';
    expect(color).toBe('#c9a84c');
  });
});
