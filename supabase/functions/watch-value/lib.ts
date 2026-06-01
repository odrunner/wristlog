// watch-value — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export function extractJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
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
