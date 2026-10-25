package com.wrotate.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.wrotate.engine.TimegrapherCore
import org.json.JSONObject

/**
 * The WRotate Android shell: one Activity hosting a WebView that loads live wrotate.com, mirroring
 * the iOS WKWebView. It injects the native bridge shim (see [buildBridgeScript]) at every page
 * start so the page's existing measurement/haptic/auth JS runs unchanged, and returns native
 * results to the page via [callJs]. v1 handles the `haptic` handler here; `timegrapher` and `auth`
 * are forwarded to hooks wired in by later tasks ([onTimegrapher], [onAuth]).
 */
class ShellActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private var pausedAtMs = 0L
    private val idleReloadMs = 30 * 60 * 1000L

    /** Set by the sign-in task to receive `auth` postMessages (raw JSON). */
    var onAuth: ((String) -> Unit)? = null

    private lateinit var measurement: MeasurementController
    private var pendingStartJson: String? = null
    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val json = pendingStartJson; pendingStartJson = null
            if (granted && json != null) measurement.handleTimegrapherMessage(json)
            else if (!granted) callJs(BridgeMessages.error("Microphone permission denied. Allow it in Settings to measure."))
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    view.evaluateJavascript(buildBridgeScript(BuildConfig.NATIVE_CAPABILITY_VERSION), null)
                }
                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    refresh.isRefreshing = false
                }
            }
        }

        refresh = SwipeRefreshLayout(this).apply {
            addView(webView)
            setOnRefreshListener { webView.reload() }
        }
        setContentView(refresh)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        measurement = buildMeasurement()

        if (savedInstanceState == null) webView.loadUrl(SITE_URL)
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
        if (action == "start" &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingStartJson = json
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        measurement.handleTimegrapherMessage(json)
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
            when (handler) {
                "haptic" -> vibrate()
                "timegrapher" -> runOnUiThread { routeTimegrapher(json) }
                "auth" -> onAuth?.invoke(json)
            }
        }
    }

    companion object {
        const val SITE_URL = "https://wrotate.com"
    }
}
