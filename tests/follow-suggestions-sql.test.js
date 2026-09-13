// Guards sql/2026-09-13-follow-suggestions.sql (deployed straight to Supabase): who may be
// suggested, in what order, and the privacy gates.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-09-13-follow-suggestions.sql'), 'utf8');
describe('follow_suggestions', () => {
  it('excludes self, followed, requested, blocks either way, non-public, suspended, internal', () => {
    expect(sql).toMatch(/SELECT id FROM me/);
    expect(sql).toMatch(/follows f WHERE f\.follower_id = \(SELECT id FROM me\)/);
    expect(sql).toMatch(/follow_requests r WHERE r\.requester_id = \(SELECT id FROM me\)/);
    expect(sql).toMatch(/user_blocks b WHERE b\.blocker_id = \(SELECT id FROM me\)/);
    expect(sql).toMatch(/user_blocks b WHERE b\.blocked_id = \(SELECT id FROM me\)/);
    expect(sql).toMatch(/COALESCE\(p\.profile_privacy, 'public'\) = 'public'/);   // public profiles only — never followers-only or private
    expect(sql).toMatch(/is_suspended/);
    expect(sql).toMatch(/internal_accounts/);
  });
  it('same-model owners only from public collections and public/default watches', () => {
    expect(sql).toMatch(/COALESCE\(op\.collection_visibility, 'followers'\) = 'public'/);
    expect(sql).toMatch(/ow\.watch_privacy IS NULL OR ow\.watch_privacy IN \('public', 'default'\)/);
  });
  it('ranks same_model, then liked (30 days, public posts), then followed (active 30 days)', () => {
    expect(sql).toMatch(/THEN 3 WHEN lk\.user_id IS NOT NULL THEN 2 ELSE 1 END AS tier/);
    expect(sql).toMatch(/k\.created_at > now\(\) - interval '30 days' AND l\.visibility = 'public'/);
    expect(sql).toMatch(/u\.last_seen_at > now\(\) - interval '30 days'/);
    expect(sql).toMatch(/ORDER BY tier DESC, likes \+ followers DESC, id/);
  });
  it('returns nothing to anon, caps the limit, authenticated only', () => {
    expect(sql).toMatch(/\(SELECT id FROM me\) IS NOT NULL/);
    expect(sql).toMatch(/least\(COALESCE\(p_limit, 8\), 20\)/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION follow_suggestions\(int\) TO authenticated/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION follow_suggestions\(int\) FROM PUBLIC, anon/);
  });
  it('registers the follow_created metric with its evaluator branch and starts the experiment at 50%', () => {
    expect(sql).toMatch(/'follow_created', 'Followed someone', 'rate', 'table:follows'/);
    expect(sql).toMatch(/WHEN 'table:follows' THEN\s*SELECT count\(\*\) INTO n FROM follows WHERE follower_id = p_user AND created_at >= p_since;/);
    expect(sql).toMatch(/'running', 50, 'follow_created'/);
  });
});
