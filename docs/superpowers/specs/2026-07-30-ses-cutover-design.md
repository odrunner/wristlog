# AWS SES Cutover — Design

**Date:** 2026-07-30
**Status:** Approved, ready for implementation planning
**Supersedes the shipping decision in:** `docs/superpowers/plans/2026-07-19-resend-to-ses-migration.md` (that plan's Tasks 2–4 are already shipped; its Tasks 5–7 were blocked by the denial and are replaced by this document)

## Context

AWS granted production access on 2026-07-30:

> Your new sending quota is 50,000 messages per day. Your maximum send rate is now 14 messages per second. We have also moved your account out of the Amazon SES sandbox.

This reverses the 2026-07-26 denial that forced a rollback to Resend. It is **not a migration** — the SES pipeline was built, tested, and deployed in July. This is a **cutover**: flipping four user-facing senders and retiring Resend without repeating the 2026-07-25 incident.

### What already exists

| Component | State |
|---|---|
| `_shared/ses.ts` + `_shared/ses-lib.ts` | Built, tested. SigV4 via `aws4fetch`, retry with `retryable` classification, batch pacing |
| `ses-webhook` | Deployed. SNS signature verification, replay protection, MessageId dedup |
| `new-user-alert`, `report-notify`, `send-report` | **Live on SES** — worked through the sandbox period because their recipients are verified |
| `send-email`, `send-wear-reminders`, `run-campaign`, `send-broadcast` | On Resend. Each has a marked, one-line provider import |
| `_shared/resend.ts` | Interface-compatible with `ses.ts` — this is why the cutover is small |

### The failure this design guards against

On 2026-07-25 the nightly `drain-broadcast-queue` ran against an SES build of `send-broadcast` while the account was still in sandbox. SES rejected the recipients with a permanent 400; the drain marked 22 rows `failed`. The drain only re-selects `pending`, so those recipients were dropped for good.

The retryable/deferred split shipped since then fixes the transient case. **A residual trap remains:** `isRetryableStatus` classifies 401/403 as permanent. Wrong SES credentials at drain time would mark rows `failed` and drop them — the same outcome, a different trigger.

### Live state at design time

- 88 rows `pending` in `broadcast_queue`, draining ~90/night against Resend's 100/day cap
- `email_events` over 90 days: 2,505 `sent`, 2,477 `delivered`, 1,534 `opened`, 118 `clicked`, 13 `unsubscribed`, **0 `bounced`, 0 `complained`**
- Steady-state volume ~1,300 emails/month; broadcast days pin at the Resend cap

## Goals

1. Move all user-facing email to SES with a rollback measured in seconds, not deploys
2. Remove the burst ceiling — a ~400-recipient broadcast sends in one night instead of four
3. Preserve every existing metric across the provider change
4. Start monitoring bounce/complaint rates, which now determine account survival

## Non-goals

- Changing email content, templates, `FROM` addresses, or send triggers
- Any client-side JS/HTML change (so no `sw.js` cache bump)
- Changing the `email_events` schema
- Re-opening the provider choice

---

## 1. `_shared/mailer.ts` — single dispatch point

A thin module resolving an `EMAIL_PROVIDER` secret to a concrete provider:

```ts
// _shared/mailer.ts
const P = Deno.env.get("EMAIL_PROVIDER") ?? "resend";
export const sendEmail = P === "ses" ? sendSesEmail : sendResendEmail;
export const sendBatch = P === "ses" ? sendSesBatch : sendResendBatch;
export const currentProvider = P;
```

**Defaults to `resend`.** An unset or misspelled secret falls back to the known-good provider rather than to the one being cut over to.

`ses.ts` and `resend.ts` are untouched — they already share an interface.

**All seven senders import from `mailer.ts`**, including the three admin senders currently importing `ses.ts` directly. One provider answer for the whole system; no split-brain state where admin mail and user mail disagree about who is sending.

`currentProvider` is reported by `send-broadcast`'s existing `quota_only` introspection response (which currently hardcodes `provider: "resend"`). This makes the live provider **checkable** rather than inferred from grepping a deployed bundle.

## 2. Cutover sequence

Each gate must produce its proof before the next begins.

| Gate | Action | Proof required |
|---|---|---|
| **A** | `aws login`; confirm region, DKIM/MAIL FROM verified, config set correct, secrets set | `sesv2 get-account` shows out-of-sandbox and 50k/day; config-set checks in §4 pass |
| **B** | Ship `mailer.ts` + all 7 senders, still `EMAIL_PROVIDER=resend` | Full suite green; deployed behaviour byte-for-byte equivalent to today |
| **C** | Flip `EMAIL_PROVIDER=ses`; UAT `send-report` to ozgurdogan@gmail.com | Email arrives, DKIM passes in "show original", `sent` + `delivered` rows in `email_events` |
| **D** | UAT `send-email` across both test accounts | testuser2 comments on a private testuser post → notification email via SES; events land |
| **E** | `send-broadcast` with `test_email`, then a `quota_only` call | Delivery confirmed; response reports `provider: "ses"` and the new budget |
| **F** | Let the nightly drain take the pending queue | Rows move to `sent`, not `failed`; queue clears in one run |

Rollback at any gate: `npx supabase secrets set EMAIL_PROVIDER=resend`. Seconds, no deploy, no revert commit.

Gate B is deliberately a no-op deploy for user-facing mail. It separates "the refactor is correct" from "SES works", so a failure at gate C has exactly one possible cause.

**One deliberate side effect at gate B:** because all seven senders now resolve through `mailer.ts`, and gate B holds `EMAIL_PROVIDER=resend`, the three admin senders temporarily move *from* SES *to* Resend — then back to SES at gate C. This is accepted. Admin mail goes to verified internal addresses only, both providers deliver it today, and the alternative (exempting admin senders from the switch) reintroduces exactly the split-brain state §1 exists to prevent. `RESEND_API_KEY` must therefore still be valid at gate B.

## 3. Closing the 403 trap

Two changes to the drain path:

1. **401/403 become deferred, not failed.** A credentials rejection is an operator problem, not a bad recipient. Affected rows stay `pending` for a later drain. This is a change to how the *drain* treats the status, not to `isRetryableStatus` itself — a permanent classification is still correct for retry-within-a-send, where hammering a bad key wastes nothing but time.

2. **Circuit breaker.** If the first batch of a drain returns 100% failures, abort the run and leave every remaining row `pending`. Caps a misconfiguration at one batch instead of the whole queue.

Together these mean the worst case of a botched cutover is a delayed broadcast, never a dropped recipient.

## 4. Metrics continuity

Every metric keys off `email_events`. The row shape does not change; what fills it does.

### Must verify before flipping (gate A)

- **Config set `wrotate-events` publishes Send, Delivery, Open, Click, Bounce, and Complaint to SNS.** `sent` events are load-bearing beyond reporting — the drain quota (`used_today`) and the `_NofM` batch dedup both read `event_type='sent'`. A config set that omits Send events silently breaks double-send protection.
- **Open tracking is ON.** If it is off, `opened` stops entirely and the engagement dashboard reads as a total collapse (1,534 opens/90d → 0). This is the highest-risk metrics item and it is invisible until someone looks at the dashboard.
- Open counting stays correct: `admin_email_engagement()` uses `count(DISTINCT email_id)` for opens because opens fire repeatedly (prefetch, re-opens). SES emits one Open event per open, same as Resend, so the existing dedup holds.

### Changes

- **Custom tracking domain `click.wrotate.com`** (one CNAME). SES otherwise rewrites every link through `awstrack.me`; a custom domain keeps links on-brand, avoids the deliverability cost of an unfamiliar redirect host, and keeps the `clicked` metric alive.
- **Event volume grows.** SES emits more events per email than Resend — intake rose 4.6× during the July SES week, per the comment in `admin_email_engagement()`. The 90-day bound added at that time caps query cost; table growth should be watched but needs no action now.

### New: bounce and complaint monitoring

SES suspends accounts above **5% bounce** or **0.1% complaint**. `admin_email_engagement()` already aggregates `bounced`/`complained` — it has simply always returned 0 because Resend never fed those events. SES will start populating them.

Both surfaces:

- **`scripts/cost-report.py`** gains a line: 24h and 7d bounce and complaint rates against the thresholds. Reuses the 9:15am job already read daily — no new LaunchAgent. Per CLAUDE.md, the deployed copy at `~/.local/bin/wrotate-cost-report.py` must be updated after editing.
- **Admin engagement tab** gains a health tile with the same figures. The RPC already aggregates them, so this is largely display work.

### Unaffected

`email-unsubscribe` writes `unsubscribed` rows directly, independent of provider. Unsub metrics carry across the cutover untouched.

### Reading the transition week

The by-subject engagement table spans a 90-day window, so during cutover a single subject may aggregate events from both providers. Row shape is identical, so the figures stay correct — but a subject straddling the flip mixes provider behaviour and should be read with that in mind.

## 5. Drain cap

`DAILY_EMAIL_LIMIT`: **100 → 500**.

The constant's meaning changes. It was Resend's free-tier quota; under a 50k/day account it is blast-radius protection — a ceiling a runaway loop cannot exceed before the nightly cap stops it. 500 lets any realistic single broadcast (~400 recipients) complete in one night, which is the entire user-visible point of this project, while capping a bug at ~1% of the SES quota.

The comment above the constant must be updated to say this. A stale "Resend's daily cap" comment on a 500 value is worse than no comment.

## 6. Resend retirement

Resend remains the rollback path for **30 days** after gate F. Then:

- Delete `supabase/functions/resend-webhook/`
- Unset `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- Delete `_shared/resend.ts`, `_shared/resend-lib.ts` and their tests
- `mailer.ts` collapses to a direct re-export of `ses.ts`
- Delete the Resend dashboard webhook and API key; close the account

**Separately:** check whether Supabase Auth SMTP points at Resend (`smtp.resend.com`). If so it needs its own SES SMTP credentials — it is not covered by the edge-function cutover. If Auth uses Supabase's built-in mailer, nothing to do.

## 7. Testing

- New `mailer-lib.test.ts`: provider resolution, and that an unset or unknown `EMAIL_PROVIDER` resolves to Resend
- Existing suites stay green throughout: `npm test`, `npm run test:functions`, `npm run test:e2e`
- `npm run test:smoke` after every edge-function deploy, per CLAUDE.md
- Gate B's proof is specifically that the full suite passes with the refactor in place and behaviour unchanged

## Gate A results — verified 2026-07-30

AWS account `392424878015`, region **`us-west-2`** (confirmed; the July plan document's `us-east-1` is stale and should be disregarded).

**Green — no action needed:**

| Check | Result |
|---|---|
| Production access | `ProductionAccessEnabled: true`, case `178450792800650` GRANTED |
| Quota | 50,000/day, 14/sec, `SentLast24Hours: 6` (the admin senders) |
| Account health | `EnforcementStatus: HEALTHY`, `SendingEnabled: true` |
| Domain identity | `wrotate.com` verified; DKIM `SUCCESS`, RSA_2048 |
| MAIL FROM | `mail.wrotate.com`, status `SUCCESS` |
| Config set events | `wrotate-events` publishes SEND, DELIVERY, OPEN, CLICK, BOUNCE, COMPLAINT to SNS |
| **Open/click tracking** | **Active** — OPEN and CLICK are in `MatchingEventTypes`, which is what enables tracking. The highest-risk metrics item in §4 is clear |
| SNS subscription | Confirmed (real ARN, not `PendingConfirmation`), pointing at the deployed `ses-webhook` with its token |
| Suppression list | Empty — clean slate |
| Auto-suppression | BOUNCE and COMPLAINT enabled account-wide |

**Two config gaps found — fold into the implementation plan:**

1. **The `wrotate.com` identity's default configuration set is `my-first-configuration-set`, not `wrotate-events`.** Sends are unaffected today because `ses.ts` passes `ConfigurationSetName` explicitly on every call. But it is a live trap: any send path that ever omits the explicit config set silently lands on a set with no event destination, producing zero events — which breaks the drain quota and `_NofM` dedup with no error anywhere. Set the identity default to `wrotate-events` as defence in depth.
2. **No custom tracking domain configured** (`TrackingOptions` absent), so click links currently rewrite through `awstrack.me`. Confirms the `click.wrotate.com` work in §4 is outstanding, not already done.

**Minor, optional:**

- `ReputationMetricsEnabled: false` on the config set — no per-config-set reputation metrics in CloudWatch. §4's monitoring computes rates from `email_events`, so this is not required; enabling it is cheap and adds AWS's own view.
- `TlsPolicy: OPTIONAL` — could be `REQUIRE`. Out of scope for this project; noted so it is not forgotten.
- Account `MailType` is registered as `TRANSACTIONAL`, while announcements and onboarding campaigns are roughly 83% of send volume. SES does not enforce this the way some providers do, but it is what the granted case describes. Worth knowing, not worth acting on now.

**Still open:**

- **Supabase Auth SMTP provider** (see §6) — not checkable via the AWS CLI.

## Risks

| Risk | Mitigation |
|---|---|
| Open tracking off → engagement appears to collapse | Explicit gate A check before any flip |
| Bad SES credentials at drain time drop recipients | §3: 401/403 deferred + circuit breaker |
| Config set missing Send events → `_NofM` dedup double-sends | Explicit gate A check; `sent` dependency documented |
| Cutover breaks something subtle in a sender | Gate B ships the refactor with no provider change, isolating the variable |
| Domain reputation on new sending IPs | Volume is ~1,300/month; the 500/day cap keeps ramp gradual. Bounce/complaint monitoring (§4) is the early-warning system |
