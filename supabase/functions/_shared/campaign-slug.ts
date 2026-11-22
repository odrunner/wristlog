// utm_campaign value for an outgoing email.
//
// Every email CTA carries ?utm_source=email&utm_medium=<kind>&utm_campaign=<slug>.
// The slug is the ONLY thing tying a click back to the send that caused it: SES
// click tracking has been off since 2026-07-31 (it rewrites hrefs to a redirect
// host, which breaks iOS Universal Link matching and sends the "Open WRotate"
// CTA to Safari), so a tagged /open link landing in page_visits is what a click
// means now. The admin "Email click-throughs" card groups on exactly this
// string, so the same rule has to run here and in index.html's campaignSlug().
//
// Drips slug their campaign NAME, not their subject: "A fun fact about
// {{watchPhrase}}" renders differently for every recipient, and slugging that
// would scatter one campaign across hundreds of buckets.
export function campaignSlug(text: string | null | undefined): string {
  return String(text || "email").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "email";
}

// The tagged CTA target. /open, never the bare root:
// .well-known/apple-app-site-association EXCLUDES "/" and "/index.html", so a
// root link hands the tap to Safari instead of the installed app.
export function campaignLink(slug: string, medium = "campaign", go: string | null | undefined = null): string {
  const key = goKey(go);
  return `https://wrotate.com/open?utm_source=email&utm_medium=${medium}&utm_campaign=${encodeURIComponent(slug)}${key ? `&go=${key}` : ""}`;
}

// The screen an email button opens (email_campaigns.cta_action): a key from
// the app's PROMO_ACTIONS registry, e.g. "open_measure". The page looks the
// key up and ignores one it does not know, and the iOS/Android shells pass it
// through, so the only job here is to keep anything that is not a plain key
// out of the link. Empty/unknown shape -> no parameter, the button opens the
// Feed as it always has.
export function goKey(go: string | null | undefined): string {
  const k = String(go ?? "").trim();
  return /^[a-z_]{1,40}$/.test(k) ? k : "";
}
