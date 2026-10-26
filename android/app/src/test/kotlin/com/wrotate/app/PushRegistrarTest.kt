package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals

class PushRegistrarTest {

    // Review Focus 5: below API 33 there is no runtime dialog — POST_NOTIFICATIONS is
    // auto-granted, and reporting anything but 'authorized' would route working-push users
    // to email reminders forever.
    @Test
    fun statusStringBelow33IsAlwaysAuthorized() {
        assertEquals("authorized", PushRegistrar.statusString(granted = false, asked = false, sdkInt = 26))
        assertEquals("authorized", PushRegistrar.statusString(granted = false, asked = true, sdkInt = 32))
    }

    @Test
    fun statusStringOn33FollowsGrantAndAskState() {
        assertEquals("authorized", PushRegistrar.statusString(granted = true, asked = true, sdkInt = 33))
        assertEquals("denied", PushRegistrar.statusString(granted = false, asked = true, sdkInt = 34))
        assertEquals("notDetermined", PushRegistrar.statusString(granted = false, asked = false, sdkInt = 34))
        // Android never has a provisional state — the word must not appear.
    }

    @Test
    fun registrationBodyCarriesAndroidPlatformAndPlayVersion() {
        val body = org.json.JSONObject(PushRegistrar.registrationBody("u-1", "fcm-tok", "1.2"))
        assertEquals("u-1", body.getString("user_id"))
        assertEquals("fcm-tok", body.getString("token"))
        assertEquals("android", body.getString("platform"))
        assertEquals("1.2", body.getString("app_version"))
    }
}
