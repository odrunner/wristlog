package com.wrotate.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Trampoline for launcher shortcuts. Android fires a static shortcut's intent with
 * NEW_TASK|CLEAR_TASK — aimed straight at ShellActivity that would tear down a running app
 * (killing a measurement or a post draft) on every warm tap. This activity owns its own task
 * (taskAffinity="" in the manifest), absorbs the CLEAR_TASK, and re-enters the shell gently.
 */
class QuickActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.let { data ->
            startActivity(
                Intent(Intent.ACTION_VIEW, data, this, ShellActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
        finish()
    }
}
