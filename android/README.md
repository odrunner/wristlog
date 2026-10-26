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

The working setup: Claude builds the APK on the Mac Mini; the Pixel is installed from the
**MacBook Pro** over USB. Copy the fresh APK across first:

```
# on the MacBook Pro
rsync ozgurdogan@192.168.1.246:"~/Documents/Claude\ project/watch\ tracker/android/app/build/outputs/apk/debug/app-debug.apk" ~/Downloads/
~/Library/Android/sdk/platform-tools/adb install -r ~/Downloads/app-debug.apk
```

(`adb install -r` also works directly on the Mac Mini if the phone is plugged in there.)

**Play-testing caveat (app is on the Play Store test track since 2026-10-25):** debug and release
share the applicationId `com.wrotate.app` with no debug suffix, so a sideloaded debug APK
**cannot install over a Play-installed copy** — signatures differ (Play App Signing), and
`adb install -r` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Either uninstall the Play copy
first (`adb uninstall com.wrotate.app` — clears app data, so you re-sign-in), or ship the change
through Play: bump `versionCode` in `app/build.gradle.kts`, `./gradlew :app:bundleRelease`
(needs `keystore.properties`), upload `app/build/outputs/bundle/release/app-release.aab` to the
Play Console test track.

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

### Added by the final-review fix pass (verify on device)
- OAuth: cold-start return (app process killed behind the Custom Tab) still signs in; a forged
  `wrotate://auth-callback` from another app does nothing.
- Process death: returning from the camera/Custom Tab under memory pressure restores the page (not blank).
- External links (non-wrotate.com) open in the browser, not inside the app.
- Edge-to-edge: header/footer clear the status bar and gesture nav; the keyboard doesn't cover inputs.
- Pull-to-refresh does not fire (and discard a draft) while a scrolled modal is open.
- File chooser offers gallery + camera, honors video and multi-select where the input allows.
