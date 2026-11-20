package com.wrotate.app

import com.google.android.play.agesignals.model.AgeSignalsStatus
import com.google.android.play.agesignals.model.ApplicableAgeFeature

/**
 * The decisions behind the age check (Play Age Signals). The shell asks Play for an age bracket
 * only where a law makes sharing mandatory (California AB 1043 and Brazil's Digital ECA from
 * January 2027, Texas today), and blocks the app for a bracket that ends below 13 — the age the
 * privacy policy already sets. Everyone else, and every failure, continues as before.
 *
 * Play's terms allow the bracket to be used only for this; it must never reach analytics, the
 * page, or the server. The only thing kept is the on-device "blocked" flag.
 *
 * Pure so it is unit-testable without the Android framework.
 */
object AgeGate {
    const val MIN_AGE = 13

    enum class Verdict { BLOCK, ALLOW, UNKNOWN }

    /** Play reports MANDATORY_SHARING only for users in the regulated regions. */
    fun sharingIsMandatory(features: Set<Int>?): Boolean =
        features?.contains(ApplicableAgeFeature.MANDATORY_SHARING) == true

    /** Only SHARED carries a bracket; NOT_SHARED / VERIFICATION_REQUIRED / null leave the app open. */
    fun shared(status: Int?): Boolean = status == AgeSignalsStatus.SHARED

    /**
     * Play's default brackets are 0-12, 13-15, 16-17 and 18+ (no upper bound). A bracket whose top
     * end is under 13 blocks; any other bracket allows; no bracket at all says nothing, so a
     * stored block is left as it was.
     */
    fun verdict(ageLower: Int?, ageUpper: Int?): Verdict = when {
        ageLower == null && ageUpper == null -> Verdict.UNKNOWN
        ageUpper != null && ageUpper < MIN_AGE -> Verdict.BLOCK
        else -> Verdict.ALLOW
    }
}
