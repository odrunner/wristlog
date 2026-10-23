package com.wrotate.engine

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TickSynthTest {
    /** Onset sample index of every burst: first |x| > threshold after a quiet refractory gap. */
    private fun onsets(x: FloatArray, sr: Double, threshold: Float = 0.02f): List<Int> {
        val refractory = (0.03 * sr).toInt()
        val out = ArrayList<Int>()
        var last = -refractory
        for (i in x.indices) {
            if (abs(x[i]) > threshold && i - last >= refractory) {
                out.add(i)
                last = i
            }
        }
        return out
    }

    @Test
    fun burstsPerSecondMatchesBph() {
        val spec = SynthSpec(durationSec = 10.0)
        val x = synthesize(spec)
        assertEquals((spec.durationSec * spec.sampleRate).toInt(), x.size)
        val n = onsets(x, spec.sampleRate).size
        assertTrue(n in 79..80, "expected ~80 bursts in 10 s (8/s), got $n")
    }

    @Test
    fun tickSpacingFollowsRate() {
        val spec = SynthSpec(rateSecPerDay = 20.0, durationSec = 60.0)
        val on = onsets(synthesize(spec), spec.sampleRate)
        // Same-parity (tick to tick) spacing is the brief's (7200/bph) * sr * (1 - rate/86400).
        val ticks = on.filterIndexed { i, _ -> i % 2 == 0 }
        val mean = (ticks.last() - ticks.first()).toDouble() / (ticks.size - 1)
        val expected = (7200.0 / 28800) * 48000 * (1 - 20.0 / 86400)
        assertEquals(expected, mean, expected * 0.0002)
    }

    @Test
    fun beatErrorAlternatesGaps() {
        val spec = SynthSpec(beatErrorMs = 2.0, durationSec = 10.0)
        val on = onsets(synthesize(spec), spec.sampleRate)
        val gaps = on.zipWithNext { a, b -> (b - a) * 1000.0 / spec.sampleRate }
        val even = gaps.filterIndexed { i, _ -> i % 2 == 0 }.average()
        val odd = gaps.filterIndexed { i, _ -> i % 2 == 1 }.average()
        assertEquals(2.0, abs(even - odd), 0.1)
    }

    @Test
    fun deterministicForSeed() {
        val a = synthesize(SynthSpec(durationSec = 1.0))
        val b = synthesize(SynthSpec(durationSec = 1.0))
        assertTrue(a.contentEquals(b))
    }

    @Test
    fun wavRoundTrip() {
        val x = synthesize(SynthSpec(sampleRate = 44100.0, durationSec = 1.0))
        val f = File.createTempFile("tick", ".wav")
        try {
            WavIo.write(f, x, 44100.0)
            val (y, sr) = WavIo.read(f)
            assertEquals(44100.0, sr)
            assertEquals(x.size, y.size)
            for (i in x.indices) assertEquals(x[i], y[i], 1e-6f)
        } finally {
            f.delete()
        }
    }
    private fun pcm16Wav(channels: Int, sampleRate: Int, interleaved: ShortArray, junkChunk: Boolean): ByteArray {
        val dataBytes = interleaved.size * 2
        val junk = if (junkChunk) 8 + 3 + 1 else 0 // odd-sized chunk plus its pad byte
        val bb = ByteBuffer.allocate(44 + junk + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
        bb.put("RIFF".toByteArray()); bb.putInt(36 + junk + dataBytes); bb.put("WAVE".toByteArray())
        bb.put("fmt ".toByteArray()); bb.putInt(16)
        bb.putShort(1); bb.putShort(channels.toShort()); bb.putInt(sampleRate)
        bb.putInt(sampleRate * channels * 2); bb.putShort((channels * 2).toShort()); bb.putShort(16)
        if (junkChunk) { bb.put("junk".toByteArray()); bb.putInt(3); bb.put(byteArrayOf(1, 2, 3, 0)) }
        bb.put("data".toByteArray()); bb.putInt(dataBytes)
        for (v in interleaved) bb.putShort(v)
        return bb.array()
    }

    @Test
    fun wavReadsMono16BitPcm() {
        val raw = shortArrayOf(0, 16384, -16384, 32767, -32768)
        val f = File.createTempFile("pcm16", ".wav")
        try {
            f.writeBytes(pcm16Wav(1, 48000, raw, false))
            val (y, sr) = WavIo.read(f)
            assertEquals(48000.0, sr)
            assertEquals(raw.size, y.size)
            for (i in raw.indices) assertEquals(raw[i] / 32768f, y[i], 1f / 32768f)
        } finally {
            f.delete()
        }
    }

    @Test
    fun wavReadsStereo16BitPcmFirstChannelOnly() {
        val left = shortArrayOf(1000, -2000, 3000, -4000)
        val right = shortArrayOf(9999, 9999, 9999, 9999)
        val inter = ShortArray(8) { if (it % 2 == 0) left[it / 2] else right[it / 2] }
        val f = File.createTempFile("pcm16st", ".wav")
        try {
            f.writeBytes(pcm16Wav(2, 44100, inter, true))
            val (y, sr) = WavIo.read(f)
            assertEquals(44100.0, sr)
            assertEquals(left.size, y.size)
            for (i in left.indices) assertEquals(left[i] / 32768f, y[i], 1f / 32768f)
        } finally {
            f.delete()
        }
    }
}
