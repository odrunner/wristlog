package com.wrotate.app

/**
 * Hand-off of a shared image into the page, mirroring the iOS share extension contract
 * (ios/Wrotate/Wrotate/ContentView.swift handleSharedImage): the page's handleSharedImage()
 * takes a full data URL and answers `true` once it owns the image — only then may the pending
 * copy be deleted. Anything else (page not loaded, evaluation failed) keeps it for a retry on
 * the next page load or foreground.
 */
object ShareHandoff {
    /** Decode sample size: cap catastrophic images (50-200 MP) near a 2.5k long edge while
     *  leaving ordinary photos at full resolution. */
    fun sampleSize(longEdge: Int, maxEdge: Int = 2560): Int =
        if (longEdge <= maxEdge) 1 else maxOf(1, longEdge / maxEdge)

    /** The base64 alphabet never breaks out of the JS literal (produced with Base64.NO_WRAP). */
    fun injectionJs(b64: String): String =
        "(function(){ if (typeof handleSharedImage !== 'function') return false; " +
            "handleSharedImage('data:image/jpeg;base64,$b64'); return true; })();"
}

/** One pending shared image (single slot, iOS parity). [load] returns its base64 or null. */
class PendingShare(
    private val load: () -> String?,
    private val clear: () -> Unit,
) {
    fun drain(evaluate: (js: String, onResult: (String?) -> Unit) -> Unit) {
        val b64 = load() ?: return
        evaluate(ShareHandoff.injectionJs(b64)) { result ->
            // evaluateJavascript returns the JSON encoding: the IIFE's boolean true is `true`.
            // A JSON string "true" is page data, not ownership — keep the share.
            if (result == "true") clear()
        }
    }
}
