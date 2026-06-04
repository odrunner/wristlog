import { describe, it, expect } from 'vitest';
import { imgSnippet, inlineImages, sharePostUrl, escHtml, sanitizeHtml } from '../wrotate_test.js';

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

  it('uses the rich edge-function URL for public posts', () => {
    expect(sharePostUrl('abc-123', 'public'))
      .toBe('https://api.wrotate.com/functions/v1/share-post?id=abc-123');
  });

  it('defaults to the edge-function URL when visibility is omitted', () => {
    expect(sharePostUrl('abc-123'))
      .toBe('https://api.wrotate.com/functions/v1/share-post?id=abc-123');
  });

  it('treats legacy null/undefined visibility as public', () => {
    expect(sharePostUrl('abc-123', null))
      .toBe('https://api.wrotate.com/functions/v1/share-post?id=abc-123');
  });

  it('uses the in-app authenticated viewer for followers posts', () => {
    expect(sharePostUrl('abc-123', 'followers'))
      .toBe('https://wrotate.com/p/?id=abc-123');
  });

  it('uses the in-app authenticated viewer for close-friends posts', () => {
    expect(sharePostUrl('abc-123', 'friends'))
      .toBe('https://wrotate.com/p/?id=abc-123');
  });

  it('uses the in-app authenticated viewer for private posts', () => {
    expect(sharePostUrl('abc-123', 'private'))
      .toBe('https://wrotate.com/p/?id=abc-123');
  });
});

// ── sanitizeHtml ────────────────────────────────────────────────────────

describe('sanitizeHtml', () => {
  it('strips script tags and content', () => {
    expect(sanitizeHtml('<p>Hello</p><script>alert(1)</script>')).toBe('<p>Hello</p>');
  });

  it('strips script tags case-insensitively', () => {
    expect(sanitizeHtml('<SCRIPT>xss</SCRIPT>')).toBe('');
  });

  it('strips iframe tags and content', () => {
    expect(sanitizeHtml('<iframe src="evil.com"></iframe>')).toBe('');
  });

  it('strips object tags and content', () => {
    expect(sanitizeHtml('<object data="flash.swf"></object>')).toBe('');
  });

  it('strips embed tags', () => {
    expect(sanitizeHtml('<embed src="evil.swf">')).toBe('');
  });

  it('strips form tags and content', () => {
    expect(sanitizeHtml('<form action="/steal"><input></form>')).toBe('');
  });

  it('strips inline event handlers with double quotes', () => {
    expect(sanitizeHtml('<div onclick="alert(1)">click</div>')).toBe('<div>click</div>');
  });

  it('strips inline event handlers with single quotes', () => {
    expect(sanitizeHtml("<img onerror='alert(1)' src='x'>")).toBe("<img src='x'>");
  });

  it('strips unquoted event handlers', () => {
    expect(sanitizeHtml('<div onmouseover=alert(1)>hover</div>')).toBe('<div>hover</div>');
  });

  it('replaces javascript: URIs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('blocked:');
  });

  it('replaces vbscript: URIs', () => {
    const result = sanitizeHtml('<a href="vbscript:run">click</a>');
    expect(result).not.toContain('vbscript:');
    expect(result).toContain('blocked:');
  });

  it('preserves safe HTML', () => {
    const safe = '<h1>Hello</h1><p>Welcome to <strong>WRotate</strong></p><a href="https://wrotate.com">Visit</a>';
    expect(sanitizeHtml(safe)).toBe(safe);
  });

  it('preserves inline styles', () => {
    const styled = '<div style="color:red;font-size:14px;">styled</div>';
    expect(sanitizeHtml(styled)).toBe(styled);
  });

  it('handles multiline script tags', () => {
    const html = '<p>before</p><script>\nvar x = 1;\nalert(x);\n</script><p>after</p>';
    expect(sanitizeHtml(html)).toBe('<p>before</p><p>after</p>');
  });

  it('handles multiple dangerous elements', () => {
    const html = '<script>a</script><iframe>b</iframe><p onclick="c">d</p>';
    expect(sanitizeHtml(html)).toBe('<p>d</p>');
  });

  it('handles empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
