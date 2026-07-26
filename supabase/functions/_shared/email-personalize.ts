// _shared/email-personalize — pure text/personalization helpers shared by the
// two senders that personalize per recipient: run-campaign (the onboarding
// drip) and send-broadcast (one-off sends). Kept in one place so the drip and a
// broadcast of the same copy can never render differently.
// No Deno/IO/network.

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

// Watch names are free text, and this one goes in the SUBJECT LINE. Most odd
// names are legitimate and stay ("Omega Seamaster Diver 300M Co-Axial Master
// Chronometer 42mm", "Mr Jones Watches A Perfectly Useless Afternoon"), so this
// is deliberately narrow: only reject entries that would read as broken or
// insulting, e.g. "Omega Fake Omega - Likely ETA 2824-2" or "TestBrand Test".
// Rejected labels fall back to the curated pair rather than dropping the email.
const JUNK_LABEL = /\b(fake|replica|unknown|untitled|tbd|n\/a|no name|placeholder|test|xxx+)\b|\?/i;

export function looksLikeRealWatchLabel(label: string | null | undefined): boolean {
  const t = (label ?? "").trim();
  if (t.length < 3 || t.length > 60) return false;
  if (JUNK_LABEL.test(t)) return false;
  // Needs at least one letter — a bare reference number reads as a mistake.
  return /\p{L}/u.test(t);
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
