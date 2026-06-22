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
export function unsubFooter(unsubUrl: string): string {
  return `<div style="padding:16px 28px;border-top:1px solid #eee;font-size:11px;color:#999;line-height:1.5;"><a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a></div>`;
}

// Build the unsubscribe URL for a recipient.
export function unsubUrl(supabaseUrl: string, uid: string, sig: string, cat = "updates"): string {
  return `${supabaseUrl}/functions/v1/email-unsubscribe?uid=${uid}&cat=${cat}&sig=${sig}`;
}

export type { Profile };
