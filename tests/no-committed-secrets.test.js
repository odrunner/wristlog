// Audit 2026-09-23 SEC-23-5 — the repo is public. The 2026-08-13 schema dump
// committed the service-role JWT and the campaign secret (both rotated/retired
// 2026-09-24). This scans every tracked text file for server credentials so a
// dump, a copied curl, or a pasted log can't publish one again. The anon /
// publishable keys are public by design and allowed.
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BINARY = /\.(png|jpe?g|gif|webp|ico|p8|woff2?|ttf|mp4|m4a|wav|pdf|zip)$/i;
const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
  .split('\n').filter((f) => f && !BINARY.test(f));

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const PATTERNS = {
  'Supabase secret key': /sb_secret_[A-Za-z0-9_-]{16,}/,
  'Supabase management token': /sbp_[0-9a-f]{30,}/,
  'campaign secret literal': /x-campaign-secret['"]?\s*[:,]\s*['"][0-9a-f]{24,}/i,
  'GitHub token': /gh[pousr]_[A-Za-z0-9]{30,}/,
  'Anthropic key': /sk-ant-[A-Za-z0-9_-]{20,}/,
  'AWS access key': /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  'private key': /-----BEGIN (RSA |EC )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/]{40,}/,
};

function jwtRole(payload) {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role;
  } catch { return undefined; }
}

describe('No server credentials in tracked files (SEC-23-5)', () => {
  const hits = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(JWT)) {
      const role = jwtRole(m[1]);
      if (role && role !== 'anon') hits.push(`${f}: JWT with role=${role}`);
    }
    for (const [name, re] of Object.entries(PATTERNS)) {
      if (re.test(text)) hits.push(`${f}: ${name}`);
    }
  }

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('finds no service-role JWTs, secret keys, tokens or campaign secrets', () => {
    expect(hits).toEqual([]);
  });
});
