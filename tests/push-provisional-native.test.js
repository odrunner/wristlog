import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// WHERE and HOW the OS notification permission is asked (2.6), across the native/web
// boundary. History: 2.3 replaced the sign-in cold ask with a warm in-app primer
// (52 shown / 2 tapped, opt-ins fell to zero); 2.5 restored the cold ask (~28%).
// 2.6 asks PROVISIONALLY at sign-in — iOS grants silently, notifications deliver quietly
// with the OS's own Keep / Turn Off buttons — and spends the one-shot dialog only after
// the user has ACTED on a quiet notification (see shouldDeferredPushAsk in index.html).
//
// Source assertions — this repo has Command Line Tools only, no Xcode, so the Swift cannot
// be executed here. They guard the contract, not the wiring.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const pushManager = read('ios', 'Wrotate', 'Wrotate', 'PushManager.swift');
const webView = read('ios', 'Wrotate', 'Wrotate', 'WebView.swift');
const contentView = read('ios', 'Wrotate', 'Wrotate', 'ContentView.swift');
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

describe('2.6: provisional at sign-in, full ask on demand', () => {
  it('handleSignIn asks provisionally (no OS dialog)', () => {
    const fn = swiftFn(pushManager, 'func handleSignIn(');
    expect(fn).toBeTruthy();
    expect(fn).toContain('requestPermissionAndRegister(full: false)');
  });
  it('provisional ask includes .provisional; the full ask does not', () => {
    const fn = swiftFn(pushManager, 'func requestPermissionAndRegister(');
    expect(fn).toMatch(/full \? \[\.alert, \.badge, \.sound\] : \[\.alert, \.badge, \.sound, \.provisional\]/);
    expect(fn).toContain('registerForRemoteNotifications()');
  });
  it('the bridge action requestPushPermission is the FULL ask (deferred, from JS)', () => {
    expect(webView).toMatch(/requestPushPermission[\s\S]{0,400}requestPermissionAndRegister\(full: true\)/);
  });
  it('reports provisional as its own status so JS can tell quiet from prominent', () => {
    expect(pushManager).toMatch(/case \.provisional: return "provisional"/);
  });
  it('token row carries the app version (payload routes go only to builds that can handle them)', () => {
    expect(pushManager).toMatch(/"app_version": /);
  });
});

describe('2.6: push-tap routing falls through to JS', () => {
  it('unknown routes call openPushRoute and every dispatch marks the session as opened from push', () => {
    const fn = swiftFn(contentView, 'private func dispatchPendingNotification(');
    expect(fn).toBeTruthy();
    expect(fn).toContain("openPushRoute('\\(pending.route)','\\(id)')");
    expect(fn).toContain('window._openedFromPush=true;');
  });
  it('the route string is sanitised before it reaches a JS literal', () => {
    expect(pushManager).toMatch(/rawRoute\.filter \{ \$0\.isLetter \|\| \$0\.isNumber \|\| \$0 == "_" \}/);
  });
  it('settings deep link opens the app notification pane on iOS 15.4+', () => {
    expect(webView).toContain('openNotificationSettingsURLString');
  });
});

describe('web side', () => {
  it('the deferred ask needs provisional + opened-from-push + 2.6', () => {
    expect(html).toMatch(/function shouldDeferredPushAsk\(/);
    expect(html).toMatch(/return iosAtLeast\(iosVersion, '2\.6'\);/);
  });
  it('the in-app primer modal is gone', () => {
    expect(html).not.toContain('id="push-primer-modal"');
    expect(html).not.toMatch(/function maybeShowPushPrimer/);
  });
});

describe('version stamping for the build carrying this change', () => {
  it('injected _iosAppVersion matches MARKETING_VERSION', () => {
    const marketing = pbxproj.match(/MARKETING_VERSION = ([\d.]+);/)[1];
    const injected = webView.match(/let fallbackAppVersion = "([\d.]+)"/)[1];
    expect(injected).toBe(marketing);
    expect(marketing).toBe('2.7');
  });
});
