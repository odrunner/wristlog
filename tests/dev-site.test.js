// Audit 2026-09-23 SEC-23-13: the LAN dev server must expose only what
// production publishes (SITE_FILES) plus the gitignored dev-config.js —
// never .git, sql/, audit-results/, scripts/, .claude/ or CLAUDE.md.
import { describe, it, expect } from 'vitest';
import { devSiteEntries } from '../scripts/dev-site.mjs';

describe('dev server allowlist (scripts/dev-site.mjs)', () => {
  const entries = devSiteEntries();

  it('serves the site plus dev-config.js', () => {
    expect(entries).toContain('index.html');
    expect(entries).toContain('dev-config.js');
  });

  it('never includes private repo paths', () => {
    for (const bad of ['.git', '.claude', 'sql', 'audit-results', 'scripts', 'supabase', 'docs', 'CLAUDE.md', 'TODO.md', 'package.json', 'ios', 'e2e', 'tests']) {
      expect(entries).not.toContain(bad);
    }
    for (const e of entries) {
      if (e.startsWith('.')) expect(['.well-known', '.nojekyll']).toContain(e);
    }
  });
});
