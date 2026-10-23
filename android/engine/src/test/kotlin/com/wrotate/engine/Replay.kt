package com.wrotate.engine

/**
 * Feeds [samples] through [TimegrapherCore.process] in [chunk]-sized pieces (the last piece
 * may be partial), as the capture layer would, and returns every Update emitted on the way.
 * Any onUpdate the caller already installed keeps receiving updates and is restored after.
 */
fun replay(core: TimegrapherCore, samples: FloatArray, chunk: Int = 4096): List<Update> {
    require(chunk > 0)
    val out = ArrayList<Update>()
    val prev = core.onUpdate
    core.onUpdate = { u -> out.add(u); prev?.invoke(u) }
    try {
        val buf = FloatArray(chunk)
        var i = 0
        while (i < samples.size) {
            val n = minOf(chunk, samples.size - i)
            System.arraycopy(samples, i, buf, 0, n)
            core.process(buf, n)
            i += n
        }
    } finally {
        core.onUpdate = prev
    }
    return out
}
