// translate-facts — pure helpers (no IO).
import { OTHER_LANGS, srcHash } from "../_shared/translate-lib.ts";
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

/** A batch cut in two, for asking again after a refused answer. One field (or none)
 *  cannot be cut: returns it alone. */
export function halves(fields: Fields): Fields[] {
  const keys = Object.keys(fields);
  if (keys.length < 2) return [fields];
  const mid = Math.ceil(keys.length / 2);
  const pick = (ks: string[]) => Object.fromEntries(ks.map((k) => [k, fields[k]]));
  return [pick(keys.slice(0, mid)), pick(keys.slice(mid))];
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Model pages (watch_models.translations) ──────────────────────────────────
// Two parts per language, each stored whole or not at all:
//   the story  — description + history
//   the extras — the spec values that are words (specs) and the note under each
//                reference (refs_by_era[].note)
// They are tracked apart so a model whose story is already translated is asked
// only for its extras, never for the story again.
//
// Stored shape, per language:
//   { description, history,
//     specs: { materials: "…", movement: "…" },   only the keys that were translated
//     ref_notes: ["…", null, "…"],                same length and order as refs_by_era
//     extras: 1 }                                 the extras were handled (EXTRAS_V)
// ref_notes go by position. That is safe because the stored translations can
// never outlive the English they were made from: the database strips the extras
// whenever specs or refs_by_era change (sql/2026-11-14-model-spec-translations.sql),
// the job checks the English again just before it stores (modelSource), and the
// page uses ref_notes only when its length matches refs_by_era.
export type ModelText = {
  description?: string; history?: string;
  specs?: Record<string, string>; ref_notes?: (string | null)[]; extras?: number;
};
export type ModelRow = {
  id: string; description: string | null; history: string | null;
  specs?: unknown; refs_by_era?: unknown;
  translations: Record<string, ModelText> | null; translate_attempts: number;
};
/** Bump to have every model's extras made again. */
export const EXTRAS_V = 1;
const MODEL_FIELDS = ["description", "history"] as const;
// The spec values the model page prints (model-page.js: hero caption + reference rows).
export const SPEC_KEYS = ["type", "size", "water_resistance", "movement", "materials"] as const;
const has = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** True when a spec value has words in it. "40mm", "37.5mm–48mm" and
 *  "10 bar (100m)/145 psi (328ft)" are the same in every language and are never sent. */
export function hasWords(v: string): boolean {
  return /\p{L}{2,}/u.test(v.replace(/(?<!\p{L})(?:mm|cm|m|ft|bar|atm|psi|vph)(?!\p{L})/giu, ""));
}

const refsOf = (row: ModelRow): unknown[] => Array.isArray(row.refs_by_era) ? row.refs_by_era : [];

/** The English of a model's extras: s_<spec key> and r<position in refs_by_era>. */
export function extraFields(row: ModelRow): Fields {
  const out: Fields = {};
  const sp = (row.specs && typeof row.specs === "object" && !Array.isArray(row.specs)) ? row.specs as Record<string, unknown> : {};
  for (const k of SPEC_KEYS) { const v = sp[k]; if (has(v) && hasWords(v)) out[`s_${k}`] = v; }
  refsOf(row).forEach((r, j) => {
    const note = (r && typeof r === "object") ? (r as Record<string, unknown>).note : null;
    if (has(note)) out[`r${j}`] = note;
  });
  return out;
}

/** Fingerprint of everything a model's translations are made from. The job reads
 *  it before asking and again before storing; a model edited in between is skipped. */
export function modelSource(row: ModelRow): string {
  return srcHash({ description: row.description ?? "", history: row.history ?? "", n: String(refsOf(row).length), ...extraFields(row) });
}

/** Every number in the English must still be in the translation ("40mm" may
 *  become "40 mm" and "18,000" "18.000", but not "38"). English ordinals
 *  ("20th century") are left out: other languages write them as words or in
 *  Roman numerals. */
export function numbersKept(src: string, out: string): boolean {
  const runs = (s: string): string[] => s.match(/\d+/g) ?? [];
  const left = runs(out);
  for (const n of runs(src.replace(/\d+(?:st|nd|rd|th)\b/gi, " "))) {
    const i = left.indexOf(n);
    if (i === -1) return false;
    left.splice(i, 1);
  }
  return true;
}

/** What a model still lacks in one language. */
export function modelMissing(row: ModelRow, lang: OtherLang): { story: boolean; extras: boolean } {
  const t = (row.translations ?? {})[lang];
  return {
    story: MODEL_FIELDS.some((f) => has(row[f]) && !has(t?.[f])),
    extras: t?.extras !== EXTRAS_V,
  };
}

/** Languages a model still lacks. A language counts as done only when every
 *  field the English has is there, so a part is never half one language. */
export function modelMissingLangs(row: ModelRow): OtherLang[] {
  return OTHER_LANGS.filter((l) => { const m = modelMissing(row, l); return m.story || m.extras; });
}

/** One request body per language, keyed m0_description, m0_history, m0_s_type,
 *  m0_r0, m1_… Only the parts that language lacks. */
export function modelBatchFields(rows: ModelRow[], lang: OtherLang): Fields {
  const out: Fields = {};
  rows.forEach((r, i) => {
    const m = modelMissing(r, lang);
    if (m.story) for (const f of MODEL_FIELDS) if (has(r[f])) out[`m${i}_${f}`] = r[f] as string;
    if (m.extras) for (const [k, v] of Object.entries(extraFields(r))) out[`m${i}_${k}`] = v;
  });
  return out;
}

/** Fold the answers back in. A part is stored for a model only when every field
 *  it asked for came back (and, for the extras, kept its numbers); a model with
 *  no extras to translate is marked done without a call. Returns only rows that
 *  gained something. */
export function mergeModelAnswers(
  rows: ModelRow[],
  answers: Map<OtherLang, Fields>,
): { id: string; translations: Record<string, ModelText> }[] {
  const out: { id: string; translations: Record<string, ModelText> }[] = [];
  rows.forEach((r, i) => {
    const t: Record<string, ModelText> = { ...(r.translations ?? {}) };
    let gained = false;
    for (const lang of OTHER_LANGS) {
      const fields = answers.get(lang) ?? {};
      const missing = modelMissing(r, lang);
      const entry: ModelText = { ...(t[lang] ?? {}) };
      let got = false;
      if (missing.story) {
        const wanted = MODEL_FIELDS.filter((f) => has(r[f]));
        if (wanted.length && wanted.every((f) => has(fields[`m${i}_${f}`]))) {
          for (const f of wanted) entry[f] = fields[`m${i}_${f}`].trim();
          got = true;
        }
      }
      if (missing.extras) {
        const wanted = extraFields(r);
        const keys = Object.keys(wanted);
        if (keys.every((k) => has(fields[`m${i}_${k}`]) && numbersKept(wanted[k], fields[`m${i}_${k}`]))) {
          const specs: Record<string, string> = {};
          const notes: (string | null)[] = refsOf(r).map(() => null);
          for (const k of keys) {
            const v = fields[`m${i}_${k}`].trim();
            if (k.startsWith("s_")) specs[k.slice(2)] = v; else notes[Number(k.slice(1))] = v;
          }
          entry.specs = specs; entry.ref_notes = notes; entry.extras = EXTRAS_V;
          got = true;
        }
      }
      if (got) { t[lang] = entry; gained = true; }
    }
    if (gained) out.push({ id: r.id, translations: t });
  });
  return out;
}
