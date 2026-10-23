package com.wrotate.engine

import kotlin.test.Test
import kotlin.test.assertEquals

/** Expected strings are the literal output of /usr/bin/swift for the same values. */
class SwiftFormatTest {
    @Test
    fun printfMatchesSwiftStringFormat() {
        assertEquals("0.12", cf(0.125, 2))
        assertEquals("2", cf(2.5, 0))
        assertEquals("2.67", cf(2.675, 2))
        assertEquals("-0.00", cf(-0.001, 2))
        assertEquals("+0.00", cf(0.0, 2, plus = true))
        assertEquals("-0.00", cf(-0.0, 2, plus = true))
        assertEquals("-12.2", cf(-12.25, 1, plus = true))
        assertEquals("0.1", cf(0.05, 1))
        assertEquals("1.000", cf(1.0005, 3))
    }

    @Test
    fun doubleDescriptionMatchesSwift() {
        assertEquals("0.0003", swiftDesc(0.0003))
        assertEquals("9e-05", swiftDesc(0.00009))
        assertEquals("0.0001", swiftDesc(0.0001))
        assertEquals("12000.0", swiftDesc(12000.0))
        assertEquals("1e+16", swiftDesc(1e16))
        assertEquals("1.5e-07", swiftDesc(1.5e-7))
        assertEquals("9000000000000000.0", swiftDesc(9.0e15))
        assertEquals("9.1e+15", swiftDesc(9.1e15))
        assertEquals("123456789.0", swiftDesc(123456789.0))
        assertEquals("0.001234", swiftDesc(0.001234))
        assertEquals("-5e-05", swiftDesc(-0.00005))
        assertEquals("-3.25", swiftDesc(-3.25))
        assertEquals("0.2", swiftDesc(0.2))
        assertEquals("52.0", swiftDesc(52.0))
    }

    @Test
    fun floatDescriptionMatchesSwift() {
        assertEquals("0.9999", swiftDesc(0.9999f))
        assertEquals("0.26666668", swiftDesc(0.8f / 3f))
        assertEquals("0.995", swiftDesc(0.995f))
        assertEquals("1.2", swiftDesc(1.2f))
        assertEquals("16777216.0", swiftDesc(16777216f))
        assertEquals("1.6777218e+07", swiftDesc(16777218f))
        assertEquals("3.3554432e+07", swiftDesc(33554432f))
        assertEquals("0.00012", swiftDesc(0.00012f))
        assertEquals("9e-05", swiftDesc(0.00009f))
        assertEquals("10000000.0", swiftDesc(1e7f))
    }

    @Test
    fun optionalIntDescribing() {
        assertEquals("Optional(28800)", swiftDescribing(28800))
        assertEquals("nil", swiftDescribing(null))
    }
}
