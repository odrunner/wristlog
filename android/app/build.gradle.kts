plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.wrotate.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.wrotate.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        // Capability version on the shared iOS numbering line (NOT the Play Store versionName),
        // injected as window._nativeAppVersion so the measurement gates (>=2.0/2.1/2.3) clear.
        buildConfigField("String", "NATIVE_CAPABILITY_VERSION", "\"2.10\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":engine"))
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.browser:browser:1.8.0")
    testImplementation(kotlin("test-junit"))
    // Real org.json so JVM unit tests exercise the message-parse path (android.jar stubs it).
    testImplementation("org.json:json:20231013")
}
