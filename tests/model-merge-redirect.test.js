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
    expect(wpage).toContain("document.getElementById('canonical-link').href = `https://wrotate.com/w/?m=${encodeURIComponent(m.slug)}`");
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
