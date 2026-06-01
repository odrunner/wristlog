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

/** Constant-input comparison of a provided signature against the expected one. */
export async function verifyHmac(uid: string, cat: string, sig: string, key: string): Promise<boolean> {
  const expected = await hmacSign(uid, cat, key);
  return sig === expected;
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
