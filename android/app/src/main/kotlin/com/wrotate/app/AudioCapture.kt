package com.wrotate.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import com.wrotate.engine.TimegrapherCore

/**
 * Mic source choice. UNPROCESSED skips the platform's AGC/noise suppression (what the iOS
 * engine gets from .measurement mode); VOICE_RECOGNITION is the closest fallback — it is
 * required to have AGC and noise suppression off but may still be tuned. The tag lands in
 * [TGTUNE] as cap=. Pure so it runs on the JVM (the constants are inlined).
 */
fun selectAudioSource(supportsUnprocessed: Boolean): Pair<Int, String> =
    if (supportsUnprocessed) Pair(MediaRecorder.AudioSource.UNPROCESSED, "unproc")
    else Pair(MediaRecorder.AudioSource.VOICE_RECOGNITION, "vrec")

/** [TGTUNE] is whitespace-tokenised and the engine does not sanitise model=: "Pixel 7" -> "Pixel_7". */
fun tuneSafeModel(model: String): String {
    val t = model.trim().replace(Regex("\\s+"), "_")
    return t.ifEmpty { "unknown" }
}

/**
 * AudioRecord capture feeding a [TimegrapherCore] (the AVAudioSession/AVAudioEngine half of
 * the Swift engine, which the Kotlin core factors out).
 *
 * Threading contract — this is what keeps analyze() from racing process():
 *  - The core is built with analysisExecutor = null, so analyze() runs inline inside
 *    process(), and process() is only ever called from [start]'s onBuffer.
 *  - Every core call this class makes (noteAudioClock, onCaptureRestart) and every onBuffer
 *    call happen on ONE dedicated capture thread, strictly in sequence.
 *  - The caller does core.start/setTuning after [open] and before [start] (Thread.start is a
 *    happens-before edge), and touches the core again only after [stop] returned true
 *    (Thread.join is one). So no two core methods ever run concurrently.
 *
 * Interruptions (Swift handleAudioInterruption/rebuildAudioAfterInterruption intent): audio
 * focus loss tears the recorder down and reports "began"; regain rebuilds it, calls
 * core.onCaptureRestart(actualRate) (which logs [TGAUDIO RESUME]) and reports "resumed"; a
 * failed rebuild logs [TGAUDIO RESUME FAILED] and reports "failed", and capture ends. A read
 * error (e.g. the audio server died) takes the same rebuild path. [log] and [onState] are
 * called on the capture thread.
 */
class AudioCapture(
    context: Context,
    private val core: TimegrapherCore,
    private val log: (String) -> Unit,
    private val onState: (String) -> Unit,
) {
    companion object {
        const val REQUESTED_RATE = 48000
        const val FRAMES = 4096
        private const val STOP_JOIN_MS = 2000L
    }

    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)

    val source: Int
    val sourceTag: String

    init {
        val supported = audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
        val (s, t) = selectAudioSource(supported)
        source = s
        sourceTag = t
    }

    /** The rate the current recorder actually delivers (48000 unless the device rejected it). */
    @Volatile var sampleRate: Double = 0.0
        private set

    // Handed between threads only across Thread.start / Thread.join (see the contract above).
    private var record: AudioRecord? = null
    private var thread: Thread? = null
    private var focusRequest: AudioFocusRequest? = null

    private val lock = Object()
    private var running = false   // guarded by lock
    private var focusLost = false // guarded by lock
    private var lossEvents = 0    // guarded by lock; counts losses so a loss+gain inside one read is not missed

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        synchronized(lock) {
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    focusLost = true
                    lossEvents += 1
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    focusLost = false
                    lock.notifyAll()
                }
                // LOSS_TRANSIENT_CAN_DUCK only lowers our (non-existent) playback; capture is unaffected.
            }
        }
    }

    /**
     * Builds the recorder on the caller's thread so [sampleRate] is known on return; the
     * caller then passes it to core.start. Returns false (with a log line) on failure.
     */
    fun open(): Boolean {
        if (appContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            log("[TGAUDIO OPEN FAILED] RECORD_AUDIO not granted")
            return false
        }
        val r = createRecord() ?: run {
            log("[TGAUDIO OPEN FAILED] no AudioRecord for src=$sourceTag")
            return false
        }
        record = r
        sampleRate = r.sampleRate.toDouble()
        log("[TGAUDIO OPEN] src=$sourceTag rate=${r.sampleRate} frames=$FRAMES")
        return true
    }

    /** Starts recording and the capture thread. [onBuffer] receives mono floats [0, n) on that thread. */
    fun start(onBuffer: (FloatArray, Int) -> Unit) {
        val r = checkNotNull(record) { "open() first" }
        synchronized(lock) { running = true; focusLost = false; lossEvents = 0 }
        requestFocus() // after the reset, so a loss delivered right away is not wiped
        r.startRecording()
        if (r.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            log("[TGAUDIO] recorder not recording after start (state=${r.recordingState}); mic busy?")
        }
        thread = Thread({ captureLoop(onBuffer) }, "wrotate-capture").apply { start() }
    }

    /**
     * Stops capture. Returns true once the capture thread has exited (after which the caller
     * may touch the core again); false if it did not exit within 2 s.
     */
    fun stop(): Boolean {
        synchronized(lock) { running = false; lock.notifyAll() }
        val t = thread
        thread = null
        abandonFocus()
        if (t == null) { // opened but never started
            releaseRecord()
            return true
        }
        t.join(STOP_JOIN_MS)
        if (t.isAlive) {
            log("[TGAUDIO STOP] capture thread still running after ${STOP_JOIN_MS}ms")
            return false
        }
        return true
    }

    private fun isRunning(): Boolean = synchronized(lock) { running }

    private fun captureLoop(onBuffer: (FloatArray, Int) -> Unit) {
        val buf = FloatArray(FRAMES)
        val ts = AudioTimestamp()
        var framesRead = 0L // frames read from the CURRENT recorder; its framePosition counts from its start
        var seenLosses = 0
        try {
            while (true) {
                var lost = false
                synchronized(lock) {
                    if (!running) return
                    if (lossEvents != seenLosses) { seenLosses = lossEvents; lost = true }
                }
                if (lost) {
                    releaseRecord()
                    log("[TGAUDIO INTERRUPT began] focus-loss")
                    onState("began")
                    synchronized(lock) {
                        while (running && focusLost) lock.wait()
                        if (!running) return
                        seenLosses = lossEvents
                    }
                    log("[TGAUDIO INTERRUPT ended] focus-gain")
                    if (!rebuild("focus-regained")) return
                    framesRead = 0
                    continue
                }

                val rec = record ?: return
                val n = rec.read(buf, 0, FRAMES, AudioRecord.READ_BLOCKING)
                if (n < 0) {
                    log("[TGAUDIO READ ERROR] code=$n")
                    releaseRecord()
                    if (!isRunning()) return
                    if (!rebuild("read-error$n")) return
                    framesRead = 0
                    continue
                }
                if (n == 0) continue

                // Host time of this buffer's FIRST frame, extrapolated from the recorder's
                // latest (framePosition, nanoTime) pair. -1 = no valid timestamp: the core
                // still counts the frames (Swift: !when.isHostTimeValid).
                val firstFrame = framesRead
                framesRead += n
                val hostNs = if (rec.getTimestamp(ts, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS) {
                    ts.nanoTime + ((firstFrame - ts.framePosition) * 1e9 / sampleRate).toLong()
                } else {
                    -1L
                }
                core.noteAudioClock(hostNs, n)
                onBuffer(buf, n)
            }
        } catch (e: InterruptedException) {
            log("[TGAUDIO STOP] capture thread interrupted")
        } finally {
            releaseRecord()
        }
    }

    /** Capture thread only. Swift rebuildAudioAfterInterruption: new recorder, then the core's half. */
    private fun rebuild(reason: String): Boolean {
        val r = createRecord()
        if (r == null) {
            log("[TGAUDIO RESUME FAILED] $reason: no AudioRecord for src=$sourceTag")
            onState("failed")
            return false
        }
        try {
            r.startRecording()
        } catch (e: IllegalStateException) {
            r.release()
            log("[TGAUDIO RESUME FAILED] $reason: ${e.message}")
            onState("failed")
            return false
        }
        if (r.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            r.release()
            log("[TGAUDIO RESUME FAILED] $reason: recordingState=${r.recordingState}")
            onState("failed")
            return false
        }
        record = r
        sampleRate = r.sampleRate.toDouble()
        core.onCaptureRestart(sampleRate, reason)
        onState("resumed")
        return true
    }

    /** 48 kHz first; if the device rejects it, its native rate (read back via getSampleRate). */
    private fun createRecord(): AudioRecord? {
        build(REQUESTED_RATE)?.let { return it }
        val r = build(null) ?: return null
        log("[TGAUDIO] $REQUESTED_RATE Hz rejected for src=$sourceTag; using device rate ${r.sampleRate}")
        return r
    }

    @SuppressLint("MissingPermission") // checked in open(); a revoke mid-session surfaces as a failed rebuild
    private fun build(rate: Int?): AudioRecord? {
        val fmt = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .apply { if (rate != null) setSampleRate(rate) }
            .build()
        val min = AudioRecord.getMinBufferSize(rate ?: REQUESTED_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val bytes = maxOf(min, FRAMES * 4 * 4) // room for four reads of float frames
        return try {
            val r = AudioRecord.Builder()
                .setAudioSource(source)
                .setAudioFormat(fmt)
                .setBufferSizeInBytes(bytes)
                .build()
            if (r.state == AudioRecord.STATE_INITIALIZED) r else { r.release(); null }
        } catch (e: UnsupportedOperationException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        } catch (e: SecurityException) {
            null
        }
    }

    private fun releaseRecord() {
        val r = record ?: return
        record = null
        try { r.stop() } catch (_: IllegalStateException) {}
        r.release()
    }

    private fun requestFocus() {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_UNKNOWN)
                    .build(),
            )
            .setOnAudioFocusChangeListener(focusListener, Handler(Looper.getMainLooper()))
            .build()
        focusRequest = req
        val res = audioManager.requestAudioFocus(req)
        if (res != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) log("[TGAUDIO] audio focus not granted (result=$res); capturing anyway")
    }

    private fun abandonFocus() {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
    }
}
