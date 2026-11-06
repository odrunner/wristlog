import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { escAttr, escHtml } from '../wrotate_test.js';

// profileInitials' avatar branch renders an <img> whose onerror swaps in the
// member's initials when the image 404s. The browser DECODES attribute
// entities before the JS engine parses the handler, so initials embedded in a
// JS string literal break on names starting with an apostrophe or backslash
// (&#39; comes back as ' and terminates the literal) — the fallback then
// silently never renders (bug audit 2026-11-06 N3). The fallback must travel
// as a data attribute, not inside handler code.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`could not extract ${name}`);
}

const profileInitials = new Function(
  'escAttr', 'escHtml', 'thumbSrcAttrs',
  `${extractFn('profileInitials')}; return profileInitials;`
)(escAttr, escHtml, (url) => `src="${escAttr(url)}"`);

// What the JS engine receives after the HTML parser decodes the attribute.
const decodeEntities = (s) => s
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const handlerOf = (out) => {
  const m = /onerror="([^"]*)"/.exec(out);
  expect(m, `no onerror in: ${out}`).not.toBeNull();
  return decodeEntities(m[1]);
};

describe('profileInitials avatar fallback', () => {
  it('survives a display name starting with an apostrophe', () => {
    const out = profileInitials({ avatar_url: 'a.jpg', display_name: "'Omer Faruk" });
    expect(() => new Function(handlerOf(out))).not.toThrow();
  });

  it('survives a backslash in the first two characters', () => {
    const out = profileInitials({ avatar_url: 'a.jpg', display_name: '\\m/ Metal' });
    expect(() => new Function(handlerOf(out))).not.toThrow();
  });

  it('the handler reads the fallback from a data attribute, never from an inline literal', () => {
    const out = profileInitials({ avatar_url: 'a.jpg', display_name: "O'Brien Watches" });
    expect(out).toMatch(/data-fb="/);
    expect(handlerOf(out)).toContain('dataset.fb');
  });

  it('still produces the right initials text and stays XSS-safe', () => {
    const out = profileInitials({ avatar_url: 'a.jpg', display_name: '"><img src=x onerror=alert(1)>' });
    expect(out).not.toMatch(/"><img src=x/);
    const noAvatar = profileInitials({ display_name: "O'Brien Watches" });
    expect(noAvatar).toBe('OW');
  });
});
