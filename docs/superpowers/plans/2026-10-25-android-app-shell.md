# WRotate Android App Shell (Android Port, Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thin native Android app — a WebView shell wrapping live wrotate.com — that mirrors the iOS app, adding in-app microphone timegrapher measurement (the validated Kotlin engine) and Google/Apple sign-in, with no fork of the web codebase.

**Architecture:** One Activity hosts an Android WebView that loads live wrotate.com once (iOS load-once + reload-after-idle pattern). The shell injects a JS shim that recreates the iOS `window.webkit.messageHandlers` interface so the page's existing measurement/haptic/auth JS runs unchanged; native returns results via `window._tgNativeCallback`. The measurement bridge wires the existing `AudioCapture` + `TimegrapherCore`. Sign-in hands OAuth out to a Chrome Custom Tab and injects the session back. One bounded, backward-compatible web edit generalizes a few measurement version-gates to a platform-neutral flag.

**Tech Stack:** Kotlin, Android (minSdk 26, targetSdk 35, `com.wrotate.app`), Android WebView, AndroidX Browser (Custom Tabs), the existing pure-JVM `engine` module. No Compose, no third-party web frameworks. Vanilla JS for the web edit.

**Spec:** `docs/superpowers/specs/2026-10-25-android-app-shell-design.md`

## Global Constraints

- The web↔native contract is fixed by the shipped web app and must be matched, not changed: JS→native is `window.webkit.messageHandlers.<name>.postMessage({action, …})`; native→JS is `window._tgNativeCallback(<json>)`; measurement native-detection is `window._wrotateNativeTimegrapher`.
- No web fork: the same `index.html`/JS runs on web, iOS, and Android. The only web edit is Task 1 (platform-neutral gates), and it must be backward-compatible — existing iOS builds keep passing with zero native change (`nativeAtLeast` falls back to `_iosAppVersion`). (The iOS shell now also sets `_nativePlatform='ios'` + `_nativeAppVersion` explicitly in `WebView.swift`, shipping with the next iOS build; the `_iosAppVersion` fallback covers builds predating that edit, so Task 1 is correct regardless of iOS adoption.)
- The shell must NOT set `window._iosAppVersion` or otherwise masquerade as iOS (`isIos = !!_iosAppVersion` drives iOS-only UI/routing).
- `_nativeAppVersion` is a capability version on the shared iOS numbering line (≥ 2.3; match current iOS 2.10), injected independent of the Play Store `versionName`/`versionCode`.
- Android v1 is mic-only and tg-only: the bridge accepts `source`/`algo` but always runs `TimegrapherCore` with `useTgAlgo = true`; `sensitivity` and `tuningPiezo` are accepted and ignored. The Standard engine is already retired app-wide.
- The core runs on a single dedicated capture thread (`analysisExecutor = null`); the bridge never touches the core from the JS-interface thread — mid-session `tuning` is queued and applied on the capture thread.
- The final reading comes from the last `update` event, never from `stopped` (`stopped.rate` is always null in tg mode).
- No `sw.js` change beyond Task 1's stamp bump. No emoji anywhere. Commit messages end with the repo's Co-Authored-By trailer.
- Android code lives only under `android/app/`; the `engine` module stays pure JVM.

## Review Focus

1. **Mid-session tuning race (every session):** the web posts `tuning` ~200 ms after `start`; applying it on the JS-interface thread races the capture thread inside `process()`. Pinned by Task 3's queue test (tuning applied only on the capture thread).
2. **Capability-version false floor (silent legacy fallback):** if `_nativeAppVersion` is below the gate thresholds, Measure appears but runs the legacy path with no beat error. Pinned by Task 1's gate tests (Android flag ≥ 2.3 lights up tg + beat error) and Task 2's injected-version test.
3. **iOS regression from the web edit:** an old iOS build with no `_nativeAppVersion` must still pass the generalized gates. Pinned by Task 1's fallback test (`nativeAtLeast` with only `_iosAppVersion` set).
4. **Back gesture losing the session (data loss feel):** Android back at WebView-history root must exit, but mid-history must navigate back, not kill a measurement. Pinned by Task 2's back-dispatch test.
5. **OAuth callback dropped (can't sign in):** the Custom Tab return must deliver the session to the WebView exactly once, even on cold-start return. Pinned by Task 4's callback-parse + single-delivery test.

---

### Task 1: Platform-neutral capability gates (the one web edit)

**Files:**
- Modify: `wrotate_test.js` (add `nativeAtLeast` beside `iosAtLeast` ~line 282; export it)
- Modify: `index.html` (mirror `nativeAtLeast`; repoint the measurement gates; fix the boot-timing platform label; bump the mirror + SW stamp)
- Modify: `tests/mirror-drift.test.js` (add `nativeAtLeast` to the mirrored-names list ~line 33)
- Test: `tests/native-at-least.test.js`

**Interfaces:**
- Produces: `nativeAtLeast(min)` — reads `window._nativeAppVersion`, falling back to `window._iosAppVersion` when unset, and compares with the same dotted-version logic as `iosAtLeast`; returns false when neither is set. `nativePlatform()` — returns `window._nativePlatform` or `'ios'` when `_iosAppVersion` is set or `'web'` otherwise. Both mirrored byte-identical in `index.html` and `wrotate_test.js`.

- [ ] **Step 1: Write the failing test** — `tests/native-at-least.test.js`, importing from `wrotate_test.js`:
  - `nativeAtLeast('2.10','2.3')` → true; `nativeAtLeast('2.1','2.3')` → false.
  - fallback: with `_nativeAppVersion` unset and `_iosAppVersion='2.3'`, `nativeAtLeast(min='2.3')` → true (set the globals the function reads).
  - neither set → false.
  - `nativePlatform()` → `'android'` when `_nativePlatform='android'`; `'ios'` when only `_iosAppVersion` set; `'web'` when neither.
- [ ] **Step 2: Run, verify it fails** — Run: `npx vitest run tests/native-at-least.test.js`. Expected: FAIL (`nativeAtLeast` not exported).
- [ ] **Step 3: Implement** `nativeAtLeast(min)` and `nativePlatform()` in `wrotate_test.js` (reuse `iosAtLeast`'s comparison), and paste the byte-identical mirror into `index.html` next to `iosAtLeast`.
- [ ] **Step 4: Repoint the gates in `index.html`** — change `_native21` (`iosAtLeast(_iosAppVersion,'2.1')` → `nativeAtLeast('2.1')`), `_tgV2Convergence` (`iosAtLeast(_iosAppVersion,_TG_V2_MIN_BUILD)` → `nativeAtLeast(_TG_V2_MIN_BUILD)`), and the beat-error gate (~line 32706, `iosAtLeast(_iosAppVersion,'2.3')` → `nativeAtLeast('2.3')`). Change the boot-timing platform label (~line 6189) from `_tgHasNative() ? 'ios' : 'web'` to `nativePlatform()`. Leave push/review gates (`iosAtLeast(_iosAppVersion,'2.3')` in `_canPush`-style helpers) unchanged.
- [ ] **Step 5: Add `nativeAtLeast` to the mirror list** in `tests/mirror-drift.test.js`.
- [ ] **Step 6: Run the suites** — Run: `npm test`. Expected: PASS (including mirror-drift and the new test). Bump the SW cache stamp in `sw.js`.
- [ ] **Step 7: Commit.**

---

### Task 2: Shell Activity — WebView, flag + shim injection, navigation

**Files:**
- Create: `android/app/src/main/kotlin/com/wrotate/app/ShellActivity.kt` (the launcher)
- Create: `android/app/src/main/kotlin/com/wrotate/app/BridgeScript.kt` (pure builder of the injected JS)
- Modify: `android/app/src/main/AndroidManifest.xml` (INTERNET permission; `ShellActivity` is LAUNCHER; `HarnessActivity` keeps its activity entry but loses the LAUNCHER filter)
- Modify: `android/app/build.gradle.kts` (`buildConfigField` `NATIVE_CAPABILITY_VERSION = "2.10"`; AndroidX WebKit/Browser deps)
- Test: `android/app/src/test/kotlin/com/wrotate/app/BridgeScriptTest.kt`

**Interfaces:**
- Consumes: Task 1's web flags (`_wrotateNativeTimegrapher`, `_nativeAppVersion`, `_nativePlatform`).
- Produces: `fun buildBridgeScript(capabilityVersion: String): String` — the document-start JS that sets `window._wrotateNativeTimegrapher=true`, `window._nativePlatform='android'`, `window._nativeAppVersion='<capabilityVersion>'`, installs `window.webkit.messageHandlers` with `timegrapher`, `haptic`, and `auth`, each a `{ postMessage(obj) }` that calls the injected `AndroidBridge.post(name, JSON.stringify(obj))`, and defines nothing that overwrites an existing `window.webkit`. `ShellActivity` exposes `@JavascriptInterface fun post(handler: String, json: String)` on the `AndroidBridge` object and `fun callJs(json: String)` that runs `window._tgNativeCallback(<json>)` on the UI thread.

- [ ] **Step 1: Write the failing test** — `BridgeScriptTest`: `buildBridgeScript("2.10")` output contains `window._wrotateNativeTimegrapher=true`, `_nativePlatform='android'`, `_nativeAppVersion='2.10'`, and installs `messageHandlers.timegrapher`/`haptic`/`auth` each exposing `postMessage`; and does not clobber a pre-existing `window.webkit` (guards with `window.webkit = window.webkit || {}`).
- [ ] **Step 2: Run, verify it fails** — Run: `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:testDebugUnitTest --tests '*BridgeScriptTest*'`. Expected: FAIL (unresolved `buildBridgeScript`).
- [ ] **Step 3: Implement** `buildBridgeScript` in `BridgeScript.kt`, and `ShellActivity` hosting a `WebView` that: enables JS + DOM storage; adds `AndroidBridge` via `addJavascriptInterface`; injects `buildBridgeScript(BuildConfig.NATIVE_CAPABILITY_VERSION)` at document start (a `WebViewClient` that evaluates it in `onPageStarted`); loads `https://wrotate.com` once in `onCreate`; reloads on foreground after >30 min idle and on pull-to-refresh; routes the Android back gesture to `WebView.goBack()` when `canGoBack()` else default (exit); keeps the screen on while a measurement is active (a flag the bridge toggles). Route the `haptic` handler to a `Vibrator` one-shot here; leave `timegrapher`/`auth` posting into the `AndroidBridge` for Tasks 3/4.
- [ ] **Step 4: Verify** — Run: `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:testDebugUnitTest :app:assembleDebug`. Expected: PASS + BUILD SUCCESSFUL.
- [ ] **Step 5: Commit.**

---

### Task 3: Measurement bridge — engine wiring, tuning marshal, Update→events

**Files:**
- Create: `android/app/src/main/kotlin/com/wrotate/app/MeasurementController.kt`
- Create: `android/app/src/main/kotlin/com/wrotate/app/BridgeMessages.kt` (pure parse/format helpers)
- Modify: `android/app/src/main/kotlin/com/wrotate/app/ShellActivity.kt` (route `timegrapher` posts to `MeasurementController`)
- Test: `android/app/src/test/kotlin/com/wrotate/app/BridgeMessagesTest.kt`, `MeasurementControllerTest.kt`

**Interfaces:**
- Consumes: Task 2's `AndroidBridge.post`/`callJs`; the `engine` module's `TimegrapherCore(analysisExecutor=null)`, `start(bph, useTgAlgo, sampleRate)`, `setTuning(Tuning)`, `onUpdate`, `Update`; `AudioCapture` (`selectAudioSource`, `start(onBuffer)`, `stop`, `onCaptureRestart`).
- Produces: `fun handleTimegrapherMessage(json: String)` — parses `{action,…}` and drives a session; `fun updateToEventJson(u: Update): String` and `fun startedJson()/stoppedJson(...)/errorJson(msg)/interruptionJson(state)/pongJson()` — exact `_tgNativeCallback` payloads mirroring `TimegrapherBridge.swift`. Tuning arriving mid-session is enqueued and applied on the capture thread.

- [ ] **Step 1: Write the failing tests** —
  - `BridgeMessagesTest`: `updateToEventJson` on a sample `Update` produces a JSON object with `event:"update"` and the fields `rate, beatError, amplitude, tickCount, confidence, noiseLevel, detectedIntervalMs, detectedBph, cumulativeOffset, elapsedSec, method, rateStable, tgSignalQuality, tgAcquiring`, with `newTicks`/`debugMessages`/`beatWaveform`/`tickPositions` present only when non-empty/non-null; `stoppedJson` has exactly `event,rate,beatError,tickCount`; `errorJson`/`interruptionJson`/`pongJson` match the Swift shapes.
  - `MeasurementControllerTest` (fake capture feeding a recorded/synth buffer, fake `callJs` sink): a `start` then a `tuning` message delivered mid-run results in `setTuning` being invoked only on the capture thread (assert via a thread-id capture in a fake core/executor), never on the caller thread; a `start` emits `started` then `update` events; `stop` emits `stopped`; the final rate is read from the last `update`, not `stopped`.
- [ ] **Step 2: Run, verify they fail** — Run: `… :app:testDebugUnitTest --tests '*BridgeMessages*' --tests '*MeasurementController*'`. Expected: FAIL.
- [ ] **Step 3: Implement** `MeasurementController` and `BridgeMessages`: on `start`, select the audio source, start `AudioCapture` feeding `core.process` on the capture thread (reuse the Plan 1 wiring), install `core.onUpdate` → `callJs(updateToEventJson(u))`, emit `started`; request mic permission first and emit `error` on denial; on `stop`, stop capture, emit `stopped`; on `tuning`, enqueue a `Tuning` to be applied at the next `process()` boundary on the capture thread; map `audioInterruption` began/resumed/failed. `source='piezo'`/`algo='original'` route to the mic+tg path; `sensitivity`/`tuningPiezo` are no-ops. Wire `ShellActivity` to forward `timegrapher` posts here.
- [ ] **Step 4: Verify** — Run: `… :app:testDebugUnitTest :app:assembleDebug :engine:test`. Expected: PASS + BUILD SUCCESSFUL.
- [ ] **Step 5: Commit.**

---

### Task 4: Sign-in — Custom Tab hand-off + session injection

**Files:**
- Create: `android/app/src/main/kotlin/com/wrotate/app/AuthHandler.kt`
- Modify: `android/app/src/main/kotlin/com/wrotate/app/ShellActivity.kt` (route `auth` posts; handle the callback intent)
- Modify: `android/app/src/main/AndroidManifest.xml` (intent-filter for the OAuth callback scheme `wrotate://auth-callback`, matching the iOS GoTrue redirect)
- Test: `android/app/src/test/kotlin/com/wrotate/app/AuthHandlerTest.kt`

**Interfaces:**
- Consumes: Task 2's `AndroidBridge`/`callJs`; the web's existing sign-in flow (the page's Google/Apple buttons and its `auth` message usage — confirm the exact trigger from current `index.html`/`OAuthManager.swift` at implementation time).
- Produces: `fun startOAuth(provider: String, authUrl: String)` — opens `authUrl` in a Chrome Custom Tab; `fun parseCallback(uri: android.net.Uri): SessionTokens?` — extracts the session from the `wrotate://auth-callback` fragment/query (mirror the iOS fragment handling); `fun sessionInjectionJs(tokens: SessionTokens): String` — the JS that hands the session to the web app (mirror the iOS `auth` path). Delivery is once-only, surviving a cold-start return.

- [ ] **Step 1: Write the failing tests** — `AuthHandlerTest`: `parseCallback` on a representative `wrotate://auth-callback#access_token=…&refresh_token=…` returns the tokens; on a URL without tokens returns null; `sessionInjectionJs` embeds the tokens into the agreed `window._tgNativeCallback`/`auth` injection shape; a second delivery of the same callback is a no-op (single-delivery guard).
- [ ] **Step 2: Run, verify they fail** — Run: `… :app:testDebugUnitTest --tests '*AuthHandler*'`. Expected: FAIL.
- [ ] **Step 3: Implement** `AuthHandler` and wire `ShellActivity`: route the page's OAuth start (intercept the provider navigation in the `WebViewClient`, or the `auth` action — whichever the current web flow uses) to `startOAuth`; receive the callback via the manifest intent-filter in `onNewIntent`/`onCreate`, parse it, and inject the session into the WebView once the page is loaded (hold-until-loaded like Plan 1's restart tests).
- [ ] **Step 4: Verify** — Run: `… :app:testDebugUnitTest :app:assembleDebug`. Expected: PASS + BUILD SUCCESSFUL.
- [ ] **Step 5: Commit.**

---

### Task 5: Photo uploads — WebView file chooser

**Files:**
- Modify: `android/app/src/main/kotlin/com/wrotate/app/ShellActivity.kt` (a `WebChromeClient` with `onShowFileChooser`)
- Modify: `android/app/src/main/AndroidManifest.xml` (a `FileProvider` for the camera-capture temp file, if camera is included)
- Test: on-device smoke (no unit test — framework-bound)

- [ ] **Step 1: Implement** `onShowFileChooser` launching an `ACTION_GET_CONTENT`/`ACTION_IMAGE_CAPTURE` chooser for images (gallery + camera), returning the chosen URI(s) to the `filePathCallback`; handle cancellation (null callback) so the page's file input does not hang.
- [ ] **Step 2: Verify build** — Run: `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:assembleDebug`. Expected: BUILD SUCCESSFUL.
- [ ] **Step 3: Commit.**

---

### Task 6: On-device validation + record

**Files:**
- Modify: `android/VALIDATION.md` (add a Plan 2 shell section), `android/README.md` (build/install/run of the shell)
- Test: manual, on-device, with the owner (mirror the Plan 1 checklist through the real shell)

- [ ] **Step 1:** Build and install the shell APK; confirm wrotate.com loads and the Measure feature appears (gated via `_wrotateNativeTimegrapher` + `nativeAtLeast('2.10')`).
- [ ] **Step 2:** Run a measurement through the bridge on a real watch; confirm rate/beat error/amplitude populate and match a replay of the recorded WAV through the engine (as in Plan 1); confirm `_nativePlatform='android'` reaches `record_boot_timing`.
- [ ] **Step 3:** Sign in with Google and with Apple via the Custom Tab; confirm the session lands in the web app. Add a watch photo via the file chooser.
- [ ] **Step 4:** Record the results in `android/VALIDATION.md`; commit.
