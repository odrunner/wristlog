package com.wrotate.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.exifinterface.media.ExifInterface
import java.io.File

/**
 * Share target: receives an image via ACTION_SEND, parks it as the single pending share, and
 * opens the shell (Android twin of ios/Wrotate/WRotateShare/ShareViewController.swift). The
 * image is always re-encoded as JPEG — Pixels can hand us HEIF, which the WebView cannot decode
 * (the iOS extension has this as a known latent bug; we fix it here from the start). Decoding
 * honors EXIF orientation, downsamples catastrophic sizes (ShareHandoff.sampleSize), and runs
 * off the main thread — ShareActivity shares the shell's process, so an OOM here would kill a
 * running measurement too.
 */
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val received = intent
        Thread({
            try {
                receive(received)
            } catch (t: Throwable) {
                // Undecodable/withdrawn/oversized content: nothing to hand over.
            }
            runOnUiThread {
                startActivity(
                    Intent(this, ShellActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                )
                finish()
            }
        }, "share-receive").start()
    }

    private fun receive(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        @Suppress("DEPRECATION")
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return
        // Standard share-target hardening: never read file: paths or our own providers with
        // our own permissions on behalf of another app.
        if (uri.scheme != "content" || uri.authority?.startsWith("com.wrotate.app") == true) return
        val bitmap = decodeOriented(uri) ?: return
        val file = File(cacheDir, "shared-image-${System.currentTimeMillis()}.jpg")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        SharedImageStore.replace(this, file)
    }

    /** Decode respecting EXIF orientation, sampled down near a 2.5k long edge. */
    private fun decodeOriented(uri: Uri): Bitmap? {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies EXIF orientation itself and decodes HEIF.
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(contentResolver, uri)) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE // HARDWARE bitmaps can't compress()
                decoder.setTargetSampleSize(
                    ShareHandoff.sampleSize(maxOf(info.size.width, info.size.height)),
                )
            }
        }
        // API 26-27: bounds pass -> sampled decode -> manual EXIF rotate.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return null
        val opts = BitmapFactory.Options().apply {
            inSampleSize = ShareHandoff.sampleSize(maxOf(bounds.outWidth, bounds.outHeight))
        }
        val raw = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: return null
        val orientation = contentResolver.openInputStream(uri)?.use {
            ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return raw
        }
        val m = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
    }
}
