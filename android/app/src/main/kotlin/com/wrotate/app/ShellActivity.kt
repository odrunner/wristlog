package com.wrotate.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import android.util.Log
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.wrotate.engine.TimegrapherCore
import org.json.JSONObject
import java.io.File

/**
 * The WRotate Android shell: one Activity hosting a WebView that loads live wrotate.com, mirroring
 * the iOS WKWebView. It injects the native bridge shim (see [buildBridgeScript]) at every wrotate.com
 * page start so the page's existing measurement/haptic/auth JS runs unchanged, and returns native
 * results via [callJs]. The bridge is gated to the wrotate.com origin; everything else opens
 * externally, so no third-party page can reach the native interface (mirrors the iOS host policy).
 */
class ShellActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var pausedAtMs = 0L
    private val idleReloadMs = 30 * 60 * 1000L

    private lateinit var measurement: MeasurementController
    private lateinit var authHandler: AuthHandler
    private var pendingStartJson: String? = null

    // The committed main-frame host; the bridge acts only while this is wrotate.com.
    @Volatile private var currentHost: String? = null
    // Hold-until-loaded for the OAuth session injection (cold-start return lands before the page).
    @Volatile private var pageLoaded = false
    private var pendingInjectJs: String? = null

    // WebView file chooser (add-watch-photo / avatar / share-to-feed file inputs).
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var captureCandidates: List<Pair<Uri, File>> = emptyList()
    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = filePathCallback; filePathCallback = null
            if (cb == null) return@registerForActivityResult
            val uris: Array<Uri>? = when {
                result.resultCode != RESULT_OK -> null
                result.data?.data != null || result.data?.clipData != null ->
                    WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                // Camera wrote into one of our pre-created temp files; data comes back null.
                else -> pickWrittenCapture(captureCandidates.map { it.first to it.second.length() })
                    ?.let { arrayOf(it) }
            }
            captureCandidates = emptyList()
            cb.onReceiveValue(uris)
        }
    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val json = pendingStartJson; pendingStartJson = null
            if (granted && json != null) safeHandle(json)
            else if (!granted) callJs(BridgeMessages.error("Microphone permission denied. Allow it in Settings to measure."))
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Let the page draw under the display cutout so its viewport-fit=cover + env(safe-area-inset-*)
        // top handling (index.html header) works like iOS, instead of us double-insetting the top.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        // Debug builds only: lets chrome://inspect attach to the WebView for diagnosis.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // Honor the page's <meta viewport width=device-width> like Chrome does; without these
            // the layout viewport is wrong and the vh-sized modals/sheets collapse (found on device).
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    pageLoaded = false
                    currentHost = url?.let { Uri.parse(it).host }
                    // Install the bridge shim only on our own origin.
                    if (isWrotateHost(currentHost)) {
                        view.evaluateJavascript(buildBridgeScript(BuildConfig.NATIVE_CAPABILITY_VERSION), null)
                    }
                }
                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    pageLoaded = true
                    pendingInjectJs?.let { view.evaluateJavascript(it, null); pendingInjectJs = null }
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url
                    // Google blocks OAuth inside a WebView: hand the Supabase authorize URL to a
                    // Chrome Custom Tab (mirror iOS decidePolicyFor + handleOAuth).
                    if (u.host == "api.wrotate.com" && (u.path ?: "").contains("/auth/v1/authorize")) {
                        authHandler.startOAuth(u.toString())
                        return true
                    }
                    // Keep our own origin in the WebView; send everything else to the browser so no
                    // third-party page can host the native bridge (mirrors the iOS allow-list).
                    if (isWrotateHost(u.host)) return false
                    if (request.isForMainFrame) {
                        try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (e: Exception) { }
                    }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    return launchPhotoChooser(params)
                }
            }
        }

        // Wrap the WebView in a plain FrameLayout and pad THAT for the system bars / keyboard
        // (targetSdk 35 is edge-to-edge by default, so without this the nav sits under the status
        // bar and gesture bar). FrameLayout is not a nested-scrolling parent, so — unlike
        // SwipeRefreshLayout — it keeps the WebView's height constrained and `100vh` correct.
        val root = android.widget.FrameLayout(this).apply { addView(webView) }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            // Top is handled by the page itself (env(safe-area-inset-top)); we only inset the sides,
            // the bottom nav bar, and the keyboard.
            v.setPadding(bars.left, 0, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        measurement = buildMeasurement()
        authHandler = AuthHandler(
            openCustomTab = { url -> CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url)) },
            inject = { js ->
                runOnUiThread {
                    if (pageLoaded) webView.evaluateJavascript(js, null) else pendingInjectJs = js
                }
            },
        )

        val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
        if (!restored) webView.loadUrl(SITE_URL)
        handleAuthIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState) // survive process death on return from Custom Tab / camera
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthIntent(intent)
    }

    private fun handleAuthIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "wrotate" && data.host == "auth-callback") {
            authHandler.onCallback(data.toString())
        }
    }

    private fun launchPhotoChooser(params: WebChromeClient.FileChooserParams): Boolean {
        val content = params.createIntent() // honors the input's acceptTypes + multiple
        val types = params.acceptTypes.joinToString(",")
        val wantsImage = types.isBlank() || types.contains("image") || types.contains("*/*")
        val wantsVideo = types.contains("video") || types.contains("*/*")
        val extras = ArrayList<Intent>()
        val candidates = ArrayList<Pair<Uri, File>>()
        if (wantsImage) buildCaptureIntent(MediaStore.ACTION_IMAGE_CAPTURE, ".jpg", candidates)?.let { extras.add(it) }
        if (wantsVideo) buildCaptureIntent(MediaStore.ACTION_VIDEO_CAPTURE, ".mp4", candidates)?.let { extras.add(it) }
        captureCandidates = candidates
        val chooser = Intent(Intent.ACTION_CHOOSER).apply {
            putExtra(Intent.EXTRA_INTENT, content)
            putExtra(Intent.EXTRA_TITLE, "Add a photo")
            if (extras.isNotEmpty()) putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toTypedArray())
        }
        return try {
            fileChooser.launch(chooser)
            true
        } catch (e: Exception) {
            filePathCallback?.onReceiveValue(null); filePathCallback = null
            true // we consumed the callback; returning true keeps the WebView contract honored
        }
    }

    private fun buildCaptureIntent(action: String, suffix: String, candidates: MutableList<Pair<Uri, File>>): Intent? {
        val capture = Intent(action)
        if (capture.resolveActivity(packageManager) == null) return null
        return try {
            val file = File.createTempFile("capture_", suffix, cacheDir)
            val uri = FileProvider.getUriForFile(this, "com.wrotate.app.fileprovider", file)
            capture.putExtra(MediaStore.EXTRA_OUTPUT, uri)
            capture.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            candidates.add(uri to file)
            capture
        } catch (e: Exception) {
            null
        }
    }

    private fun buildMeasurement(): MeasurementController {
        val core = TimegrapherCore(analysisExecutor = null)
        val capture = AudioCapture(
            this, core,
            log = { line -> Log.i("WRotateTG", line) },
            onState = { state -> callJs(BridgeMessages.interruption(state)) },
        )
        return MeasurementController(
            core = core,
            capture = capture,
            emit = { json -> callJs(json) },
            deviceModel = tuneSafeModel(Build.MODEL),
            onMeasuringChange = { on -> setKeepScreenOn(on) },
        )
    }

    /** Runs on the UI thread. A `start` needs the mic permission first; everything else passes through. */
    private fun routeTimegrapher(json: String) {
        val action = try { JSONObject(json).optString("action") } catch (e: Exception) { "" }
        if (action == "stop") pendingStartJson = null // cancel a start waiting on the permission prompt
        if (action == "start" &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingStartJson = json
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        safeHandle(json)
    }

    /** A thrown AudioRecord/parse error must surface as an event, never crash the process. */
    private fun safeHandle(json: String) {
        try {
            measurement.handleTimegrapherMessage(json)
        } catch (e: Exception) {
            setKeepScreenOn(false)
            callJs(BridgeMessages.error("Measurement error: ${e.message ?: "unknown"}"))
        }
    }

    override fun onPause() {
        super.onPause()
        pausedAtMs = System.currentTimeMillis()
    }

    override fun onResume() {
        super.onResume()
        if (pausedAtMs != 0L && System.currentTimeMillis() - pausedAtMs > idleReloadMs) {
            webView.reload()
        }
        pausedAtMs = 0L
    }

    private fun isWrotateHost(host: String?): Boolean =
        host == "wrotate.com" || host == "www.wrotate.com" || host == "api.wrotate.com"

    /** Keep the screen on while a measurement is active; the measurement bridge toggles it. */
    fun setKeepScreenOn(on: Boolean) {
        runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    /** Return a native result to the page, exactly as iOS does. */
    fun callJs(json: String) {
        runOnUiThread {
            webView.evaluateJavascript("if(window._tgNativeCallback)window._tgNativeCallback($json);", null)
        }
    }

    private fun vibrate() {
        val v = getSystemService(Vibrator::class.java) ?: return
        v.vibrate(VibrationEffect.createOneShot(10, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    /** The single @JavascriptInterface the shim forwards every handler's postMessage to. */
    inner class AndroidBridge {
        @android.webkit.JavascriptInterface
        fun post(handler: String, json: String) {
            // Only our own origin may reach native (a linked third-party page must not).
            if (!isWrotateHost(currentHost)) return
            when (handler) {
                "haptic" -> vibrate()
                "timegrapher" -> runOnUiThread { routeTimegrapher(json) }
                "auth" -> {} // web→native auth notifications are unused on Android v1 (no push)
            }
        }
    }

    companion object {
        const val SITE_URL = "https://wrotate.com"
    }
}
