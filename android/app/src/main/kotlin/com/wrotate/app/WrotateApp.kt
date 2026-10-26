package com.wrotate.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/** Initializes Firebase manually from checked-in public identifiers — google-services.json is
 *  gitignored (public repo) and the gradle plugin is deliberately not applied, so every
 *  checkout builds without it. */
class WrotateApp : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseApp.initializeApp(
                    this,
                    FirebaseOptions.Builder()
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        .build(),
                )
            }
            PushChannels.ensure(this)
        } catch (e: Exception) {
            // Push is additive: a Firebase init failure must never take the shell down.
        }
    }
}
