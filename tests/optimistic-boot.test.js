import { describe, it, expect } from 'vitest';
import { decodeAuthUser, decodeAuthUserId, sessionSettleAction } from '../wrotate_test.js';

// The optimistic boot draws the app from the session supabase-js persisted in
// localStorage before getSession() has refreshed it. It needs the whole user
// object (id + email drive bootApp), in either storage format the SDK uses.
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'a@b.c' };
const b64url = s => Buffer.from(s).toString('base64url');

describe('decodeAuthUser', () => {
  it('returns the stored user from the plain-JSON format', () => {
    expect(decodeAuthUser(JSON.stringify({ access_token: 'x', user: USER }))).toEqual(USER);
  });
  it('returns the stored user from the base64- format', () => {
    expect(decodeAuthUser('base64-' + b64url(JSON.stringify({ user: USER })))).toEqual(USER);
  });
  it('is null for nothing stored, junk, or a user without an id', () => {
    expect(decodeAuthUser(null)).toBeNull();
    expect(decodeAuthUser('')).toBeNull();
    expect(decodeAuthUser('not json')).toBeNull();
    expect(decodeAuthUser(JSON.stringify({ user: { email: 'x' } }))).toBeNull();
    expect(decodeAuthUser(JSON.stringify({ user: 'string' }))).toBeNull();
    expect(decodeAuthUser(JSON.stringify({}))).toBeNull();
  });
  it('decodeAuthUserId still reads the id through it', () => {
    expect(decodeAuthUserId(JSON.stringify({ user: USER }))).toBe(USER.id);
    expect(decodeAuthUserId('{}')).toBeNull();
  });
});

describe('sessionSettleAction', () => {
  const session = { user: USER };
  it('boots whenever a session with a user comes back, optimistic or not', () => {
    expect(sessionSettleAction({ session, optimistic: false })).toBe('boot');
    expect(sessionSettleAction({ session, optimistic: true, error: null })).toBe('boot');
  });
  it('keeps an optimistic boot alive when the refresh failed with a retryable error', () => {
    expect(sessionSettleAction({ session: null, error: { name: 'AuthRetryableFetchError' }, optimistic: true, retryable: true })).toBe('keep');
  });
  it('signs an optimistic boot out on a definitive miss: no session, or a non-retryable error', () => {
    expect(sessionSettleAction({ session: null, error: null, optimistic: true, retryable: false })).toBe('sign_out');
    expect(sessionSettleAction({ session: null, error: { name: 'AuthApiError' }, optimistic: true, retryable: false })).toBe('sign_out');
    expect(sessionSettleAction({ session: { user: null }, error: null, optimistic: true, retryable: true })).toBe('sign_out');
  });
  it('shows the login screen when nothing booted and nothing came back', () => {
    expect(sessionSettleAction({ session: null, error: null, optimistic: false })).toBe('auth_screen');
    expect(sessionSettleAction({ session: null, error: { name: 'AuthRetryableFetchError' }, optimistic: false, retryable: true })).toBe('auth_screen');
  });
});
