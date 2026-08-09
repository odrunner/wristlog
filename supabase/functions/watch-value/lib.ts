// watch-value — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export function extractJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
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

// True if a stored rate-limit row falls within the current UTC-day window.
export function isInRateWindow(
  windowStart: string | null | undefined,
  todayStartIso: string,
): boolean {
  return !!windowStart && windowStart >= todayStartIso;
}

// Start-of-UTC-day ISO string for a given moment.
export function utcDayStartIso(nowMs: number): string {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Merge a freshly looked-up mid price into a watch's price_history, preserving
// the prior price as a "previous" entry (deduped). Returns the new history array.
export function mergePriceHistory(
  watch: { market_price?: number | string | null; market_price_date?: string | null; price_history?: unknown },
  mid: number,
  today: string,
): { src: string; date: string; price: number }[] {
  const history: { src: string; date: string; price: number }[] =
    Array.isArray(watch.price_history) ? watch.price_history as { src: string; date: string; price: number }[] : [];

  if (watch.market_price && watch.market_price_date) {
    const already = history.some(
      (h) => h.date === watch.market_price_date && h.price === Number(watch.market_price),
    );
    if (!already) {
      history.push({ src: "previous", date: watch.market_price_date, price: Number(watch.market_price) });
    }
  }

  history.push({ src: "WRotate", date: today, price: mid });
  return history;
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
