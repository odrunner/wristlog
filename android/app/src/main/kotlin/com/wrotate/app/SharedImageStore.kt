package com.wrotate.app

import android.content.Context
import android.util.Base64
import java.io.File

/**
 * Single-slot store for the pending shared image (iOS parity: the `sharedImagePath` key in the
 * App Group defaults). Replacing deletes the older file; clearing happens only once the page
 * confirms ownership (PendingShare's `"true"` contract).
 */
object SharedImageStore {
    private const val PREFS = "share"
    private const val KEY = "sharedImagePath"

    fun replace(context: Context, file: File) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY, null)?.let { File(it).delete() }
        prefs.edit().putString(KEY, file.absolutePath).apply()
    }

    /** Base64 (NO_WRAP — safe inside a JS string literal) of the pending image, or null. */
    fun loadB64(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val path = prefs.getString(KEY, null) ?: return null
        val file = File(path)
        if (!file.exists()) { prefs.edit().remove(KEY).apply(); return null }
        return Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }

    fun clear(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY, null)?.let { File(it).delete() }
        prefs.edit().remove(KEY).apply()
    }
}
