# App Welcome Trim — shipped 2026-10-15 (sw v1323)

**Change:** inside the native iOS shell (webkit auth bridge present), the
landing no longer re-pitches: the 01/02/03 feature block and divider are
hidden, the tagline becomes "Sign in to start your collection — 100% free.",
and Continue with Apple moves above Google. The web landing is untouched
(`compare.sh landing` = 0; the comparator pairs elements by document order,
so the native script must stay in its slot between the badge and the Google
button). Rationale: 90% of signups come through the app (64 of 71 in the 30
days to 10-15), and those users already read this pitch on the App Store page.

**Instrumentation added:** `landing_page_viewed` now carries `native:
true|false` (PostHog), so in-app welcome views are countable from 10-15 on.

## Baseline (before) — app-side signups (profiles with a device_tokens row)

14 days 2026-10-02 → 2026-10-15: 2,5,1,2,2,5,3,1,2,1,2,1,3,5 —
**35 signups / 14 days = 2.5/day.**

## How to evaluate (with the demo test, on/after 2026-10-29)

```sql
SELECT p.created_at::date AS day, count(*) AS app_signups
FROM profiles p
WHERE p.created_at >= current_date - 13
  AND EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = p.id)
GROUP BY 1 ORDER BY 1;
```

- Primary: app signups/day vs 2.5/day baseline.
- Better denominators: PostHog `landing_page_viewed` where `native = true`
  (welcome views → signup conversion; only measurable after, no before), and
  App Store Connect download units for the two windows (user checks ASC).
- Caveat: the device_tokens split slightly undercounts "app" (a user who
  signs up in-app but denies the token row never appears); the bias is the
  same before and after, so the comparison holds.
- Runs concurrently with the demo-entry removal test
  (`demo-entry-removal-2026-10-15.md`), which evaluates on **web-only**
  signups — the two tests are disjoint by this split.

## Outcome

_(fill in at evaluation)_
