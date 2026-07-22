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

describe('Totals card day-over-day deltas', () => {
  // Every count metric on the totals card wires a dod.* delta from admin_dod_counts
  // (SECURITY DEFINER RPC, external users only, last 24h). Spec: sql/2026-07-20-admin-dod-full.sql.
  const dodKeys = ['users', 'watches', 'wears', 'priceChecks', 'enhances',
    'measurements', 'wish', 'clubs', 'follows', 'friends', 'likes', 'comments'];

  it.each(dodKeys)('passes dod.%s into a statRow', (key) => {
    expect(html).toContain(`dod.${key}`);
  });

  it('fetches the deltas from the admin_dod_counts RPC', () => {
    expect(html).toContain("db.rpc('admin_dod_counts')");
  });

  it('Advanced mode delta compares 24h vs the prior 24h window', () => {
    expect(html).toMatch(/advDelta\s*=\s*advSessions24h\s*-\s*advSessionsPrev24h/);
    // prior-window advanced sessions parsed identically to the 24h window
    expect(html).toContain('advSessionsPrevByUser');
    expect(html).toMatch(/statRow\('Advanced mode \(24h\)',\s*advSessions24h,\s*advDelta/);
  });

  it('Pro V2 Beta row: total stands alone, active-vs-prior change lives in the sub', () => {
    expect(html).toContain('beta_users_prev24h');
    // total passes null delta (no change glued to the all-time total); the 24h-active
    // change is folded into the sub via inlineDelta, next to the "active (24h)" figure
    expect(html).toMatch(/statRow\('Pro V2 Beta users \(total\)',[^\n]*null,[^\n]*inlineDelta\([^\n]*beta_users_24h[^\n]*beta_users_prev24h/);
  });

  it('Email Unsubs row: total stands alone, 24h change inverted (a rise is not green)', () => {
    // total passes null delta; the 24h change is inverted (higher-is-bad) via inlineDelta(..., true)
    expect(html).toMatch(/statRow\('Email Unsubs \(total\)',[^\n]*null,[^\n]*inlineDelta\([^\n]*unsub_prev24h[^\n]*,\s*true\)/);
  });

  it('inlineDelta colors an embedded change and inverts when a rise is bad', () => {
    expect(html).toMatch(/const inlineDelta = \(delta, invert\) => \{[\s\S]*?const good = invert \? delta < 0 : delta > 0;/);
  });

  it('statRow renders green only when good, honoring the invert flag', () => {
    expect(html).toMatch(/const good = invert \? delta < 0 : delta > 0;/);
  });
});
