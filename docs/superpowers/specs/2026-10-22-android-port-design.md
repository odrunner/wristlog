# WRotate Android Port — Design

**Date:** 2026-10-22
**Status:** Approved by owner 2026-10-22
**Author:** Claude, from a brainstorm with Ozgur

## Intent

Ship WRotate on Android as a public Play Store release. Measurement is the
whole point: the native 2.0 timegrapher (phase-lock, phase-separated beat
error, adaptive convergence) at parity with the iOS app, with push
notifications and the app shell around them. The web app already runs in any
Android browser; what Android lacks is the native microphone engine, push,
and an installable app.

First device: the user's Google Pixel 7 (arrives Saturday 2026-10-25). The
app must ultimately work on most Android phones, not just Pixels.

## Goals

1. **Measurement parity.** A Kotlin port of `ios/Wrotate/Wrotate/TimegrapherEngine.swift`
   producing the same session behavior, the same bridge messages, and the
   same log markers (`[TGTUNE]` echo, `psBE=` signature) so the existing
   telemetry — the Sunday accuracy loop, the rollout tracker, tick-log
   analysis — covers Android sessions without modification.
2. **Push notifications.** FCM registration into the existing `device_tokens`
   table as `platform='android'`; the server send path and the reminder RPCs
   extended so Android users receive wear reminders, measure reminders, the
   day-7 nudge, and badge pushes.
3. **App shell at parity.** WebView serving wrotate.com with the bridge the
   JS already expects; sign-in via Custom Tabs; app links; share target;
   in-app review; app shortcuts.
4. **Public Play Store release**, through Google's required closed-testing
   phase, with testers recruited from Reddit (several users have already
   asked) and the existing user base.

## Non-Goals

- **PiezoEngine is not ported.** It is experimental and stays iOS-only.
- No new features beyond parity. No redesign of any surface.
- No frameworks on the web side — the web app stays vanilla JS.
- No Kotlin Multiplatform / shared C++ core. The iOS engine stays Swift;
  Android gets a direct Kotlin port. Two implementations is an accepted cost.

## Anti-Goals (failure even if it "works")

- **Breaking iOS or web behavior.** The web-side bridge changes must be
  invisible to iOS users and web users. Every `iosAtLeast()` /
  `_iosAppVersion` gate must keep its exact current meaning for iOS.
- **Android masquerading as iOS.** Android must not set `_iosAppVersion`,
  must not write `platform='ios'` token rows, and must not pollute
  iOS-specific metrics (2.0 rollout tracker counts, push-auth stats).
- **Breaking email links for Android users.** `_shared/tracked.ts` gates
  per-recipient click tracking on *any* `device_tokens` row with
  `app_version >= 2.6` — it does not check platform. An Android token row
  would route that user's email links through click.wrotate.com, whose
  `.well-known` (private S3 behind CloudFront) has no `assetlinks.json`, so
  links would stop opening the app. The gate becomes **tracked = has an iOS
  ≥2.6 token AND has no Android token** (Claude's call: a dual-device user's
  Android phone would otherwise get broken app-opens, and total historic
  click volume is 118 events, so the metric loss is trivial). This lands
  **in the same change that first registers an Android token**. Android may
  only be included later if assetlinks.json is added to the click-tracking
  bucket and the Android app verifies that host.
- **Confidently wrong readings on hostile hardware.** Phones that force
  auto-gain/noise-suppression on the mic must be detected and the session
  degraded honestly (lower accepted-tick counts, no-reading outcomes), never
  a plausible-looking wrong rate.

## Constraints

- Repo layout: Android project lives at `android/` alongside `ios/`.
- Web app rules apply to every index.html change: design-system tokens only,
  SW cache version bump, ratchet budget never raised, coverage gate on new
  `wrotate_test.js` exports, full test suite before push.
- Development happens on the Mac Mini (headless Gradle builds + unit tests;
  no Android Studio required for CI-style work). Device installs via `adb`
  over USB or Wi-Fi.
- All email/push server work follows existing rules: edge functions deployed
  `--no-verify-jwt`, smoke test after deploy, RPCs applied via
  `supabase db query --linked`, new tables (none expected) ship with GRANTs.
- Sending anything (broadcast recruiting testers, push to real users) needs
  the user's explicit go-ahead; admin-only and code changes do not.

## The Decided How

### 1. Engine port (the critical path)

- **Scope: the default Pro V2 engine (`algo='tg'`) only** (owner's
  decision). The legacy "Standard" engine (`algo='original'`) is not ported
  for 1.0; the engine selector in Advanced Settings is hidden on Android
  (part of the web gate audit in §2, with no iOS behavior change).
- **Language: Kotlin, direct port.** The Swift engine's DSP is portable
  math: biquad high-pass filters, Goertzel detectors, FFT autocorrelation.
  The only Apple dependency is vDSP/Accelerate (17 call sites, confined to
  the FFT-autocorrelation and mean/RMS helpers) — replaced by a small
  radix-2 FFT (library or ~100-line implementation; builder's choice).
- **Structure: pure DSP core + capture adapter.** The port separates the
  tick-detection/convergence logic (pure functions over Float arrays,
  unit-testable on the JVM with no Android device) from audio capture. The
  Swift original couples them via AVAudioEngine taps; the Kotlin version
  must not, because testability of the DSP core is how we verify the port.
- **Capture:** `AudioRecord`, 48 kHz mono float, preferring
  `MediaRecorder.AudioSource.UNPROCESSED` when
  `AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED` reports support
  (Pixels do), falling back to `VOICE_RECOGNITION` (disables AGC/NS on most
  devices) otherwise. The chosen source and the device model are logged in
  the `[TGTUNE]` echo so tick-log telemetry can segment quality by capture
  path and device. Mirror the Swift engine's handling of sample-rate
  changes, interruptions (audio focus loss), and route changes (wired/BT
  mics).
- **Parity verification, in order:**
  1. **Synthetic fixtures** — generated tick trains with known rate, beat
     error, and amplitude patterns, asserted against expected engine output.
     These run as JVM unit tests and are built before Saturday.
  2. **Recorded-audio replay** — real watch recordings captured on the
     Pixel 7 on Saturday, replayed through the DSP core as regression
     fixtures (checked into `android/` test resources if small, or kept
     locally).
  3. **Side-by-side acceptance** — the same ≥3 watches measured on iPhone
     and Pixel 7: Android median rate within **±3 s/day** of the iPhone
     median per watch, and Android sessions meeting the existing "good"
     proxy (|rate| ≤ 15 s/day, ≥ 40 accepted ticks). Beat error within
     ±0.5 ms. Until this passes, nothing ships to testers.
- **Tuning knobs:** the engine honors the same knob set the JS sends
  (`_tgKnob` / trial values arrive through the existing `start` message), so
  Sunday knob trials apply to Android sessions automatically. Knob defaults
  start identical to iOS; device-specific divergence is a later, evidence-
  driven step, not a launch task.

### 2. Bridge and web-side changes

- The JS calls four handlers: `auth`, `appAction`, `timegrapher`, `haptic`
  (`window.webkit.messageHandlers.X.postMessage({...})`), and native calls
  back by evaluating JS. On Android, a JavascriptInterface-backed shim
  injected at document start provides the same four channels; whether the
  shim literally emulates the `window.webkit.messageHandlers` shape or the
  web gains a thin `nativeBridge` abstraction is the builder's choice,
  under the anti-goal above: **zero behavior change for iOS and plain web.**
- Android exposes `window._androidAppVersion` (its own series, starting
  `1.0`) and never `_iosAppVersion`. Web gates that actually mean "native
  capability X exists" (native timegrapher, push bridge, review prompt,
  haptics) are taught to accept Android; gates that mean "iOS build ≥ N"
  (e.g. click-link unwrapping, 2.6 route payloads) stay iOS-only until
  Android explicitly implements the capability. The builder audits every
  `iosAtLeast` / `messageHandlers` site (≈30) and classifies each.
- Message semantics to mirror from the Swift side (`WebView.swift`,
  `TimegrapherBridge.swift`, `PushManager.swift`): auth session handoff
  (SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT / SESSION_REFRESH_DONE), badge
  updates, `requestReview` (→ Play In-App Review), `requestPushPermission`
  (→ Android 13+ POST_NOTIFICATIONS runtime request, reported via the
  existing `record_push_auth_status` RPC), `openAppSettings`, haptic types
  (→ Android VibrationEffect equivalents), and the full timegrapher
  start/stop/data streaming contract.

### 3. Push notifications

- **Client:** Firebase Cloud Messaging. Token upserted into `device_tokens`
  with `platform='android'`, `app_version` set to the Android version.
  Notification taps route like iOS push taps (deep-link payloads → the same
  in-app routes).
- **Permission ask: at first sign-in** (owner's decision). Android 13+ has
  no provisional/quiet state, so the iOS deferred strategy cannot map; the
  app prompts for POST_NOTIFICATIONS right after a successful sign-in.
  Grant/denied status is reported like iOS does.
- **`push_auth_status` gains a platform dimension** (Claude's call — today
  it is one row per user, so an Android `denied` would overwrite an
  iPhone's `authorized` and flip reminder channel selection). PK becomes
  (user_id, platform); `record_push_auth_status` takes the platform; the
  reminder RPCs' channel rule becomes: push if **any** platform is
  authorized, delivered to each authorized platform's tokens, else email.
  Existing rows migrate as platform='ios'.
- **Server:** `send-push` and `send-badge-push` gain an FCM HTTP v1 sender
  (OAuth2 service-account auth; key stored as a Supabase secret) beside the
  APNs path, selecting per token row by `platform`. FCM's permanent-failure
  codes (UNREGISTERED etc.) prune dead tokens the way APNs 410s do today.
  The reminder RPCs (`wear_reminder_targets`, measure reminders,
  `remeasure_d7_targets`) currently require an iOS token for push
  eligibility; each is extended to treat an Android token equivalently.
  RPC changes are applied as new dated files in `sql/`.
- **Firebase project:** a new Firebase project (owned by the user's Google
  account) provides FCM; no other Firebase services are used. Creating it is
  a user task (console login), ~10 minutes, needed before push work can be
  tested end to end.

### 4. Shell, sign-in, links, share

- **applicationId: `com.wrotate.app`** (owner's decision; permanent on Play,
  baked into assetlinks.json, Firebase, and the intent filters).
- Kotlin + WebView, min SDK 26 (covers the vast majority of active
  devices; builder may adjust ±2 with justification). Target SDK: current
  Play requirement (35).
- **Sign-in:** Google and Apple OAuth cannot run inside a WebView (Google
  blocks it). Mirror the iOS approach (`OAuthManager.swift`, 41 lines —
  ASWebAuthenticationSession): Chrome Custom Tabs + the existing Supabase
  GoTrue flow, returning via an app link / custom scheme to hand the session
  to the WebView, matching the SIGNED_IN handoff above.
- **App links:** `.well-known/assetlinks.json` (package name + release-key
  SHA-256 fingerprints) added to the repo and to `SITE_FILES` (the
  `.well-known/` entry already ships). Same link routes the AASA covers
  today; email CTAs keep pointing at `https://wrotate.com/open`.
- **Share target:** Android equivalent of the iOS share extension
  (`ShareViewController.swift`) — an activity accepting the same content
  types and feeding the same web flow.
- **App shortcuts:** Android dynamic shortcuts mirroring
  `QuickActionManager.swift`.
- **Offline/network state:** mirror `NetworkMonitor.swift` behavior.
- **Icon/branding:** generated from the existing `ios/app-icon.svg` source;
  adaptive-icon variants required by Android.

### 5. Keeping the two engines in sync (owner requirement)

Web changes reach both platforms by construction. For the native engines:

- **Most tuning never touches native code.** Knob values flow through the
  `experiments` system and the bridge `start` message; Android honors the
  same knob set (§1), so Sunday-loop trials, promotions, and new defaults
  apply to both platforms automatically.
- **Lockstep rev, enforced by test** (Claude's call): both engine sources
  declare a `TG_ENGINE_REV` constant; a unit test in the normal `npm test`
  suite reads `ios/Wrotate/Wrotate/TimegrapherEngine.swift` and the Kotlin
  engine source and fails on mismatch. An algorithm change bumps the rev
  where it's made, forcing the matching port in the same change — or an
  explicit dated waiver entry in the test (e.g. an iOS-only capability),
  so divergence is always a recorded decision, never drift.
- **Shared parity fixtures:** the synthetic + recorded fixtures from §1
  serve as the cross-platform contract — an algo change updates the
  expected outputs once, and both engines must reproduce them within
  tolerance.
- **Changelog convention:** every `docs/measurement-changelog.md` entry
  gains a platforms line (ios / android / both / web).

### 6. Play Store release path

1. **Now:** user creates a personal Google Play developer account ($25,
   identity verification can take days — start immediately). User task.
2. **Internal testing track** (up to 100 testers by email, no review wait):
   the user's Pixel 7 installs from here once the engine passes acceptance;
   before that, direct `adb` installs of debug builds.
3. **Closed testing**: Google requires 12 testers opted in for 14
   continuous days before a new personal account may go to production.
   Recruiting: the Reddit users who asked, plus an ask to existing users
   (in-app surface and/or broadcast — **the send itself needs the user's
   go-ahead**). The 14-day clock is the schedule's long pole after the
   engine works; start closed testing as early as the build is honest.
4. **Production** after the 14 days + Google review. Store listing needs
   screenshots (reuse the Playwright screenshot pipeline), privacy policy
   (privacy.html exists), and the Data Safety form (declare: account data,
   photos, audio processed on-device and not recorded — mirror the App
   Store privacy answers).
- **Signing:** Play App Signing (Google holds the release key); upload key
  kept with the user's other keys in `~/.config/wrotate/`. The
  `assetlinks.json` fingerprint must be the **Play App Signing** key's, not
  the upload key's.

### 7. Versioning, telemetry, metrics hygiene

- Android version series starts at `1.0`, independent of iOS 2.x.
  `versionCode` increments every upload.
- Android sessions write the same tick-log format. The rollout tracker
  (`scripts/rollout-check.py`) counts `psBE=` as "native 2.0" — Android
  sessions will satisfy that; before first external Android session, decide
  (and note in the script) whether its counts split by platform. Low
  stakes; flagged so it isn't a surprise.
- Admin metrics that say "iOS" (push stats) get an Android/platform
  dimension only where they'd otherwise mislead; no dashboard redesign.
- **After the Play release ships** (owner decision: not before), the admin
  reporting page gains an iOS vs Android install/adoption breakdown
  (`device_tokens.platform` is the natural source).
- Internal accounts exclusion applies unchanged (server-side tables/RPCs).

## Order of Work (shape, not schedule)

1. Kotlin DSP core port + synthetic-fixture tests (JVM, no device) — the
   bulk of the pre-Saturday work.
2. Minimal capture harness app (record → engine → numbers on screen, no
   WebView) to validate on the Pixel 7 the day it arrives; record WAV
   fixtures; side-by-side acceptance against the iPhone.
3. WebView shell + bridge + web-side gate audit (tracked.ts platform fix
   lands here, before any token row exists).
4. FCM client + server senders + reminder RPC extensions; smoke tests.
5. Sign-in, app links, share target, shortcuts, review, icon.
6. Play account/tracks, store listing, closed-test recruiting, 14-day
   soak, production.

Steps 1–2 are strictly first (measurement is the point); 3–5 can
interleave after.

## Left to the Builder

- FFT implementation choice; Kotlin project structure; Gradle/AGP versions.
- Exact bridge shim mechanics (emulate `webkit.messageHandlers` vs web-side
  abstraction), given the zero-iOS-change constraint.
- Foreground-service vs in-activity capture for measurement sessions
  (screen stays on during measurement on iOS; match that UX).
- FCM library-vs-raw-HTTP choice server-side; notification channel design.
- How WAV replay fixtures are stored (repo vs local) by size.
- Whether Android CI runs anywhere initially or tests stay local-only.
- Classification of each individual `iosAtLeast` gate (per the rule in §2).

## Open Risks

- **Per-device audio variance** is the known unknown: AGC/NS behavior,
  mic frequency response, and buffer timing jitter differ across OEMs. The
  design's answer is capture-path telemetry in tick logs + the existing
  accuracy loop, plus honest degradation. Expect post-launch tuning.
- **WebView engine differences** (Chromium WebView vs iOS WKWebView) may
  surface small CSS/JS issues; the e2e mocked suite runs in Chromium
  already, which covers most of it.
- **Closed-testing attrition**: Google counts testers continuously opted in;
  recruit more than 12.
