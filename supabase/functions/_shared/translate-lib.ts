// _shared/translate-lib — pure half of the automatic translation step (no IO).
//
// English is written once (a drip in Admin, a broadcast draft, a generated fun
// fact); translate.ts asks a model for the other languages and this file decides
// whether an answer may be used. The rule: a translation that changed anything
// except the words is thrown away and the reader gets English. Tags, links,
// image sources and {{tokens}} must come back exactly as they went in.
import type { Lang } from "./lang.ts";

export type OtherLang = Exclude<Lang, "en">;
export const OTHER_LANGS: OtherLang[] = ["es", "it", "fr", "tr", "de", "pt"];

// How each language addresses the reader matches the app (i18n/<lang>.json).
export const LANG_BRIEF: Record<OtherLang, string> = {
  es: "Spanish, neutral for Spain and Latin America, informal (tú)",
  it: "Italian, informal (tu)",
  fr: "French, formal (vous)",
  tr: "Turkish, informal (sen)",
  de: "German, informal (du)",
  pt: "European Portuguese, informal (tu)",
};

// The app's own words for its features, so an email says what the screen says.
export const GLOSSARY: Record<OtherLang, Record<string, string>> = {
  es: { timegrapher: "cronocomparador", "a wear / to log a wear": "un uso / registrar un uso", streak: "racha", wishlist: "lista de deseos", collection: "colección", "close friends": "mejores amigos", strap: "correa", "shared links": "enlaces compartidos" },
  it: { timegrapher: "cronocomparatore", "a wear / to log a wear": "un utilizzo / registrare un utilizzo", streak: "serie", wishlist: "lista dei desideri", collection: "collezione", "close friends": "amici stretti", strap: "cinturino", "shared links": "link condivisi" },
  fr: { timegrapher: "chronocomparateur", "a wear / to log a wear": "un port / enregistrer un port", streak: "série", wishlist: "liste de souhaits", collection: "collection", "close friends": "amis proches", strap: "bracelet", "shared links": "liens partagés" },
  tr: { timegrapher: "timegrapher", "a wear / to log a wear": "kullanım / kullanım kaydetmek", streak: "seri", wishlist: "istek listesi", collection: "koleksiyon", "close friends": "yakın arkadaşlar", strap: "kayış", "shared links": "paylaşılan bağlantılar" },
  de: { timegrapher: "Zeitwaage", "a wear / to log a wear": "ein Tragen / ein Tragen erfassen", streak: "Serie", wishlist: "Wunschliste", collection: "Sammlung", "close friends": "enge Freunde", strap: "Armband", "shared links": "geteilte Links" },
  pt: { timegrapher: "cronocomparador", "a wear / to log a wear": "um uso / registar um uso", streak: "sequência", wishlist: "lista de desejos", collection: "coleção", "close friends": "amigos próximos", strap: "bracelete", "shared links": "links partilhados" },
};

export type Fields = Record<string, string>;

export function buildTranslatePrompt(fields: Fields, lang: OtherLang): string {
  const glossary = Object.entries(GLOSSARY[lang]).map(([en, tr]) => `- ${en} = ${tr}`).join("\n");
  return `You translate text for WRotate, an app for mechanical-watch collectors, from English into ${LANG_BRIEF[lang]}.

Translate every value of the JSON object below and return a JSON object with exactly the same keys.

Rules:
- Translate only the human-readable words. Write the way a native speaker who collects watches would, not word for word.
- A value may contain HTML. Copy every tag exactly as it is, in the same order, with every attribute unchanged (href, src, style, alt, width). Never add, remove, reorder or rewrite a tag.
- Copy placeholders such as {{name}}, {{watch}}, {{watchPhrase}}, {{fact}} and [img1] exactly. They are filled in later.
- Keep "WRotate", brand names, watch model names, reference numbers, numbers, units (s/d) and URLs unchanged.
- No emoji. Do not add notes, explanations or anything that is not in the English.
- Use these words for the app's features:
${glossary}

JSON to translate:
${JSON.stringify(fields)}`;
}

/** Every tag, verbatim and in order. */
export function tagsOf(s: string): string[] {
  return s.match(/<[^>]+>/g) ?? [];
}

/** Every {{token}} and [imgN] marker, sorted. */
export function tokensOf(s: string): string[] {
  return (s.match(/\{\{\s*\w+\s*\}\}|\[img\d+\]/g) ?? []).map((t) => t.replace(/\s+/g, "")).sort();
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The model's answer if it is safe to send, otherwise null. */
export function validateTranslation(src: Fields, out: unknown): Fields | null {
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;
  const o = out as Record<string, unknown>;
  const result: Fields = {};
  for (const key of Object.keys(src)) {
    const v = o[key];
    if (typeof v !== "string") return null;
    if (src[key].trim() && !v.trim()) return null;
    if (!same(tagsOf(src[key]), tagsOf(v))) return null;
    if (!same(tokensOf(src[key]), tokensOf(v))) return null;
    // A runaway answer (the model kept writing) is not a translation.
    if (v.length > src[key].length * 3 + 200) return null;
    if (/\p{Extended_Pictographic}/u.test(v) && !/\p{Extended_Pictographic}/u.test(src[key])) return null;
    result[key] = v;
  }
  return result;
}

/** First JSON object in a model reply; null when there is none. */
export function parseModelJson(text: string): unknown {
  const t = (text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { return null; }
}

/** Fingerprint of the English a translation was made from (FNV-1a, 32-bit, hex).
 *  A stored translation is used only while this still matches, so editing the
 *  English is all it takes to get it translated again. */
export function srcHash(fields: Fields): string {
  const s = Object.keys(fields).sort().map((k) => `${k}\u0000${fields[k]}`).join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A stored translation for `lang`, if it was made from exactly this English. */
export function freshTranslation(
  stored: unknown,
  lang: string,
  src: Fields,
): Fields | null {
  const entry = (stored && typeof stored === "object" ? (stored as Record<string, unknown>)[lang] : null) as
    | (Record<string, unknown> & { src?: unknown })
    | null;
  if (!entry || typeof entry !== "object" || entry.src !== srcHash(src)) return null;
  const out: Fields = {};
  for (const k of Object.keys(src)) {
    if (typeof entry[k] !== "string") return null;
    out[k] = entry[k] as string;
  }
  return out;
}
