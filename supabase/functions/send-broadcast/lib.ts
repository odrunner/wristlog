// send-broadcast — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// Signup-window cohorts. Each cohort maps to an optional [gte, lt) created_at range.
export const COHORTS: Record<string, { gte?: string; lt?: string }> = {
  pre_april: { lt: "2026-04-01T00:00:00Z" },
  april: { gte: "2026-04-01T00:00:00Z", lt: "2026-05-01T00:00:00Z" },
  may: { gte: "2026-05-01T00:00:00Z", lt: "2026-06-01T00:00:00Z" },
};

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

// Slice recipients into one of 3 roughly-equal batches for "batch_1/2/3" segments.
// Returns the input unchanged for any other segment.
export function batchSegment<T>(recipients: T[], segment: string): T[] {
  if (segment === "batch_1" || segment === "batch_2" || segment === "batch_3") {
    const size = Math.ceil(recipients.length / 3);
    const batchNum = parseInt(segment.split("_")[1]) - 1;
    return recipients.slice(batchNum * size, (batchNum + 1) * size);
  }
  return recipients;
}

// Build the per-recipient unsubscribe footer HTML.
export function unsubFooter(unsubUrl: string): string {
  return `<div style="text-align:center;padding:16px 28px;font-size:11px;color:#999;line-height:1.5;border-top:1px solid #eee;"><a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a></div>`;
}

// Build the unsubscribe URL for a recipient.
export function unsubUrl(supabaseUrl: string, uid: string, sig: string, cat = "updates"): string {
  return `${supabaseUrl}/functions/v1/email-unsubscribe?uid=${uid}&cat=${cat}&sig=${sig}`;
}

export type { Profile };
