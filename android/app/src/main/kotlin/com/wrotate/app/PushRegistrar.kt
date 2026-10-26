package com.wrotate.app

import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import java.net.HttpURLConnection
import java.net.URL

/**
 * FCM token registration against the existing device_tokens table, mirroring
 * ios/Wrotate/Wrotate/PushManager.swift storeToken/deleteToken: user-bearer REST upsert with
 * merge-duplicates, platform='android', app_version = the Play versionName (NEVER the iOS-line
 * capability version — it would wrongly clear the >=2.6 email-tracking/route gates server-side).
 */
object PushRegistrar {
    private const val REST = "https://api.wrotate.com/rest/v1/device_tokens"
    private const val PUBLISHABLE_KEY = "sb_publishable_pxXMl4LD0xTLEqNKCZyQ5Q_qQfhNYbz"
    private const val PREFS = "push"

    // The signed-in session, learned from the page's auth bridge events.
    @Volatile private var userId: String? = null
    @Volatile private var accessToken: String? = null

    /** OS permission state → the web/status vocabulary. Below API 33 POST_NOTIFICATIONS is
     *  auto-granted (no dialog exists), so the only honest answer is authorized. Android has
     *  no provisional state, ever. */
    fun statusString(granted: Boolean, asked: Boolean, sdkInt: Int): String = when {
        sdkInt < 33 -> "authorized"
        granted -> "authorized"
        asked -> "denied"
        else -> "notDetermined"
    }

    /** What sign-in does with push: supabase-js re-emits SIGNED_IN on every foreground and
     *  TOKEN_REFRESHED hourly — the one-shot OS dialog may only ever be auto-launched once. */
    fun signInAction(granted: Boolean, asked: Boolean): String = when {
        granted -> "register"
        !asked -> "ask"
        else -> "report"
    }

    fun registrationBody(userId: String, token: String, versionName: String): String =
        org.json.JSONObject()
            .put("user_id", userId)
            .put("token", token)
            .put("platform", "android")
            .put("app_version", versionName)
            .toString()

    fun onSession(context: Context, uid: String, token: String) {
        userId = uid
        accessToken = token
        register(context)
    }

    /** Fetch the FCM token and upsert it — only with a live session. Fire-and-forget. */
    fun register(context: Context) {
        val uid = userId ?: return
        val bearer = accessToken ?: return
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { fcmToken ->
                Thread({ upsert(context, uid, bearer, fcmToken) }, "push-register").start()
            }
        } catch (e: Exception) {
        }
    }

    fun onNewToken(context: Context, fcmToken: String) {
        val uid = userId ?: return
        val bearer = accessToken ?: return
        Thread({ upsert(context, uid, bearer, fcmToken) }, "push-token-rotate").start()
    }

    fun onSignedOut(context: Context) {
        val uid = userId
        val bearer = accessToken
        userId = null
        accessToken = null
        val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", null)
        if (uid == null || bearer == null || stored == null) return
        Thread({
            try {
                val conn = URL("$REST?user_id=eq.$uid&token=eq.$stored").openConnection() as HttpURLConnection
                conn.requestMethod = "DELETE"
                headers(conn, bearer)
                conn.responseCode
            } catch (e: Exception) {
            }
        }, "push-delete").start()
    }

    private fun upsert(context: Context, uid: String, bearer: String, fcmToken: String) {
        try {
            val conn = URL(REST).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            headers(conn, bearer)
            conn.setRequestProperty("Prefer", "return=minimal, resolution=merge-duplicates")
            conn.outputStream.use {
                it.write(registrationBody(uid, fcmToken, BuildConfig.VERSION_NAME).toByteArray(Charsets.UTF_8))
            }
            if (conn.responseCode in 200..299) {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString("token", fcmToken).apply()
            }
        } catch (e: Exception) {
        }
    }

    private fun headers(conn: HttpURLConnection, bearer: String) {
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("apikey", PUBLISHABLE_KEY)
        conn.setRequestProperty("Authorization", "Bearer $bearer")
    }
}
