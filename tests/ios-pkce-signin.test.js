import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// iOS 2.10 PKCE sign-in (weekly security audit F1, mirrors Android 369f0fe1).
// The OAuth hand-off used to return access + refresh tokens in the
// wrotate://auth-callback fragment; any app on the device can claim that custom
// scheme, and an interceptor keeps the account via the refresh token. Now the
// shell sends an RFC 7636 S256 challenge on the authorize URL (GoTrue then
// returns ?code=) and exchanges code + verifier at /auth/v1/token?grant_type=pkce.
// The verifier never leaves the process, so an intercepted callback is worthless.
// The fragment path stays as a transitional fallback, and BOTH paths interpolate
// tokens into the setSession JS literal only after a charset guard.
//
// Source assertions — this repo has Command Line Tools only, no Xcode, so the
// Swift cannot be executed here. They guard the contract, not the wiring.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const pkce = read('ios', 'Wrotate', 'Wrotate', 'Pkce.swift');
const exchange = read('ios', 'Wrotate', 'Wrotate', 'TokenExchange.swift');
const webView = read('ios', 'Wrotate', 'Wrotate', 'WebView.swift');
const html = read('index.html');

const swiftFn = (src, signaturePrefix) => {
  const start = src.indexOf(signaturePrefix);
  if (start < 0) return null;
  let depth = 0, seen = false;
  for (let p = src.indexOf('{', start); p < src.length; p++) {
    if (src[p] === '{') { depth++; seen = true; }
    else if (src[p] === '}') { depth--; if (seen && depth === 0) return src.slice(start, p + 1); }
  }
  return null;
};

describe('Pkce.swift — RFC 7636 verifier/challenge', () => {
  it('verifier is 48 cryptographically random bytes, base64url encoded', () => {
    const fn = swiftFn(pkce, 'static func generateVerifier(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('count: 48'); // 48 bytes -> 64 base64url chars, within the 43..128 spec
    expect(fn).toContain('SecRandomCopyBytes');
  });
  it('challenge is base64url(SHA256(ascii verifier)), no padding', () => {
    const fn = swiftFn(pkce, 'static func challenge(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('SHA256.hash');
    const b64 = swiftFn(pkce, 'static func base64url(');
    expect(b64).toBeTruthy();
    expect(b64).toContain('"+", with: "-"');
    expect(b64).toContain('"/", with: "_"');
    expect(b64).toContain('"=", with: ""');
  });
});

describe('authorize URL carries the challenge of a per-flow verifier', () => {
  it('handleOAuth generates a verifier and opens the challenge URL', () => {
    const fn = swiftFn(webView, 'private func handleOAuth(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('Pkce.generateVerifier()');
    expect(fn).toContain('Pkce.challenge(verifier)');
  });
  it('pkceAuthorizeURL rewrites redirect_to AND attaches code_challenge + s256 method', () => {
    const fn = swiftFn(webView, 'static func pkceAuthorizeURL(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('"redirect_to", value: "wrotate://auth-callback"');
    expect(fn).toContain('"code_challenge", value: challenge');
    expect(fn).toContain('"code_challenge_method", value: "s256"');
  });
});

describe('callback code is exchanged, never trusted raw', () => {
  it('parseAuthCode reads the query (not the fragment) and rejects unsafe charsets', () => {
    const fn = swiftFn(webView, 'static func parseAuthCode(');
    expect(fn).toBeTruthy();
    // GoTrue auth codes are UUIDs; anything outside this charset is a forgery attempt.
    expect(fn).toContain('^[A-Za-z0-9-]+$');
    expect(fn).toContain('queryItems');
  });
  it('a code callback goes through TokenExchange with the flow verifier', () => {
    const fn = swiftFn(webView, 'private func handleOAuth(');
    expect(fn).toMatch(/parseAuthCode\(callbackURL\)/);
    expect(fn).toMatch(/TokenExchange\.exchange\(code: code, verifier: verifier\)/);
  });
  it('the fragment path survives as a transitional fallback', () => {
    const fn = swiftFn(webView, 'private func handleOAuth(');
    expect(fn).toContain('callbackURL.fragment');
    expect(fn).toContain('access_token');
  });
});

describe('TokenExchange.swift — GoTrue PKCE grant', () => {
  it('posts auth_code + code_verifier to /auth/v1/token?grant_type=pkce', () => {
    expect(exchange).toContain('https://api.wrotate.com/auth/v1/token?grant_type=pkce');
    expect(exchange).toContain('auth_code');
    expect(exchange).toContain('code_verifier');
  });
  it('authenticates with the same publishable key the page ships (never a secret key)', () => {
    const pageKey = html.match(/const SUPABASE_KEY = '(sb_publishable_[A-Za-z0-9_]+)'/)?.[1];
    expect(pageKey).toBeTruthy();
    expect(exchange).toContain(`"${pageKey}"`);
    expect(exchange).not.toMatch(/sb_secret|service_role/);
  });
  it('fails closed: any error yields nil tokens, nothing is injected', () => {
    const fn = swiftFn(webView, 'private func handleOAuth(');
    expect(fn).toMatch(/guard let tokens/);
  });
});

describe('tokens pass the JS-literal charset guard on BOTH paths', () => {
  it('sessionInjectionJS rejects tokens outside base64url/JWT charset', () => {
    const fn = swiftFn(webView, 'static func sessionInjectionJS(');
    expect(fn).toBeTruthy();
    // Supabase tokens are base64url/JWT (letters, digits, '.', '_', '-'). Anything
    // else is an injection attempt — return nil rather than interpolate it.
    expect(fn).toContain('^[A-Za-z0-9._-]+$');
    expect(fn).toContain('return nil');
    expect(fn).toContain('db.auth.setSession');
  });
  it('the PKCE path and the fragment fallback both build their JS through the guard', () => {
    const fn = swiftFn(webView, 'private func handleOAuth(');
    const uses = fn.match(/Self\.sessionInjectionJS\(/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    // No raw token interpolation left in the handler.
    expect(fn).not.toMatch(/access_token: '\\\(/);
  });
});
