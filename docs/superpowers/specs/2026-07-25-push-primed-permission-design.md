# Push primed-permission — design (2026-07-25)

Ships in the pending **2.3** build (App Store is 2.2; 2.3 unsubmitted). Web is gated on
`_iosAppVersion >= 2.3` so it's inert until the 2.3 native lands (no double-prompt on 2.2).

## Problem
Push reach is stuck at ~33%. Root causes (`PushManager.swift`):
1. `handleSignIn` fired the OS permission dialog **cold at sign-in** — iOS shows it once
   ever, and a cold ask before any value is mostly declined (unrecoverable without Settings).
2. Push is iOS-app-only (APNs); web/Safari users can't receive it at all.

## Fix — warm, primed ask
**Native (2.3 build):**
- `handleSignIn` no longer cold-asks. If already `.authorized` → register the token
  silently; if `.notDetermined` → wait for the primer.
- `PushManager.requestPermissionAndRegister(completion:)` shows the real OS dialog only
  when invoked, and reports the resulting status.
- `WebView` app actions: `requestPushPermission` (→ the ask) and `openAppSettings`
  (→ iOS Settings, for the denied case).
- `WebView` reports OS auth status to JS (`window._pushAuthStatus` + `onPushAuthStatus`)
  on page load and after the ask.

**Web (gated on 2.3):**
- Primer modal ("Don't miss out on updates" + Turn on / Not now). Turn on → the native ask.
- `maybeShowPushPrimer()` fires after an early engagement moment — first wear-log
  (`saveLog`, new logs only) or first measurement (`markMeasurementTried`).
- Decision `shouldShowPushPrimer(state)` (pure, mirrored, 6 unit tests): only when
  available (2.3 native), `authStatus === 'notDetermined'`, and no decline
  cooldown/cap in effect (7-day cooldown, cap 3). Overlay-guarded so it never stacks
  on the review prompt / other modals.
- Settings row ("Push notifications") in profile → notifications: reflects OS status;
  Turn on when notDetermined, Open Settings when denied, "On" when authorized.
- Funnel-tracked via `_logPostCtaEvent('shown'|'clicked'|'dismissed', 'push_primer')`.

## Marking / status
`window._pushAuthStatus` is the source of truth for suppression + the settings row;
native keeps it current. `seen`-style local state (`wr_push_primer`) tracks decline
cadence only.

## Build split
Web ships now (inert until 2.3). Native code (PushManager.swift, WebView.swift) lands
in the 2.3 App Store build — build on the MacBook Pro (no xcodebuild on the Mac Mini),
TestFlight, verify: cold ask gone at sign-in; primer → OS dialog; grant → token stored +
status flips to authorized; deny → settings row offers Open Settings.

## Rollback
Web: revert the `index.html` hunks + SW bump (gate makes it inert regardless).
Native: revert PushManager/WebView changes (restores the cold ask).
