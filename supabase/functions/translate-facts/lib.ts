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

// ── Model pages: description + history (watch_models.translations) ──────────
export type ModelText = { description?: string; history?: string };
export type ModelRow = {
  id: string; description: string | null; history: string | null;
  translations: Record<string, ModelText> | null; translate_attempts: number;
};
const MODEL_FIELDS = ["description", "history"] as const;
const has = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Languages a model still lacks. A language counts as done only when every
 *  field the English has is there, so a page is never half one language. */
export function modelMissingLangs(row: ModelRow): OtherLang[] {
  const t = row.translations ?? {};
  return OTHER_LANGS.filter((l) => MODEL_FIELDS.some((f) => has(row[f]) && !has(t[l]?.[f])));
}

/** One request body per language, keyed m0_description, m0_history, m1_… */
export function modelBatchFields(rows: ModelRow[], lang: OtherLang): Fields {
  const out: Fields = {};
  rows.forEach((r, i) => {
    if (!modelMissingLangs(r).includes(lang)) return;
    for (const f of MODEL_FIELDS) if (has(r[f])) out[`m${i}_${f}`] = r[f] as string;
  });
  return out;
}

/** Fold the answers back in. A language is stored for a model only when every
 *  field it asked for came back. Returns only rows that gained something. */
export function mergeModelAnswers(
  rows: ModelRow[],
  answers: Map<OtherLang, Fields>,
): { id: string; translations: Record<string, ModelText> }[] {
  const out: { id: string; translations: Record<string, ModelText> }[] = [];
  rows.forEach((r, i) => {
    const t: Record<string, ModelText> = { ...(r.translations ?? {}) };
    let gained = false;
    for (const [lang, fields] of answers) {
      const wanted = MODEL_FIELDS.filter((f) => has(r[f]));
      if (!wanted.length || !wanted.every((f) => has(fields[`m${i}_${f}`]))) continue;
      const entry: ModelText = {};
      for (const f of wanted) entry[f] = fields[`m${i}_${f}`].trim();
      t[lang] = entry; gained = true;
    }
    if (gained) out.push({ id: r.id, translations: t });
  });
  return out;
}
