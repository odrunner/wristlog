# How WRotate Measures Watch Accuracy

## The Basic Idea

A mechanical watch ticks at a known rate. A watch rated at 28,800 BPH (beats per hour) should tick exactly 8 times per second. If it ticks slightly faster or slower than that, the watch is gaining or losing time. We measure exactly how much faster or slower, and express it as **seconds per day** (s/day).

For example: if a watch ticks 0.01% too fast, it gains about **+8.6 seconds per day**.

---

## Step by Step

### 1. Listening to the Watch

The phone's microphone picks up the raw audio of the watch ticking. The audio comes in at 48,000 samples per second (48 kHz) — that's 48,000 tiny measurements of the sound wave every second.

### 2. Filtering Out Noise

Watch ticks are high-pitched, sharp clicks. Background noise (fans, traffic, voices) is mostly low-frequency. We run the audio through **high-pass filters** that strip out everything below 4,000 Hz, keeping only the sharp tick sounds. We actually run three filters in parallel at different cutoffs (4 kHz, 6 kHz, 8 kHz) and pick whichever one gives the cleanest signal for each watch.

### 3. Building an Energy Timeline

We don't need all 48,000 samples per second — that's overkill for detecting ticks that only happen 8 times per second. So we downsample to about **12,000 samples per second** by taking the peak energy value from every group of 4 raw samples. This creates a compact "energy ring buffer" — a sliding window of the last 30 seconds of tick energy.

This ring buffer is where tick detection happens. Each position in the buffer represents about **0.083 milliseconds** of time.

### 4. Figuring Out Which Watch It Is (Auto-BPH Detection)

If the user didn't tell us the BPH, we need to figure it out. We use two techniques:

- **Goertzel analysis** (primary) — it's like asking "how much energy is there at exactly 8 Hz?" (for 28,800 BPH) vs. "how much at 6 Hz?" (for 21,600 BPH), and so on. We check all common BPH values (18,000 / 21,600 / 25,200 / 28,800 / 36,000) and pick the one with the strongest signal, but only if it's decisively stronger than the runner-up.

- **FFT autocorrelation** (fallback) — if Goertzel doesn't produce a decisive winner, we compute a full autocorrelation of the energy buffer and look for the strongest periodic peak corresponding to a known BPH.

If the user selected their BPH manually, we skip this step entirely and start detecting ticks right away.

### 5. Calibration Phase

Before detecting ticks, the engine runs a **2-second calibration phase**. During this time, it collects energy samples but does not attempt to detect any ticks. At the end of calibration:

- It sorts all observed energy values and takes the **98th percentile** (p98).
- The initial tick threshold is set to **p98 × 1.2**.

Using a robust percentile instead of the raw peak makes calibration resistant to transient spikes (bumps, taps, coughs). A single loud noise during calibration won't set the threshold impossibly high.

**Fallback recalibration:** If no ticks are detected within 3 seconds after calibration, the engine assumes the threshold latched onto a transient and automatically recalibrates with a fresh window. This can happen up to 2 times per session to avoid infinite loops.

### 6. Detecting Individual Ticks

Once we know the BPH, we know exactly how far apart ticks should be in the energy buffer. For a 28,800 BPH watch, ticks should be **1,500 ring samples apart** (12,000 Hz / 8 ticks per second).

The engine watches the energy buffer in real time. When it sees an energy spike above a threshold (30% of the tracked peak energy), and the spike is roughly the right distance from the last tick, it registers a tick.

The tick threshold is adaptive: it tracks the peak energy and decays slowly over time (0.9999× per sample, or 0.995× if no ticks have been found yet — faster decay to recover from bad calibrations).

**Sub-sample interpolation:** The tick might not land exactly on a ring sample boundary. To get more precise timing, we fit a parabola through the three energy values around the peak and calculate where the true peak falls between samples. This gives us fractional-sample precision.

**Outlier rejection:** If a detected tick is more than 15% off from the expected spacing, it's thrown out — it's probably not a real tick (maybe a bump or background noise).

### 7. Pairing Ticks to Cancel Beat Error

This is a subtle but important step. Mechanical watches have a **beat error** — the tick and the tock aren't perfectly symmetric. One half-swing might be slightly longer than the other. If we measured individual ticks, the beat error would show up as alternating fast/slow readings, adding noise to our rate measurement.

The solution: we **pair consecutive ticks** (tick + tock = one full swing of the balance wheel). A pair always covers one complete oscillation, so the beat error cancels out. We only measure the deviation of pairs, never individual ticks.

For each pair, we calculate:
- **Expected pair interval** = 2 x expected tick interval
- **Actual pair interval** = measured time between the first tick and the tick after next
- **Pair deviation** = the difference, in milliseconds

We keep a running total of pair deviations. This **cumulative pair deviation** is the heart of the measurement — it's how far the watch has drifted from perfect time since we started listening.

### 8. The Adaptive Pair Gate

Not all detected pairs are clean. The **adaptive pair gate** decides which pairs to trust:

- We track the last 30 pair deviations and compute their **MAD** (median absolute deviation) — a robust measure of how noisy the data is.
- The acceptance threshold = median + 3× MAD, clamped between a floor (**1.0 ms**) and ceiling (**2.0 ms**).
- Before we have enough data to compute MAD, we use a fixed threshold (**2.0 ms**).
- All pairs are used for deviation tracking and plotting; the gate prevents pathological outliers from corrupting the regression.
- Individual tick deviations are also sanity-checked against a **10 ms** limit.

### 9. Computing the Rate (Theil-Sen Regression)

This is where we turn raw tick data into a single number: seconds per day.

We have a list of data points: (elapsed time, cumulative pair deviation). If the watch is running fast, the cumulative deviation grows over time. If it's slow, it shrinks. The **slope** of this line is the rate.

We use **Theil-Sen regression**, which works like this:
1. Take every possible pair of data points
2. Calculate the slope between each pair
3. The **median** of all those slopes is the answer

Why not just draw a best-fit line (ordinary least squares)? Because Theil-Sen is **robust to outliers**. Even if 30% of the data points are garbage, the median slope is still correct. A single bad tick can't pull the line off course.

The slope comes out in milliseconds per second. We multiply by 86.4 to convert to **seconds per day**.

We skip the first 5 pairs from the regression (they're from the calibration phase when the adaptive gate was still learning). We also require at least 10 pairs before showing any rate at all.

**Large dataset optimization:** When the number of regression points exceeds ~120, we subsample down to ~120 evenly-spaced points to keep the O(n²) pairwise slope computation fast.

### 10. Stability Detection

We don't just want a rate — we want to know when it's **settled**. The engine tracks the rate over a 15-second sliding window:

- **Stable** = the rate has stayed within a 3 s/day range for the full window
- **Unstable** = the rate has drifted more than 5 s/day within the window

The different thresholds (3 to gain stability, 5 to lose it) prevent flickering between stable/unstable states. This is called **hysteresis**.

The engine also enforces a **20-second minimum elapsed time** before allowing convergence (stability alone isn't enough if too little time has passed).

### 11. JS Convergence (Auto-Stop)

On the frontend, JavaScript decides when the measurement is "done" and can auto-stop. Three conditions must all be met:

1. **Enough time has passed** — at least **25 seconds** minimum, regardless of signal strength.
2. **Enough dots on the chart** — at least 20, scaled by BPH (formula: `max(20, BPH / 1200)`, which gives 24 for a 28,800 BPH watch).
3. **Dual stability check:**
   - **Bucket rate stability** — the last 8 bucket rate snapshots, after trimming the single highest and lowest values, span less than one quantization step (BPH-scaled).
   - **Native rate stability** — the last 8 Theil-Sen rates from the engine span ≤ **5 s/day**. This prevents converging while the regression is still drifting.

When all conditions are met, the measurement auto-stops and presents the final rate. If convergence hasn't been reached after **45 seconds**, the measurement times out and saves whatever rate is available, with a warning haptic.

### 12. What the User Sees

**The scatter chart:** Each dot represents one tick pair. The X axis is elapsed time, the Y axis is cumulative deviation in milliseconds. If the watch is perfect, dots form a flat line at 0. If it's running fast, they slope upward. The dashed yellow reference line shows the current rate.

**The HUD (top-right number):** The rate in seconds per day, computed by the Theil-Sen regression. This is the most accurate number we have.

**The saved result:** When the user taps Save, we store the Theil-Sen rate. This is what shows up on their watch's history chart and in their posts.

---

## Why Dots Look Quantized

The energy ring buffer runs at ~12,000 samples per second. Each tick's position is an integer index in this buffer (plus a fractional offset from interpolation). When we compute pair deviations, they come out as multiples of **0.083 ms** (1 ring sample / 12,000 Hz). Converted to s/day, that's steps of **7.2 s/day**.

Sub-sample interpolation reduces this somewhat, but the dots on the scatter chart still tend to cluster on these bands. The Theil-Sen regression sees through this quantization — it computes a smooth rate from the overall trend, not from individual dot positions.

Increasing the ring buffer sample rate (e.g., from 12 kHz to 24 kHz) would halve the quantization step to 3.6 s/day, making dots look smoother. The ring rate is now web-tunable (12 kHz to 48 kHz) for experimentation, though the default remains 12 kHz.

---

## Web-Tunable Parameters

All major engine parameters can be tuned from the web layer without an App Store update. The iOS app accepts these values via the JS-to-native bridge and clamps them to safe ranges:

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Ring buffer rate | 12,000 Hz | 12k–48k | Higher = finer quantization, more memory |
| Regression skip pairs | 5 | 0–30 | Pairs to exclude from start of regression |
| Regression min N | 10 | 3–50 | Minimum data points before showing rate |
| Wall elapsed minimum | 20s | 5–120s | Minimum time before allowing convergence |
| Stability window | 15s | 5–60s | Window for checking rate stability |
| Stability threshold | 3.0 s/day | 0.5–20 | Range to gain stability |
| Stability lose threshold | 5.0 s/day | 1–30 | Range to lose stability |
| Adaptive pair gate ceiling | 2.0 ms | 0.1–5 | Max pair deviation threshold |
| Adaptive pair gate floor | 1.0 ms | 0.05–2 | Min pair deviation threshold |
| Cold start threshold | 2.0 ms | 0.1–5 | Pair threshold before MAD is available |
| MAD multiplier | 3.0 | 1–10 | How many MADs above median to accept |
| Max tick deviation | 10.0 ms | 1–20 | Individual tick sanity limit |

---

## Summary of the Pipeline

```
Microphone (48 kHz raw audio)
    |
    v
High-pass filter (3 parallel: 4/6/8 kHz, 2nd-order Butterworth)
    |
    v
Energy ring buffer (~12 kHz, peak-hold downsampling)
    |
    v
Calibration (2s, p98 × 1.2 threshold, auto-recalibrate if no ticks)
    |
    v
BPH detection (Goertzel analysis + FFT autocorrelation fallback)
    |
    v
Tick detection (energy threshold + sub-sample parabolic interpolation)
    |
    v
Pair grouping (tick + tock → one pair, cancels beat error)
    |
    v
Adaptive pair gate (MAD-based, 1.0–2.0 ms range, rejects outlier pairs)
    |
    v
Cumulative pair deviation (running total of timing drift)
    |
    v
Theil-Sen regression (median of all pairwise slopes → rate)
    |
    v
Stability detection (3 s/day window for 15 seconds, hysteresis at 5 s/day)
    |
    v
JS convergence (25s minimum + dual stability check, 45s timeout)
    |
    v
Rate in seconds per day
```
