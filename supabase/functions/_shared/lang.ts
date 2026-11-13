// _shared/lang — which language a server-written message goes out in.
//
// profiles.language is the member's own choice in Profile -> Language
// (sql/2026-11-13-profiles-language.sql). NULL, or a code we have no text for,
// is English: nobody is ever guessed into a language from their location.
export const LANGS = ["en", "es", "it", "fr", "tr", "de", "pt"] as const;
export type Lang = typeof LANGS[number];

export function pickLang(v: unknown): Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v) ? (v as Lang) : "en";
}

// Fill {name} holes. split/join, not String.replace: a display name containing
// "$&" must come out as typed, not be read as a replacement pattern.
export function fill(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(vars[k]);
  return out;
}
