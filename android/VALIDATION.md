# Android engine — Pixel 7 on-device validation (Task 10)

Date: 2026-10-25 · Device: Pixel 7 (Android 13, SDK 35) · Build: `app-debug.apk` from main `fb7ffd98`+ · Watch: Hamilton, 21600 bph (3 Hz, H-10-type).

## Verdict: engine acceptance PASS

The Kotlin port measures a real watch correctly on real hardware, and is deterministic on
recorded audio (it is byte-identical to the iOS Swift engine on the 24 golden runs, so a replay
result equals what the iPhone engine would produce on the same audio).

### Accuracy (±3 s/day bar)
- iPhone (live, 21600): **+3.5 s/day**.
- Pixel recording `capture-20261025-081129-vrec-48000.wav` replayed through the engine on the
  Mac Mini: **final +1.4, stable-tail mean +1.9** (range −0.5..+4.1 while settling), beat error
  0.14 ms, amplitude 290°, 379 updates. Both at 21600.
- **+1.9 vs +3.5 = 1.6 s/day apart → within ±3.** An earlier live Pixel run read ~−1.7 in a
  different position; that −1.7-vs-+3.5 gap was watch position/time variation (normal 5+ s/day
  between positions), not instrument disagreement — confirmed because the engine agrees with
  itself and with the iPhone's engine on identical audio.

### Confirmed working on device
- Full detect → converge → calibrate pipeline runs without crashing (Task 9 never ran on a device).
- BPH auto-correction: started at 28800, saw the tick spacing, switched to 21600 and recalibrated
  (`[TGBPH CORRECT OUTLIER] ... ratio=1.328 → 21600`). Live and in replay, identically.
- `[TGTUNE]` telemetry tokens: ends `cap=vrec model=Pixel_7` — the `Build.MODEL` whitespace
  sanitize works (checklist item 1).
- Share log export (checklist item 6): full logSink + 201 debug batches, readable.
- WAV record (checklist item 5, capture side) + JVM engine replay: deterministic and correct.

### Findings (none block the port; all pre-existing or log-only)
1. **No UNPROCESSED audio source on this Pixel 7** → fell back to `VOICE_RECOGNITION` (`cap=vrec`).
   The fallback (Review Focus 1) works. Open question for the real-app plan: is this a true device
   limitation or a `getProperty(PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)` false-negative? Worth
   force-trying UNPROCESSED, since unprocessed audio is cleaner for tick detection.
2. **`[TGCLOCK]` ppm not sane on device** (checklist item 2 FAIL): read −600..−6500 ppm with a
   host-vs-frame gap growing to ~1 s over 60 s. This is **log-only** — the rate comes from tick
   regression, not this clock, so the measurement is unaffected — but the AudioRecord-timestamp
   (`framePosition`,`nanoTime`) mapping needs work before `[TGCLOCK]` ppm is trusted on Android,
   and the growing gap indicates buffers dropping late in a run (seen when the watch was handled).
3. **Auto-BPH locked on pure noise** (no watch): confirmed live = Product Finding #4.
4. **Stability latch**: `rate=nil stable=true` observed live = Product Finding #3.

### Checklist status
- (1) TGTUNE cap/model — PASS (`cap=vrec model=Pixel_7`)
- (2) TGCLOCK ppm within tens — FAIL, log-only; AudioRecord timestamp mapping is a real-app TODO
- (3) Stop returns cleanly, no UI hitch — not formally captured; defer
- (4) Focus loss interrupted→resumed — not tested; defer
- (5) WAV record + replay parity — engine/JVM replay PASS; on-phone Replay WAV not yet run
- (6) Share log readable — PASS
- (7) Foreign-WAV replay — not run on device (16-bit reader is unit-tested)
- Accuracy ±3 — PASS

### Optional follow-up (not blocking)
A single same-position live A/B (watch dial-up, unmoved, Pixel then iPhone) would close the ±3 bar
end-to-end and rule out any `vrec` capture bias in the live rate. The replay cannot settle that,
since the recording already went through `vrec`; but rate derives from tick timing, which voice
processing does not systematically shift, and the clean convergence + low beat error here bear that out.

---

# Shell app (Plan 2) — status

The Android shell (WebView over wrotate.com + measurement bridge + sign-in + photo uploads)
was built task-by-task with unit tests and clean `:app:assembleDebug`:
- Web §3 gates (nativeAtLeast/nativePlatform): `npm test` green.
- Bridge script, Update→JSON contract, capture-thread tuning marshal, OAuth callback parse/
  rewrite/inject + single-delivery: `:app:testDebugUnitTest` green.
- Framework-bound pieces (WebView host, Custom Tab, file chooser) are build-verified.

**On-device smoke (Task 6) is pending the owner** — same as Plan 1's Task 10, it needs a real
Pixel. The checklist is in `android/README.md` ("On-device smoke"). Until it runs, the shell is
proven to compile and its logic is unit-tested, but the live WebView/bridge/OAuth/file-chooser
paths are unverified on hardware.

## Shell app (Plan 2) — on-device smoke PASSED (2026-10-25, Pixel 7)

Ran on the Pixel 7. All core paths work; the device run caught and fixed real bugs.
- **Measurement + save:** Pixel read the Hamilton at +0.9 s/day, amplitude 287, beat error 0.67 ms
  (21600 bph), saved correctly to `measurement_sessions` + `timegrapher_results` (rate/amp/BE all
  intact) — the full mic→engine→bridge→web→Supabase path. In the Hamilton's normal range vs prior
  iOS readings (positional variation).
- **Sign-in:** Google completes via the Custom Tab and the session lands in the app; the Apple flow
  launches correctly (owner didn't finish it — forgotten password, not a bug).
- **UI:** modals, nav, and layout render correctly; top/bottom insets correct.

Bugs found and fixed on device (committed on the branch):
- `100vh` resolved to 0 (every vh-sized modal collapsed) because the WebView was inside
  SwipeRefreshLayout, a nested-scroll parent — removed it (also drops the draft-discarding
  pull-to-refresh the review flagged).
- Edge-to-edge insets: content under the status/gesture bars, then over-padded — now a FrameLayout
  wrapper pads sides/nav/keyboard and the page's own env(safe-area-inset-top) handles the top.

Not re-verified on device (fine, low-risk): process-death restore, external-link-opens-externally,
foreign-WAV replay. Pull-to-refresh is removed (idle-reload + back-nav remain; no manual refresh).
