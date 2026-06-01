import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Guard-rail coverage for two admin metrics shipped this session that compute
// inline inside loadAdminStats (no extractable pure function): the cross-feature
// repeat-user definition and the advanced-mode usage surfacing. These assert the
// wiring stays intact so a refactor can't silently drop them.
// Specs: repeat-user (commit 7278e2d), advanced-mode (commit eed604a).
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Admin repeat-user metric (R?)', () => {
  it('reads recent_active_days from admin_user_stats', () => {
    expect(html).toMatch(/recent_active_days/);
  });

  it('marks repeat when active on 2+ days (>1 threshold)', () => {
    expect(html).toMatch(/repeat:\s*\(activeDaysByUser\[[^\]]+\]\s*\|\|\s*0\)\s*>\s*1/);
  });

  it('uses the renamed "repeat" column key (not the stale r7)', () => {
    expect(html).toContain("{ key: 'repeat', label: 'R?' }");
    expect(html).not.toMatch(/key:\s*'r7'/);
  });

  it('detail modal repeat verdict also thresholds on >1 active days', () => {
    expect(html).toMatch(/d\.active_days\s*>\s*1/);
  });
});

describe('Admin advanced-mode surfacing', () => {
  it('counts advanced_used sessions per user from session summaries', () => {
    expect(html).toMatch(/if \(msg\.advanced_used\)/);
  });

  it('shows the 24h advanced-mode rollup on the dashboard', () => {
    expect(html).toContain("statRow('Advanced mode (24h)'");
  });

  it('excludes internal accounts from the advanced-mode rollup', () => {
    expect(html).toMatch(/advEntries\s*=\s*Object\.entries\(advSessionsByUser\)\.filter\(/);
    expect(html).toMatch(/advSessionsByUser\)\.filter\(\(\[uid\]\)\s*=>\s*!INTERNAL_IDS\.has\(uid\)\)/);
  });

  it('shows an Advanced mode line in the per-user detail modal', () => {
    expect(html).toContain("row('Advanced mode'");
    expect(html).toContain('d.advanced_sessions');
  });
});
