# Push value loop — design (2026-08-16)

Source discussion: `docs/usage-review-2026-08-15.md` §3 P1/P2 and the follow-up on push.

## Why
- Push reminders → a wear log within 30 h at 32%; email 13%. But only 27 of 137 monthly actives can receive push, and every iOS install that declines the one-shot OS dialog is unreachable forever.
- The 2.3 in-app primer failed (52 shown / 2 tapped). 2.5 (in review) restores the cold ask (~28%). Neither changes the ceiling.
- 75% of converged measurements are never saved (60 d: 1,652 converged sessions vs 419 saved; 95 users measured and never saved). Every session leaves a `session_summary` in `timegrapher_tick_logs` with `user_id`, `watch_id`, `native_rate`, `converged`, `stop_reason`.

## The experience
1. **No dialog at sign-in.** The next iOS build asks for *provisional* authorization — iOS grants silently. Notifications arrive quietly in Notification Center with iOS's own **Keep / Turn Off** buttons. That is the ask.
2. **First notification type — daily wear reminder, watch-specific.** "Wearing the Omega Seamaster again today? Tap to log it." Tap → app opens on Track with a one-tap **Log it / Different watch** banner. The same banner appears on Track / on foreground after 5 pm local for anyone with a log in the last 14 days and none today (push or not, any platform).
3. **Second notification type — re-measure / drift.** Built from `session_summary`, not saved readings. First: "You measured your Speedmaster at +6.2 s/d on Aug 2 — re-measure to see if it's holding" (21–60 days after the last converged session on that watch, no session on it in the last 21 days, ≤1 per user per 30 days). Once a watch has two converged sessions ≥14 days apart the copy becomes "Your Speedmaster is running +6.2 s/d — 4.0 s/d slower than in July." Push only.
4. **Unsaved readings in-app.** On a watch's accuracy panel: "Unsaved readings (n)" — converged sessions from the last 30 days that were never saved — each with **Keep** / ✕.
5. **Deferred hard ask.** Only for users still on quiet delivery: when the app was opened from a notification tap and the user then logs a wear or completes a measurement, fire the OS dialog once. Never at sign-in, never from a modal.
6. **Denied recovery.** Notifications settings row → "Off — turn on in Settings" deep-links to WRotate's own notification pane (`openNotificationSettingsURLString`).
7. **Removed:** the in-app push primer modal. **Unchanged:** email reminders for people without push.

## Metrics
- New iOS installs with a device token within 7 days (target ~100% on the provisional build; 28% today on 2.5).
- Keep-prominent vs turned-off at day 30 (from foreground status logging).
- % of monthly loggers with ≥3 logs (42% now).
- Saved readings / converged sessions (25% now).
- Re-measure push → measurement within 48 h.

## Constraints
- Web/DB/edge pieces ship first and work on every current build; native pieces ride the post-2.5 build.
- No push payload `w.route` values the current native switch can't handle (unknown routes open the bell) until the generic fallback ships natively.
- Never bulk-read `timegrapher_tick_logs` from PostgREST; capture at write time with a trigger, backfill server-side in weekly chunks.
- Copy uses "we"; CTAs in email go to `https://wrotate.com/open`.
