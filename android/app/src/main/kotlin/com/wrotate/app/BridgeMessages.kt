package com.wrotate.app

import com.wrotate.engine.Result
import com.wrotate.engine.Update

/**
 * Formats native→JS `_tgNativeCallback` payloads, byte-for-byte matching the shapes
 * `ios/Wrotate/Wrotate/TimegrapherBridge.swift` emits, so the page's measurement JS needs no
 * change. JSON is built by hand (no org.json) so these are pure and unit-testable on the JVM.
 */
object BridgeMessages {

    /** A web→native auth event ({"event","userId","accessToken"}) as (event, userId, accessToken),
     *  or null when malformed. userId/accessToken are null for SIGNED_OUT. */
    fun parseAuthEvent(json: String): Triple<String, String?, String?>? = try {
        val o = org.json.JSONObject(json)
        val event = o.optString("event", "").ifEmpty { null }
        event?.let { Triple(it, o.optString("userId", "").ifEmpty { null }, o.optString("accessToken", "").ifEmpty { null }) }
    } catch (e: Exception) {
        null
    }

    /** The unread count of a web→native BADGE_UPDATE post ({"event":"BADGE_UPDATE","count":N}),
     *  or null for any other message. A missing count reads as 0 (iOS WebView.swift parity). */
    fun parseBadgeCount(json: String): Int? = try {
        val o = org.json.JSONObject(json)
        if (o.optString("event") == "BADGE_UPDATE") o.optInt("count", 0) else null
    } catch (e: Exception) {
        null
    }

    /** The `action` of a web→native appAction post ({"action":"requestReview"}), or null. */
    fun parseAppAction(json: String): String? = try {
        org.json.JSONObject(json).optString("action", "").ifEmpty { null }
    } catch (e: Exception) {
        null
    }

    fun started(): String = "{\"event\":\"started\"}"
    fun pong(): String = "{\"event\":\"pong\"}"
    fun error(message: String): String = "{\"event\":\"error\",\"message\":${str(message)}}"
    fun interruption(state: String): String = "{\"event\":\"audioInterruption\",\"state\":${str(state)}}"

    fun stopped(r: Result): String =
        "{\"event\":\"stopped\",\"rate\":${num(r.rate)},\"beatError\":${num(r.beatError)},\"tickCount\":${r.tickCount}}"

    fun updateEvent(u: Update): String {
        val sb = StringBuilder("{\"event\":\"update\"")
        sb.append(",\"rate\":").append(num(u.rate))
        sb.append(",\"beatError\":").append(num(u.beatError))
        sb.append(",\"amplitude\":").append(num(u.amplitude))
        sb.append(",\"tickCount\":").append(u.tickCount)
        sb.append(",\"confidence\":").append(u.confidence)
        sb.append(",\"noiseLevel\":").append(u.noiseLevel)
        sb.append(",\"detectedIntervalMs\":").append(u.detectedIntervalMs)
        sb.append(",\"detectedBph\":").append(u.detectedBph?.toString() ?: "null")
        sb.append(",\"cumulativeOffset\":").append(u.cumulativeOffset)
        sb.append(",\"elapsedSec\":").append(u.elapsedSec)
        sb.append(",\"method\":").append(str(u.method))
        sb.append(",\"rateStable\":").append(u.rateStable)
        sb.append(",\"tgSignalQuality\":").append(str(u.tgSignalQuality))
        sb.append(",\"tgAcquiring\":").append(u.tgAcquiring)
        if (u.newTicks.isNotEmpty()) {
            sb.append(",\"newTicks\":[")
            u.newTicks.forEachIndexed { i, d ->
                if (i > 0) sb.append(",")
                sb.append("{\"t\":").append(d.timeSec).append(",\"d\":").append(d.deviationMs).append("}")
            }
            sb.append("]")
        }
        if (u.debugMessages.isNotEmpty()) {
            sb.append(",\"debugMessages\":[")
            u.debugMessages.forEachIndexed { i, m -> if (i > 0) sb.append(","); sb.append(str(m)) }
            sb.append("]")
        }
        val wf = u.beatWaveform
        if (wf != null) {
            sb.append(",\"beatWaveform\":[")
            wf.forEachIndexed { i, x -> if (i > 0) sb.append(","); sb.append(x) }
            sb.append("]")
        }
        val tp = u.tickPositions
        if (tp != null) {
            sb.append(",\"tickPositions\":[")
            tp.forEachIndexed { i, x -> if (i > 0) sb.append(","); sb.append(x) }
            sb.append("]")
        }
        sb.append("}")
        return sb.toString()
    }

    private fun num(x: Double?): String = x?.toString() ?: "null"

    private fun str(s: String?): String {
        if (s == null) return "null"
        val sb = StringBuilder("\"")
        for (c in s) {
            when {
                c == '\\' -> sb.append("\\\\")
                c == '"' -> sb.append("\\\"")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> sb.append("\\u").append("%04x".format(c.code))
                else -> sb.append(c)
            }
        }
        return sb.append("\"").toString()
    }
}
