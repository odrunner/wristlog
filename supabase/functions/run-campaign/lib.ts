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

// Personalization + fun-fact helpers live in _shared/email-personalize.ts so
// send-broadcast renders identical copy. Re-exported here because this module
// is run-campaign's public surface (index.ts and lib.test.ts import from it).
export {
  escapeHtml,
  modelKey,
  pickFeaturedWatch,
  FALLBACK_FACT,
  looksCompleteFact,
  looksLikeName,
  looksLikeRealWatchLabel,
  needsFactVars,
  personalizeBody,
  personalizeName,
  personalizeSubject,
  pickPoolFact,
  watchLabel,
  watchPhrase,
} from "../_shared/email-personalize.ts";

// Wrap a campaign body in the branded HTML email shell.
// Pass an empty unsubUrl to omit the footer row: broadcast_queue rows are
// stored footer-less because send-broadcast's drain appends its own
// unsubFooter() (with a freshly signed URL) at send time.
export function buildHtmlEmail(subject: string, body: string, unsubUrl: string): string {
  const unsubLine = `<a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a>`;
  const footerRow = unsubUrl
    ? `
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">${unsubLine}</div>
        </td></tr>`
    : "";
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
          <!-- /open, never the bare root: .well-known/apple-app-site-association
               EXCLUDES "/" and "/index.html", so a root link opens Safari instead
               of the installed iOS app. The utm_* params are kept — they do not
               affect Universal Link matching, which is path-based. -->
          <a href="https://wrotate.com/open?utm_source=email&utm_medium=campaign&utm_campaign=welcome" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
${footerRow}
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
  has_wishlist: "wishlist",
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


export type { FactWatch } from "../_shared/email-personalize.ts";
export type { Profile };
