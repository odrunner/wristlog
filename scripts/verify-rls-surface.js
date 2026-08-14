#!/usr/bin/env node
/**
 * Verify the public REST surface still works — as anon and as a logged-in user.
 *
 * Exists because of the 2026-08-13 S1 incident: restricting anon's column access on
 * `profiles` made the `logs` RLS policy unevaluable (it reads profiles.is_admin) and
 * the whole logs query returned 401. SQL-level checks with `SET LOCAL ROLE anon`
 * passed the entire time — the failure only appears at the PostgREST layer, because
 * that is where the policy is evaluated under the caller's column privileges.
 *
 * So: always check over HTTP with a real anon key, never only in SQL.
 *
 * Usage: node scripts/verify-rls-surface.js [label]
 * Exit code is non-zero if any check fails, so it can gate a change.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const API = /const SUPABASE_URL = '([^']+)'/.exec(html)[1];
const ANON = /const SUPABASE_KEY = '([^']+)'/.exec(html)[1];
const LABEL = process.argv[2] || 'check';

// Tables the logged-out site reads. Each is a table whose RLS policies reference
// profiles.is_admin, so each is a candidate for the exact failure above.
const ANON_READS = [
  ['logs', 'id,user_id,watch_id,visibility'],
  ['watches', 'id,brand,name'],
  ['profiles', 'id,username,display_name,avatar_url,is_official'],
  ['comments', 'id,log_id,body'],
  ['likes', 'log_id,user_id'],
  ['clubs', 'id,name'],
  ['follows', 'follower_id,following_id'],
  ['watch_facts', 'id'],
];

// Columns anon must NOT be able to read once S1 lands. Before S1 these return 200;
// after, they must be 401/403. Recorded either way so the diff is explicit.
const ANON_MUST_NOT_READ = ['is_admin', 'email_prefs', 'timezone', 'rec_settings', 'eula_accepted_at'];

async function get(path, token) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}` },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

async function userToken() {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@wrotate.com', password: process.env.TEST_PW }),
  });
  const j = await res.json().catch(() => ({}));
  return j.access_token || null;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log(`\n=== RLS surface: ${LABEL} ===`);
console.log('\nANON can still read what the logged-out site needs:');
for (const [table, cols] of ANON_READS) {
  const r = await get(`${table}?select=${cols}&limit=1`);
  record(table, r.status === 200, `HTTP ${r.status}${r.status !== 200 ? ` ${r.body?.message || ''}` : ''}`);
}

console.log('\nANON access to private profile columns (expect 200 before S1, 401/403 after):');
for (const col of ANON_MUST_NOT_READ) {
  const r = await get(`profiles?select=${col}&limit=1`);
  record(`profiles.${col}`, true, `HTTP ${r.status}`);   // recorded, not asserted
}

if (process.env.TEST_PW) {
  console.log('\nLOGGED-IN user is unaffected:');
  const tok = await userToken();
  if (!tok) {
    record('auth', false, 'could not obtain a token');
  } else {
    const own = await get('profiles?select=*&limit=1', tok);
    record('own profile select=*', own.status === 200, `HTTP ${own.status}`);
    for (const [table, cols] of ANON_READS.slice(0, 4)) {
      const r = await get(`${table}?select=${cols}&limit=1`, tok);
      record(`${table} (auth)`, r.status === 200, `HTTP ${r.status}`);
    }
  }
} else {
  console.log('\n(set TEST_PW to also check the logged-in surface)');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `FAILED ${failed.length}` : 'all reads OK'}\n`);
process.exit(failed.length ? 1 : 0);
