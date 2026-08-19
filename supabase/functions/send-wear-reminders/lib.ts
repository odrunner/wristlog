// send-wear-reminders — pure helpers + copied APNs/email utilities (self-contained,
// matching the repo convention: no cross-function imports).

// ---------------------------------------------------------------------------
// Reminder message builders
// ---------------------------------------------------------------------------

export type LastWatch = { brand: string; name: string } | null | undefined;
const watchLabel = (w: LastWatch) => w ? [w.brand, w.name].filter(Boolean).join(" ").trim() : "";

// Names the last-worn watch when the target RPC supplies one (2026-08-16). Push is
// plain text; the email body is HTML — the caller escapes brand/name before passing.
export function buildReminderPush(w?: LastWatch): { title: string; body: string } {
  const label = watchLabel(w);
  if (label) return { title: "WRotate", body: `Wearing the ${label} again today? Tap to log it — or pick another watch.` };
  return { title: "WRotate", body: "What did you wear today? 🕰️ Log it before the day's out." };
}

export function buildReminderEmail(w?: LastWatch): { subject: string; body: string } {
  const label = watchLabel(w);
  return {
    subject: "What's on your wrist today?",
    body: label
      ? `Wearing the ${label} again today? Log it in WRotate before the day's out — or whatever's on your wrist. It keeps your wear history complete and your streak alive.`
      : "Wearing something today? Log it in WRotate before the day's out — it keeps your collection's wear history complete and your streak alive.",
  };
}

// ---------------------------------------------------------------------------
// APNs helpers — copied VERBATIM from supabase/functions/send-badge-push/lib.ts
// (self-contained; no cross-function imports per repo convention)
// ---------------------------------------------------------------------------

const BUNDLE_ID = "com.wrotate.Wrotate";

// `extra` is merged into the payload ROOT (APNs custom keys), e.g. { w: { route, id, uid } }.
export function buildAlertPayload(message: { title: string; body: string }, extra?: Record<string, unknown>) {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      badge: 1,
    },
    ...(extra ?? {}),
  };
}

// "2.10" >= "2.6", "2.6" >= "2.6", "2.5" < "2.6", "" < "2.6". Mirrors iosAtLeast in index.html.
export function versionAtLeast(v: string | null | undefined, min: string): boolean {
  if (!v) return false;
  const a = String(v).split(".").map((x) => parseInt(x, 10) || 0);
  const b = min.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

// Only builds >= 2.6 route unknown `w.route` values through JS (openPushRoute); older
// builds open the bell for anything but post/profile/club/badges. So a route object is
// attached per token, never blanket.
export function routeFor(appVersion: string | null | undefined, route: string, id: string | null, uid: string): Record<string, unknown> | undefined {
  return versionAtLeast(appVersion, "2.6") ? { w: { route, id, uid } } : undefined;
}

export function apnsHost(useSandbox: boolean): string {
  return useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

export function apnsDeviceUrl(host: string, token: string): string {
  return `${host}/3/device/${token}`;
}

export function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return base64UrlEncode(String.fromCharCode(...bytes));
}

export function stripPemArmor(pem: string): string {
  return pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
}

// Build an ES256 APNs JWT from the .p8 key material.
export async function createAPNsJWT(
  keyP8: string,
  keyId: string,
  teamId: string,
): Promise<string> {
  const header = { alg: "ES256", kid: keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: teamId, iat: now };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = stripPemArmor(keyP8);
  const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${signingInput}.${sigB64}`;
}

// Send one push to a single device token.
export async function sendPush(
  token: string,
  message: { title: string; body: string },
  jwt: string,
  host: string,
  extra?: Record<string, unknown>,
): Promise<{ token: string; success: boolean; status: number }> {
  const url = apnsDeviceUrl(host, token);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildAlertPayload(message, extra)),
    });
    return { token, success: response.ok, status: response.status };
  } catch (_err) {
    return { token, success: false, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// Email helpers — copied VERBATIM from supabase/functions/run-campaign/lib.ts
// and supabase/functions/run-campaign/index.ts
// ---------------------------------------------------------------------------

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
          <!-- /open, never the bare root: .well-known/apple-app-site-association
               EXCLUDES "/" and "/index.html", so a root link opens Safari instead
               of the installed iOS app. The utm_* params are kept — they do not
               affect Universal Link matching, which is path-based. -->
          <a href="https://wrotate.com/open?utm_source=email&utm_medium=campaign&utm_campaign=wear-reminder" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
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
