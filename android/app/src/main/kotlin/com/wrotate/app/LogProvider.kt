package com.wrotate.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Read-only provider for the harness's exported log files (external-files/logs), so "Share
 * log" can hand a content:// URI to the share sheet without pulling in androidx FileProvider.
 * Not exported; access is only via the per-intent read grant.
 */
class LogProvider : ContentProvider() {
    companion object {
        const val AUTHORITY = "com.wrotate.app.logs"
        const val DIR = "logs"

        fun uriFor(file: File): Uri = Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(file.name).build()
    }

    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File {
        val dir = context?.getExternalFilesDir(DIR)?.canonicalFile ?: throw FileNotFoundException("no log dir")
        val name = uri.lastPathSegment ?: throw FileNotFoundException(uri.toString())
        val f = File(dir, name).canonicalFile
        if (f.parentFile != dir || !f.isFile) throw FileNotFoundException(uri.toString())
        return f
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read-only provider")
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String = "text/plain"

    // Share targets (mail, Drive) query the display name and size.
    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val f = fileFor(uri)
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val row = cols.map {
            when (it) {
                OpenableColumns.DISPLAY_NAME -> f.name
                OpenableColumns.SIZE -> f.length()
                else -> null
            }
        }
        return MatrixCursor(cols, 1).apply { addRow(row) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int =
        throw UnsupportedOperationException()
}
