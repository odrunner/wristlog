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
