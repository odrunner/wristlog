import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SITE_FILES, buildSite } from '../scripts/build-site.mjs';
import { readFileSync, existsSync, rmSync, mkdtempSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// wrotate.com publishes only SITE_FILES (.github/workflows/pages.yml). These
// tests catch the two ways that goes wrong: the site loading a file that isn't
// published (a broken page), and a private file being published again.

let out;
beforeAll(() => { out = buildSite(mkdtempSync(join(tmpdir(), 'wrotate-site-'))); });
afterAll(() => rmSync(out, { recursive: true, force: true }));

// `from` is the page's own URL: a link without a leading slash resolves against
// the page's folder, exactly as the browser does (profile/'s href="icon.svg"
// meant /profile/icon.svg, a 404 from March to September 2026).
const published = (p, from = '/') => {
  const clean = decodeURIComponent(new URL(p, `https://wrotate.com${from}`).pathname).replace(/^\//, '');
  const target = join(out, clean);
  if (!existsSync(target)) return false;
  return statSync(target).isDirectory() ? existsSync(join(target, 'index.html')) : true;
};

const PAGES = ['index.html', 'open.html', 'privacy.html', 'terms.html', 'p/index.html', 'profile/index.html', 'w/index.html'];

describe('site build', () => {
  it('publishes every local src/href the pages reference', () => {
    const missing = [];
    for (const page of PAGES) {
      const html = readFileSync(join(root, page), 'utf8');
      for (const [, url] of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
        if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(url) || url.includes('${')) continue;
        if (url === 'dev-config.js') continue; // local-only credentials, 404 in production by design
        if (!published(url, '/' + page.replace(/index\.html$/, ''))) missing.push(`${page} → ${url}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('publishes every service-worker precache entry', () => {
    const list = readFileSync(join(root, 'sw.js'), 'utf8').match(/const PRECACHE = \[([^\]]*)\]/)[1];
    const entries = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter(e => e !== '/' && !published(e))).toEqual([]);
  });

  it('publishes the manifest icons and the universal-links file', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    for (const icon of manifest.icons) expect(published(icon.src)).toBe(true);
    expect(published('.well-known/apple-app-site-association')).toBe(true);
    expect(readFileSync(join(out, 'CNAME'), 'utf8').trim()).toBe('wrotate.com');
  });

  it('keeps private paths off the site', () => {
    const top = readdirSync(out);
    for (const p of ['audit-results', 'sql', 'scripts', 'docs', 'supabase', 'tests', 'e2e', 'ios', 'infra',
                     'TODO.md', 'CLAUDE.md', 'wrotate_test.js', 'dev-config.js', 'package.json', 'node_modules']) {
      expect(top).not.toContain(p);
    }
    expect(SITE_FILES.every(f => !f.startsWith('/') && !f.includes('..'))).toBe(true);
  });
});
