import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Reserved usernames + profanity enforcement (sql/2026-10-30-reserved-usernames.sql,
// client wiring 7517efba). Shipped without tests — added by the 2026-11-06 audit.
// These pin the properties that make the feature safe; each would fail if the
// matching guard were deleted from the SQL file or the client wiring.

const sql = readFileSync(new URL('../sql/2026-10-30-reserved-usernames.sql', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('reserved_usernames table: API-invisible', () => {
  it('has RLS enabled with the default API grants stripped and none granted back', () => {
    expect(sql).toMatch(/ALTER TABLE public\.reserved_usernames ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.reserved_usernames FROM anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT .* ON (TABLE )?public\.reserved_usernames/);
  });
  it('constrains names to lowercase, 2-30 chars (matching is lower(); an uppercase row would never match)', () => {
    expect(sql).toMatch(/CHECK \(name = lower\(name\) AND length\(name\) BETWEEN 2 AND 30\)/);
  });
});

describe('is_username_reserved RPC', () => {
  it('is SECURITY DEFINER with a pinned search_path, revoked from public, granted to authenticated', () => {
    expect(sql).toMatch(/is_username_reserved[\s\S]{0,200}SECURITY DEFINER/);
    expect(sql).toMatch(/is_username_reserved[\s\S]{0,250}SET search_path TO 'public'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.is_username_reserved\(text\) FROM public;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_username_reserved\(text\) TO authenticated;/);
  });
  it('null-proofs the input and matches patterns as substrings, exact rows on equality', () => {
    expect(sql).toMatch(/NOT r\.is_pattern AND r\.name = lower\(coalesce\(p_name, ''\)\)/);
    expect(sql).toMatch(/r\.is_pattern AND lower\(coalesce\(p_name, ''\)\) LIKE '%' \|\| r\.name \|\| '%'/);
  });
});

describe('enforce_reserved_username trigger: the four rules in order', () => {
  const body = sql.slice(sql.indexOf('enforce_reserved_username'), sql.indexOf('DROP TRIGGER'));
  it('rule 1: an unchanged username is always allowed (case-insensitive)', () => {
    expect(body).toMatch(/TG_OP = 'UPDATE' AND lower\(OLD\.username\) = lower\(NEW\.username\)/);
  });
  it('rule 2: internal accounts may hold reserved names', () => {
    expect(body).toMatch(/EXISTS \(SELECT 1 FROM internal_accounts ia WHERE ia\.user_id = NEW\.id\)/);
  });
  it('rule 3: the no-JWT path RENAMES instead of raising — an exception in handle_new_user would brick signup', () => {
    const noJwt = body.slice(body.indexOf('auth.uid() IS NULL'), body.indexOf('RAISE EXCEPTION'));
    expect(noJwt).toContain("NEW.username := 'user' || substr(replace(NEW.id::text, '-', ''), 1, 8);");
    expect(noJwt).not.toMatch(/RAISE/);
  });
  it("rule 4: the raise carries 'reserved' — the client keys its toast off that word", () => {
    expect(body).toMatch(/RAISE EXCEPTION 'username "%" is reserved'/);
    expect(body).toMatch(/ERRCODE = 'check_violation'/);
  });
  it('fires BEFORE INSERT OR UPDATE OF username only — existing holders are untouched', () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF username ON public\.profiles/);
  });
});

describe('seed hygiene', () => {
  // Pattern rows match as substrings anywhere in a name, so a short pattern
  // would swallow innocent usernames (the Scunthorpe problem: dickens_fan,
  // spiceman). Exact rows can be any length.
  it('every pattern row is at least 4 characters', () => {
    const patterns = [...sql.matchAll(/\('([a-z_]+)',\s*true,/g)].map(m => m[1]);
    expect(patterns.length).toBeGreaterThan(20); // brand + profanity/slur/hate lists
    for (const p of patterns) expect(p.length, `pattern '${p}' is dangerously short`).toBeGreaterThanOrEqual(4);
  });
  it('reserves the brand, test accounts and retired demo names', () => {
    for (const name of ['wrotate', 'wristlog', 'admin', 'official', 'test', 'demo', 'watchdemo']) {
      expect(sql).toMatch(new RegExp(`\\('${name}',`));
    }
  });
});

describe('client wiring (index.html)', () => {
  it('availability check calls the RPC and fails OPEN (the trigger is the backstop)', () => {
    expect(html).toContain("db.rpc('is_username_reserved', { p_name: username })");
    expect(html).toMatch(/Reserved check fails OPEN on error/);
  });
  it("save-time trigger rejection is keyed off 'reserved' in the error message", () => {
    expect(html).toContain("error.message.includes('reserved')");
  });
  it('display name (both prompts) and bio run through checkContent before save', () => {
    expect(html.match(/if \(!checkContent\(displayName\)\.clean\)/g)).not.toBeNull();
    expect(html.match(/if \(!checkContent\(name\)\.clean\)/g)).not.toBeNull();
    expect(html.match(/if \(!checkContent\(bio\)\.clean\)/g)).not.toBeNull();
  });
});
