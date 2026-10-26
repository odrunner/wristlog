package com.wrotate.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import java.io.File

/**
 * Share target: receives an image via ACTION_SEND, parks it as the single pending share, and
 * opens the shell (Android twin of ios/Wrotate/WRotateShare/ShareViewController.swift). The
 * image is always re-encoded as JPEG — Pixels can hand us HEIF, which the WebView cannot decode
 * (the iOS extension has this as a known latent bug; we fix it here from the start).
 */
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            receive(intent)
        } catch (e: Exception) {
            // Undecodable/withdrawn content: nothing to hand over; the share sheet just closes.
        }
        startActivity(
            Intent(this, ShellActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    private fun receive(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        @Suppress("DEPRECATION")
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return
        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
        val file = File(cacheDir, "shared-image-${System.currentTimeMillis()}.jpg")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        SharedImageStore.replace(this, file)
    }
}
