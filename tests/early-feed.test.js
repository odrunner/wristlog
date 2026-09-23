import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { earlyFeedUsable } from '../wrotate_test.js';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

// The head's early-fetch script runs before the boot script exists, so it has
// to carry its own copy of the API key and host. If either drifts, the early
// call fails and every load pays for a second one.
describe('early-fetch script mirrors the boot script', () => {
  const pick = re => (html.match(re) || [])[1];
  it('uses the same anon key', () => {
    expect(pick(/var EARLY_KEY = '([^']+)';/)).toBe(pick(/^const SUPABASE_KEY = '([^']+)';/m));
  });
  it('uses the same API host', () => {
    expect(pick(/var EARLY_URL = '([^']+)';/)).toBe(pick(/^const SUPABASE_URL = '([^']+)';/m));
  });
  it('fires feed_page before the boot script', () => {
    expect(html.indexOf("rpc: send(EARLY_URL + '/rest/v1/rpc/feed_page'")).toBeGreaterThan(0);
    expect(html.indexOf("rpc: send(EARLY_URL + '/rest/v1/rpc/feed_page'")).toBeLessThan(html.indexOf('const SUPABASE_KEY ='));
  });
  it('no longer carries an experiment arm check', () => {
    expect(html).not.toMatch(/wrotate_feed_rpc_|exp_force_feed_rpc/);
  });
});

describe('earlyFeedUsable', () => {
  const T = 1_000_000;
  const e = (extra = {}) => ({ uid: 'u1', at: T, rpc: Promise.resolve(), ...extra });
  it('accepts a fresh parked call for the same user', () => {
    expect(earlyFeedUsable(e(), 'u1', T + 500)).toBe(true);
    expect(earlyFeedUsable(e(), 'u1', T)).toBe(true);
  });
  it('rejects another account, a missing user, or nothing parked', () => {
    expect(earlyFeedUsable(e(), 'u2', T + 500)).toBe(false);
    expect(earlyFeedUsable(e(), null, T + 500)).toBe(false);
    expect(earlyFeedUsable(null, 'u1', T + 500)).toBe(false);
    expect(earlyFeedUsable(undefined, 'u1', T + 500)).toBe(false);
  });
  it('rejects stale results and clock skew', () => {
    expect(earlyFeedUsable(e(), 'u1', T + 15_000)).toBe(false);
    expect(earlyFeedUsable(e(), 'u1', T + 14_999)).toBe(true);
    expect(earlyFeedUsable(e(), 'u1', T - 1)).toBe(false);
    expect(earlyFeedUsable(e(), 'u1', T + 3000, 2000)).toBe(false);
  });
  it('rejects a malformed record, including the retired two-query shape', () => {
    expect(earlyFeedUsable(e({ rpc: null }), 'u1', T)).toBe(false);
    expect(earlyFeedUsable(e({ at: 'x' }), 'u1', T)).toBe(false);
    expect(earlyFeedUsable({ uid: 'u1', at: T, q1: Promise.resolve(), q2: Promise.resolve() }, 'u1', T)).toBe(false);
  });
});
