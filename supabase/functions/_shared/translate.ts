// _shared/translate — the automatic translation step (IO half).
//
// One call = one language. Uses Gemini 2.5 Flash, the cheap model the app
// already calls, with thinking off: translation needs none and thinking tokens
// are billed as output. Every answer goes through validateTranslation(); a
// failed call or a rejected answer is retried once and then returns null, and
// null always means "send the English".
import { buildTranslatePrompt, parseModelJson, validateTranslation } from "./translate-lib.ts";
import type { Fields, OtherLang } from "./translate-lib.ts";

const MODEL = "gemini-2.5-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function callOnce(prompt: string, key: string, timeoutMs: number, noThinking: boolean): Promise<{ status: number; text: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const resp = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: abort.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
          ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });
    if (!resp.ok) return { status: resp.status, text: "" };
    const result = await resp.json();
    const parts = result.candidates?.[0]?.content?.parts ?? [];
    // deno-lint-ignore no-explicit-any
    return { status: 200, text: parts.filter((p: any) => p.text).map((p: any) => p.text).join("") };
  } catch (_) {
    return { status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function translateFields(
  fields: Fields,
  lang: OtherLang,
  opts: { timeoutMs?: number; tag?: string } = {},
): Promise<Fields | null> {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) return null;
  const prompt = buildTranslatePrompt(fields, lang);
  const timeoutMs = opts.timeoutMs ?? 60000;
  let noThinking = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callOnce(prompt, key, timeoutMs, noThinking);
    // A 400 may be the thinking switch itself being refused; try once without it.
    if (r.status === 400 && noThinking) { noThinking = false; continue; }
    if (r.status !== 200) { console.warn(`[translate] ${opts.tag ?? ""} ${lang}: HTTP ${r.status}`); continue; }
    const ok = validateTranslation(fields, parseModelJson(r.text));
    if (ok) return ok;
    console.warn(`[translate] ${opts.tag ?? ""} ${lang}: answer rejected (tags, tokens or shape changed)`);
  }
  return null;
}

/** Several languages at once. Languages that failed are simply absent. */
export async function translateMany(
  fields: Fields,
  langs: OtherLang[],
  opts: { timeoutMs?: number; tag?: string } = {},
): Promise<Map<OtherLang, Fields>> {
  const out = new Map<OtherLang, Fields>();
  const results = await Promise.all([...new Set(langs)].map(async (l) => [l, await translateFields(fields, l, opts)] as const));
  for (const [l, f] of results) if (f) out.set(l, f);
  return out;
}
