package com.wrotate.app

import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

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

    /** Set by the measurement task to receive `timegrapher` postMessages (raw JSON). */
    var onTimegrapher: ((String) -> Unit)? = null
    /** Set by the sign-in task to receive `auth` postMessages (raw JSON). */
    var onAuth: ((String) -> Unit)? = null

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

        if (savedInstanceState == null) webView.loadUrl(SITE_URL)
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
                "timegrapher" -> onTimegrapher?.invoke(json)
                "auth" -> onAuth?.invoke(json)
            }
        }
    }

    companion object {
        const val SITE_URL = "https://wrotate.com"
    }
}
