# WRotate Android App — Shell + Measurement + Sign-in (Android Port, Plan 2)

## Intent and why

WRotate ships on iOS as a thin native shell wrapping the live web app (wrotate.com) in a
WebView, adding only what a browser cannot: the microphone timegrapher engine and push. The
engine was ported to Kotlin and validated on a Pixel 7 (Plan 1 — `android/VALIDATION.md`).
Plan 2 builds the Android app that turns that engine into a shippable product.

The owner's directive sets the whole design: **Android is the same as iOS. The web app is
single-source and must not fork. Differ only where a platform physically forces it.** So this
document is essentially a catalog of the forced differences and how each stays as close to iOS
as possible.

## Goals

- One native Activity hosting an Android WebView that loads live wrotate.com, with the same
  load-once + reload-after-idle behavior as the iOS WKWebView.
- The entire WRotate product — sign-up, onboarding, feed, profile, collection, settings,
  everything — is the existing web app served to the WebView, unchanged and not reimplemented.
- Microphone timegrapher measurement works in-app, driven by the page's existing measurement
  JS with **no changes to that JS**, backed by the validated Kotlin engine.
- Google and Apple sign-in work.
- The shared web codebase does not fork: the same `index.html`/JS runs on web, iOS, and Android.

## Non-goals (v1) — immediate fast-follow

- **Push** (Android is FCM, not APNs: a different token system plus a backend branch in
  `send-push`). First fast-follow.
- **Share-to-app** (an `ACTION_SEND` receiver replacing the iOS share extension).
- **Deep links / Android App Links** (`assetlinks.json` + intent filters; needed for push-tap
  routing and shared-post links).
- **In-app review prompt** (Play In-App Review). Later.
- **Native background session-refresh.** iOS's `SessionRefresher` refreshes the auth token while
  backgrounded (holding a `beginBackgroundTask`) so the next open is ~1 s faster. Android has no
  clean equivalent — a backgrounded WebView is paused and there is no background-task API for
  arbitrary page JS. v1 skips it; the `auth` handler still accepts `SESSION_REFRESH_DONE` /
  `TOKEN_REFRESHED` as no-ops so the bridge contract matches, and the ~1 s first-request lag on a
  cold open is accepted. [Decided: skip in v1; revisit with a next-foreground refresh if it bites.]

## Anti-goals (a failure even if it technically runs)

- **Forking the web app.** Any solution requiring a separate Android branch in `index.html`/JS
  for a feature that exists on both platforms is a failure. The web stays one version.
- **Faking iOS identity.** The shell must not set `window._iosAppVersion` or otherwise
  masquerade as iOS: the web's `isIos` logic (`!!window._iosAppVersion`) drives iOS-only UI and
  routing, and mislabeling would mis-trip it.
- **Reimplementing product UI natively.** The only native surfaces are the shell plumbing and
  the measurement bridge.

## Constraints

- `android/engine` is pure JVM, minSdk 26, already built and validated. `android/app`
  (`com.wrotate.app`, targetSdk 35) currently holds the Plan 1 validation harness Activity;
  Plan 2 replaces it with the real shell (keep `AudioCapture`/`WavIo` reuse).
- Google OAuth refuses to complete inside an embedded WebView, so sign-in hands out to a Chrome
  Custom Tab (owner-accepted "to start"); Apple sign-in uses the same hand-off.
- The web↔native contract is fixed by the shipped web app and must be matched, not changed:
  JS→native is `window.webkit.messageHandlers.<name>.postMessage({action, …})`; native→JS is
  `window._tgNativeCallback(<json>)`. Native detection for measurement is the platform-neutral
  `window._wrotateNativeTimegrapher`.
- No `sw.js` or `SITE_FILES` change. The only web edit is the bounded gate generalization in
  §3. No emoji anywhere. Commit trailer per repo convention.

## The decided "how"

### 1. The bridge — a compatibility shim, so the web stays unforked

At page load the shell injects a JS object that recreates the exact interface the web expects:
`window.webkit.messageHandlers` with the handlers v1 needs — `timegrapher`, `haptic`, `auth` —
each exposing `postMessage(obj)` that forwards to a native Android `@JavascriptInterface`
object. Native returns results by calling `window._tgNativeCallback(<json>)` via
`evaluateJavascript`, exactly as iOS does. The shell also sets
`window._wrotateNativeTimegrapher = true`. Result: the page's existing measurement, haptic, and
auth-session JS runs byte-identical on Android with zero changes to those call sites.

The measurement bridge mirrors `ios/Wrotate/Wrotate/TimegrapherBridge.swift` exactly:

- **JS→native actions:** `ping`; `start` {bph, sensitivity, source, pzMode, algo}; `stop`;
  `sensitivity` {value}; `tuning` {the full iOS param set, including `tgStabFresh` and
  `tgBphDecisive`}. Android v1 is mic-only — a `source:'piezo'` start routes to the mic path
  (piezo is not ported); `tuningPiezo` is accepted and ignored. The `start` `algo` field is
  accepted but the bridge always runs the **tg (Pro V2) engine** — the only path ported and
  validated. The legacy "Standard" engine is being retired app-wide in a separate, parallel
  effort, so no engine toggle remains to honor; Android ignores `algo` regardless of when that
  retirement lands.
- **native→JS events** via `_tgNativeCallback`: `pong`; `started`; `update` {rate, beatError,
  amplitude, tickCount, confidence, noiseLevel, detectedIntervalMs, detectedBph,
  cumulativeOffset, elapsedSec, method, rateStable, tgSignalQuality, tgAcquiring, newTicks[],
  debugMessages[], beatWaveform?, tickPositions?, debug?}; `stopped` {rate, beatError,
  tickCount}; `error` {message}; `audioInterruption` {state}. The Kotlin `Update` already
  carries these fields (validated). **The final reading comes from the last `update`, never from
  `stopped`** (`stopped.rate` is the legacy-only field, always null in tg mode — VALIDATION.md).
- The bridge wires the validated `AudioCapture` + `TimegrapherCore` behind these actions,
  running the core on a single dedicated capture thread (`analysisExecutor = null`), and
  requesting mic permission on `start`.
- **Mid-session tuning is normal and must be marshalled, not raced.** The web posts the full
  `tuning` payload ~200 ms after `start` (index.html `sendMsrTuning` on a timeout), and again on
  every dev-knob change and BPH-change restart — so `tuning`/`sensitivity` routinely arrive while
  a session is running. The Plan 1 single-driver contract is honored not by forbidding this but by
  making the capture thread the only thread that ever touches the core: the bridge **enqueues**
  `setTuning` and applies it at the top of the next `process()` on the capture thread, never
  calling the core from the JS-interface thread. iOS tolerates mid-session tuning because the Swift
  engine mutates params live; Android reaches the same place via the queue. `sensitivity` is
  accepted and ignored (tg mode does not use it).

### 2. Sign-in — Custom Tab hand-off, mirroring the iOS auth bridge

The page's Google/Apple buttons would complete in-page; Google blocks that in a WebView. The
shell intercepts the OAuth start, opens the provider in a Chrome Custom Tab, and on return
injects the resulting session into the WebView so the web app continues exactly as after an
in-page sign-in — mirroring the iOS `OAuthManager` + `auth` message-handler path. The injected
bridge script that iOS uses to watch for and forward the session (WebView.swift) is the
reference for the `auth` handler's shape.

### 3. The one bounded web change — platform-neutral capability gates

A handful of measurement feature-gates in `index.html` read `iosAtLeast(window._iosAppVersion,
…)` (e.g. `_native21`, the TG-v2 gate, the beat-error ≥2.3 gate). To light up on Android
without faking an iOS version, introduce a platform-neutral signal — `window._nativeAppVersion`
+ `window._nativePlatform` ('ios'|'android'), set by each shell — and a `nativeAtLeast(min)`
helper, then change **only those measurement gates** to the neutral check. iOS sets both the old
and the new flags so it keeps passing unchanged. This is a focused edit shared by both
platforms, not a fork. Push/review gates stay iOS-specific and are naturally dark on Android
because v1 does not install the `appAction` handler.

**`_nativeAppVersion` is a capability version on the shared iOS numbering line — NOT the Android
Play Store `versionName`.** The gates compare versions (`_native21` ≥ 2.1, the TG-v2 path ≥ 2.0,
beat-error ≥ 2.3), and iOS sets `_nativeAppVersion = _iosAppVersion` (currently 2.10), so the
neutral line *is* the iOS line. The first Android build therefore stamps the then-current shared
number (≥ 2.3; match iOS), so the validated Pro V2 engine runs. Stamping the Android marketing
`versionName` (which starts at "1.0") would leave `nativeAtLeast('1.0','2.3')` false — the Measure
tab would appear but silently fall back to the legacy engine with beat error hidden, defeating the
port. [Decided: capability version on the shared line, independent of Play Store versionName.]

### 4. Shell plumbing (mirror iOS behavior)

- Load live wrotate.com once in `onCreate`; do not auto-reload; reload on
  foreground-after-idle (mirror iOS ContentView's >30 min pattern) and on pull-to-refresh.
- Android back gesture/button navigates WebView history; exits the app at history root.
- Runtime `RECORD_AUDIO` permission on first `start`, mirroring the iOS prompt and the
  "denied → Settings" `error` event.
- Photo uploads: wire `WebChromeClient.onShowFileChooser` to gallery + camera so add-watch-photo
  / avatar / share-to-feed file inputs work (owner default: both gallery and camera).
- Keep the screen on during an active measurement (mirror iOS `isIdleTimerDisabled`).
- Inject `window._nativePlatform='android'` and `window._nativeAppVersion=<BuildConfig>`.

## What's left to the builder

- The exact OAuth interception point for the Custom Tab hand-off, against the current web
  sign-in code (intercept the OAuth navigation in a `WebViewClient` vs the page calling an
  explicit `auth` action — both reach the same hand-off).
- The precise enumeration of `index.html` gates to neutralize (this doc names the known ones;
  the builder confirms the full set from the current file).
- Android WebView config to match the web app's needs: DOM storage, mixed content, media
  playback without a user gesture, hardware acceleration, user-agent.
- Test strategy: unit tests for the bridge message mapping (assert it mirrors the iOS contract);
  the engine suite already exists; an on-device smoke mirroring `android/VALIDATION.md`.
- Versioning: how `_nativeAppVersion` is stamped (BuildConfig) and how the iOS side also sets
  the neutral flags during the transition.

## Cross-session dependency

The legacy "Standard" measurement engine is being retired app-wide in a separate, parallel
effort. This plan does **not** depend on that retirement completing first — the bridge ignores
`algo` and runs tg regardless. But both this plan's §3 web edit and the retirement touch
`index.html` (the retirement removes the engine toggle + legacy `_tgAlgo`/'original' JS; this
plan's only web edit is the §3 neutral-flag gate generalization). Whoever executes this plan
should rebase on the retirement if it has landed, and coordinate the two `index.html` edits.
