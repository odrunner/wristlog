# Email / SES Cutover Audit — 2026-07-30

Scope: the whole email path after the 2026-07-30 cutover from Resend to AWS SES v2 —
transport layer, all 7 senders, SES account + config set, DNS, SNS → webhook →
`email_events`, the broadcast queue, unsubscribe, and monitoring.

Everything below was verified against live AWS, live Supabase, and live DNS at audit
time. Nothing is inferred from the repo alone.

---

## Verified working

| Area | Evidence |
|---|---|
| No sender bypasses the switch | `grep -rn '_shared/\(ses\|resend\)' supabase/functions/*/index.ts` → 0 hits. All 7 (`send-email`, `send-broadcast`, `run-campaign`, `send-wear-reminders`, `send-report`, `new-user-alert`, `report-notify`) import `_shared/mailer.ts` |
| SES is genuinely live | `net._http_response` bodies carry SES v2 message IDs (`0101019fb66607e6-…-000000`), not Resend UUIDs |
| Account health | `ProductionAccessEnabled: true`, `EnforcementStatus: HEALTHY`, `SendingEnabled: true`, 50,000/day, 14/s, 103 sent in last 24h |
| Domain auth | `wrotate.com` verified; DKIM 3× CNAME live (RSA-2048); custom MAIL FROM `mail.wrotate.com` with MX → `feedback-smtp.us-west-2.amazonses.com` and `v=spf1 include:amazonses.com ~all`. SPF **and** DKIM align |
| Identity default config set | `wrotate-events` — the spec's "gap 1" (was `my-first-configuration-set`) is fixed |
| SNS → webhook | Subscription confirmed (1 confirmed, 0 pending); topic policy scoped by `AWS:SourceAccount` |
| `ses-webhook` hardening | token query param + topic-ARN check + full SNS SigV1/V2 signature verify + 300s replay window + `onConflict: sns_message_id` idempotent upsert. 300s ≫ SNS's 3×20s retry schedule, so valid retries aren't rejected as stale |
| Events flowing | 2026-07-31: 99 sent / 98 delivered / 74 opened |
| Broadcast queue | 695 rows, **all `sent`** — zero `pending`, zero `failed`. No residue from the 2026-07-25 incident |
| Batch-outcome guard | `resolveBatchOutcome()` folds `failed` into `deferred` on *any* non-retryable verdict; `isCredentialFailure()` defers 401/403. The 07-25 failure mode is closed |
| No suppression migration needed | **Zero** external bounces or complaints in `email_events` for all history → no Resend-era bad addresses to pre-suppress. SES suppression list is empty and correctly so |
| Unsubscribe | `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` on all 4 user-facing senders; `email-unsubscribe` reads query params and never checks `req.method`, so RFC 8058 POST works |
| From addresses | `hello@`, `notifications@`, `reports@` — all on the verified domain |
| IAM | Dedicated `wrotate-ses-sender` user, inline `ses-send-only` policy, single active key |
| Tests | 1624 unit tests pass (77 files); `npm run test:smoke` 6/6 |
| Cron | 3 jobs active, all recent runs succeeded |

---

## Findings

### 1. HIGH — Click tracking is still ON in live SES; the spec says it was removed

Commit `3875daf` (today, 20:30 PDT) states: *"Removed CLICK from the config set event
types… Applied and verified 2026-07-30 — `MatchingEventTypes` is now SEND, DELIVERY,
OPEN, BOUNCE, COMPLAINT."*

Live, right now:

```
$ aws sesv2 get-configuration-set-event-destinations \
    --configuration-set-name wrotate-events --region us-west-2 \
    --query 'EventDestinations[0].MatchingEventTypes'
["BOUNCE", "CLICK", "COMPLAINT", "DELIVERY", "OPEN", "SEND"]
```

And a `clicked` event fired at **2026-07-31 04:53:50 UTC** for subject
`"SES click-tracking check"` → `ozgurdogan@gmail.com`.

So SES is still rewriting every link in every outgoing email through `awstrack.me`.
`CLAUDE.md` also still documents click tracking as ON — so the two docs now contradict
each other and one of them is wrong.

**Action:** decide which state you want, apply it, and make `CLAUDE.md` and the spec
agree. To actually remove it:

```bash
aws sesv2 update-configuration-set-event-destination \
  --configuration-set-name wrotate-events \
  --event-destination-name wrotate-email-events \
  --event-destination 'Enabled=true,MatchingEventTypes=[SEND,DELIVERY,OPEN,BOUNCE,COMPLAINT],SnsDestination={TopicArn=arn:aws:sns:us-west-2:392424878015:wrotate-email-events}' \
  --region us-west-2
```

### 2. MEDIUM — No DMARC record

`_dmarc.wrotate.com` → NXDOMAIN.

DKIM and SPF both already align on the MAIL FROM domain, so a `p=none` policy carries
no delivery risk — it only turns on reporting. Gmail/Yahoo bulk-sender rules expect a
DMARC record to exist, and without one you have no visibility into anyone else sending
as `wrotate.com`.

**Action:** one Cloudflare TXT record —
`_dmarc` → `v=DMARC1; p=none; rua=mailto:dmarc@wrotate.com; fo=1`
(add a Cloudflare Email Routing rule for `dmarc@` first, or point `rua` at an address
that resolves). Move to `p=quarantine` after a few weeks of clean reports.

### 3. MEDIUM — SNS subscription has no dead-letter queue

Effective delivery policy on the topic: `numRetries: 3`, linear, `maxDelayTarget: 20`.
No `RedrivePolicy` on the subscription.

If `ses-webhook` is unavailable for more than ~60 seconds, those events are **dropped
permanently**. Those are the same `sent` rows that the broadcast drain quota and the
`_NofM` batch dedup key off — losing them means an over-generous quota and duplicate
emails to real users, with no error anywhere.

**Action:** create an SQS queue and attach it as the subscription's redrive target.

### 4. MEDIUM — No CloudWatch alarm on bounce or complaint rate

`aws cloudwatch describe-alarms --region us-west-2` → `[]`.

SES already publishes `Reputation.BounceRate` and `Reputation.ComplaintRate`, so the
metrics are there — nothing consumes them. Today's only monitoring is the 9:15am cost
report, which reads `email_events`. That shares a failure mode with finding 3: if the
SNS→webhook path breaks, `sent` **and** `bounced` both go to zero and the report renders
a healthy-looking section. An alarm reads SES directly and does not share that blind
spot.

**Action:** two alarms on `AWS/SES` `Reputation.BounceRate` ≥ 0.03 and
`Reputation.ComplaintRate` ≥ 0.0005, → an SNS topic with an email subscription.

### 5. MEDIUM — `test@wrotate.com` hard-bounced today; internal bounces are invisible to the admin tile

At `2026-07-31 04:15:11 UTC` a send to `test@wrotate.com` returned a **Permanent /
General** bounce. A resend of the same subject at 04:19:32 delivered fine, so whatever
the Cloudflare Email Routing fix was, it worked. The address did **not** land on the SES
suppression list — that is luck, not design; a Permanent bounce is exactly what SES
auto-suppresses on, and once suppressed all test-account email fails silently.

Separately: `admin_email_engagement()` excludes every `@wrotate.com` recipient by design,
so an internal-address bounce storm is invisible in the admin tile while still counting
toward SES's 5% suspension threshold. The cost report does **not** filter internal
addresses, so it is the safety net here — worth knowing which of the two you're reading.

**Action:** nothing urgent. Confirm the Cloudflare routing rules for `test@` / `test2@`
are permanent, and re-check the suppression list before the next UAT round:
`aws sesv2 get-suppressed-destination --email-address test@wrotate.com --region us-west-2`

### 6. LOW — `getSesQuota()` is dead code and would fail if called

No callers anywhere in `supabase/` or `scripts/`. The drain uses `DAILY_EMAIL_LIMIT`
plus an `email_events` count instead. And if it *were* called it would fail silently:
the IAM policy grants only `ses:SendEmail`, not `ses:GetAccount`, so the request 403s
and the function returns `null`.

**Action:** delete it, or wire it up and add `ses:GetAccount` to the policy. Leaving it
as-is is a trap for the next person who reaches for it.

### 7. LOW — Zero smoke-test coverage on the email path

`npm run test:smoke` covers 6 functions — `share-collection`, `share-post`,
`identify-watch` ×2, `search-watch-image`, `extract-url-meta`. None of the 7 senders the
cutover touched. `CLAUDE.md` says to run the smoke test after every deploy, but for this
change it proves nothing.

**Action:** add one case — `POST send-broadcast` with `x-campaign-secret` and
`{"drain": true, "quota_only": true}`, asserting `provider === "ses"`. It sends no mail
and would have caught a bad `EMAIL_PROVIDER` flip immediately.

### 8. LOW — `ReputationMetricsEnabled: false` on the config set

Account-level reputation metrics are published (that's what enforcement uses), but the
config set doesn't emit its own. Enabling it is free and gives per-set granularity if a
second config set is ever added.

### 9. LOW — Housekeeping

- `TlsPolicy: OPTIONAL` on `wrotate-events` — SES falls back to cleartext when the
  receiving MTA offers no STARTTLS. `REQUIRE` is stricter but bounces those recipients;
  `OPTIONAL` is the defensible default. Noting it, not recommending a change.
- Leftover `my-first-configuration-set` — unused, safe to delete.
- `click.wrotate.com` CNAME still in Cloudflare (the spec flags it) — unused either way.
- `CLAUDE.md`'s pg_cron section documents jobs 1 and 3 but not job 5,
  `drain-broadcast-queue` (`30 21 * * *`).
- 2 of 43 `net._http_response` rows in the last 7 days have `status_code: null` (no
  response captured). Both on idempotent reminder paths, so no user impact — worth a
  glance if the ratio grows.

---

## Not verified

- **Whether replies to `hello@` / `notifications@` / `reports@` are routed.** Cloudflare
  holds the `wrotate.com` MX and `CLAUDE.md` says catch-all is disabled/drop. If those
  three have no explicit routing rule, user replies are silently discarded. Requires
  Cloudflare access to confirm.

---

## Resolution — 2026-07-31

All findings actioned the same night. Verified live, not assumed.

| # | Status | Evidence |
|---|---|---|
| 1 HIGH — click tracking contradiction | **NOT A DEFECT (stale)** | The audit ran between two changes. Click tracking was briefly removed, then deliberately re-enabled on the default `awstrack.me` domain (commit `bc6843e`) once it was clear a *branded* redirect needs CloudFront + ACM but the *default* one costs nothing. Spec, `CLAUDE.md` and live SES now all agree it is ON. Verified: `sent → delivered → clicked`. |
| 2 MED — no DMARC | **FIXED** | `_dmarc.wrotate.com` → `v=DMARC1; p=none; rua=mailto:dmarc@wrotate.com; fo=1`, resolving via 1.1.1.1 and 8.8.8.8. A `dmarc@` routing rule was added so `rua` lands. |
| 3 MED — no SNS DLQ | **FIXED** | SQS `wrotate-email-events-dlq` (14-day retention), queue policy scoped to the topic ARN, attached as the subscription's `RedrivePolicy`. A webhook outage now parks events instead of dropping them — which is what protects the drain quota and the `_NofM` double-send guard. |
| 4 MED — no CloudWatch alarm | **FIXED** | `wrotate-ses-bounce-rate` (≥3%) and `wrotate-ses-complaint-rate` (≥0.05%) on `AWS/SES` reputation metrics → SNS topic `wrotate-ses-alarms`, email subscription **confirmed**. `treatMissingData: notBreaching` so low volume does not false-fire. Reads SES directly, so it survives the webhook outage in finding 3. |
| 5 MED — test@ bounce / internal bounces invisible | **FIXED** | Cloudflare routing rules now exist and are Active for `test@`, `test2@`, `notifications@`, `reports@`, `dmarc@`. Forwarding confirmed by a real external send. Suppression list cleared and currently **EMPTY**; `EnforcementStatus: HEALTHY`. |
| 6 LOW — `getSesQuota()` dead + would 403 | **FIXED** | Deleted (commit `016df9b`), replaced by a comment explaining why it could not have worked and why `DAILY_EMAIL_LIMIT` must NOT be wired to the real SES quota. |
| 7 LOW — no smoke coverage of email | **FIXED** | `send-broadcast` `quota_only` case added. With `CAMPAIGN_TRIGGER_SECRET` it asserts the live provider is `ses`; without it, it still proves the function is deployed and its auth gate answers. Both paths verified, 7/7 passing. |
| 8 LOW — reputation metrics off | **FIXED** | `ReputationMetricsEnabled: true` on `wrotate-events`. |
| 9 LOW — housekeeping | **PARTLY DONE** | `click.wrotate.com` CNAME deleted. Drain cron job 5 now documented in `CLAUDE.md`. `TlsPolicy: OPTIONAL` deliberately left (the audit's own reasoning). `my-first-configuration-set` left in place — unused and harmless. |
| Not verified — reply routing | **WAS A REAL GAP, NOW FIXED** | The audit could not check this. It was real: `notifications@` and `reports@` — the addresses users actually reply to — had no routing rule while catch-all was disabled, so every reply was silently discarded. Both now route to the founder and forwarding is confirmed. |

**Self-inflicted note:** verifying finding 5 by sending SES probes to unrouted `@wrotate.com`
addresses generated 5 hard bounces, briefly pushing the 24h bounce rate to 2.7% against a 5%
suspension threshold — and against the 3% alarm set up an hour earlier. It cleared with normal
volume and the suppression list is empty. **Do not test mailbox routing by sending through SES.**
Send from an external mailbox to the address instead; it exercises the same path and cannot
damage sending reputation.
