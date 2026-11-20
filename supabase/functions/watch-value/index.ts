// Supabase Edge Function: watch-value
// Uses Gemini with grounded search to look up current market value for a watch.
// Called from the app when a user taps "Check Value" on a watch.
//
// Required Supabase secrets:
//   GEMINI_API_KEY — for the lookup
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildWatchDesc,
  describeEmptyAnswer,
  extractJson,
  geminiAttemptTimeouts,
  isCacheFresh,
  pickReplay,
  roundEstimate,
  salvageJson,
  shouldRetryWithoutRef,
  utcDayStartIso,
} from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { clampText, isDemoUser } from "../_shared/ai-guard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = serviceKey();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // Verify authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Audit SEC-23-18: the shared demo account never valued anything (0 calls in
    // 30 days) and anyone can enter it, so it gets no paid lookups; every field
    // that reaches the prompt is clamped.
    if (isDemoUser(user)) {
      return new Response(JSON.stringify({ error: "demo", message: "Price lookups need an account — sign up to use them." }), {
        status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const body = await req.json();
    const brand = clampText(body.brand), model = clampText(body.model), reference = clampText(body.reference, 60);
    const condition = clampText(body.condition, 40), year = clampText(body.year, 20);
    const watch_id = clampText(body.watch_id, 64), source = clampText(body.source, 40);

    if (!brand) {
      return new Response(JSON.stringify({ error: "brand is required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // If watch_id provided, check for a recent cached price (< 7 days old)
    if (watch_id) {
      const { data: cached } = await supabase
        .from("watches")
        .select("market_price, market_price_date, price_history")
        .eq("id", watch_id)
        .eq("user_id", user.id)
        .single();

      if (cached?.market_price && isCacheFresh(cached.market_price_date, Date.now())) {
        {
          console.log(`[watch-value] Returning cached price $${cached.market_price} (${cached.market_price_date}) for watch ${watch_id}`);
          return new Response(JSON.stringify({
            estimated_value_usd: { low: null, mid: Number(cached.market_price), high: null },
            confidence: "cached",
            notes: `Cached price from ${cached.market_price_date}. Prices refresh weekly.`,
            query: { brand, model, reference, condition, year },
            looked_up_at: cached.market_price_date,
            cached: true,
          }), {
            status: 200,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
      }
    }

    // A retried lookup (the client's connection dropped) gets the answer we
    // already computed, if it is the same question from the last 15 minutes.
    // Before the rate limit on purpose: the first ask was counted and paid for.
    if (watch_id && body.retry === true) {
      const { data: recent } = await supabase
        .from("watch_value_recent")
        .select("query, result, created_at")
        .eq("user_id", user.id)
        .eq("watch_id", watch_id)
        .maybeSingle();
      const replay = pickReplay(recent, { brand, model, reference, condition, year }, Date.now());
      if (replay) {
        console.log(`[watch-value] user=${user.id} src=${source ?? "unknown"} Replaying recent answer for watch ${watch_id}`);
        return new Response(JSON.stringify({ ...replay, replayed: true }), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // Rate limit: 20 lookups per user per day. Atomic check-and-increment via RPC —
    // the prior read-then-update let concurrent requests slip past the cap.
    const DAILY_LIMIT = 40;
    const todayStartIso = utcDayStartIso(Date.now());
    const rlKey = `watch-value:${user.id}`;
    const { data: rlCount, error: rlErr } = await supabase.rpc("bump_rate_limit", {
      p_user: user.id, p_fn: rlKey, p_window_floor: todayStartIso, p_now: todayStartIso,
    });
    // Fail closed: an unknown count must not mean unlimited paid lookups.
    if (rlErr || typeof rlCount !== "number") {
      console.error("[watch-value] rate limit check failed:", rlErr?.message);
      return new Response(JSON.stringify({ error: "busy", message: "Try again in a moment." }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (rlCount > DAILY_LIMIT) {
      return new Response(JSON.stringify({ error: "daily_limit", message: "Price lookups are limited to once per day. Try again tomorrow." }), {
        status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const watchDesc = buildWatchDesc({ brand, model, reference, year, condition });

    // `source` names the calling surface (single / batch / update-prices / add-flow).
    // Two identical lookups landed 0.59s and 1.07s apart on 2026-08-26 — same user,
    // same watch, both engines run, both billed. The logs could not say which screen
    // fired them, so there was nothing to fix. Now they can.
    console.log(`[watch-value] user=${user.id} src=${source ?? "unknown"} Looking up: ${watchDesc}`);

    const promptFor = (desc: string) => `What is the current market value (in USD) of this watch: ${desc}?

Search for recent sold prices and current listings. Check Chrono24, WatchCharts, eBay sold listings, and dealer sites.

Respond with ONLY a JSON object, no other text:
{
  "estimated_value_usd": { "low": <number>, "mid": <number>, "high": <number> },
  "retail_price_usd": <number or null>,
  "currency_note": "all values in USD",
  "data_points": [
    { "source": "<site name>", "price_usd": <number>, "condition": "<new/used/etc>", "url": "<url if available>" }
  ],
  "confidence": "<high|medium|low>",
  "notes": "<brief note on price range, trends, or caveats>"
}

Rules:
- low/mid/high should reflect the realistic range for this watch in typical pre-owned condition with box and papers
- Include at least 2-3 data points from different sources
- If you cannot find reliable pricing, set confidence to "low" and explain in notes
- retail_price_usd is the current MSRP if available, null otherwise
- All prices in USD`;
    const prompt = promptFor(watchDesc);

    // Primary: Gemini 2.5 Flash with grounded search — same engine strategy as
    // identify-watch, ~90% cheaper than Sonnet + web search at equivalent accuracy
    // (validated 2026-07-19 against the full test collection, ±7% median deviation).
    let parsed: Record<string, unknown> | null = null;
    if (GEMINI_API_KEY) {
      // 35s, not 60s. Measured over 80 live lookups (2026-08-13..19): median 15s,
      // p90 23s, slowest healthy call 33s — a request still running at 35s has
      // hung, not slowed down. The old 60s cap made the user wait the full minute
      // BEFORE the Claude fallback even started, so the one hang on 2026-08-17
      // took 95s end to end and the user gave up and retried at 89s. Raise this
      // only if the p90 above moves; a too-generous timeout costs a real wait on
      // every hang and buys nothing, because Gemini never recovers after ~35s.
      //
      // Batch (update-prices) lookups get ONE shorter second attempt after an
      // abort/network failure before giving up: a hang
      // is a per-request fluke (2026-10-12: the 38 batch calls around two hung
      // ones all answered in 10-30s), and nobody is waiting on a single batch
      // row. An HTTP error or a parse failure is never retried as-is — both
      // times those appeared they were real bugs, and the same request fails
      // the same way (the no-sources pass below changes the request). The retry log line must NOT say "Gemini exception/error" —
      // cost-report.py counts those as failures, and a recovered stall isn't one.
      //
      // There is NO second engine (since 2026-11-19). A lookup Gemini cannot
      // answer ends as "not found" and the member keeps the price they had —
      // the Claude + web search fallback cost ~100x a Gemini call to rescue
      // ~4% of lookups, and was most of the day-to-day swing in the bill.
      const attemptTimeouts = geminiAttemptTimeouts(source);
      //
      // One more pass, only when Gemini searched, found zero sources and wrote
      // nothing for a lookup that has a reference number: the same lookup with
      // the reference dropped (see shouldRetryWithoutRef). An empty answer comes
      // back in ~4s, so this costs a person ~15s.
      const noRefDesc = buildWatchDesc({ brand, model, year, condition });
      const passes = [prompt];
      for (let pass = 0; pass < passes.length && !parsed; pass++) {
        for (let attempt = 0; attempt < attemptTimeouts.length; attempt++) {
          try {
            const geminiAbort = new AbortController();
            const geminiTimer = setTimeout(() => geminiAbort.abort(), attemptTimeouts[attempt]);
            const geminiResponse = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
                signal: geminiAbort.signal,
                body: JSON.stringify({
                  contents: [{ parts: [{ text: passes[pass] }] }],
                  tools: [{ google_search: {} }],
                  // The cap covers thinking + answer on 2.5 Flash. Measured live:
                  // answers run 651-1049 tokens, thinking 1596-2407. A heavy-thinking
                  // run (the 32-35s ones that failed to parse) can spend most of an
                  // 8192 budget before the JSON is finished, and a truncated object
                  // is unrecoverable at parse time — so give it headroom. Billing is
                  // per token generated, not per cap, so this costs nothing unused.
                  generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
                }),
              },
            );
            clearTimeout(geminiTimer);
            if (geminiResponse.ok) {
              const geminiResult = await geminiResponse.json();
              const candidate = geminiResult.candidates?.[0];
              const finishReason = candidate?.finishReason || "unknown";
              const parts = candidate?.content?.parts ?? [];
              const text = parts.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text).join("");
              try {
                parsed = extractJson(text);
              } catch (_e) {
                parsed = null;
              }
              if (parsed && !parsed.estimated_value_usd) parsed = null;
              // A MAX_TOKENS response still carries a complete estimate up front —
              // both 2026-08-08 ones did. Recover it rather than report "not
              // found" for a lookup Gemini had already answered.
              // Require a usable mid: the UI keys off it entirely, so a range
              // with only `low` would render as not found anyway.
              if (!parsed) {
                const salvaged = salvageJson(text);
                const est = salvaged?.estimated_value_usd as Record<string, unknown> | undefined;
                if (est && roundEstimate(est.mid) !== null) {
                  salvaged!._salvaged = true;
                  parsed = salvaged;
                }
              }
              console.log(`[watch-value] DIAG gemini finish=${finishReason} textLen=${text.length} ok=${!!parsed} salvaged=${!!parsed?._salvaged} usage=${JSON.stringify(geminiResult.usageMetadata ?? {})}`);
              if (parsed) {
                parsed._engine = "gemini";
                if (pass > 0) parsed._noRef = true;
              } else {
                // Separate DIAG line on purpose: cost-report.py counts the
                // "parse failed" line, and this must not double that count.
                if (text.length === 0) {
                  console.log(`[watch-value] DIAG empty-answer ${describeEmptyAnswer(geminiResult)}`);
                }
                if (pass === 0 && shouldRetryWithoutRef(geminiResult, text, reference)) {
                  // Must not say "Gemini parse failed/error/exception" — a
                  // recovered lookup isn't a failure in the cost report.
                  passes.push(promptFor(noRefDesc));
                  console.log(`[watch-value] user=${user.id} Gemini found no sources, retrying without the reference: ${noRefDesc}`);
                } else {
                  const usage = geminiResult.usageMetadata ?? {};
                  console.error(
                    `[watch-value] user=${user.id} Gemini parse failed, not found. finish=${finishReason} len=${text.length} parts=${parts.length} tokens=${JSON.stringify(usage)} HEAD:${text.slice(0, 200)} TAIL:${text.slice(-300)}`,
                  );
                }
              }
            } else {
              const errText = await geminiResponse.text();
              console.error(`[watch-value] user=${user.id} Gemini error, not found:`, geminiResponse.status, errText.slice(0, 300));
            }
            break; // got an HTTP response — handled above, a retry can't help
          } catch (geminiErr) {
            if (attempt < attemptTimeouts.length - 1) {
              console.log(`[watch-value] user=${user.id} Gemini stalled (attempt ${attempt + 1}/${attemptTimeouts.length}), retrying: ${(geminiErr as Error).message}`);
              continue;
            }
            console.error(`[watch-value] user=${user.id} Gemini exception, not found:`, (geminiErr as Error).message);
          }
        }
      }
    }

    // No answer: say so and stop. Nothing is saved, so the price the member
    // already has stays. 200 on purpose — every caller already treats an answer
    // with no mid as "no price found", including pages cached before this.
    // The log line carries engine=none: cost-report.py counts it.
    if (!parsed) {
      console.log(`[watch-value] user=${user.id} ${watchDesc} → not found engine=none`);
      return new Response(JSON.stringify({
        error: "not_found",
        estimated_value_usd: null,
        query: { brand, model, reference, condition, year },
        looked_up_at: new Date().toISOString(),
      }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // Strip false precision from the estimate range (e.g. $4,801.5 → $4,800).
    // Data points and MSRP are real observed prices — leave those untouched.
    const ev = parsed.estimated_value_usd as Record<string, unknown> | undefined;
    if (ev) {
      for (const k of ["low", "mid", "high"]) {
        const rounded = roundEstimate(ev[k]);
        if (rounded !== null) ev[k] = rounded;
      }
    }

    // Add metadata
    parsed.query = { brand, model, reference, condition, year };
    parsed.looked_up_at = new Date().toISOString();

    console.log(`[watch-value] user=${user.id} ${watchDesc} → $${parsed.estimated_value_usd?.low}-${parsed.estimated_value_usd?.high} (${parsed.confidence}) engine=${parsed._engine}${parsed._salvaged ? " salvaged=1" : ""}${parsed._noRef ? " noref=1" : ""}`);

    // NOTE: no server-side save. Prices are only written by the client after the
    // user explicitly approves them (Save/Apply in the UI). watch_id is still
    // accepted — it's used above for the 7-day cache read.
    //
    // The answer itself is kept briefly so a retry after a dropped connection
    // can be replayed (see pickReplay). Failing to keep it must never fail the
    // lookup the caller is waiting on.
    if (watch_id) {
      try {
        const { error: keepErr } = await supabase.from("watch_value_recent").upsert({
          user_id: user.id,
          watch_id,
          query: parsed.query,
          result: parsed,
          created_at: parsed.looked_up_at,
        });
        if (keepErr) console.log(`[watch-value] could not keep recent answer: ${keepErr.message}`);
      } catch (keepEx) {
        console.log(`[watch-value] could not keep recent answer: ${(keepEx as Error).message}`);
      }
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[watch-value] Error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong — please try again." }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
