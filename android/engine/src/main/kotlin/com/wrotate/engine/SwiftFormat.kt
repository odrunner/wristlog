package com.wrotate.engine

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs

// Log lines must be byte-identical to the Swift engine's: server telemetry and the weekly
// accuracy loop parse them (psBE= in [TGTICK], knob echoes in [TGTUNE]). Java's own
// formatting differs from Swift's in two places, so these helpers reproduce Swift instead:
//  - String(format: "%.Nf") is C printf: the EXACT binary value rounded half-to-even
//    (0.125 -> "0.12", 2.5 -> "2"), sign kept on negatives that round to zero ("-0.00").
//    java.util.Formatter rounds the shortest decimal half-up (0.13, 3, "-0.00" varies).
//  - "\(x)" interpolation of a Double/Float is Swift's shortest description: 0.0003 stays
//    "0.0003" (Java: "3.0E-4"), exponential form is "9e-05" / "1.6777218e+07".
// Verified against /usr/bin/swift output (see SwiftFormatTest).

/** Swift `String(format: "%.<decimals>f", x)`; `plus = true` for `"%+.<decimals>f"`. */
internal fun cf(x: Double, decimals: Int, plus: Boolean = false): String {
    if (x.isNaN()) return "nan"
    if (x.isInfinite()) return if (x > 0) (if (plus) "+inf" else "inf") else "-inf"
    val neg = x < 0.0 || (x == 0.0 && 1.0 / x < 0.0)
    val body = BigDecimal(abs(x)).setScale(decimals, RoundingMode.HALF_EVEN).toPlainString()
    return (if (neg) "-" else if (plus) "+" else "") + body
}

/** Swift `"\(d)"` for a Double. */
internal fun swiftDesc(d: Double): String {
    if (d.isNaN()) return "nan"
    if (d.isInfinite()) return if (d > 0) "inf" else "-inf"
    if (d == 0.0) return if (1.0 / d < 0) "-0.0" else "0.0"
    return swiftLayout(BigDecimal(d.toString()), abs(d) > 9007199254740992.0) // 2^53
}

/** Swift `"\(f)"` for a Float. */
internal fun swiftDesc(f: Float): String {
    if (f.isNaN()) return "nan"
    if (f.isInfinite()) return if (f > 0) "inf" else "-inf"
    if (f == 0f) return if (1f / f < 0) "-0.0" else "0.0"
    return swiftLayout(BigDecimal(f.toString()), abs(f) > 16777216f) // 2^24
}

/** Swift `String(describing: Int?)`: "Optional(28800)" or "nil". */
internal fun swiftDescribing(v: Int?): String = if (v == null) "nil" else "Optional($v)"

// value = 0.<digits> x 10^exp; Swift goes exponential when exp < -3 or the value is huge.
private fun swiftLayout(v: BigDecimal, huge: Boolean): String {
    val sb = StringBuilder()
    if (v.signum() < 0) sb.append('-')
    val s = v.abs().stripTrailingZeros()
    val digits = s.unscaledValue().toString()
    val exp = digits.length - s.scale()
    if (exp < -3 || huge) {
        sb.append(digits[0])
        if (digits.length > 1) sb.append('.').append(digits, 1, digits.length)
        val e = exp - 1
        sb.append('e').append(if (e < 0) '-' else '+')
        val ae = abs(e)
        if (ae < 10) sb.append('0')
        sb.append(ae)
    } else if (exp <= 0) {
        sb.append("0.")
        repeat(-exp) { sb.append('0') }
        sb.append(digits)
    } else if (exp >= digits.length) {
        sb.append(digits)
        repeat(exp - digits.length) { sb.append('0') }
        sb.append(".0")
    } else {
        sb.append(digits, 0, exp).append('.').append(digits, exp, digits.length)
    }
    return sb.toString()
}
