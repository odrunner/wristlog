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

// The language's name as written into a prompt ("Write the description in German").
// English, a missing value and anything we do not offer give null, and the caller
// then leaves its prompt exactly as it was.
const PROMPT_LANGUAGES: Record<string, string> = {
  es: "Spanish", it: "Italian", fr: "French", tr: "Turkish", de: "German", pt: "European Portuguese",
};
export function promptLanguage(v: unknown): string | null {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PROMPT_LANGUAGES, v) ? PROMPT_LANGUAGES[v] : null;
}

// Fill {name} holes. split/join, not String.replace: a display name containing
// "$&" must come out as typed, not be read as a replacement pattern.
export function fill(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(vars[k]);
  return out;
}

// Chosen language per user id, for senders whose target list comes from an RPC
// that does not carry it. Fails open to an empty map (everyone English): a
// reminder in English beats a reminder not sent.
export async function fetchLangs(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  uids: string[],
): Promise<Map<string, Lang>> {
  const out = new Map<string, Lang>();
  const ids = [...new Set(uids)].filter(Boolean);
  if (!ids.length) return out;
  try {
    const { data, error } = await supabase.from("profiles").select("id, language").in("id", ids);
    if (error || !Array.isArray(data)) return out;
    for (const r of data) if (r?.language) out.set(r.id, pickLang(r.language));
  } catch (_) { /* English for everyone */ }
  return out;
}

// The name used when the person behind a notification has none we can show (a
// deleted account, an empty profile). One word, shared by send-push and
// send-email so the two never differ.
export const SOMEONE: Record<Lang, string> = {
  en: "Someone", es: "Alguien", it: "Qualcuno", fr: "Quelqu'un", tr: "Biri", de: "Jemand", pt: "Alguém",
};

// Footer and button shared by the reminder emails' HTML shells.
export const SHELL_STRINGS: Record<Lang, { open: string; unsub: string; manage: string }> = {
  en: { open: "Open WRotate", unsub: "Unsubscribe", manage: "Manage preferences" },
  es: { open: "Abrir WRotate", unsub: "Cancelar suscripción", manage: "Gestionar preferencias" },
  it: { open: "Apri WRotate", unsub: "Annulla iscrizione", manage: "Gestisci preferenze" },
  fr: { open: "Ouvrir WRotate", unsub: "Se désabonner", manage: "Gérer les préférences" },
  tr: { open: "WRotate'i aç", unsub: "Abonelikten çık", manage: "Tercihleri yönet" },
  de: { open: "WRotate öffnen", unsub: "Abmelden", manage: "Einstellungen verwalten" },
  pt: { open: "Abrir o WRotate", unsub: "Cancelar subscrição", manage: "Gerir preferências" },
};

// Every email that is not in English was translated by a machine, and says so:
// one line above the unsubscribe links, in the reader's language, with where to
// tell us about wording that reads wrong. English emails carry nothing.
export const AI_NOTE: Record<Lang, string> = {
  en: "",
  es: "Este correo se tradujo automáticamente con IA. Si algo suena raro, cuéntanoslo desde Enviar comentarios en la app.",
  it: "Questa email è stata tradotta automaticamente con l'IA. Se qualcosa suona strano, scrivici da Invia feedback nell'app.",
  fr: "Cet e-mail a été traduit automatiquement par IA. Si une tournure vous semble maladroite, dites-le-nous via Envoyer un retour dans l'app.",
  tr: "Bu e-posta yapay zekâ ile otomatik olarak çevrildi. Kulağa tuhaf gelen bir şey varsa uygulamadaki Geri bildirim gönder üzerinden bize yaz.",
  de: "Diese E-Mail wurde automatisch mit KI übersetzt. Wenn etwas seltsam klingt, schreib uns über Feedback senden in der App.",
  pt: "Este e-mail foi traduzido automaticamente por IA. Se algo te soar estranho, diz-nos em Enviar feedback na app.",
};
export function aiNote(lang: Lang): string {
  return AI_NOTE[lang] ? `${AI_NOTE[lang]}<br>` : "";
}

// ── The reader is not a member: public pages ────────────────────────────────
// A share page (and an unsubscribe link that fails before we know whose it is)
// is read by whoever opens it, so there is no profiles.language to follow. The
// language then comes from the request itself.

// BCP 47 locale per language, for dates and numbers written on the server.
export const LOCALES: Record<Lang, string> = {
  en: "en-US", es: "es-ES", it: "it-IT", fr: "fr-FR", tr: "tr-TR", de: "de-DE", pt: "pt-PT",
};

function asLang(v: string): Lang | null {
  return (LANGS as readonly string[]).includes(v) ? (v as Lang) : null;
}

// 1. `?lang=<code>` when it is exactly one of our codes (case and surrounding
//    space forgiven; "de-DE" or "german" are not codes and are ignored);
// 2. otherwise the first language in Accept-Language, by q then by position,
//    that we have text for ("fr-CH" counts as fr; q=0 means "not this one");
// 3. otherwise English.
// So "ja, de;q=0.8, en;q=0.5" is German, and "en-US, de;q=0.9" is English.
export function requestLang(queryLang: unknown, acceptLanguage: unknown): Lang {
  if (typeof queryLang === "string") {
    const q = asLang(queryLang.trim().toLowerCase());
    if (q) return q;
  }
  if (typeof acceptLanguage !== "string" || !acceptLanguage) return "en";
  const ranked: { tag: string; q: number; i: number }[] = [];
  // A real header is well under 200 characters; the cap bounds a hostile one.
  acceptLanguage.slice(0, 1000).split(",").forEach((part, i) => {
    const [rawTag, ...params] = part.split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!tag) return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!Number.isFinite(q) || q <= 0) return;
    ranked.push({ tag, q, i });
  });
  ranked.sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) {
    const l = asLang(r.tag.split("-")[0]);
    if (l) return l;
  }
  return "en";
}

// Link-preview fetchers (iMessage, WhatsApp, Slack, ...) and scripts. They are
// recognised by User-Agent; no User-Agent at all is nothing a browser sends.
// share-recap also uses this to keep previews out of its view counts.
const CRAWLER_RE =
  /bot|crawler|spider|facebookexternalhit|facebookcatalog|whatsapp|telegram|slack|discord|twitter|linkedin|pinterest|skype|snapchat|iframely|embedly|quora|preview|fetch|curl|wget|python|go-http|java\/|okhttp|axios|headless/i;
export function isCrawlerUA(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return CRAWLER_RE.test(ua);
}

// The language of a public share page. A preview fetcher always gets English
// unless the link itself says `?lang=`: some of them run on the SENDER's phone
// and carry its Accept-Language, and the preview is read by someone else. It
// also keeps every existing link preview exactly as it was.
export function pageLang(queryLang: unknown, acceptLanguage: unknown, userAgent: string | null | undefined): Lang {
  return isCrawlerUA(userAgent) ? requestLang(queryLang, null) : requestLang(queryLang, acceptLanguage);
}

// The page's language depends on these two request headers, so any cache that
// may keep it (the pages send `Cache-Control: public`) must key on them, or one
// reader's language is served to the next.
export const VARY_LANG = "Accept-Language, User-Agent";

// Counts. English keeps its bare digits ("1234 wears"), as these pages always
// wrote them; the other languages get their own grouping.
export function num(lang: Lang, n: number): string {
  return lang === "en" ? String(n) : n.toLocaleString(LOCALES[lang]);
}

// [one, other]. French counts 0 as singular ("0 montre"); Turkish does not
// inflect after a number, so its two forms are simply the same text.
export type Plural = readonly [string, string];
export function count(lang: Lang, n: number, forms: Plural): string {
  const one = lang === "fr" ? n < 2 : n === 1;
  return fill(one ? forms[0] : forms[1], { n: num(lang, n) });
}
