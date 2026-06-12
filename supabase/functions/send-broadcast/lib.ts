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
  input: { subject?: unknown; html?: unknown; cohort?: string; campaign_id?: unknown },
): string | null {
  if (!input.subject || !input.html) {
    return "subject and html are required";
  }
  if (input.cohort && !COHORTS[input.cohort]) {
    return `Unknown cohort: ${input.cohort}`;
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

// Slice recipients into one roughly-equal batch. Two segment forms:
//   "<base>_<n>of<m>"   e.g. "may_onward_2of2" — n-th of m batches (1-indexed)
//   "batch_1/2/3"       — legacy 3-way split of the full list
// Returns the input unchanged for any non-batched segment.
export function batchSegment<T>(recipients: T[], segment: string): T[] {
  const nOfM = /_(\d+)of(\d+)$/.exec(segment);
  if (nOfM) {
    const num = parseInt(nOfM[1]);
    const count = parseInt(nOfM[2]);
    if (num >= 1 && count >= 1 && num <= count) {
      const size = Math.ceil(recipients.length / count);
      return recipients.slice((num - 1) * size, num * size);
    }
    return recipients;
  }
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
