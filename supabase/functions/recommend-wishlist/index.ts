// Supabase Edge Function: recommend-wishlist
// Ranks the user's wishlist against their collection + wear patterns with one
// Claude call (no web search — everything it needs is in the prompt). Called
// from the What-if simulator and the Wishlist page ("Recommend me").
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL / service key — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildRecommendPrompt, parseRecommendResponse, sanitizeRecommendPayload } from "./lib.ts";
import { utcDayStartIso } from "../watch-value/lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { clampText, isDemoUser, oversized } from "../_shared/ai-guard.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = serviceKey();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: JSON_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: JSON_HEADERS });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }

    // Same policy as the other paid AI endpoints (audit SEC-23-18): the shared
    // demo account gets no paid calls, and every field reaching the prompt is
    // clamped in sanitizeRecommendPayload.
    if (isDemoUser(user)) {
      return new Response(JSON.stringify({ error: "demo", message: "Recommendations need an account — sign up to use them." }), {
        status: 403, headers: JSON_HEADERS,
      });
    }

    const body = await req.json();
    // Byte cap before any per-field clamping: 300 collection + 100 wishlist
    // items serialize well under this; anything bigger is not a real client.
    if (oversized(body, 120000)) {
      return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: JSON_HEADERS });
    }
    const source = clampText(body?.source, 40);
    const payload = sanitizeRecommendPayload(body);
    if (payload.wishlist.length < 2) {
      return new Response(JSON.stringify({ error: "wishlist_too_small", message: "Add at least two wishlist watches first." }), {
        status: 400, headers: JSON_HEADERS,
      });
    }

    // Rate limit: 10 recommendations per user per day, atomic, fail closed.
    const DAILY_LIMIT = 10;
    const todayStartIso = utcDayStartIso(Date.now());
    const { data: rlCount, error: rlErr } = await supabase.rpc("bump_rate_limit", {
      p_user: user.id, p_fn: `recommend-wishlist:${user.id}`, p_window_floor: todayStartIso, p_now: todayStartIso,
    });
    if (rlErr || typeof rlCount !== "number") {
      console.error("[recommend-wishlist] rate limit check failed:", rlErr?.message);
      return new Response(JSON.stringify({ error: "busy", message: "Try again in a moment." }), { status: 503, headers: JSON_HEADERS });
    }
    if (rlCount > DAILY_LIMIT) {
      return new Response(JSON.stringify({ error: "daily_limit", message: "Daily recommendation limit reached. Try again tomorrow." }), {
        status: 429, headers: JSON_HEADERS,
      });
    }

    console.log(`[recommend-wishlist] user=${user.id} src=${source || "unknown"} coll=${payload.collection.length} wish=${payload.wishlist.length}`);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: buildRecommendPrompt(payload) }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[recommend-wishlist] Claude API error:", resp.status, errText.slice(0, 300));
      return new Response(JSON.stringify({ error: "api_failed", status: resp.status }), { status: 502, headers: JSON_HEADERS });
    }
    const result = await resp.json();
    const textBlock = result.content?.find((b: { type: string }) => b.type === "text");
    const parsed = parseRecommendResponse(textBlock?.text ?? "", payload.wishlist.map((w) => w.id));
    if (!parsed) {
      console.error("[recommend-wishlist] Could not parse response:", textBlock?.text?.slice(0, 500));
      return new Response(JSON.stringify({ error: "parse_failed" }), { status: 500, headers: JSON_HEADERS });
    }

    console.log(`[recommend-wishlist] user=${user.id} picks=${parsed.picks.map((p) => p.id).join(",")}`);
    return new Response(JSON.stringify(parsed), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    console.error("[recommend-wishlist] Error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong — please try again." }), { status: 500, headers: JSON_HEADERS });
  }
});
