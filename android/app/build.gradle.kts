import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing is read from android/keystore.properties (gitignored; see
// keystore.properties.example). Absent (CI / a dev without the key) → debug builds still work and
// `release` is simply unsigned.
val keystoreProps = rootProject.file("keystore.properties").takeIf { it.exists() }?.let {
    Properties().apply { load(FileInputStream(it)) }
}

android {
    namespace = "com.wrotate.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.wrotate.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "1.1.1"
        // Capability version on the shared iOS numbering line (NOT the Play Store versionName),
        // injected as window._nativeAppVersion so the measurement gates (>=2.0/2.1/2.3) clear.
        buildConfigField("String", "NATIVE_CAPABILITY_VERSION", "\"2.10\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (keystoreProps != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
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
    implementation("com.google.android.play:review:2.0.2")
    // play:review drags in fragment:1.1.0, which release lint rejects for the ActivityResult APIs.
    implementation("androidx.fragment:fragment:1.6.2")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    testImplementation(kotlin("test-junit"))
    // Real org.json so JVM unit tests exercise the message-parse path (android.jar stubs it).
    testImplementation("org.json:json:20231013")
}
