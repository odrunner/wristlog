package com.wrotate.engine

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Minimal RIFF/WAVE reader (16-bit PCM, 32-bit float) and writer (32-bit float, mono). */
object WavIo {
    private const val FMT_PCM = 1
    private const val FMT_FLOAT = 3
    private const val FMT_EXTENSIBLE = 0xFFFE

    /** Returns (first-channel samples scaled to [-1, 1), sample rate). */
    fun read(path: File): Pair<FloatArray, Double> {
        val bb = ByteBuffer.wrap(path.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        require(bb.remaining() >= 12 && tag(bb, 0) == "RIFF" && tag(bb, 8) == "WAVE") { "not a RIFF/WAVE file" }

        var format = -1
        var channels = 0
        var sampleRate = 0
        var bits = 0
        var pos = 12
        while (pos + 8 <= bb.limit()) {
            val id = tag(bb, pos)
            val size = bb.getInt(pos + 4).toLong() and 0xFFFFFFFFL
            val body = pos + 8
            if (id == "fmt ") {
                format = bb.getShort(body).toInt() and 0xFFFF
                channels = bb.getShort(body + 2).toInt() and 0xFFFF
                sampleRate = bb.getInt(body + 4)
                bits = bb.getShort(body + 14).toInt() and 0xFFFF
                if (format == FMT_EXTENSIBLE && size >= 26) format = bb.getShort(body + 24).toInt() and 0xFFFF
            } else if (id == "data") {
                require(format != -1) { "data chunk before fmt chunk" }
                require(channels >= 1) { "invalid channel count" }
                val avail = (bb.limit() - body).toLong()
                val bytes = minOf(size, avail).toInt()
                val bytesPerSample = bits / 8
                val frame = bytesPerSample * channels
                val frames = bytes / frame
                val out = FloatArray(frames)
                when {
                    format == FMT_PCM && bits == 16 ->
                        for (i in 0 until frames) out[i] = bb.getShort(body + i * frame) / 32768f
                    format == FMT_FLOAT && bits == 32 ->
                        for (i in 0 until frames) out[i] = bb.getFloat(body + i * frame)
                    else -> throw IllegalArgumentException("unsupported WAV format=$format bits=$bits")
                }
                return Pair(out, sampleRate.toDouble())
            }
            pos = body + size.toInt() + (size.toInt() and 1) // chunks are word-aligned
        }
        throw IllegalArgumentException("no data chunk")
    }

    /** Writes mono 32-bit float WAV (format tag 3). */
    fun write(path: File, samples: FloatArray, sampleRate: Double) {
        val dataBytes = samples.size * 4
        val bb = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
        val sr = Math.round(sampleRate).toInt()
        bb.put("RIFF".toByteArray(Charsets.US_ASCII))
        bb.putInt(36 + dataBytes)
        bb.put("WAVE".toByteArray(Charsets.US_ASCII))
        bb.put("fmt ".toByteArray(Charsets.US_ASCII))
        bb.putInt(16)
        bb.putShort(FMT_FLOAT.toShort())
        bb.putShort(1)
        bb.putInt(sr)
        bb.putInt(sr * 4)
        bb.putShort(4)
        bb.putShort(32)
        bb.put("data".toByteArray(Charsets.US_ASCII))
        bb.putInt(dataBytes)
        for (s in samples) bb.putFloat(s)
        path.writeBytes(bb.array())
    }

    private fun tag(bb: ByteBuffer, at: Int): String =
        String(ByteArray(4) { bb.get(at + it) }, Charsets.US_ASCII)
}
