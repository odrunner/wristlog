// email-unsubscribe — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.
// Uses only Web Crypto + standard web APIs (crypto.subtle, btoa, TextEncoder),
// which run under Deno test without any permissions or network.

import { TOKENS_LIGHT } from "../_shared/page-tokens.ts";
import { fill } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { UNSUB_STRINGS } from "./strings.ts";

export const CATEGORY_LABELS: Record<string, string> = {
  comments: "Comments & replies",
  mentions: "Mentions",
  friends: "Follows & friend requests",
  clubs: "Clubs",
  updates: "Updates & new features",
  reminders: "Daily reminders",
  share_comments: "Comments on your shared links",
  all: "All emails",
};

/** Human label for an unsubscribe category, falling back to the raw category. */
export function categoryLabel(cat: string, lang: Lang = "en"): string {
  const cats = UNSUB_STRINGS[lang].cats;
  const own = (o: Record<string, string>) => Object.prototype.hasOwnProperty.call(o, cat) ? o[cat] : "";
  return own(cats) || own(CATEGORY_LABELS) || cat;
}

/** The success page: its <title> and the card body, in the member's language.
 *  `allHref` is the signed "unsubscribe from everything" link, or null when
 *  this click already was that one. */
export function successPage(lang: Lang, cat: string, allHref: string | null): { title: string; body: string } {
  const S = UNSUB_STRINGS[lang];
  const allLink = allHref
    ? `<p class="muted"><a href="${allHref}" style="color:var(--gold);">${S.all}</a></p>`
    : "";
  return {
    title: S.title,
    body: `<h1>${S.h1}</h1><p>${fill(S.wont, { c: categoryLabel(cat, lang) })}</p><p>${S.reenable}</p><a href="https://wrotate.com/open" class="btn">${S.open}</a>${allLink}`,
  };
}

/** The four pages shown when the link cannot be honoured. `incomplete` and
 *  `expired` (a bad signature) come before we know whose link it is and
 *  `noAccount` when nobody is behind it, so index.ts passes the request's
 *  language for those; `noUpdate` knows the member and uses theirs. */
export type UnsubError = "incomplete" | "expired" | "noAccount" | "noUpdate";
export function errorPage(lang: Lang, kind: UnsubError): { title: string; body: string } {
  const S = UNSUB_STRINGS[lang];
  const invalid = kind === "incomplete" || kind === "expired";
  return {
    title: invalid ? S.err.invalidTitle : S.err.errorTitle,
    body: `<h1>${invalid ? S.err.invalidH1 : S.err.errorH1}</h1><p>${S.err[kind]}</p><a href='https://wrotate.com/open' class='btn'>${S.open}</a>`,
  };
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
 * Resolve the unsubscribe verification keys.
 *
 * Links were signed with SUPABASE_SERVICE_ROLE_KEY until 2026-08-15, then with
 * UNSUBSCRIBE_HMAC_SECRET. The service-role fallback was dropped 2026-09-24
 * (audit SEC-23-5): that key leaked publicly, so accepting it let anyone forge
 * an unsubscribe for any user; pre-08-15 emails have aged out. A list is kept
 * so a future rotation can add the previous secret for a grace period.
 */
export function unsubscribeKeys(env: (k: string) => string | undefined): string[] {
  return [env("UNSUBSCRIBE_HMAC_SECRET")]
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
    prefs.share_comments = false;
  } else {
    prefs[cat] = false;
  }
  return prefs;
}

/** Full confirmation HTML page (card chrome + injected body). English keeps the
 *  bare <html> it always had; any other language is declared on it. */
export function renderPage(title: string, body: string, lang: Lang = "en"): string {
  return `<!DOCTYPE html>
<html${lang === "en" ? "" : ` lang="${lang}"`}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — WRotate</title>
<style>
  :root { ${TOKENS_LIGHT} }
  body { margin:0; padding:var(--space-10) var(--space-5); background:var(--bg); font-family:var(--font-sans); }
  .card { max-width:var(--size-105); margin:0 auto; background:var(--surface); border-radius:var(--radius); padding:var(--space-8); box-shadow:var(--shadow-1); text-align:center; }
  .logo { width:var(--size-10); height:var(--size-10); border-radius:var(--radius); margin-bottom:var(--space-2); }
  .brand { font-size:var(--fs-xl); font-weight:var(--fw-bold); color:var(--gold); letter-spacing:var(--ls-snug); margin-bottom:var(--space-5); }
  h1 { font-size:var(--fs-xl); color:var(--text); margin:0 0 var(--space-3); }
  p { font-size:var(--fs-md); color:var(--muted); line-height:var(--lh-body); margin:0 0 var(--space-4); }
  a.btn { display:inline-block; background:var(--gold); color:var(--white); font-size:var(--fs-base); font-weight:var(--fw-semibold); padding:var(--space-2-5) var(--space-6); border-radius:var(--radius-btn); text-decoration:none; }
  .muted { font-size:var(--fs-sm); color:var(--muted); margin-top:var(--space-5); }
</style></head><body>
<div class="card">
  <img src="https://wrotate.com/icon.svg" alt="WRotate" class="logo">
  <div class="brand">WRotate</div>
  ${body}
</div></body></html>`;
}
