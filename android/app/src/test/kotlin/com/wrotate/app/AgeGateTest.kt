package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AgeGateTest {

    @Test
    fun onlyTheMandatoryFeatureTriggersTheAsk() {
        assertTrue(AgeGate.sharingIsMandatory(setOf(1)))
        // Everyone outside the regulated regions gets an empty set: no request, no prompt.
        assertFalse(AgeGate.sharingIsMandatory(emptySet()))
        assertFalse(AgeGate.sharingIsMandatory(setOf(2)))
        assertFalse(AgeGate.sharingIsMandatory(null))
    }

    @Test
    fun onlySharedCarriesABracket() {
        assertTrue(AgeGate.shared(1))
        assertFalse(AgeGate.shared(0)) // UNSPECIFIED
        assertFalse(AgeGate.shared(2)) // NOT_SHARED
        assertFalse(AgeGate.shared(3)) // VERIFICATION_REQUIRED
        assertFalse(AgeGate.shared(null))
    }

    @Test
    fun theUnder13BracketBlocks() {
        assertEquals(AgeGate.Verdict.BLOCK, AgeGate.verdict(0, 12))
        assertEquals(AgeGate.Verdict.BLOCK, AgeGate.verdict(null, 12))
    }

    @Test
    fun teensAndAdultsAreAllowed() {
        assertEquals(AgeGate.Verdict.ALLOW, AgeGate.verdict(13, 15))
        assertEquals(AgeGate.Verdict.ALLOW, AgeGate.verdict(16, 17))
        assertEquals(AgeGate.Verdict.ALLOW, AgeGate.verdict(18, null)) // 18+ has no upper bound
        // A custom Play Console bracket that straddles 13 is not known to be under it.
        assertEquals(AgeGate.Verdict.ALLOW, AgeGate.verdict(10, 14))
    }

    // SHARED with no bracket tells us nothing — it must neither block nor lift a stored block.
    @Test
    fun noBracketIsUnknown() {
        assertEquals(AgeGate.Verdict.UNKNOWN, AgeGate.verdict(null, null))
    }
}
