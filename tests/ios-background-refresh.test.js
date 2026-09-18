import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';
import { shouldRefreshOnBackground } from '../wrotate_test.js';

// iOS 2.7: the login token is renewed when the app is BACKGROUNDED, so the next
// launch doesn't spend ~1 s refreshing it before any request can leave. Two
// halves: the page decides and performs the refresh; native keeps the process
// alive for it (UIKit background task) and ends the task when the page answers.
//
// Source assertions for the Swift — this repo has Command Line Tools only, no
// Xcode, so it cannot be executed here. They guard the contract, not the wiring.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const webView = read('ios', 'Wrotate', 'Wrotate', 'WebView.swift');
const contentView = read('ios', 'Wrotate', 'Wrotate', 'ContentView.swift');
const html = read('index.html');

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = payload => ['h', b64url(payload), 'sig'].join('.');
const NOW = 1_800_000_000;
const session = (extra = {}) => ({ access_token: jwt({ iat: NOW - 7200, exp: NOW + 79200 }), refresh_token: 'r', expires_at: NOW + 79200, expires_in: 86400, ...extra });

describe('shouldRefreshOnBackground', () => {
  it('renews a token issued more than an hour ago', () => {
    expect(shouldRefreshOnBackground(session(), NOW)).toBe(true);
    expect(shouldRefreshOnBackground(session({ access_token: jwt({ iat: NOW - 3600 }) }), NOW)).toBe(true);
  });
  it('leaves a recent token alone, so a quick app-switch never rotates anything', () => {
    expect(shouldRefreshOnBackground(session({ access_token: jwt({ iat: NOW - 3599 }) }), NOW)).toBe(false);
    expect(shouldRefreshOnBackground(session({ access_token: jwt({ iat: NOW - 60 }) }), NOW)).toBe(false);
    expect(shouldRefreshOnBackground(session({ access_token: jwt({ iat: NOW - 60 }) }), NOW, 30)).toBe(true);
  });
  it('falls back to expires_at − expires_in when the token carries no iat', () => {
    expect(shouldRefreshOnBackground(session({ access_token: jwt({ sub: 'u' }) }), NOW)).toBe(true);          // issued 2 h ago
    expect(shouldRefreshOnBackground(session({ access_token: jwt({ sub: 'u' }), expires_at: NOW + 86000 }), NOW)).toBe(false);
    expect(shouldRefreshOnBackground(session({ access_token: 'not-a-jwt' }), NOW)).toBe(true);
    expect(shouldRefreshOnBackground(session({ access_token: 'not-a-jwt', expires_in: undefined }), NOW)).toBe(false);
    expect(shouldRefreshOnBackground(session({ access_token: 'x.%%%.y', expires_at: 'soon' }), NOW)).toBe(false);
  });
  it('does nothing without a session, an access token or a refresh token', () => {
    expect(shouldRefreshOnBackground(null, NOW)).toBe(false);
    expect(shouldRefreshOnBackground(undefined, NOW)).toBe(false);
    expect(shouldRefreshOnBackground(session({ refresh_token: '' }), NOW)).toBe(false);
    expect(shouldRefreshOnBackground(session({ access_token: null }), NOW)).toBe(false);
  });
});

describe('native ↔ page contract', () => {
  it('ContentView starts the refresh when the app is backgrounded', () => {
    const i = contentView.indexOf('UIApplication.didEnterBackgroundNotification');
    expect(i).toBeGreaterThan(0);
    expect(contentView.slice(i, i + 400)).toContain('SessionRefresher.shared.refreshOnBackground(webView: webViewRef)');
  });
  it('SessionRefresher holds a background task and calls the page function by its real name', () => {
    expect(webView).toContain('final class SessionRefresher');
    expect(webView).toContain('beginBackgroundTask(withName: "session-refresh")');
    expect(webView).toContain('endBackgroundTask(');
    expect(webView).toContain("typeof _nativeRefreshSession === 'function'");
    expect(html).toContain('async function _nativeRefreshSession()');
  });
  it('the task always ends: on the page\'s answer, on timeout, and on expiry', () => {
    expect(webView).toContain('event == "SESSION_REFRESH_DONE"');
    expect(html).toContain("event: 'SESSION_REFRESH_DONE'");
    expect(webView).toMatch(/asyncAfter\(deadline: \.now\(\) \+ Self\.timeout\)/);
    expect(webView).toMatch(/self\.generation == mine/);                 // a stale timer can't end a later task
    expect(webView).toMatch(/beginBackgroundTask\(withName: "session-refresh"\) \{ \[weak self\] in\s+self\?\.finish\(\)/);
  });
  it('an older page without the function ends the task at once', () => {
    expect(webView).toContain('if (result as? Bool) != true { self?.finish() }');
  });
  it('the page only renews through the age rule, never for a demo or signed-out page', () => {
    const i = html.indexOf('async function _nativeRefreshSession()');
    const fn = html.slice(i, i + 900);
    expect(fn).toContain("if (!currentUser || _isDemoMode) return done('skipped')");
    expect(fn).toContain('shouldRefreshOnBackground(');
    expect(fn.indexOf('shouldRefreshOnBackground(')).toBeLessThan(fn.indexOf('db.auth.refreshSession()'));
  });
});
