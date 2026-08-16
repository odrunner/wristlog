// Guards sql/2026-08-16-measurement-sessions.sql, deployed straight to Supabase and so
// without a runtime test here. Every measurement (saved or not) writes ONE
// {"type":"session_summary",...} row into timegrapher_tick_logs; a trigger copies its
// scalars into measurement_sessions so "unsaved readings" and re-measure reminders can be
// queried without ever bulk-reading the tick logs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-08-16-measurement-sessions.sql'), 'utf8');

describe('measurement_sessions capture', () => {
  it('trigger only fires on session_summary rows and never blocks the log insert', () => {
    expect(sql).toMatch(/WHEN \(NEW\.messages LIKE '\{"type":"session_summary"%'\)/);
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(sql).toMatch(/RETURN NEW;/);
  });
  it('trigger function is SECURITY DEFINER (tick-log inserts run as anon)', () => {
    const i = sql.indexOf('capture_measurement_session()');
    expect(sql.slice(i, i + 400)).toMatch(/SECURITY DEFINER/);
  });
  it('one row per session', () => {
    expect(sql).toMatch(/session_id\s+text\s+UNIQUE/);
    expect(sql).toMatch(/ON CONFLICT \(session_id\) DO NOTHING/);
  });
  it('RLS: users read + update only their own rows, nobody inserts from the client', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FOR SELECT USING \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/FOR UPDATE USING \(auth\.uid\(\) = user_id\)/);
    expect(sql).not.toMatch(/FOR INSERT/);
  });
  it('unsaved RPC excludes sessions within 5 minutes of a saved reading on the same watch', () => {
    const body = sql.slice(sql.indexOf('unsaved_measurement_sessions'));
    expect(body).toMatch(/interval '5 minutes'/);
    expect(body).toMatch(/saved_result_id IS NULL/);
    expect(body).toMatch(/dismissed_at IS NULL/);
    expect(body).toMatch(/converged/);
    expect(body).toMatch(/interval '30 days'/);
  });
  it('backfill is chunked by week and parses with regex, not a jsonb cast of the whole row', () => {
    expect(sql).toMatch(/generate_series/);
    expect(sql).toMatch(/substring\(t\.messages from '"native_rate":\(-\?\[0-9.\]\+\)'\)/);
    expect(sql).not.toMatch(/messages::jsonb/);
  });
});
