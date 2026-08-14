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
export function campaignLink(slug: string, medium = "campaign"): string {
  return `https://wrotate.com/open?utm_source=email&utm_medium=${medium}&utm_campaign=${encodeURIComponent(slug)}`;
}
