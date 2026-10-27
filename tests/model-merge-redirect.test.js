import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Merged model slugs must keep working (weekly agents A4, 2026-10-12):
// model_page() follows merged_into to the canonical row, the client rewrites
// the address bar, and the sitemap lists content-bearing model pages so the
// URLs Google gets can never rot on an admin merge.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sql = readFileSync(join(root, 'sql', '2026-08-23-model-page.sql'), 'utf8');
const wpage = readFileSync(join(root, 'w', 'index.html'), 'utf8');
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');

describe('model_page merge-following (sql source)', () => {
  it('follows merged_into with a depth cap instead of filtering merged rows out', () => {
    expect(sql).not.toContain('slug = p_slug and merged_into is null');
    expect(sql).toMatch(/while v_m\.id is not null and v_m\.merged_into is not null and v_hops < \d+ loop/);
  });
});

describe('w/ page canonical rewrite', () => {
  it('rewrites the address bar when the returned slug differs from the requested one', () => {
    expect(wpage).toContain("if (m.slug && m.slug !== slug) history.replaceState(null, '', '/w/?m=' + encodeURIComponent(m.slug));");
  });
  it('still sets the canonical link from the RETURNED slug', () => {
    expect(wpage).toContain("canon.href = `https://wrotate.com/w/?m=${encodeURIComponent(m.slug)}`");
  });
  it('ships no static canonical — a fixed href would mark every slug a duplicate of one URL', () => {
    expect(wpage).not.toMatch(/<link rel="canonical"/);
  });
});

describe('model hub crawl graph (w/all/)', () => {
  const hub = readFileSync(join(root, 'w', 'all', 'index.html'), 'utf8');
  it('lists exactly the sitemap model slugs — both come from gen-sitemap.mjs, so drift means a stale regen', () => {
    const smSlugs = [...sitemap.matchAll(/\/w\/\?m=([a-z0-9-]+)<\/loc>/g)].map(m => m[1]).sort();
    const hubSlugs = [...hub.matchAll(/href="\/w\/\?m=([a-z0-9-]+)"/g)].map(m => m[1]).sort();
    expect(hubSlugs).toEqual(smSlugs);
  });
  it('is in the sitemap and every watch page links back to it', () => {
    expect(sitemap).toContain('https://wrotate.com/w/all/</loc>');
    expect(wpage).toContain('href="/w/all/"');
  });
});

describe('sitemap', () => {
  it('keeps the four static pages', () => {
    for (const loc of ['https://wrotate.com/</loc>', '/privacy.html</loc>', '/terms.html</loc>', '/profile/</loc>']) {
      expect(sitemap).toContain(loc);
    }
  });
  it('lists a meaningful set of model pages with safe slugs', () => {
    const models = sitemap.match(/\/w\/\?m=([a-z0-9-]+)<\/loc>/g) || [];
    expect(models.length).toBeGreaterThan(50);
    // every /w/ loc matches the safe-slug pattern (nothing needing XML escaping)
    expect((sitemap.match(/\/w\/\?m=/g) || []).length).toBe(models.length);
  });
});
