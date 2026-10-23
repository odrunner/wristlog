package com.wrotate.app

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.Spinner
import android.widget.TextView
import com.wrotate.engine.TimegrapherCore
import com.wrotate.engine.Tuning
import com.wrotate.engine.Update
import com.wrotate.engine.WavIo
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * One-screen engineering harness for the Pixel 7 validation session: live mic measurement,
 * raw-capture WAV recording, WAV replay through the same core and display path, and a log
 * export. Not a product screen.
 *
 * Every session builds a fresh TimegrapherCore with analysisExecutor = null, and only one
 * thread drives it: the capture thread (live) or the replay thread (replay). The UI thread
 * calls core.start/setTuning before that thread starts and core.stop after it has exited.
 * See AudioCapture for the full contract.
 */
class HarnessActivity : Activity() {
    private enum class Mode { IDLE, LIVE, REPLAY }

    private companion object {
        const val TAG = "WRotateTG"
        const val REQ_MIC = 1
        const val REQ_WAV = 2
        const val CHUNK = AudioCapture.FRAMES
        const val MAX_RECORD_SEC = 300 // raw float WAV is ~11.5 MB/min at 48 kHz, held in memory until Stop
        val BPH_CHOICES = listOf("Auto" to 0, "18000" to 18000, "21600" to 21600, "25200" to 25200, "28800" to 28800, "36000" to 36000)
    }

    private val model = tuneSafeModel(Build.MODEL ?: "")

    private lateinit var bphSpinner: Spinner
    private lateinit var startStop: Button
    private lateinit var recordWav: CheckBox
    private lateinit var replayWav: Button
    private lateinit var shareLog: Button
    private lateinit var statusView: TextView
    private lateinit var fieldsView: TextView
    private lateinit var finalView: TextView

    // UI-thread state.
    private var mode = Mode.IDLE
    private var capture: AudioCapture? = null
    private var liveCore: TimegrapherCore? = null
    private var sourceLine = "--"
    private var status = "Idle"

    @Volatile private var replayCancel = false
    @Volatile private var replayProgress = 0.0
    @Volatile private var captureState = ""

    // Session log: appended from the processing thread and the UI thread.
    private val sessionLock = Any()
    private val sinkLines = ArrayList<String>()
    private val batchLines = ArrayList<String>()
    private var batchCount = 0
    private var sessionHeader = ""
    private var finalLine = ""

    // Latest Update, coalesced onto the UI thread (the engine emits one per 4096-frame buffer;
    // a replay emits them far faster than real time).
    private val latest = AtomicReference<Update?>(null)
    private val renderPosted = AtomicBoolean(false)

    // Raw-capture recording: written on the capture thread while live, read on the UI thread
    // only after AudioCapture.stop() returned true (Thread.join).
    private var recording = false
    private var recChunks = ArrayList<FloatArray>()
    private var recFrames = 0L
    private var recRate = 0.0
    private var recCut = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_harness)
        val root = findViewById<android.view.View>(R.id.root)
        root.setOnApplyWindowInsetsListener { v, insets ->
            // targetSdk 35 is edge-to-edge: keep content clear of the status and nav bars.
            if (Build.VERSION.SDK_INT >= 30) {
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        bphSpinner = findViewById(R.id.bph)
        startStop = findViewById(R.id.startStop)
        recordWav = findViewById(R.id.recordWav)
        replayWav = findViewById(R.id.replayWav)
        shareLog = findViewById(R.id.shareLog)
        statusView = findViewById(R.id.status)
        fieldsView = findViewById(R.id.fields)
        finalView = findViewById(R.id.finalReading)

        bphSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, BPH_CHOICES.map { it.first })
        startStop.setOnClickListener {
            when (mode) {
                Mode.IDLE -> startLive()
                Mode.LIVE -> stopLive()
                Mode.REPLAY -> { replayCancel = true; setStatus("Stopping replay...") }
            }
        }
        replayWav.setOnClickListener { pickWav() }
        shareLog.setOnClickListener { shareLog() }
        render()
        updateControls()
    }

    override fun onDestroy() {
        if (mode == Mode.LIVE) stopLive()
        replayCancel = true
        super.onDestroy()
    }

    // ---- live capture ----

    private fun startLive() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        val bph = selectedBph()
        resetSession("live bph=${bphLabel(bph)}")
        val core = newCore()
        val cap = AudioCapture(this, core, ::harnessLog) { state ->
            captureState = when (state) {
                "began" -> "interrupted (focus lost)"
                "resumed" -> "resumed after interruption"
                "failed" -> "FAILED to resume - press Stop"
                else -> state
            }
            postRender()
        }
        if (!cap.open()) {
            setStatus("Mic open failed (see log)")
            return
        }
        val rate = cap.sampleRate
        core.start(bph, true, rate)
        core.setTuning(Tuning(captureSource = cap.sourceTag, deviceModel = model))
        sourceLine = "${cap.sourceTag} / $model / ${rate.toLong()} Hz"
        synchronized(sessionLock) { sessionHeader += "\nsource=${cap.sourceTag} model=$model rate=${rate.toLong()}" }

        recording = recordWav.isChecked
        recChunks = ArrayList()
        recFrames = 0
        recRate = rate
        recCut = false

        try {
            cap.start { buf, n ->
                if (recording) appendRecording(buf, n, cap.sampleRate)
                core.process(buf, n) // analyze runs inline here (analysisExecutor == null)
            }
        } catch (e: IllegalStateException) {
            harnessLog("[HARNESS] capture start failed: ${e.message}")
            cap.stop()
            setStatus("Capture start failed (see log)")
            return
        }
        capture = cap
        liveCore = core
        mode = Mode.LIVE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setStatus("Measuring" + if (recording) " (recording WAV)" else "")
        updateControls()
    }

    /** Capture thread. */
    private fun appendRecording(buf: FloatArray, n: Int, rate: Double) {
        if (recCut) return
        if (rate != recRate) {
            recCut = true
            harnessLog("[HARNESS] WAV recording cut: capture rate changed ${recRate.toLong()} -> ${rate.toLong()}")
            return
        }
        if (recFrames + n > (MAX_RECORD_SEC * recRate).toLong()) {
            recCut = true
            harnessLog("[HARNESS] WAV recording cut at the ${MAX_RECORD_SEC}s cap")
            return
        }
        recChunks.add(buf.copyOf(n))
        recFrames += n
    }

    private fun stopLive() {
        val cap = capture ?: return
        val exited = cap.stop()
        capture = null
        // Safe only once the capture thread has exited. The Result is not used: Result.rate is
        // written only by the legacy path and is always null in tg mode — the final reading
        // comes from the last Update instead.
        if (exited) liveCore?.stop()
        liveCore = null
        finishSession()
        if (recording) {
            if (exited) saveRecording(recChunks, recRate) else harnessLog("[HARNESS] WAV not saved: capture thread did not exit")
            recChunks = ArrayList()
        }
    }

    private fun saveRecording(chunks: List<FloatArray>, rate: Double) {
        val name = "capture-${stamp()}-${sourceLine.substringBefore(' ')}-${rate.toLong()}.wav"
        val dir = getExternalFilesDir("wav")
        if (dir == null) {
            setStatus("WAV not saved: external files unavailable")
            return
        }
        setStatus("Saving WAV...")
        Thread({
            val msg = try {
                val total = chunks.sumOf { it.size }
                val all = FloatArray(total)
                var at = 0
                for (c in chunks) { System.arraycopy(c, 0, all, at, c.size); at += c.size }
                val f = File(dir, name)
                WavIo.write(f, all, rate)
                harnessLog("[HARNESS] WAV saved ${f.absolutePath} frames=$total")
                "WAV saved: ${f.absolutePath}"
            } catch (e: Exception) {
                harnessLog("[HARNESS] WAV save failed: $e")
                "WAV save failed: ${e.message}"
            } catch (e: OutOfMemoryError) {
                "WAV save failed: out of memory"
            }
            runOnUiThread { setStatus(msg) }
        }, "wrotate-wav").start()
    }

    // ---- replay ----

    private fun pickWav() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "application/octet-stream"))
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQ_WAV)
    }

    @Deprecated("Activity result API (framework Activity, no androidx)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode == REQ_WAV && resultCode == RESULT_OK && uri != null && mode == Mode.IDLE) startReplay(uri)
    }

    private fun startReplay(uri: Uri) {
        val bph = selectedBph()
        val name = displayName(uri)
        resetSession("replay file=$name bph=${bphLabel(bph)}")
        sourceLine = "replay / $model / $name"
        replayCancel = false
        replayProgress = 0.0
        mode = Mode.REPLAY
        setStatus("Replaying $name")
        updateControls()
        Thread({
            var err: String? = null
            try {
                val tmp = File(cacheDir, "replay.wav")
                val input = contentResolver.openInputStream(uri) ?: throw IllegalStateException("cannot open $uri")
                input.use { inp -> tmp.outputStream().use { inp.copyTo(it) } }
                val (samples, rate) = WavIo.read(tmp)
                tmp.delete()
                harnessLog("[HARNESS REPLAY] file=$name frames=${samples.size} rate=${rate.toLong()}")
                // Same core wiring and display path as live; this thread is its only driver.
                val core = newCore()
                core.start(bph, true, rate)
                core.setTuning(Tuning(captureSource = "replay", deviceModel = model))
                val buf = FloatArray(CHUNK)
                var i = 0
                while (i < samples.size && !replayCancel) {
                    val n = minOf(CHUNK, samples.size - i)
                    System.arraycopy(samples, i, buf, 0, n)
                    core.process(buf, n)
                    i += n
                    replayProgress = i.toDouble() / samples.size
                }
                core.stop()
                if (replayCancel) harnessLog("[HARNESS REPLAY] cancelled at ${fmt(i / rate, 1)}s")
            } catch (e: Exception) {
                err = e.toString()
            } catch (e: OutOfMemoryError) {
                err = "out of memory"
            }
            err?.let { harnessLog("[HARNESS REPLAY FAILED] $it") }
            runOnUiThread {
                finishSession()
                if (err != null) setStatus("Replay failed: $err")
            }
        }, "wrotate-replay").start()
    }

    private fun displayName(uri: Uri): String {
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) return tuneSafeModel(c.getString(0))
            }
        } catch (_: Exception) {}
        return tuneSafeModel(uri.lastPathSegment ?: "wav")
    }

    // ---- session plumbing ----

    private fun newCore(): TimegrapherCore = TimegrapherCore(analysisExecutor = null).apply {
        logSink = { line -> sinkLine(line) }
        onUpdate = { u -> onCoreUpdate(u) }
    }

    /** Processing thread (capture or replay). */
    private fun onCoreUpdate(u: Update) {
        if (u.debugMessages.isNotEmpty()) {
            synchronized(sessionLock) {
                batchCount += 1
                batchLines.add("-- batch $batchCount el=${fmt(u.elapsedSec, 3)} lines=${u.debugMessages.size} --")
                batchLines.addAll(u.debugMessages)
            }
        }
        latest.set(u)
        postRender()
    }

    private fun postRender() {
        if (renderPosted.compareAndSet(false, true)) runOnUiThread { renderPosted.set(false); render() }
    }

    private fun sinkLine(line: String) {
        synchronized(sessionLock) { sinkLines.add(line) }
        Log.i(TAG, line)
    }

    /** Capture/harness lines go into the same sink as the core's debugLog lines. Any thread. */
    private fun harnessLog(line: String) = sinkLine(line)

    private fun resetSession(kind: String) {
        synchronized(sessionLock) {
            sinkLines.clear()
            batchLines.clear()
            batchCount = 0
            sessionHeader = "session=$kind started=${SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).format(Date())}" +
                " device=$model sdk=${Build.VERSION.SDK_INT}"
            finalLine = ""
        }
        latest.set(null)
        captureState = ""
        finalView.text = ""
        render()
    }

    private fun finishSession() {
        mode = Mode.IDLE
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val u = latest.get()
        val line = if (u == null) "no Update received" else
            "rate=${u.rate?.let { fmt(it, 1, plus = true) } ?: "--"} be=${u.beatError?.let { fmt(it, 2) } ?: "--"}" +
                " amp=${u.amplitude?.let { fmt(it, 0) } ?: "--"} ticks=${u.tickCount} stable=${u.rateStable}" +
                " bph=${u.detectedBph ?: "--"} el=${fmt(u.elapsedSec, 1)}"
        harnessLog("[HARNESS FINAL] $line")
        synchronized(sessionLock) { finalLine = line }
        finalView.text = "Final (last Update)\n$line"
        setStatus("Stopped")
        render()
        updateControls()
    }

    // ---- display ----

    private fun render() {
        val u = latest.get()
        val acq = if (u?.tgAcquiring == true) " (acquiring)" else ""
        fieldsView.text = buildString {
            appendLine("rate      ${u?.rate?.let { fmt(it, 1, plus = true) + " s/d" } ?: "--"}")
            appendLine("beat err  ${u?.beatError?.let { fmt(it, 2) + " ms" } ?: "--"}")
            appendLine("amplitude ${u?.amplitude?.let { fmt(it, 0) + " deg" } ?: "--"}")
            appendLine("ticks     ${u?.tickCount ?: "--"}")
            appendLine("stable    ${u?.let { if (it.rateStable) "yes" else "no" } ?: "--"}")
            appendLine("signal    ${u?.tgSignalQuality ?: "--"}$acq")
            appendLine("elapsed   ${u?.let { fmt(it.elapsedSec, 1) + " s" } ?: "--"}")
            appendLine("bph       ${u?.detectedBph ?: "--"}")
            appendLine("source    $sourceLine")
            append("capture   ${captureState.ifEmpty { "--" }}")
        }
        statusView.text = if (mode == Mode.REPLAY) "$status (${fmt(replayProgress * 100, 0)}%)" else status
    }

    private fun setStatus(s: String) {
        status = s
        statusView.text = s
    }

    private fun updateControls() {
        startStop.text = if (mode == Mode.IDLE) "Start" else "Stop"
        val idle = mode == Mode.IDLE
        bphSpinner.isEnabled = idle
        recordWav.isEnabled = idle
        replayWav.isEnabled = idle
    }

    private fun selectedBph(): Int = BPH_CHOICES[bphSpinner.selectedItemPosition.coerceIn(0, BPH_CHOICES.size - 1)].second

    private fun bphLabel(bph: Int): String = if (bph == 0) "auto" else bph.toString()

    // ---- log export ----

    private fun shareLog() {
        val text = synchronized(sessionLock) {
            buildString {
                appendLine("WRotate Android engine harness log")
                appendLine(sessionHeader.ifEmpty { "no session yet" })
                appendLine("final (last Update): ${finalLine.ifEmpty { "session still running or none" }}")
                appendLine()
                appendLine("== logSink: every core debugLog line plus capture/harness lines, in order (${sinkLines.size} lines) ==")
                sinkLines.forEach { appendLine(it) }
                appendLine()
                appendLine("== debugMessages: every batch as attached to an Update ($batchCount batches) ==")
                batchLines.forEach { appendLine(it) }
            }
        }
        val dir = getExternalFilesDir(LogProvider.DIR)
        if (dir == null) {
            setStatus("Log not saved: external files unavailable")
            return
        }
        val f = File(dir, "harness-${stamp()}.txt")
        try {
            f.writeText(text)
        } catch (e: Exception) {
            setStatus("Log save failed: ${e.message}")
            return
        }
        val uri = LogProvider.uriFor(f)
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, f.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(f.name, uri)
        startActivity(Intent.createChooser(send, "Share log"))
        setStatus("Log saved: ${f.absolutePath}")
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startLive()
        else setStatus("Microphone permission denied")
    }

    private fun stamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

    private fun fmt(x: Double, decimals: Int, plus: Boolean = false): String =
        String.format(Locale.US, if (plus) "%+.${decimals}f" else "%.${decimals}f", x)
}
