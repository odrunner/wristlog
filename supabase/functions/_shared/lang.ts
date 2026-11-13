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
