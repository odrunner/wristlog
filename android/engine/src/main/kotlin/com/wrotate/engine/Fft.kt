package com.wrotate.engine

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * In-place iterative radix-2 complex FFT. Length must be a power of two.
 * [inverse] computes the unscaled inverse transform (caller divides by n).
 */
internal fun fftInPlace(re: DoubleArray, im: DoubleArray, inverse: Boolean) {
    val n = re.size
    require(n > 0 && (n and (n - 1)) == 0) { "length must be a power of two" }

    // bit-reversal permutation
    var j = 0
    for (i in 1 until n) {
        var bit = n shr 1
        while (j and bit != 0) {
            j = j xor bit
            bit = bit shr 1
        }
        j = j xor bit
        if (i < j) {
            val tr = re[i]; re[i] = re[j]; re[j] = tr
            val ti = im[i]; im[i] = im[j]; im[j] = ti
        }
    }

    var len = 2
    while (len <= n) {
        val ang = 2.0 * PI / len * (if (inverse) 1.0 else -1.0)
        val half = len shr 1
        val wr = DoubleArray(half) { cos(ang * it) }
        val wi = DoubleArray(half) { sin(ang * it) }
        var start = 0
        while (start < n) {
            for (k in 0 until half) {
                val a = start + k
                val b = a + half
                val xr = re[b] * wr[k] - im[b] * wi[k]
                val xi = re[b] * wi[k] + im[b] * wr[k]
                re[b] = re[a] - xr
                im[b] = im[a] - xi
                re[a] += xr
                im[a] += xi
            }
            start += len
        }
        len = len shl 1
    }
}

/**
 * Linear (non-circular) autocorrelation of the first [count] samples of [signal]:
 * zero-pad to the next power of two >= 2*count, IFFT(|FFT|^2), return the first
 * [count] lags (lag 0 first). Scale is the plain sum of products (unnormalised).
 */
fun fftAutocorrelation(signal: FloatArray, count: Int): FloatArray {
    if (count <= 0) return FloatArray(0)
    var n = 1
    while (n < 2 * count) n = n shl 1
    val re = DoubleArray(n)
    val im = DoubleArray(n)
    for (i in 0 until count) re[i] = signal[i].toDouble()
    fftInPlace(re, im, inverse = false)
    for (i in 0 until n) {
        re[i] = re[i] * re[i] + im[i] * im[i]
        im[i] = 0.0
    }
    fftInPlace(re, im, inverse = true)
    return FloatArray(count) { (re[it] / n).toFloat() }
}
