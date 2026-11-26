// Guards sql/2026-11-26-remeasure-steps.sql (deployed straight to Supabase): the day-3 and
// day-14 steps around the day-7 "did it hold?" nudge.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-26-remeasure-steps.sql'), 'utf8');
const fn = readFileSync(join(root, 'supabase', 'functions', 'send-measure-reminders', 'index.ts'), 'utf8');

describe('remeasure_step_eligible', () => {
  it('local hour 19, opted-in, not internal, not suspended, valid time zone from the lookup table', () => {
    expect(sql).toMatch(/= 19/);
    expect(sql).toMatch(/email_prefs->>'reminders'/);
    expect(sql).toMatch(/internal_accounts/);
    expect(sql).toMatch(/is_suspended/);
    expect(sql).toMatch(/FROM valid_timezones z/);
    expect(sql).not.toMatch(/pg_timezone_names/);
  });
  it('steps 3 and 14 off the FIRST kept reading, each once, only while not measured again', () => {
    expect(sql).toMatch(/DISTINCT ON \(t\.user_id\)[\s\S]*ORDER BY t\.user_id, t\.created_at ASC/);
    expect(sql).toMatch(/\(3::smallint, 3, 4\), \(14::smallint, 14, 15\)/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM remeasure_step_sends x WHERE x\.user_id = a\.id AND x\.step = s\.step\)/);
    expect(sql).toMatch(/ms\.created_at > a\.created_at \+ interval '1 day'/);
  });
});
describe('remeasure_step_targets', () => {
  it('assigns arms with the get_experiments hash, records control rows, returns treatment only', () => {
    expect(sql).toMatch(/abs\(hashtext\(d\.user_id::text \|\| '\|remeasure_steps'\)::bigint\) % 100\) < e\.rollout_pct/);
    expect(sql).toMatch(/'control', d\.local_today/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, step\) DO NOTHING/);
    expect(sql).toMatch(/WHERE p_dry OR a\.variant = 'treatment'/);
  });
  it('push only behind a real grant on either platform; everyone else gets email', () => {
    expect(sql).toMatch(/s\.platform = 'ios' AND s\.status <> 'authorized'/);
    expect(sql).toMatch(/s\.platform = 'android' AND s\.status = 'authorized'/);
  });
  it('kill stops it, an archived win keeps sending, dry runs write nothing', () => {
    expect(sql).toMatch(/e\.status = 'archived' AND e\.archived_from = 'won'/);
    expect(sql).toMatch(/IF NOT p_dry THEN/);
  });
  it('closed by default: table and functions reachable by the service role only', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON remeasure_step_sends FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, DELETE ON remeasure_step_sends TO service_role/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION remeasure_step_targets\(boolean\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION remeasure_step_targets\(boolean\) TO service_role/);
    expect(sql).toMatch(/owner[\s\S]*'server'\)/);
    expect(sql).toMatch(/NOTIFY pgrst/);
  });
});
describe('send-measure-reminders phase 3', () => {
  it('claims the (user, step) ledger row before sending and releases it on failure', () => {
    expect(fn).toMatch(/rpc\("remeasure_step_targets", \{ p_dry: dry \}\)/);
    expect(fn).toMatch(/from\("remeasure_step_sends"\)\s*\.insert\(/);
    expect(fn).toMatch(/from\("remeasure_step_sends"\)\.delete\(\)\.eq\("user_id", t\.user_id\)\.eq\("step", t\.step\)/);
    expect(fn).toMatch(/msgKey: `remeasure_d\$\{t\.step\}`/);
  });
});
