// send-broadcast — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// Signup-window cohorts. Each cohort maps to an optional [gte, lt) created_at range.
export const COHORTS: Record<string, { gte?: string; lt?: string }> = {
  pre_april: { lt: "2026-04-01T00:00:00Z" },
  april: { gte: "2026-04-01T00:00:00Z", lt: "2026-05-01T00:00:00Z" },
  may: { gte: "2026-05-01T00:00:00Z", lt: "2026-06-01T00:00:00Z" },
};

// Date-windowed broadcast segments: created_at >= gte with no upper bound ("to now").
// Unlike COHORTS (re-engagement blasts → dormant-only, campaign-tracked), these are
// plain UI segments that go to every opted-in user in the window. The batch suffix
// ("_<n>of<m>") is stripped before lookup.
export const SEGMENT_DATE_GTE: Record<string, string> = {
  may_onward: "2026-05-01T00:00:00Z",
};

// Return the created_at >= filter for a (possibly batched) date-windowed segment, or null.
export function segmentDateGte(segment: string): string | null {
  const base = segment.replace(/_\d+of\d+$/, "");
  return SEGMENT_DATE_GTE[base] ?? null;
}

// Single-user segment: "uid:<uuid>" targets exactly one profile by id (e.g. a
// personal win-back to one lapsed user). Returns the uuid, or null when the
// segment isn't a uid segment. Opt-in/suspended filters still apply downstream.
export function segmentUserId(segment: string): string | null {
  const m = /^uid:([0-9a-fA-F-]{36})$/.exec(segment);
  return m ? m[1] : null;
}

// Whitelist of recognized segments. An unknown/typo'd segment used to fall through
// batchSegment's pass-through and silently blast EVERY opted-in user, so anything
// not matched here is rejected by validateBroadcastInput.
export function isKnownSegment(segment: string | undefined | null): boolean {
  if (!segment || segment === "all") return true;
  if (segment === "never_measured") return true;
  if (segment === "one_done_winback") return true;
  if (segment === "never_logged") return true;
  if (segment === "batch_1" || segment === "batch_2" || segment === "batch_3") return true;
  if (segmentUserId(segment)) return true;                 // uid:<uuid>
  const hasSuffix = /_\d+of\d+$/.test(segment);
  const base = segment.replace(/_\d+of\d+$/, "");          // strip optional _NofM
  if (SEGMENT_DATE_GTE[base]) {                            // date-windowed (± batched)
    return hasSuffix ? parseBatchSuffix(segment) !== null : true; // reject malformed NofM
  }
  return false;
}

// Strip script/embed/handler attributes + dangerous URI schemes from admin HTML.
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript\s*:/gi, "blocked:")
    .replace(/vbscript\s*:/gi, "blocked:");
}

// Validate the broadcast request body. Returns an error string (matching the
// caller's messages) or null when valid. Mirrors the order of checks in index.ts.
export function validateBroadcastInput(
  input: { subject?: unknown; html?: unknown; cohort?: string; campaign_id?: unknown; segment?: string },
): string | null {
  if (!input.subject || !input.html) {
    return "subject and html are required";
  }
  if (input.cohort && !COHORTS[input.cohort]) {
    return `Unknown cohort: ${input.cohort}`;
  }
  if (input.segment && !isKnownSegment(input.segment)) {
    return `Unknown segment: ${input.segment}`;
  }
  if (input.cohort && !input.campaign_id) {
    return "campaign_id is required when cohort is set";
  }
  if (typeof input.html === "string" && input.html.length > 512000) {
    return "Email body too large (max 500KB)";
  }
  return null;
}

type Profile = { id: string; email_prefs?: { updates?: boolean } | null; created_at?: string };

// Keep only profiles still opted in to "Updates & new features" (default: opted-in).
export function filterOptedIn<T extends { email_prefs?: { updates?: boolean } | null }>(
  profiles: T[],
): T[] {
  return (profiles || []).filter((p) => {
    const prefs = p.email_prefs || {};
    return prefs.updates !== false;
  });
}

// Drop profiles whose id is in the excluded set (internal accounts / already-sent).
export function excludeIds<T extends { id: string }>(profiles: T[], excludedIds: Iterable<string>): T[] {
  const set = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  return (profiles || []).filter((p) => !set.has(p.id));
}

// Inverse of excludeIds: keep only profiles whose id is in the list. Used to
// intersect the eligible set with a server-resolved segment (see
// one_and_done_winback_users). An empty id list correctly yields an empty segment.
export function keepIds<T extends { id: string }>(profiles: T[], keptIds: Iterable<string>): T[] {
  const set = keptIds instanceof Set ? keptIds : new Set(keptIds);
  return (profiles || []).filter((p) => set.has(p.id));
}

// "never_measured" segment: drop anyone who has a measurement row.
export function filterNeverMeasured<T extends { id: string }>(
  profiles: T[],
  measuredUserIds: Iterable<string | null | undefined>,
): T[] {
  const set = new Set([...measuredUserIds].filter(Boolean) as string[]);
  return (profiles || []).filter((p) => !set.has(p.id));
}

// Dormant predicate for cohort blasts: true if the user has NOT signed in since
// the cutoff (i.e. they are dormant and should receive the email).
export function isDormant(lastSignInAt: string | null | undefined, dormantCutoffMs: number): boolean {
  const lastSignIn = lastSignInAt ? new Date(lastSignInAt).getTime() : 0;
  return lastSignIn < dormantCutoffMs;
}

// 21-day dormancy cutoff in ms for a given "now".
export function dormantCutoffMs(nowMs: number): number {
  return nowMs - 21 * 24 * 60 * 60 * 1000;
}

// Normalize a caller-supplied limit to a positive integer, or null when absent/invalid.
export function effectiveLimit(limit: unknown): number | null {
  return typeof limit === "number" && limit > 0 ? Math.floor(limit) : null;
}

// Cap recipients to the effective limit (only when the limit is smaller than the list).
export function capRecipients<T>(recipients: T[], limit: number | null): T[] {
  if (limit !== null && limit < recipients.length) {
    return recipients.slice(0, limit);
  }
  return recipients;
}

// Parse a "_<n>of<m>" batch suffix (e.g. "may_onward_2of2") → { num, count },
// or null when the segment isn't batched or the suffix is invalid.
export function parseBatchSuffix(segment: string): { num: number; count: number } | null {
  const m = /_(\d+)of(\d+)$/.exec(segment);
  if (!m) return null;
  const num = parseInt(m[1]);
  const count = parseInt(m[2]);
  return num >= 1 && count >= 1 && num <= count ? { num, count } : null;
}

// Drop recipients whose email already received this campaign (case-insensitive).
// Batched sends exclude by actual send history (email_events) rather than by
// list position: the old positional slice of an unordered, still-growing list
// could re-send to batch-1 users or skip users entirely between batch runs.
export function excludeAlreadyEmailed<T extends { email: string }>(
  recipients: T[],
  sentEmails: Iterable<string | null | undefined>,
): T[] {
  const set = new Set([...sentEmails].filter(Boolean).map((e) => (e as string).toLowerCase()));
  return recipients.filter((r) => !set.has(r.email.toLowerCase()));
}

// Batch n of m takes the next 1/(m-n+1) chunk of the not-yet-sent list — the
// remaining list shrinks as earlier batches are excluded, so the last batch
// always takes everything left (no user can be skipped, none sent twice).
export function nextBatchSlice<T>(recipients: T[], num: number, count: number): T[] {
  return recipients.slice(0, Math.ceil(recipients.length / (count - num + 1)));
}

// Slice recipients into one roughly-equal batch (legacy "batch_1/2/3" 3-way
// positional split). "_NofM" segments are handled by parseBatchSuffix +
// excludeAlreadyEmailed + nextBatchSlice in index.ts instead.
// Returns the input unchanged for any non-batched segment.
export function batchSegment<T>(recipients: T[], segment: string): T[] {
  if (segment === "batch_1" || segment === "batch_2" || segment === "batch_3") {
    const size = Math.ceil(recipients.length / 3);
    const batchNum = parseInt(segment.split("_")[1]) - 1;
    return recipients.slice(batchNum * size, (batchNum + 1) * size);
  }
  return recipients;
}

// Build the per-recipient unsubscribe footer HTML.
// Standard footer across ALL WRotate emails: "Unsubscribe · Manage preferences".
// Unsubscribe = one-click signed opt-out; Manage preferences = open the app
// (Profile → Notifications). Keep in sync with run-campaign + the admin preview.
// A bare <div> here rendered full-bleed and flush-left, outside the white card,
// because withUnsubFooter() used to append it AFTER </html> and mail clients
// hoist stray trailing content straight into the body with no layout around it.
// (Its old `border-top:1px solid #eee` and `padding:16px 28px` were written to
// match the card's own padding — it was always meant to be part of that column,
// and never once rendered that way in a real send.)
//
// So the footer now carries its own layout: the same page background, the same
// 20px gutter and the same max-width:480px as the card above it, centred. That
// makes it correct wherever it lands, which matters because the campaign mailer
// builds its HTML from a different template than the broadcast composer — a fix
// that depended on either template's exact closing markup would fix only one.
export function unsubFooter(unsubUrl: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">` +
    `<tr><td align="center" style="padding:0 20px 40px;">` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">` +
    `<tr><td align="center" style="font-size:11px;color:#999;line-height:1.5;">` +
    `<a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · ` +
    `<a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a>` +
    `</td></tr></table></td></tr></table>`;
}

// Put the footer INSIDE the document, immediately before </body>, so it sits in
// the same layout flow as the card instead of trailing after </html> as stray
// content. Falls back to appending when there is no </body> — a partial
// template must still carry an unsubscribe link, which is a legal requirement,
// not a cosmetic one.
export function withUnsubFooter(html: string, unsubscribeUrl: string): string {
  const footer = unsubFooter(unsubscribeUrl);
  const at = html.lastIndexOf("</body>");
  return at === -1 ? html + footer : html.slice(0, at) + footer + html.slice(at);
}

// Build the unsubscribe URL for a recipient.
export function unsubUrl(supabaseUrl: string, uid: string, sig: string, cat = "updates"): string {
  return `${supabaseUrl}/functions/v1/email-unsubscribe?uid=${uid}&cat=${cat}&sig=${sig}`;
}

export type { Profile };

// ── Broadcast queue daily quota ───────────────────────────────────────────────
// Daily quota resets at midnight UTC. The nightly drain sends broadcast rows with
// whatever quota is left, keeping a reserve for late-night transactional email.
//
// This is no longer a provider quota — SES allows 50,000/day. It is blast-radius
// protection: the ceiling a runaway loop cannot exceed before the nightly cap
// stops it. Raised 500 → 2000 on 2026-08-28: the list passed 500 members and a
// full broadcast plus the day's reminders no longer fit (35 rows stranded to the
// next night). 2000 covers the whole list plus a second broadcast in one day,
// while still capping a bug at 4% of the SES quota.
export const DAILY_EMAIL_LIMIT = 2000;
export const DRAIN_RESERVE = 10;

// How many queued broadcast emails tonight's drain may send.
export function drainBudget(usedToday: number, dailyLimit = DAILY_EMAIL_LIMIT, reserve = DRAIN_RESERVE): number {
  return Math.max(0, dailyLimit - usedToday - reserve);
}

// 401/403 mean our credentials are wrong, not that the recipient is bad. The
// send layer correctly calls these permanent (retrying a bad key is pointless),
// but the QUEUE must not: marking these rows `failed` drops real recipients for
// an operator mistake. Defer them instead — they retry once the key is fixed.
// This is exactly the shape of the 2026-07-25 incident.
export function isCredentialFailure(status: number): boolean {
  return status === 401 || status === 403;
}

// Presence-based, not a success ratio: trip the moment the batch contains
// ANY non-retryable failure, however few.
//
// Two earlier, weaker rules both left a real window open. An absolute
// okCount === 0 rule was right for Resend (a whole batch was ONE HTTP request,
// so every message shares a single verdict — a transport failure is always
// 100%), but SES's _shared/ses.ts sendSesBatch sends individually, in waves
// of 10 with a pause between waves, so a mid-batch failure (a paused
// account, a DNS/identity change, a rate limit) leaves early waves marked ok
// and okCount > 0 even though the transport is broken — that rule never
// trips. A proportional majority-failed rule (okCount * 2 < batchSize)
// closed most of that but not all of it: on the live 88-row queue (9 waves
// of 10), a failure starting at wave 6 is 50 ok / 38 non-retryable, and
// 50*2 > 88, so even the majority rule does not trip — 38 people would still
// be written `failed` and lost forever, the 2026-07-25 outcome again.
//
// The fix is to stop asking "how many failed" and ask "did anything fail in
// a way the provider called permanent." One non-retryable verdict is enough
// to distrust every other verdict in the same batch, including ones also
// called permanent, because there is no way to tell — from inside this
// function — a genuinely bad recipient from the first row hit by a breaking
// transport. Retryable-only batches (throttling, 5xx, network) don't trip
// here; they already defer through the ordinary per-row path with no signal
// that anything is wrong with the transport itself.
//
// The owner accepted this trade explicitly: a truly bad address now gets a
// few retries before it's obviously wrong in the logs, rather than being
// caught on sight — deferring costs a night's delay. The alternative,
// missing a live transport break because too few rows had failed yet by the
// time the breaker was checked, costs someone their email permanently.
export function shouldTripBreaker(permanentFailureCount: number, batchSize: number): boolean {
  return batchSize > 0 && permanentFailureCount > 0;
}

// Fold a batch's raw per-row classification into the id lists that actually
// get written. shouldTripBreaker() is keyed on failedRows.length (the
// non-retryable verdicts) — the moment it says the batch is untrustworthy,
// `failedRows` is folded into `deferredRows` wholesale and returned empty:
// nothing from a tripped batch may end up `failed`. Rows that already
// succeeded are never touched — `sentIds` passes `okIds` straight through,
// because a successful send can't be undone. Delegates the trip decision to
// shouldTripBreaker() itself (rather than re-deriving it, e.g. checking
// okIds.length === 0) so the two can never disagree.
//
// One exception to "nothing from a tripped batch may end up `failed`": a row that
// has now been judged permanently undeliverable on MAX_DELIVERY_ATTEMPTS separate
// drains. Folding it back to `pending` forever means it re-trips this batch on
// every future drain and holds a budget slot indefinitely, and after that many
// independent verdicts the evidence is about the address rather than the
// transport. Rows below the threshold still fold, so a single bad night (wrong
// key, paused provider) never retires anyone.
export const MAX_DELIVERY_ATTEMPTS = 3;

export function resolveBatchOutcome(
  okIds: number[],
  failedRows: { id: number; error: string; attempts?: number }[],
  deferredRows: { id: number; error: string; attempts?: number }[],
  batchSize: number,
  maxAttempts: number = MAX_DELIVERY_ATTEMPTS,
): {
  sentIds: number[];
  failedRows: { id: number; error: string; attempts?: number }[];
  deferredRows: { id: number; error: string; attempts?: number }[];
} {
  if (shouldTripBreaker(failedRows.length, batchSize)) {
    const exhausted = failedRows.filter((r) => (r.attempts ?? 0) >= maxAttempts);
    const foldable = failedRows.filter((r) => (r.attempts ?? 0) < maxAttempts);
    return {
      sentIds: okIds,
      failedRows: exhausted,
      deferredRows: [...deferredRows, ...foldable],
    };
  }
  return { sentIds: okIds, failedRows, deferredRows };
}

// ── Batched outcome writes ────────────────────────────────────────────────────
// The drain used to issue one UPDATE per failed/deferred row "to keep each
// row's own send error". At the 2,000-row limit a run where every send fails
// identically (a dead credential) became ~2,000 serial UPDATEs — minutes of
// grinding against a 406 MB database. Grouping rows that would receive the
// IDENTICAL update payload (same error text, same attempts value) collapses
// that to one UPDATE ... WHERE id IN (...) per distinct payload, while every
// row still ends up with exactly the values the per-row writes gave it —
// per-row error fidelity is preserved because rows with different errors land
// in different groups. First-seen order, so logs stay chronological.
export function groupOutcomeRows(
  rows: { id: number; error: string; attempts?: number }[],
): { ids: number[]; error: string; attempts?: number }[] {
  const groups = new Map<string, { ids: number[]; error: string; attempts?: number }>();
  for (const r of rows) {
    const key = `${r.attempts === undefined ? "" : r.attempts}|${r.error}`;
    const g = groups.get(key);
    if (g) g.ids.push(r.id);
    else groups.set(key, { ids: [r.id], error: r.error, ...(r.attempts === undefined ? {} : { attempts: r.attempts }) });
  }
  return [...groups.values()];
}

// ── Transport-failure streak breaker ──────────────────────────────────────────
// shouldTripBreaker() only sees NON-RETRYABLE verdicts, and a credential
// failure (401/403) is deliberately classified as a deferral (see
// isCredentialFailure) — so a dead SES key used to sail past the breaker and
// grind through every queued row: up to 2,000 failed SES calls and ~3 minutes
// of wave sleeps, all to defer everything. The tell for a dead transport is
// that every verdict is THE SAME failure: N consecutive identical
// (status, error) failures — successes and differing failures both reset the
// run — mean the next send will fail the same way, so the drain should stop
// and leave the rest `pending` for a drain with a working transport.
//
// This breaker only ever ends the run early; it never changes how any row is
// classified. Rows it stops short of stay `pending` (the claim is released),
// so nobody can be lost to it — the worst case of a false trip is a night's
// delay, the same cost the deferral path already accepts.
//
// The threshold is 25: comfortably above any plausible run of coincidentally
// identical per-recipient failures, and low enough that a dead credential
// (100 identical failures in the first batch) trips on batch one.
export const TRANSPORT_FAILURE_STREAK_LIMIT = 25;

export type FailureStreak = { count: number; key: string | null };
export const EMPTY_STREAK: FailureStreak = { count: 0, key: null };

// Fold one batch's send results (in send order) into the running streak.
export function updateFailureStreak(
  streak: FailureStreak,
  results: { ok: boolean; status?: number; error?: string }[],
): FailureStreak {
  let { count, key } = streak;
  for (const r of results) {
    if (r.ok) { count = 0; key = null; continue; }
    const k = `${r.status ?? 0}|${r.error ?? ""}`;
    count = k === key ? count + 1 : 1;
    key = k;
  }
  return { count, key };
}

export function streakTripped(streak: FailureStreak, limit = TRANSPORT_FAILURE_STREAK_LIMIT): boolean {
  return streak.count >= limit;
}

// ── Staged sends ──────────────────────────────────────────────────────────────
// Split a queue insert into what goes out now and what waits for the operator's
// go-ahead. Held rows carry status 'held', which the drain never selects (it
// asks for 'pending'), so neither the 21:30 cron nor a manual Drain now can
// touch them until admin_release_broadcast() flips them.
//
// Anything that isn't a usable positive count means "send it all" — the
// pre-existing behaviour. That covers an omitted field, 0, a negative, a
// non-number, and a batch at least as large as the audience: in the last case
// holding nothing is not a degenerate staged send, it IS an unstaged send, and
// leaving a campaign marked HELD with zero held rows would strand a "Send
// remaining 0" button in the admin list forever.
export function splitFirstBatch<T>(rows: T[], firstBatch: unknown): { pending: T[]; held: T[] } {
  const n = Math.trunc(Number(firstBatch));
  if (!Number.isFinite(n) || n <= 0 || n >= rows.length) return { pending: rows, held: [] };
  return { pending: rows.slice(0, n), held: rows.slice(n) };
}

// UTC midnight for "today" — the DAILY_EMAIL_LIMIT quota window start.
export function utcDayStart(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
