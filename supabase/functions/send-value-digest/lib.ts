// Supabase Edge Function: send-value-digest — pure helpers.
// Monthly "your collection" digest: deterministic numbers (saved market values), a nudge
// to refresh what is stale, one CTA. Copy uses "we". CTA → https://wrotate.com/open.

export type DigestTarget = {
  display_name: string | null;
  total_value: number | string; priced_count: number; watch_count: number;
  unpriced_count: number; stale_count: number; last_checked: string | null;
  gain: number | string | null; gain_n: number;
  top_brand: string | null; top_name: string | null; top_value: number | string | null;
};

export function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return "$" + Math.round(v).toLocaleString("en-US");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));

export function buildDigestEmail(t: DigestTarget, monthLabel: string): { subject: string; body: string } {
  const total = fmtMoney(t.total_value);
  const subject = `Your collection is worth ${total} — ${monthLabel}`;
  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 10px;">Your ${t.priced_count} priced watch${t.priced_count === 1 ? "" : "es"} add up to <strong>${total}</strong>` +
    (t.watch_count > t.priced_count ? ` (${t.priced_count} of ${t.watch_count} in your collection have a value)` : "") + `.</p>`);
  const gain = t.gain == null ? null : Number(t.gain);
  if (gain != null && Number.isFinite(gain) && t.gain_n > 0) {
    parts.push(`<p style="margin:0 0 10px;">Against what you paid, that is <strong>${gain >= 0 ? "+" : "−"}${fmtMoney(Math.abs(gain))}</strong> across the ${t.gain_n} watch${t.gain_n === 1 ? "" : "es"} where we know both numbers.</p>`);
  }
  if (t.top_brand || t.top_name) {
    const label = esc([t.top_brand, t.top_name].filter(Boolean).join(" "));
    parts.push(`<p style="margin:0 0 10px;">Most valuable: <strong>${label}</strong> at ${fmtMoney(t.top_value)}.</p>`);
  }
  const nudges: string[] = [];
  if (t.stale_count > 0) nudges.push(`${t.stale_count} ${t.stale_count === 1 ? "hasn't" : "haven't"} been checked in 60+ days`);
  if (t.unpriced_count > 0) nudges.push(`${t.unpriced_count} ${t.unpriced_count === 1 ? "has" : "have"} no value yet`);
  if (nudges.length) {
    parts.push(`<p style="margin:0 0 10px;">${nudges.join(", and ")}. Estimates come from recent listings, so a refresh keeps the total honest — tap <strong>Update prices</strong> on the Stats tab (a minute for the whole collection).</p>`);
  } else {
    parts.push(`<p style="margin:0 0 10px;">Everything was checked in the last two months — nothing to do.</p>`);
  }
  parts.push(`<p style="margin:0;color:#888;font-size:12px;">These are the values you saved in WRotate; we don't change them without you.</p>`);
  return { subject, body: parts.join("") };
}

export function monthLabel(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

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
          <!-- /open, never the bare root: .well-known/apple-app-site-association
               EXCLUDES "/" and "/index.html", so a root link opens Safari instead
               of the installed iOS app. The utm_* params are kept — they do not
               affect Universal Link matching, which is path-based. -->
          <a href="https://wrotate.com/open?utm_source=email&utm_medium=campaign&utm_campaign=value-digest" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
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

// Constant-time compare for the shared trigger secret.
// Copied from supabase/functions/run-campaign/index.ts.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// HMAC-SHA-256 sign uid:cat with the given key; returns url-safe base64.
// Copied from supabase/functions/run-campaign/index.ts.
export async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
