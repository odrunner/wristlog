package com.wrotate.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Notification channel setup (API 26+ requirement; idempotent). */
object PushChannels {
    const val DEFAULT = "reminders"

    fun ensure(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(DEFAULT, "Notifications", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }
}

/**
 * FCM entry points. The server sends notification+data messages: when the app is backgrounded
 * the system tray displays them itself (data arrives in the launch intent's extras); this
 * callback runs for foreground deliveries, where we post the tray notification ourselves so
 * a push is never silently swallowed (iOS willPresent parity).
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        PushRegistrar.onNewToken(this, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: return
        val body = message.notification?.body ?: ""
        PushChannels.ensure(this)
        val extras = PushPayload.tapExtras(message.data)
        val tap = Intent(this, ShellActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            extras.forEach { (k, v) -> putExtra("push_$k", v) }
        }
        val pending = PendingIntent.getActivity(
            this,
            (System.currentTimeMillis() and 0x7FFFFFFF).toInt(),
            tap,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = android.app.Notification.Builder(this, PushChannels.DEFAULT)
            .setSmallIcon(R.drawable.ic_shortcut_measure)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        getSystemService(NotificationManager::class.java)
            ?.notify((System.currentTimeMillis() and 0x7FFFFFFF).toInt(), notification)
    }
}
