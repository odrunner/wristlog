import { describe, it, expect } from 'vitest';
import { normalizeLocation, renderPostLocationHtml } from '../wrotate_test.js';

// Spec: 2026-06-01-post-location-design.md

describe('normalizeLocation', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeLocation('  Geneva  ')).toBe('Geneva');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeLocation('Wempe   New   York')).toBe('Wempe New York');
  });

  it('caps at 60 characters', () => {
    const long = 'a'.repeat(80);
    expect(normalizeLocation(long)).toHaveLength(60);
  });

  it('returns null for empty / whitespace-only', () => {
    expect(normalizeLocation('')).toBe(null);
    expect(normalizeLocation('   ')).toBe(null);
  });

  it('returns null for null / undefined', () => {
    expect(normalizeLocation(null)).toBe(null);
    expect(normalizeLocation(undefined)).toBe(null);
  });

  it('passes a preset through unchanged', () => {
    expect(normalizeLocation('Travel')).toBe('Travel');
  });
});

describe('renderPostLocationHtml', () => {
  it('renders a pinned label with a grayscale SVG pin (not the red emoji) when present', () => {
    const out = renderPostLocationHtml('Home');
    expect(out).toContain(' · ');
    expect(out).toContain('Home');
    expect(out).toContain('<svg'); // grayscale pin icon
    expect(out).toContain('currentColor'); // inherits muted text color, not red
    expect(out).not.toContain('📍'); // no red emoji pin
  });

  it('returns empty string when absent', () => {
    expect(renderPostLocationHtml(null)).toBe('');
    expect(renderPostLocationHtml('')).toBe('');
    expect(renderPostLocationHtml('   ')).toBe('');
  });

  it('escapes HTML in the free-text location (no injection)', () => {
    const out = renderPostLocationHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });

  it('normalizes the location text before rendering (trim + cap)', () => {
    expect(renderPostLocationHtml('  Geneva  ')).toContain('Geneva');
    expect(renderPostLocationHtml('  Geneva  ')).not.toContain('  Geneva');
  });
});

// Guard rails on the index.html wiring.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Post location — index.html wiring', () => {
  it('composer and edit-post both have a location field', () => {
    expect(html).toContain('id="np-location-input"');
    expect(html).toContain('id="ep-location-input"');
    expect(html).toContain('id="np-location-chips"');
    expect(html).toContain('id="ep-location-chips"');
  });

  it('offers Home / Work preset chips', () => {
    for (const p of ['Home', 'Work']) {
      expect(html).toContain(`data-loc="${p}"`);
    }
  });

  it('no longer offers a Travel preset chip (free text still allowed)', () => {
    expect(html).not.toContain('data-loc="Travel"');
    expect(html).toContain("POST_LOCATION_PRESETS = ['Home', 'Work']");
  });

  it('saves location on new post and includes it in the logs upsert', () => {
    expect(html).toMatch(/location: location/);
    expect(html).toMatch(/location: entry\.location/);
  });

  it('saves location on edit and prefills it when opening edit', () => {
    expect(html).toContain("setPostLocationField('ep', fi.location)");
    expect(html).toMatch(/location: newLocation/);
  });

  it('fetches location in the feed column lists', () => {
    expect(html).toMatch(/FEED_LOG_COLS = '[^']*location/);
  });
});
