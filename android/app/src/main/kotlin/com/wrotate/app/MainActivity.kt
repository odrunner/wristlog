package com.wrotate.app

import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import com.wrotate.engine.engineReady

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "WRotate engine ready: ${engineReady()}" })
    }
}
