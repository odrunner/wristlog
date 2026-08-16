// Guards sql/2026-08-16-value-digest.sql (deployed straight to Supabase).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-16-value-digest.sql'), 'utf8');
describe('value_digest_targets', () => {
  it('audience: priced watch, active 90d, opted in (digest), not internal/suspended, ≤1 per 25 days', () => {
    expect(sql).toMatch(/w\.market_price IS NOT NULL/);
    expect(sql).toMatch(/interval '90 days'/);
    expect(sql).toMatch(/email_prefs->>'digest'/);
    expect(sql).toMatch(/internal_accounts/);
    expect(sql).toMatch(/is_suspended/);
    expect(sql).toMatch(/current_date - 25/);
  });
  it('numbers are deterministic sums of saved values; stale = 60 days; gain only where paid > 0', () => {
    expect(sql).toMatch(/sum\(w\.market_price\)/);
    expect(sql).toMatch(/current_date - 60/);
    expect(sql).toMatch(/w\.price > 0/);
    expect(sql).not.toMatch(/watch-value|http_post/);
  });
  it('is SECURITY DEFINER and reloads the schema', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
