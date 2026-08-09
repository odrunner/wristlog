// Supabase Edge Function: watch-value
// Uses Claude web search to look up current market value for a watch.
// Called from the app when a user taps "Check Value" on a watch.
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY — for Claude web search
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildWatchDesc,
  extractJson,
  isCacheFresh,
  roundEstimate,
  salvageJson,
  utcDayStartIso,
} from "./lib.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

    const { brand, model, reference, condition, year, watch_id } = await req.json();

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

    // Rate limit: 20 lookups per user per day. Atomic check-and-increment via RPC —
    // the prior read-then-update let concurrent requests slip past the cap.
    const DAILY_LIMIT = 40;
    const todayStartIso = utcDayStartIso(Date.now());
    const rlKey = `watch-value:${user.id}`;
    const { data: rlCount } = await supabase.rpc("bump_rate_limit", {
      p_user: user.id, p_fn: rlKey, p_window_floor: todayStartIso, p_now: todayStartIso,
    });
    if (typeof rlCount === "number" && rlCount > DAILY_LIMIT) {
      return new Response(JSON.stringify({ error: "daily_limit", message: "Price lookups are limited to once per day. Try again tomorrow." }), {
        status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const watchDesc = buildWatchDesc({ brand, model, reference, year, condition });

    console.log(`[watch-value] user=${user.id} Looking up: ${watchDesc}`);

    const prompt = `What is the current market value (in USD) of this watch: ${watchDesc}?

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

    // Primary: Gemini 2.5 Flash with grounded search — same engine strategy as
    // identify-watch, ~90% cheaper than Sonnet + web search at equivalent accuracy
    // (validated 2026-07-19 against the full test collection, ±7% median deviation).
    let parsed: Record<string, unknown> | null = null;
    if (GEMINI_API_KEY) {
      try {
        const geminiAbort = new AbortController();
        const geminiTimer = setTimeout(() => geminiAbort.abort(), 60000);
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: geminiAbort.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
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
          // both 2026-08-08 fallbacks did. Recover it rather than pay for a
          // Claude re-run of a lookup Gemini had already answered.
          // Require a usable mid: the UI keys off it entirely, so salvaging a
          // range with only `low` would render "N/A" — worse than the Claude
          // re-run this is replacing.
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
          } else {
            const usage = geminiResult.usageMetadata ?? {};
            console.error(
              `[watch-value] Gemini parse failed, falling back to Claude. finish=${finishReason} len=${text.length} parts=${parts.length} tokens=${JSON.stringify(usage)} HEAD:${text.slice(0, 200)} TAIL:${text.slice(-300)}`,
            );
          }
        } else {
          const errText = await geminiResponse.text();
          console.error("[watch-value] Gemini error, falling back to Claude:", geminiResponse.status, errText.slice(0, 300));
        }
      } catch (geminiErr) {
        console.error("[watch-value] Gemini exception, falling back to Claude:", (geminiErr as Error).message);
      }
    }

    // Fallback: Claude Sonnet + web search (previous primary engine)
    if (!parsed) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("[watch-value] Claude API error:", resp.status, errText);
        return new Response(JSON.stringify({ error: "api_failed", status: resp.status }), { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }

      const result = await resp.json();
      const textBlock = result.content?.find((b: { type: string }) => b.type === "text");
      // extractJson throws on malformed/truncated JSON (Claude runs with a 2048
      // max_tokens cap, so a long answer can be cut mid-object). Without this
      // guard the throw skips the parse_failed branch below and surfaces a raw
      // SyntaxError from the outer catch, losing the raw text we need to debug.
      try {
        parsed = extractJson(textBlock?.text ?? "");
      } catch (_e) {
        parsed = null;
      }

      if (!parsed) {
        console.error("[watch-value] Could not parse response:", textBlock?.text);
        return new Response(JSON.stringify({ error: "parse_failed", raw: textBlock?.text?.slice(0, 500) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      parsed._engine = "claude";
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

    console.log(`[watch-value] ${watchDesc} → $${parsed.estimated_value_usd?.low}-${parsed.estimated_value_usd?.high} (${parsed.confidence}) engine=${parsed._engine}${parsed._salvaged ? " salvaged=1" : ""}`);

    // NOTE: no server-side save. Prices are only written by the client after the
    // user explicitly approves them (Save/Apply in the UI). watch_id is still
    // accepted — it's used above for the 7-day cache read.

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[watch-value] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
