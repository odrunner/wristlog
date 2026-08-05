import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// WHERE the OS notification permission is asked, across the native/web boundary.
//
// 2.3 removed the sign-in ask in favour of a warm in-app primer. The field data
// went the other way — signup -> push within 7 days, external accounts, equal
// window: cold ask 45/162 (27.8%), primer 2/15 (13.3%, and both of those were
// users still on pre-2.3 binaries). The primer's own funnel over its first 25
// shows was 25 dismissed / 0 clicked, and new device_tokens rows stopped on
// Jul 27. 2.5 restores the ask.
//
// The primer deliberately stays: 2.3/2.4 binaries have no cold ask, so it is the
// only route for those users until they update.
//
// Source assertions — this repo has Command Line Tools only, no Xcode, so the
// Swift cannot be executed here. They guard the contract, not the wiring.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const pushManager = read('ios', 'Wrotate', 'Wrotate', 'PushManager.swift');
const webView = read('ios', 'Wrotate', 'Wrotate', 'WebView.swift');
const pbxproj = read('ios', 'Wrotate', 'Wrotate.xcodeproj', 'project.pbxproj');
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

describe('native asks for push permission at sign-in', () => {
  it('handleSignIn requests permission rather than deferring', () => {
    const fn = swiftFn(pushManager, 'func handleSignIn(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('requestPermissionAndRegister()');
  });

  it('the ask still registers a device that already granted', () => {
    // requestAuthorization returns the existing decision without re-prompting,
    // so an authorized device re-registers and refreshes its token on every
    // sign-in. That behaviour must not depend on a separate code path.
    const fn = swiftFn(pushManager, 'func requestPermissionAndRegister(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('registerForRemoteNotifications()');
  });

  it('the primer bridge action survives for 2.3/2.4 users', () => {
    // Those binaries never ask at sign-in. Removing this action would strand
    // every one of them with no route to the OS prompt at all.
    expect(webView).toContain('requestPushPermission');
    const fn = swiftFn(pushManager, 'func requestPermissionAndRegister(');
    expect(fn).toContain('requestAuthorization');
  });
});

describe('the web primer stays gated so it cannot double-prompt', () => {
  it('only runs when the OS decision is still open', () => {
    // On 2.5 the sign-in ask resolves the status, so this gate turns the primer
    // off by itself — no version check needed, and no second prompt.
    expect(html).toMatch(/if \(authStatus !== 'notDetermined'\) return false;/);
  });

  it('is still gated to native builds that carry the bridge', () => {
    expect(html).toMatch(/_pushBridge\(\) && iosAtLeast\(window\._iosAppVersion, '2\.3'\)/);
  });
});

describe('version stamping for the build carrying this change', () => {
  it('injected _iosAppVersion matches MARKETING_VERSION', () => {
    // The injected string is hand-maintained and independent of the Xcode
    // setting; 2.4 build 1 was pulled from review for exactly this mismatch.
    const marketing = pbxproj.match(/MARKETING_VERSION = ([\d.]+);/)[1];
    const injected = webView.match(/window\._iosAppVersion = '([\d.]+)'/)[1];
    expect(injected).toBe(marketing);
  });

  it('ships in a build past the live 2.4', () => {
    const marketing = parseFloat(pbxproj.match(/MARKETING_VERSION = ([\d.]+);/)[1]);
    expect(marketing).toBeGreaterThan(2.4);
  });
});
