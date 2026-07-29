import { describe, it, expect } from 'vitest';
import { decodeAuthUserId } from '../wrotate_test.js';

// Regression guard for the Traffic-tab bug: every non-admin page_visit landed
// with user_id NULL, so admin_traffic_stats' visitor fingerprint
// (COALESCE(user_id, user_agent, ...)) degraded into "distinct User-Agent
// string" — one iOS Safari UA accounted for 74% of all recorded visits.
//
// Half the cause was here: supabase-js stores the session base64url-encoded
// behind a "base64-" prefix, and the old code did a bare JSON.parse on it.

const UID = '98d41856-9e04-4c3c-b178-b170422cfdff';

const b64url = (s) =>
  Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const session = (extra = {}) =>
  JSON.stringify({ access_token: 'x', user: { id: UID, email: 'a@b.com', ...extra } });

describe('decodeAuthUserId', () => {
  it('reads the user id from a base64- prefixed session (the real storage format)', () => {
    expect(decodeAuthUserId('base64-' + b64url(session()))).toBe(UID);
  });

  it('still reads a plain-JSON session (older supabase-js)', () => {
    expect(decodeAuthUserId(session())).toBe(UID);
  });

  it('decodes non-ASCII session payloads without corrupting them', () => {
    // A display name with multi-byte characters must not break the decode —
    // atob alone yields latin-1 bytes, so this needs the TextDecoder path.
    const raw = 'base64-' + b64url(session({ user_metadata: { name: 'Özgür 時計' } }));
    expect(decodeAuthUserId(raw)).toBe(UID);
  });

  it('handles base64url payloads of every padding length', () => {
    for (const pad of ['', 'a', 'ab', 'abc']) {
      const raw = 'base64-' + b64url(session({ pad }));
      expect(decodeAuthUserId(raw)).toBe(UID);
    }
  });

  it('returns null for missing, empty, or unparseable storage', () => {
    expect(decodeAuthUserId(null)).toBe(null);
    expect(decodeAuthUserId(undefined)).toBe(null);
    expect(decodeAuthUserId('')).toBe(null);
    expect(decodeAuthUserId('not json')).toBe(null);
    expect(decodeAuthUserId('base64-@@@not-base64@@@')).toBe(null);
  });

  it('returns null for a session with no user', () => {
    expect(decodeAuthUserId(JSON.stringify({ access_token: 'x' }))).toBe(null);
    expect(decodeAuthUserId('base64-' + b64url(JSON.stringify({ user: null })))).toBe(null);
  });
});
