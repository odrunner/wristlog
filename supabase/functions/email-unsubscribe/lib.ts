// email-unsubscribe — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.
// Uses only Web Crypto + standard web APIs (crypto.subtle, btoa, TextEncoder),
// which run under Deno test without any permissions or network.

export const CATEGORY_LABELS: Record<string, string> = {
  comments: "Comments & replies",
  mentions: "Mentions",
  friends: "Follows & friend requests",
  clubs: "Clubs",
  updates: "Updates & new features",
  reminders: "Daily reminders",
  digest: "Monthly collection value digest",
  all: "All emails",
};

/** Human label for an unsubscribe category, falling back to the raw category. */
export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat;
}

/** Base64url HMAC-SHA256 of `${uid}:${cat}` using the given key. */
export async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string compare — avoids leaking the expected signature via the
 *  early-exit timing of `===` (which a forger could exploit byte-by-byte). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a provided signature against the expected one in constant time. */
export async function verifyHmac(uid: string, cat: string, sig: string, key: string): Promise<boolean> {
  const expected = await hmacSign(uid, cat, key);
  return timingSafeEqual(sig, expected);
}

/**
 * Resolve the unsubscribe signing key, newest first.
 *
 * Links used to be signed with SUPABASE_SERVICE_ROLE_KEY. Rotating that key — a
 * routine security action — would silently invalidate the unsubscribe link in every
 * email already delivered, and a broken unsubscribe is a compliance problem rather
 * than a cosmetic one. UNSUBSCRIBE_HMAC_SECRET decouples the two.
 *
 * Signing always uses keys[0]. Verification accepts ANY of them, so the changeover
 * needs no flag day: set the secret and links already in inboxes keep working via
 * the service-role fallback. Drop the fallback once those emails have aged out.
 */
export function unsubscribeKeys(env: (k: string) => string | undefined): string[] {
  return [env("UNSUBSCRIBE_HMAC_SECRET"), env("SUPABASE_SERVICE_ROLE_KEY")]
    .filter((k): k is string => !!k);
}

/** Verify against any accepted key. Always checks every key — no early return — so
 *  the work done does not reveal which key matched. */
export async function verifyHmacAny(uid: string, cat: string, sig: string, keys: string[]): Promise<boolean> {
  let ok = false;
  for (const key of keys) {
    if (await verifyHmac(uid, cat, sig, key)) ok = true;
  }
  return ok;
}

export type EmailPrefs = Record<string, boolean>;

/**
 * Apply an unsubscribe to an email_prefs object. For "all", disables every
 * notification category; otherwise disables just the named category. Mutates
 * and returns the prefs object (matching the original inline behavior).
 */
export function applyUnsubscribe(prefs: EmailPrefs, cat: string): EmailPrefs {
  if (cat === "all") {
    prefs.comments = false;
    prefs.mentions = false;
    prefs.friends = false;
    prefs.clubs = false;
    prefs.updates = false;
    prefs.reminders = false;
    prefs.digest = false;
  } else {
    prefs[cat] = false;
  }
  return prefs;
}

/** Full confirmation HTML page (card chrome + injected body). */
export function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — WRotate</title>
<style>
  body { margin:0; padding:40px 20px; background:#f4f4f4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .card { max-width:420px; margin:0 auto; background:#fff; border-radius:12px; padding:32px; box-shadow:0 1px 4px rgba(0,0,0,.08); text-align:center; }
  .logo { width:40px; height:40px; border-radius:9px; margin-bottom:8px; }
  .brand { font-size:18px; font-weight:700; color:#b8941f; letter-spacing:.03em; margin-bottom:20px; }
  h1 { font-size:18px; color:#1a1a1a; margin:0 0 12px; }
  p { font-size:14px; color:#555; line-height:1.55; margin:0 0 16px; }
  a.btn { display:inline-block; background:#b8941f; color:#fff; font-size:13px; font-weight:600; padding:10px 24px; border-radius:8px; text-decoration:none; }
  .muted { font-size:12px; color:#999; margin-top:20px; }
</style></head><body>
<div class="card">
  <img src="https://wrotate.com/icon.svg" alt="WRotate" class="logo">
  <div class="brand">WRotate</div>
  ${body}
</div></body></html>`;
}
