# WRotate Android

Kotlin port of the WRotate timegrapher engine. Two modules:

- `engine` - pure JVM library (`com.wrotate.engine`), no `android.*` imports.
- `app` - Android application (`com.wrotate.app`), minSdk 26, targetSdk 35.

## Prerequisites

- JDK 17 (`brew install openjdk@17`); export `JAVA_HOME=/opt/homebrew/opt/openjdk@17`.
- Android SDK with `platforms;android-35` and `build-tools;35.0.0`
  (`sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"`).
- `android/local.properties` (gitignored) pointing at the SDK:
  `sdk.dir=/Users/<you>/Library/Android/sdk`

## Build and test

```
cd android
./gradlew :engine:test
./gradlew :app:assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/app-debug.apk`.

## Install on a device

```
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## The shell app (Plan 2)

`ShellActivity` is the launcher: a WebView over live wrotate.com that mirrors the iOS app,
adding the microphone timegrapher (the validated Kotlin engine, behind a JS bridge) and
Google/Apple sign-in (Chrome Custom Tab hand-off). The web app is unchanged — a JS shim
recreates the iOS `window.webkit.messageHandlers` bridge so the page's measurement/haptic/auth
JS runs as-is. `HarnessActivity` remains for engine debugging (launch via
`adb shell am start -n com.wrotate.app/.HarnessActivity`).

### On-device smoke (Task 6 — run with the device)

1. `./gradlew :app:assembleDebug` and install (above). Launch "WRotate" — wrotate.com loads.
2. Measure a real watch (set the BPH): rate / beat error / amplitude populate; compare to a
   replay of a recorded WAV through the engine (as in Plan 1). Confirm `record_boot_timing`
   receives `platform='android'`.
3. Sign in with Google and with Apple — the Custom Tab completes and the session lands in the app.
4. Add a watch photo via the file chooser (gallery and camera).
