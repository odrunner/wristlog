import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect } from 'vitest';

// Bug (reported 2026-08-04, shipped in 2.3 via ca78f70): sharing a photo to
// WRotate showed "Sent to WRotate" but no chooser ever appeared in the app.
//
// ContentView's foreground handler called webViewRef.reload() (>30min idle) and
// then, in the same pass, handleSharedImage(). isLoading is only ever assigned
// false — nothing sets it back on a navigation start — so the !isLoading guard
// passed, the pending key and file were deleted unconditionally, and the JS was
// evaluated into a document the reload was about to replace. onChange(of:
// isLoading) then never re-fired, so nothing retried. The photo was gone.
//
// Fix (2.5): drain from didFinish (every load, not just the first), skip the
// drain when a reload was just started, and only consume the photo once the web
// layer confirms it took it.
//
// These are source assertions because the logic is SwiftUI-bound and this repo
// has no Xcode. They guard the contract each layer relies on, not the wiring.

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const html = read('index.html');
const contentView = read('ios', 'Wrotate', 'Wrotate', 'ContentView.swift');
const webView = read('ios', 'Wrotate', 'Wrotate', 'WebView.swift');
const pbxproj = read('ios', 'Wrotate', 'Wrotate.xcodeproj', 'project.pbxproj');

describe('shared image hand-off — web side of the contract', () => {
  it('defines the global handleSharedImage the native layer probes by name', () => {
    expect(html).toMatch(/^function handleSharedImage\(/m);
  });

  it('keeps that handler synchronous', () => {
    // Native returns true immediately after calling it and treats that as "the
    // chooser is up". An async handler would report success before it was.
    expect(html).not.toMatch(/^async function handleSharedImage\(/m);
  });

  it('ships the chooser markup handleSharedImageV2 unhides', () => {
    // Missing markup silently falls through to the collection flow — a photo
    // that identifies itself with no question asked, which is the same symptom.
    expect(html).toMatch(/id="shared-img-modal"/);
  });
});

describe('shared image hand-off — native side of the contract', () => {
  it('never consumes the photo outside the evaluation completion handler', () => {
    // The regression itself: an unconditional delete meant a hand-off that went
    // nowhere still destroyed the image.
    const consumes = contentView.match(/removeObject\(forKey: "sharedImagePath"\)/g) || [];
    expect(consumes.length).toBeGreaterThan(0);

    const handler = contentView.match(
      /evaluateJavaScript\(js\) \{[\s\S]*?\n {8}\}/
    );
    expect(handler).not.toBeNull();
    expect(handler[0]).toMatch(/removeObject\(forKey: "sharedImagePath"\)/);
    expect(handler[0]).toMatch(/removeItem\(atPath: path\)/);

    // The only other clear is the unrecoverable case: key present, file gone.
    expect(consumes.length).toBe(2);
  });

  it('requires a positive marker before consuming', () => {
    expect(contentView).toMatch(/guard \(result as\? Bool\) == true else \{ return \}/);
  });

  it('does not drain into a page it just told to reload', () => {
    const foreground = contentView.match(
      /didBecomeActiveNotification[\s\S]*?\n {8}\}/
    );
    expect(foreground).not.toBeNull();
    expect(foreground[0]).toMatch(/reloading = true/);
    expect(foreground[0]).toMatch(/if !isLoading, !reloading \{ drainPending\(\) \}/);
  });

  it('drains after every completed load, not just the first', () => {
    // isLoading only moves true -> false, so an onChange observer fires once per
    // launch and misses every reload.
    expect(contentView).not.toMatch(/onChange\(of: isLoading\)/);
    expect(contentView).toMatch(/onPageLoaded: \{ self\.drainPending\(\) \}/);

    const didFinish = webView.match(/func webView\(_ webView: WKWebView, didFinish[\s\S]*?\n {8}\}/);
    expect(didFinish).not.toBeNull();
    expect(didFinish[0]).toMatch(/parent\.onPageLoaded\?\(\)/);
  });
});

describe('injected version string', () => {
  it('matches MARKETING_VERSION', () => {
    // 2.4 build 1 was pulled from review because the hand-maintained injected
    // string still said '2.3' after the Xcode-only bump, permanently killing
    // every iosAtLeast gate for that build.
    const injected = webView.match(/window\._iosAppVersion = '([\d.]+)'/);
    expect(injected).not.toBeNull();

    const marketing = [...pbxproj.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map(m => m[1]);
    expect(marketing.length).toBeGreaterThan(0);
    expect([...new Set(marketing)]).toEqual([injected[1]]);
  });
});
