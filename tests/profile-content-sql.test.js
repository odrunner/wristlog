// Guards sql/2026-11-07-profile-content-filter.sql — NEW-3: display_name/bio were
// only filtered by the client's checkContent(); the trigger enforces the same four
// patterns server-side. The SQL regexes must stay in step with _objPatterns
// (index.html) / OBJECTIONABLE_PATTERNS (wrotate_test.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'sql', '2026-11-07-profile-content-filter.sql'), 'utf8');

// The JS patterns, mechanically translated (\b -> \y, \s -> [[:space:]], (?: -> ().
// If a pattern changes in wrotate_test.js, this expected list — and the SQL — change with it.
const EXPECTED_SQL_PATTERNS = [
  String.raw`\y(f+[u*]+[c*]+[k*]+|sh[i*]+[t*]+|a[s*]+h[o*]+le|b[i*]+tch|d[i*]+ck|c[u*]+nt)\y`,
  String.raw`\y(kill[[:space:]]+your|go[[:space:]]+die|kys|stfu)\y`,
  String.raw`\y(buy[[:space:]]+now|click[[:space:]]+here|free[[:space:]]+money|act[[:space:]]+now)\y`,
  String.raw`\y(n[i1]+[gq]+[e3]*r|f+[a@]+[gq]+[o0]*t|tr[a@]+nn)`,
];

describe('is_content_objectionable mirrors the client patterns', () => {
  it('carries all four translated patterns, case-insensitive (~*)', () => {
    for (const p of EXPECTED_SQL_PATTERNS) expect(sql).toContain(`~* '${p}'`);
  });
  it('is in step with OBJECTIONABLE_PATTERNS in wrotate_test.js (count + sources)', async () => {
    const js = readFileSync(join(root, 'wrotate_test.js'), 'utf8');
    const m = js.match(/const OBJECTIONABLE_PATTERNS = \[([\s\S]*?)\];/);
    const jsPatterns = m[1].match(/\/.*?\/i/g);
    expect(jsPatterns.length).toBe(EXPECTED_SQL_PATTERNS.length);
    // Mechanical translation of each JS pattern must equal the SQL pattern.
    const translate = src => src
      .slice(1, -2)                       // strip /.../i
      .replaceAll('\\b', '\\y')
      .replaceAll('\\s', '[[:space:]]')
      .replaceAll('(?:', '(');
    jsPatterns.forEach((p, i) => expect(translate(p)).toBe(EXPECTED_SQL_PATTERNS[i]));
  });
  it('treats NULL as clean and has no client EXECUTE', () => {
    expect(sql).toMatch(/coalesce\(p_text, ''\)/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.is_content_objectionable(text) FROM PUBLIC, anon, authenticated');
  });
});

describe('enforce_profile_content trigger', () => {
  it('fires BEFORE INSERT OR UPDATE OF display_name, bio', () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF display_name, bio ON public\.profiles/);
  });
  it('unchanged values pass (profile saves PATCH the whole row)', () => {
    expect(sql).toMatch(/NEW\.display_name IS NOT DISTINCT FROM OLD\.display_name\s+AND NEW\.bio IS NOT DISTINCT FROM OLD\.bio/);
  });
  it('internal accounts are exempt', () => {
    expect(sql).toMatch(/FROM internal_accounts ia WHERE ia\.user_id = NEW\.id/);
  });
  it('no-JWT path sanitizes and never raises (handle_new_user runs inside the auth insert)', () => {
    const noJwt = sql.match(/IF auth\.uid\(\) IS NULL THEN[\s\S]*?RETURN NEW;\s+END IF;/)[0];
    expect(noJwt).toMatch(/NEW\.display_name := NULL/);
    expect(noJwt).toMatch(/NEW\.bio := NULL/);
    expect(noJwt).not.toMatch(/RAISE/);
  });
  it('checks only the CHANGED field (pre-rule rows are grandfathered per field)', () => {
    expect(sql).toMatch(/\(TG_OP = 'INSERT' OR NEW\.display_name IS DISTINCT FROM OLD\.display_name\)/);
    expect(sql).toMatch(/\(TG_OP = 'INSERT' OR NEW\.bio IS DISTINCT FROM OLD\.bio\)/);
  });
  it('trigger function has no client EXECUTE; NEW-4 revoke on the username trigger fn rides along', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.enforce_profile_content() FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.enforce_reserved_username() FROM PUBLIC, anon, authenticated');
  });
});
