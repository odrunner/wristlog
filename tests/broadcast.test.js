import { describe, it, expect } from 'vitest';
import { imgSnippet, inlineImages, sharePostUrl, escHtml } from '../wrotate_test.js';

// ── imgSnippet ──────────────────────────────────────────────────────────

describe('imgSnippet', () => {
  it('renders image with src', () => {
    const result = imgSnippet({ src: 'https://example.com/watch.jpg', caption: '' });
    expect(result).toContain('src="https://example.com/watch.jpg"');
    expect(result).not.toContain('font-size:12px'); // no caption div
  });

  it('renders image with caption', () => {
    const result = imgSnippet({ src: 'https://example.com/watch.jpg', caption: 'My watch' });
    expect(result).toContain('src="https://example.com/watch.jpg"');
    expect(result).toContain('My watch');
    expect(result).toContain('font-size:12px'); // caption div present
  });

  it('escapes HTML in src', () => {
    const result = imgSnippet({ src: 'https://example.com/a"b<c', caption: '' });
    expect(result).toContain('&quot;');
    expect(result).toContain('&lt;');
    expect(result).not.toContain('"b<c"');
  });

  it('escapes HTML in caption', () => {
    const result = imgSnippet({ src: 'https://example.com/img.jpg', caption: '<script>alert(1)</script>' });
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('closes and reopens body div for inline placement', () => {
    const result = imgSnippet({ src: 'x.jpg', caption: '' });
    expect(result).toMatch(/^<\/div><\/td><\/tr>/);
    expect(result).toMatch(/<div style="font-size:14px/);
  });
});

// ── inlineImages ────────────────────────────────────────────────────────

describe('inlineImages', () => {
  const images = [
    { src: 'img1.jpg', caption: 'First' },
    { src: 'img2.jpg', caption: 'Second' },
  ];

  it('replaces [img1] marker with image snippet', () => {
    const result = inlineImages('Hello [img1] world', images);
    expect(result).toContain('src="img1.jpg"');
    expect(result).toContain('First');
    expect(result).not.toContain('[img1]');
  });

  it('replaces multiple markers', () => {
    const result = inlineImages('A [img1] B [img2] C', images);
    expect(result).toContain('src="img1.jpg"');
    expect(result).toContain('src="img2.jpg"');
    expect(result).not.toContain('[img1]');
    expect(result).not.toContain('[img2]');
  });

  it('leaves unreferenced markers if no matching image', () => {
    const result = inlineImages('A [img1] B [img3] C', images);
    expect(result).toContain('src="img1.jpg"');
    expect(result).toContain('[img3]'); // no image at index 2
  });

  it('returns body unchanged if no markers', () => {
    const result = inlineImages('Hello world', images);
    expect(result).toBe('Hello world');
  });

  it('handles empty images array', () => {
    const result = inlineImages('A [img1] B', []);
    expect(result).toBe('A [img1] B');
  });

  it('does not replace marker if image is null', () => {
    const result = inlineImages('A [img1] B', [null]);
    expect(result).toBe('A [img1] B');
  });
});

// ── sharePostUrl ────────────────────────────────────────────────────────

describe('sharePostUrl', () => {
  it('builds correct share URL', () => {
    const url = sharePostUrl('abc-123');
    expect(url).toBe('https://api.wrotate.com/functions/v1/share-post?id=abc-123');
  });

  it('handles UUID format', () => {
    const url = sharePostUrl('d70b1a85-4f31-4431-b3b7-db76543daaf5');
    expect(url).toContain('d70b1a85-4f31-4431-b3b7-db76543daaf5');
  });
});
