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
export function personalizeBody(bodyHtml: string, displayName: string | null | undefined): string {
  return bodyHtml.replace(/\{\{name\}\}/g, displayName || "there");
}

// Wrap a campaign body in the branded HTML email shell.
export function buildHtmlEmail(subject: string, body: string, unsubUrl: string): string {
  const unsubLine = `You're receiving this because you recently joined WRotate.<br><a href="${unsubUrl}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a>`;
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

export type { Profile };
