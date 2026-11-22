package com.wrotate.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GoLinkTest {
    @Test fun readsTheKeyFromAnEmailButtonLink() {
        assertEquals("open_measure", GoLink.parse(
            "https://wrotate.com/open?utm_source=email&utm_medium=campaign&utm_campaign=onboarding-3-measure&go=open_measure"))
        assertEquals("open_accuracy", GoLink.parse("https://wrotate.com/open.html?go=open_accuracy"))
    }

    @Test fun aPlainOpenLinkCarriesNothing() {
        assertNull(GoLink.parse("https://wrotate.com/open?utm_source=email"))
        assertNull(GoLink.parse("https://wrotate.com/open"))
        assertNull(GoLink.parse(null))
    }

    @Test fun otherHostsPathsAndSchemesAreIgnored() {
        assertNull(GoLink.parse("https://evil.example/open?go=open_measure"))
        assertNull(GoLink.parse("https://wrotate.com.evil.example/open?go=open_measure"))
        assertNull(GoLink.parse("http://wrotate.com/open?go=open_measure"))
        assertNull(GoLink.parse("https://wrotate.com/p/?go=open_measure"))
        assertNull(GoLink.parse("wrotate://quick/measure"))
        assertNull(GoLink.parse("not a uri at all"))
    }

    @Test fun onlyAPlainKeyIsAccepted() {
        assertNull(GoLink.parse("https://wrotate.com/open?go=x%27)%3Balert(1)%2F%2F"))
        assertNull(GoLink.parse("https://wrotate.com/open?go=Open_Measure"))
        assertNull(GoLink.parse("https://wrotate.com/open?go="))
        assertNull(GoLink.parse("https://wrotate.com/open?go=" + "a".repeat(41)))
        assertNull(GoLink.dispatchJs("x');alert(1)//"))
    }

    @Test fun dispatchCallsThePageGuarded() {
        assertEquals("if(typeof runGoLink==='function') runGoLink('open_measure');", GoLink.dispatchJs("open_measure"))
    }
}
