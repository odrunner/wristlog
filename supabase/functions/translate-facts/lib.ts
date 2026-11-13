// translate-facts — pure helpers (no IO).
import { OTHER_LANGS } from "../_shared/translate-lib.ts";
import type { Fields, OtherLang } from "../_shared/translate-lib.ts";

export type FactRow = { id: string; fact: string; translations: Record<string, string> | null; translate_attempts: number };

/** Languages a fact still lacks. */
export function missingLangs(row: FactRow): OtherLang[] {
  const t = row.translations ?? {};
  return OTHER_LANGS.filter((l) => typeof t[l] !== "string" || !t[l].trim());
}

/** One request body per language: the facts that lack it, keyed f0, f1, …
 *  (position in `rows`), so an answer can be matched back to its row. */
export function batchFields(rows: FactRow[], lang: OtherLang): Fields {
  const out: Fields = {};
  rows.forEach((r, i) => { if (missingLangs(r).includes(lang)) out[`f${i}`] = r.fact; });
  return out;
}

/** Fold the per-language answers back into each row's translations. Returns
 *  only rows that gained something. */
export function mergeAnswers(
  rows: FactRow[],
  answers: Map<OtherLang, Fields>,
): { id: string; translations: Record<string, string> }[] {
  const out: { id: string; translations: Record<string, string> }[] = [];
  rows.forEach((r, i) => {
    const t: Record<string, string> = { ...(r.translations ?? {}) };
    let gained = false;
    for (const [lang, fields] of answers) {
      const v = fields[`f${i}`];
      if (typeof v === "string" && v.trim()) { t[lang] = v.trim(); gained = true; }
    }
    if (gained) out.push({ id: r.id, translations: t });
  });
  return out;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
