// Guards sql/2026-11-14-admin-language-stats.sql (deployed straight to Supabase):
// the language_changes log + trigger and the admin_language_stats() RPC behind
// the Usage tab's Languages card.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-14-admin-language-stats.sql'), 'utf8');

describe('language_changes log', () => {
  it('has RLS on and no Data API access', () => {
    expect(sql).toMatch(/ALTER TABLE public\.language_changes ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.language_changes FROM anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT [^;]* ON public\.language_changes/);
  });

  it('has no FK to profiles, so account deletion is untouched', () => {
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.language_changes'), sql.indexOf('CREATE INDEX'));
    expect(table).not.toMatch(/REFERENCES/);
  });

  it('logs only real changes of profiles.language, via a SECURITY DEFINER trigger', () => {
    expect(sql).toMatch(/AFTER UPDATE OF language ON public\.profiles/);
    expect(sql).toMatch(/WHEN \(OLD\.language IS DISTINCT FROM NEW\.language\)/);
    expect(sql).toMatch(/FUNCTION public\.log_language_change\(\)[\s\S]*?SECURITY DEFINER\s+SET search_path TO 'pg_catalog', 'public'/);
    expect(sql).toMatch(/VALUES \(NEW\.id, OLD\.language, NEW\.language\)/);
  });
});

describe('admin_language_stats SQL', () => {
  it('is a SECURITY DEFINER function with a pinned search_path', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_language_stats\(\)\s+RETURNS json[\s\S]*?STABLE SECURITY DEFINER\s+SET search_path TO 'pg_catalog', 'public'/);
  });

  it('gates on profiles.is_admin before counting anything', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.admin_language_stats()'));
    const gate = fn.indexOf("is_admin = true) THEN\n    RAISE EXCEPTION 'Not authorized'");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fn.indexOf('WITH chosen'));
  });

  it('excludes internal accounts from both the totals and the 24h changes', () => {
    expect(sql.match(/NOT EXISTS \(SELECT 1 FROM internal_accounts ia WHERE ia\.user_id = (p\.id|c\.user_id)\)/g)).toHaveLength(2);
  });

  it('totals are explicit choices only (NULL = never chosen)', () => {
    expect(sql).toMatch(/WHERE p\.language IS NOT NULL/);
  });

  it('24h changes are net: arrivals minus departures, last 24 hours', () => {
    expect(sql).toMatch(/c\.changed_at >= now\(\) - interval '24 hours'/);
    expect(sql).toMatch(/WHERE new_language = l\.lang\)\s+- \(SELECT count\(\*\) FROM recent WHERE old_language = l\.lang\) AS d1/);
    expect(sql).toMatch(/'chosen_24h',\s+\(SELECT count\(\*\) FROM recent WHERE old_language IS NULL\)\s+- \(SELECT count\(\*\) FROM recent WHERE new_language IS NULL\)/);
  });

  it('returns every key the dashboard reads', () => {
    for (const key of ['chosen_total', 'chosen_24h', 'by_lang']) expect(sql).toContain(`'${key}',`);
    for (const key of ["'lang'", "'users'", "'d1'"]) expect(sql).toContain(key);
  });

  it('revokes anon and grants only authenticated + service_role, then reloads PostgREST', () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.admin_language_stats\(\) FROM anon, public;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_language_stats\(\) TO authenticated, service_role;/);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/);
  });
});
