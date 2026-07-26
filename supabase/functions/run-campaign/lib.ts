// run-campaign — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// The [windowStart, windowEnd) created_at range that selects users who signed up
// `delay_days` ago (a 24h slice ending delay_days before now). Returned as ISO.
export function signupWindow(nowMs: number, delayDays: number): { windowStart: string; windowEnd: string } {
  const windowEnd = new Date(nowMs - delayDays * 24 * 60 * 60 * 1000);
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  return { windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() };
}

type Profile = { id: string; email_prefs?: { updates?: boolean } | null };

// Eligible recipients for a campaign: not internal, and not unsubscribed from
// updates (default opted-in). Mirrors the filter in index.ts.
export function filterEligible<T extends Profile>(profiles: T[], internalIds: Iterable<string>): T[] {
  const internalSet = internalIds instanceof Set ? internalIds : new Set(internalIds);
  return (profiles || []).filter((p) => {
    if (internalSet.has(p.id)) return false;
    const prefs = p.email_prefs || {};
    return prefs.updates !== false;
  });
}

// Partition eligible users into those already sent this campaign vs still pending.
// Returns the pending list and a skipped count (already sent).
export function splitAlreadySent<T extends { id: string }>(
  users: T[],
  alreadySentIds: Iterable<string>,
): { pending: T[]; skipped: number } {
  const sentSet = alreadySentIds instanceof Set ? alreadySentIds : new Set(alreadySentIds);
  const skipped = (users || []).filter((u) => sentSet.has(u.id)).length;
  const pending = (users || []).filter((u) => !sentSet.has(u.id));
  return { pending, skipped };
}

// Replace the {{name}} placeholder with a display name, falling back to "there".
// True when a display name reads like a real name (not a handle, initials, or a
// random id) — so we only greet "Hi {name}," when it won't look broken.
// Rules: 2–20 chars, letters/space/apostrophe/hyphen only (no digits/symbols),
// and contains at least one vowel (rejects consonant-only initials like "CN").
export function looksLikeName(name: string | null | undefined): boolean {
  const t = (name ?? "").trim();
  if (t.length < 2 || t.length > 20) return false;
  if (!/^[\p{L} '’-]+$/u.test(t)) return false;
  if (!/[aeiouyàáâäãåèéêëìíîïòóôöõùúûüæø]/iu.test(t)) return false;
  return true;
}

// Resolve the greeting name: the trimmed display name when it looks real, else "there".
export function personalizeName(displayName: string | null | undefined): string {
  return looksLikeName(displayName) ? (displayName as string).trim() : "there";
}

// Substitute {{name}} plus any extra tokens (e.g. {{watch}}, {{fact}}).
function fillTokens(
  text: string,
  displayName: string | null | undefined,
  vars: Record<string, string>,
  escape: boolean,
): string {
  let out = text.replace(/\{\{name\}\}/g, personalizeName(displayName));
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), escape ? escapeHtml(value) : value);
  }
  return out;
}

// Body: values are HTML-escaped — {{fact}} text comes from the shared,
// AI-written watch_facts pool and lands inside an HTML email.
export function personalizeBody(
  bodyHtml: string,
  displayName: string | null | undefined,
  vars: Record<string, string> = {},
): string {
  return fillTokens(bodyHtml, displayName, vars, true);
}

// Subject: a plain-text header, so substitute raw — escaping here would put a
// literal "&amp;" in the inbox for brands like "A. Lange &amp; Söhne".
export function personalizeSubject(
  subject: string,
  displayName: string | null | undefined,
  vars: Record<string, string> = {},
): string {
  return fillTokens(subject, displayName, vars, false);
}

// True when a campaign's copy asks for the fun-fact treatment. Campaigns
// without these tokens take the original zero-extra-query path.
export function needsFactVars(campaign: { subject?: string; body_html?: string }): boolean {
  return /\{\{(watch|watchPhrase|fact)\}\}/.test(`${campaign.subject ?? ""}${campaign.body_html ?? ""}`);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Wrap a campaign body in the branded HTML email shell.
export function buildHtmlEmail(subject: string, body: string, unsubUrl: string): string {
  const unsubLine = `<a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a>`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #eee;">
          <img src="https://wrotate.com/icon.svg" alt="WRotate" width="40" height="40" style="display:inline-block;border-radius:9px;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:700;color:#b8941f;letter-spacing:.03em;">WRotate</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <div style="font-size:14px;color:#555;line-height:1.6;">${body}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com/?utm_source=email&utm_medium=campaign&utm_campaign=welcome" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">${unsubLine}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Build the unsubscribe URL for a recipient.
export function unsubUrl(supabaseUrl: string, uid: string, sig: string, cat = "updates"): string {
  return `${supabaseUrl}/functions/v1/email-unsubscribe?uid=${uid}&cat=${cat}&sig=${sig}`;
}

// Behavior-aware skip: which table proves a user already did the action.
// Unknown/empty → null (no skip), so a typo can never drop the whole cohort.
export const KNOWN_SKIPS: Record<string, string> = {
  has_watch: "watches",
  has_log: "logs",
  has_measurement: "timegrapher_results",
};

export function skipTable(skipKey: string | null | undefined): string | null {
  if (!skipKey) return null;
  return KNOWN_SKIPS[skipKey] ?? null;
}

export function dropDone<T extends { id: string }>(
  users: T[],
  doneIds: Iterable<string>,
): T[] {
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds);
  return users.filter((u) => !done.has(u.id));
}


// Backfill: pick up to `limit` members who haven't been sent this campaign and
// weren't already emailed earlier this run. Newest members first — they're the
// most likely to still be engaged. Caller pre-filters to profiles strictly
// older than the drip window and applies filterEligible/dropDone.
export function pickBackfill<T extends { id: string; created_at: string }>(
  eligible: T[],
  alreadySentIds: Iterable<string>,
  emailedThisRunIds: Iterable<string>,
  limit: number,
): T[] {
  const sent = alreadySentIds instanceof Set ? alreadySentIds : new Set(alreadySentIds);
  const emailed = emailedThisRunIds instanceof Set ? emailedThisRunIds : new Set(emailedThisRunIds);
  return eligible
    .filter((p) => !sent.has(p.id) && !emailed.has(p.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, Math.max(0, limit));
}


// ── Fun-fact personalization (the "Start your streak" campaign hero) ──
// A campaign body/subject containing {{watch}}/{{fact}} gets a real fact about a
// watch in the recipient's own collection. The helpers below are the pure parts;
// index.ts does the DB reads and the Gemini call.

type FactWatch = { brand?: string | null; name?: string | null; created_at?: string | null };

// Shared-pool key, byte-identical to the SQL in pick_watch_fact:
//   lower(trim(brand)) || '|' || lower(trim(name))
export function modelKey(brand: string, name: string): string {
  return `${brand.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
}

// Which watch to feature: the most recently added one that has both a brand and
// a name. Newest first because it's the one freshest in the recipient's mind —
// usually the watch they added after the day-1 "Add a watch" email.
export function pickFeaturedWatch<T extends FactWatch>(watches: T[]): T | null {
  const usable = (watches || []).filter((w) => (w.brand ?? "").trim() && (w.name ?? "").trim());
  if (!usable.length) return null;
  return usable
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

// Human label for the featured watch: "Seiko SKX007". Collapses a name that
// already repeats the brand ("Rolex" + "Rolex Submariner" → "Rolex Submariner").
export function watchLabel(brand: string, name: string): string {
  const b = brand.trim();
  const n = name.trim();
  if (n.toLowerCase().startsWith(b.toLowerCase())) return n;
  return `${b} ${n}`;
}

// The fact is the hero of this email, so only ship one that reads as finished.
// Some pool rows were truncated mid-sentence by an early generation bug; those
// must never be the first thing a recipient sees. Requires terminal punctuation
// and enough substance to be interesting.
export function looksCompleteFact(fact: string | null | undefined): boolean {
  const t = (fact ?? "").trim();
  if (t.length < 40 || t.length > 500) return false;
  return /[.!?]$/.test(t);
}

// First usable fact in the pool, lowest position first (the generation prompt
// puts the most interesting fact at position 0). Returns null if the pool is
// empty or every row looks truncated.
export function pickPoolFact<T extends { position: number; fact: string }>(rows: T[]): T | null {
  return (rows || [])
    .filter((r) => looksCompleteFact(r.fact))
    .sort((a, b) => a.position - b.position)[0] ?? null;
}

// Possessive-safe phrase for the subject line and prose: "your Seiko SKX007"
// when we're talking about a watch they actually own. The fallback supplies its
// own phrase ("the Omega Speedmaster") — "your Omega Speedmaster" would claim
// they own one they never added.
export function watchPhrase(label: string): string {
  return `your ${label}`;
}

// Used when the recipient has no watch yet, or when the pool is empty and
// generation is unavailable. A real, well-known fact — the email still has to
// deliver on its subject line.
export const FALLBACK_FACT = {
  watch: "Omega Speedmaster",
  watchPhrase: "the Omega Speedmaster",
  fact:
    "It was never designed for space — Omega built it as a motorsport chronograph in 1957, and NASA found it years later by sending a staffer to buy chronographs off the shelf at a Houston jeweller, without saying who they were for.",
};

export type { FactWatch };
export type { Profile };
