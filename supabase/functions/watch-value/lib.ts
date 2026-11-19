// watch-value — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export function extractJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// All the text in a Claude response, in order.
//
// With web search Claude answers in several text blocks: a note before it
// searches ("Let me search more specifically."), then the answer, itself split
// wherever a citation attaches. Taking only the first block read the note and
// missed the price (2026-11-13 and 2026-11-17: Claude billed, member shown an
// error). Tool-use and search-result blocks carry no `text` and are skipped.
export function claudeAnswerText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

// Most cuts we'll try before giving up. Each attempt re-parses the prefix, so
// an adversarially comma-heavy blob shouldn't turn salvage into a hot loop.
const MAX_SALVAGE_ATTEMPTS = 50;

// Last-resort recovery for an engine response that stopped mid-object.
//
// Gemini hits MAX_TOKENS two different ways — thinking eats the shared output
// budget, or the answer degenerates into a repetition loop — and both leave a
// prefix whose leading fields, estimated_value_usd included, are already
// complete. extractJson is all-or-nothing, so a single missing brace used to
// throw that away and buy a Claude re-run instead.
//
// Walks the text tracking string state and the open-bracket stack, collecting
// every offset where the document could be truncated and legally closed (just
// before a separating comma, or just after a nested value closes), then tries
// those cuts newest-first. Returns null when nothing parseable survives.
export function salvageJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  const cuts: { end: number; closers: string }[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
    } else if (c === "}" || c === "]") {
      stack.pop();
      cuts.push({ end: i + 1, closers: closersFor(stack) });
      if (stack.length === 0) break; // top-level object closed — ignore any trailing text
    } else if (c === "," && stack.length > 0) {
      cuts.push({ end: i, closers: closersFor(stack) });
    }
  }

  const floor = Math.max(0, cuts.length - MAX_SALVAGE_ATTEMPTS);
  for (let k = cuts.length - 1; k >= floor; k--) {
    try {
      const obj = JSON.parse(text.slice(start, cuts[k].end) + cuts[k].closers);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch (_e) {
      // This cut landed somewhere unparseable — try an earlier one.
    }
  }
  return null;
}

function closersFor(stack: string[]): string {
  let out = "";
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}

// Human-readable watch description used in the lookup prompt + logs.
export function buildWatchDesc(
  q: { brand?: string; model?: string; reference?: string; year?: string | number; condition?: string },
): string {
  return [
    q.brand,
    q.model || "",
    q.reference ? `ref. ${q.reference}` : "",
    q.year ? `(${q.year})` : "",
    q.condition ? `in ${q.condition} condition` : "",
  ].filter(Boolean).join(" ");
}

// True if a cached market price is still fresh (< 7 days old).
export function isCacheFresh(
  marketPriceDate: string | null | undefined,
  nowMs: number,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): boolean {
  if (!marketPriceDate) return false;
  const ageMs = nowMs - new Date(marketPriceDate).getTime();
  return ageMs >= 0 && ageMs < maxAgeMs;
}

// Start-of-UTC-day ISO string for a given moment.
export function utcDayStartIso(nowMs: number): string {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Per-attempt Gemini timeouts for one lookup. Batch price refreshes
// (update-prices) get a second, shorter attempt after a hang: rows in that
// modal render independently, so nobody waits on any one of them, and a retry
// replaces a ~$0.10 Claude+web-search fallback with a ~$0.001 Gemini call
// (2 of 40 batch lookups hung past 35s on 2026-10-12). Interactive sources
// keep the single 35s attempt — see the timeout rationale in index.ts.
export function geminiAttemptTimeouts(source: string): number[] {
  return source === "update-prices" ? [35000, 20000] : [35000];
}

// Round a value estimate to the nearest $50 — raw engine output can carry false
// precision (e.g. 4801.5 from averaging listings). Values that would round to 0
// keep whole-dollar rounding instead so tiny estimates aren't wiped out.
export function roundEstimate(v: unknown, step = 50): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n / step) * step;
  return rounded === 0 ? Math.round(n) : rounded;
}

// Everything Google says about WHY a candidate came back with no text. Gemini
// sometimes runs its search, bills thinking + output tokens, then returns
// finish=STOP with zero parts (7 times 2026-08-16..11-13; one watch, Tissot
// T120.407.22.041.00, does it every time). The usage line alone can't explain
// that, so this keeps the reason fields and the shape of what DID come back —
// key names, search queries, source count — never page text, so the log stays
// small. Returns a compact JSON string capped at `max` chars.
export function describeEmptyAnswer(result: unknown, max = 1500): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const cands = Array.isArray(r.candidates) ? r.candidates : [];
  const c = (cands[0] ?? {}) as Record<string, unknown>;
  const content = (c.content ?? null) as Record<string, unknown> | null;
  const gm = (c.groundingMetadata ?? null) as Record<string, unknown> | null;
  const flagged = Array.isArray(c.safetyRatings)
    ? (c.safetyRatings as Record<string, unknown>[])
      .filter((s) => s.blocked || (s.probability && s.probability !== "NEGLIGIBLE"))
    : [];
  const out = JSON.stringify({
    candidates: cands.length,
    candidateKeys: Object.keys(c),
    finishMessage: c.finishMessage ?? null,
    contentKeys: content ? Object.keys(content) : null,
    role: content?.role ?? null,
    promptFeedback: r.promptFeedback ?? null,
    safetyFlagged: flagged,
    searchQueries: Array.isArray(gm?.webSearchQueries) ? gm!.webSearchQueries : null,
    groundingChunks: Array.isArray(gm?.groundingChunks) ? (gm!.groundingChunks as unknown[]).length : null,
    groundingKeys: gm ? Object.keys(gm) : null,
    modelVersion: r.modelVersion ?? null,
  });
  return out.length > max ? out.slice(0, max) + "…" : out;
}

// Should an empty Gemini answer be re-asked with the reference number dropped?
// Only for the one shape we have evidence for: no text AND no web sources, on
// a lookup that HAS a reference. The Tissot T120.407.22.041.00 lookup came back
// empty 3 of 3 times — all six of Gemini's searches quoted the full reference
// and none returned a source — while the same watch without the reference
// answered 3 of 3 on Gemini (2026-11-14, $450-650 high, vs Claude's $400-700).
// An empty answer that DID find sources is a different failure; leave it to
// the Claude fallback rather than guess.
export function shouldRetryWithoutRef(result: unknown, text: string, reference: string): boolean {
  if (!reference.trim() || text.trim() !== "") return false;
  const r = (result ?? {}) as { candidates?: { groundingMetadata?: { groundingChunks?: unknown } }[] };
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks;
  return !Array.isArray(chunks) || chunks.length === 0;
}

// The fields that make two lookups "the same question". Order is fixed so the
// stored copy and a retry's copy compare equal as strings.
export function queryKey(
  q: { brand?: string; model?: string; reference?: string; condition?: string; year?: string | number },
): string {
  return JSON.stringify([q.brand ?? "", q.model ?? "", q.reference ?? "", q.condition ?? "", String(q.year ?? "")]);
}

// The answer to replay for a retried lookup, or null to run it again.
//
// A client re-asks (`retry: true`) only after its connection dropped, and the
// usual reason is that the answer was computed and never arrived (2026-11-16:
// 8 of 10 batch answers lost when the page left the foreground). Replaying is
// only right for the same question asked moments ago: an edited reference or
// an old row must run a real lookup.
export function pickReplay(
  row: { query?: unknown; result?: unknown; created_at?: string | null } | null | undefined,
  query: Parameters<typeof queryKey>[0],
  nowMs: number,
  maxAgeMs = 15 * 60 * 1000,
): Record<string, unknown> | null {
  if (!row || !row.created_at || !row.result || typeof row.result !== "object") return null;
  const ageMs = nowMs - new Date(row.created_at).getTime();
  if (!(ageMs >= 0 && ageMs < maxAgeMs)) return null;
  if (!row.query || typeof row.query !== "object") return null;
  if (queryKey(row.query as Parameters<typeof queryKey>[0]) !== queryKey(query)) return null;
  const est = (row.result as Record<string, unknown>).estimated_value_usd as Record<string, unknown> | undefined;
  if (!est || typeof est.mid !== "number") return null;
  return row.result as Record<string, unknown>;
}
