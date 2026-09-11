// Guards sql/2026-09-11-remeasure-d7.sql (deployed straight to Supabase): the day-7
// "did it hold?" nudge — who is eligible, how arms are assigned, and the owner='server'
// contract that keeps login-time assignment out of it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-09-11-remeasure-d7.sql'), 'utf8');
describe('remeasure_d7_eligible', () => {
  it('local hour 19, opted-in, not internal, not suspended, never targeted before', () => {
    expect(sql).toMatch(/= 19/);
    expect(sql).toMatch(/email_prefs->>'reminders'/);
    expect(sql).toMatch(/internal_accounts/);
    expect(sql).toMatch(/is_suspended/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM remeasure_d7_sends s WHERE s\.user_id = p\.id\)/);
  });
  it('the FIRST kept reading, 7–8 local days ago, nothing converged on that watch since day 1', () => {
    expect(sql).toMatch(/DISTINCT ON \(t\.user_id\)[\s\S]*ORDER BY t\.user_id, t\.created_at ASC/);
    expect(sql).toMatch(/BETWEEN 7 AND 8/);
    expect(sql).toMatch(/ms\.created_at > fk\.created_at \+ interval '1 day'/);
  });
});
describe('remeasure_d7_targets', () => {
  it('assigns arms with the same hash as get_experiments, records control rows, returns treatment only', () => {
    expect(sql).toMatch(/abs\(hashtext\(d\.user_id::text \|\| '\|remeasure_d7'\)::bigint\) % 100\) < e\.rollout_pct/);
    expect(sql).toMatch(/'control', d\.local_today/);
    expect(sql).toMatch(/WHERE p_dry OR a\.variant = 'treatment'/);
  });
  it('push only for authorized/legacy tokens; everyone else gets email', () => {
    expect(sql).toMatch(/s\.status <> 'authorized'\)\s*THEN 'push' ELSE 'email' END/);
  });
  it('stops when the experiment is killed/archived; dry runs write nothing', () => {
    expect(sql).toMatch(/e\.status NOT IN \('running', 'won'\) THEN RETURN/);
    expect(sql).toMatch(/IF NOT p_dry THEN/);
  });
  it('is SECURITY DEFINER, service-role only, and reloads the schema', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION remeasure_d7_targets\(boolean\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
describe("owner = 'server' contract", () => {
  it('get_experiments never assigns server-owned experiments at login', () => {
    expect(sql).toMatch(/coalesce\(e\.owner, 'sql'\) <> 'server'/);
  });
  it('the nightly judge evaluates sql + server owners; only knob trials are deferred to Sunday', () => {
    expect(sql).toMatch(/owner IN \('sql', 'server'\)/);
    expect(sql).toMatch(/IF e\.owner = 'weekly_review' THEN/);
  });
  it('the experiment row is server-owned and running at 50%', () => {
    expect(sql).toMatch(/'running', 50, 'accuracy_reading_saved'[\s\S]*'server'\)/);
  });
});
