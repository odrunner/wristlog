package com.wrotate.app

// The file chooser offers BOTH a photo-capture and a video-capture intent when the page's
// input accepts image/* and video/* (the post composer does), each with its own pre-created
// temp file as EXTRA_OUTPUT. The camera returns data=null, so the only way to know which
// capture happened is which temp file the camera app actually wrote into.
fun <T> pickWrittenCapture(candidates: List<Pair<T, Long>>): T? =
    candidates.firstOrNull { it.second > 0L }?.first
