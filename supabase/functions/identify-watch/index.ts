// Supabase Edge Function: identify-watch
// Called from the client to identify watches in a photo using Claude Vision.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY  — API key from anthropic.com

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

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
    console.error("[identify-watch] Auth failed:", authError?.message, "tokenLen:", token.length);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Rate limiting: 100 requests per rolling 1-hour window ──
  const RATE_LIMIT = 100;
  const WINDOW_MS = 60 * 60 * 1000;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  try {
    const { data: rl } = await supabase
      .from("rate_limits")
      .select("window_start, request_count")
      .eq("user_id", user.id)
      .eq("function_name", "identify-watch")
      .single();

    if (rl) {
      const rlWindowStart = new Date(rl.window_start);
      if (rlWindowStart > windowStart) {
        if (rl.request_count >= RATE_LIMIT) {
          const resetTime = new Date(rlWindowStart.getTime() + WINDOW_MS);
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
            {
              status: 429,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
                "Retry-After": String(Math.ceil((resetTime.getTime() - now.getTime()) / 1000)),
              },
            }
          );
        }
        await supabase
          .from("rate_limits")
          .update({ request_count: rl.request_count + 1 })
          .eq("user_id", user.id)
          .eq("function_name", "identify-watch");
      } else {
        await supabase
          .from("rate_limits")
          .update({ window_start: now.toISOString(), request_count: 1 })
          .eq("user_id", user.id)
          .eq("function_name", "identify-watch");
      }
    } else {
      await supabase.from("rate_limits").insert({
        user_id: user.id,
        function_name: "identify-watch",
        window_start: now.toISOString(),
        request_count: 1,
      });
    }
  } catch (rlErr) {
    console.error("[identify-watch] Rate limit check error:", rlErr);
    // Fail open: allow the request if rate limit check fails
  }

  try {
    const { image, collection } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let collectionHint = "";
    if (Array.isArray(collection) && collection.length > 0) {
      const items = collection.map((w: any) =>
        `${w.brand} ${w.name}${w.ref ? ` (ref: ${w.ref})` : ""}`
      ).join(", ");
      collectionHint = `\nThe user owns these watches: ${items}\nIf you recognize a watch as one of these, use the exact names. Do NOT force a match — accuracy over matching.`;
    }

    const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, "");
    const mediaType = image.startsWith("data:image/png") ? "image/png" : "image/jpeg";

    const imageContent = {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64Data },
    };

    const apiHeaders = {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    };

    function extractJson(text: string) {
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    }

    const BRAND_CUES = `Brand identification guide:
- Rolex: Crown logo at 12 o'clock, "ROLEX" on dial, Cyclops lens over date, Oyster/Jubilee/President bracelets, fluted or smooth bezel
- Tudor: Shield logo at 12 o'clock, "TUDOR" on dial, snowflake hands on Black Bay models, rose or shield emblem
- Omega: Ω symbol, "OMEGA" on dial, Speedmaster has tachymeter bezel, Seamaster has wave dial pattern
- Patek Philippe: Calatrava cross logo, "PATEK PHILIPPE GENEVE" on dial, typically dress watches with leather straps
- Audemars Piguet: "AP" initials, Royal Oak has octagonal bezel with 8 exposed hexagonal screws, "Tapisserie" waffle dial pattern
- Vacheron Constantin: Maltese cross logo, "VACHERON CONSTANTIN" on dial, Overseas has distinctive cross-shaped bezel
- Cartier: Roman numerals, blue sword hands, "Cartier" in cursive, Santos has exposed screws
- IWC: "IWC SCHAFFHAUSEN" on dial, Portugieser has railroad chapter ring
- Breitling: Winged B logo, "BREITLING" on dial, often with slide rule bezel
- Panerai: Cushion case, crown-protecting bridge/lever, large luminous numerals
- Grand Seiko: "GS" logo, "Grand Seiko" text, zaratsu polishing with sharp case edges
- GRØNE: "GRØNE" on dial, Danish microbrand, minimalist Scandinavian design
- Anoma: "Anoma" on dial, microbrand`;

    // ── PASS 1: Detect watches and locate them (with thinking) ──
    const pass1 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            imageContent,
            {
              type: "text",
              text: `Count every watch visible in this image and locate each one precisely.

${BRAND_CUES}

For each watch, provide:
- position: description (e.g., "top", "second from top")
- boundingBox: [x, y, width, height] as percentages (0-100) of image. Be generous — include full case, dial, and strap visible.
- firstImpression: brand guess based on logos, text, and visual cues above

Return ONLY valid JSON after your analysis:
{"count": N, "watches": [{"position": "...", "boundingBox": [x, y, w, h], "firstImpression": "..."}]}`,
            },
          ],
        }],
      }),
    });

    if (!pass1.ok) {
      const errText = await pass1.text();
      console.error("[identify-watch] Pass 1 error:", pass1.status, errText);
      return new Response(
        JSON.stringify({ error: "AI detection failed", detail: pass1.status, apiError: errText }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const pass1Result = await pass1.json();
    const pass1Text = pass1Result.content?.[0]?.text ?? "";
    const detected = extractJson(pass1Text);
    if (!detected?.watches?.length) {
      return new Response(JSON.stringify({ watches: [] }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── PASS 2: Per-watch identification with thinking ──
    // Each watch gets its own API call for maximum focus
    const identifyPromises = detected.watches.map((w: any, i: number) => {
      const bb = w.boundingBox || [0, 0, 100, 100];
      return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-opus-4-20250514",
          max_tokens: 8000,
            messages: [{
            role: "user",
            content: [
              imageContent,
              {
                type: "text",
                text: `Focus ONLY on the watch at position [${bb.join(", ")}] (${w.position || "unknown"}) in this image. Ignore all other watches.

${BRAND_CUES}

First impression: ${w.firstImpression || "unknown"}

Study this specific watch carefully:
1. Read ALL text on the dial — brand name, model text, any small print
2. Examine the logo at 12 o'clock position
3. Note the bezel type (smooth, fluted, rotating, octagonal)
4. Note the bracelet/strap type
5. Check for date window, day window, chronograph subdials
6. Identify the exact brand, model name, and reference number

Provide:
- brand: Exact manufacturer name
- model: Model name with case size if determinable
- reference: Reference number if determinable, empty string if not
- dialText: All text you can read on the dial, comma-separated
- estimatedColor: Pick from: #c9a84c (gold), #94a3b8 (slate/silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (sky blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
- confidence: "high", "medium", or "low"
- productUrl: Product page URL if known, empty string if not
- boundingBox: [${bb.join(", ")}]
${collectionHint}

Return ONLY valid JSON:
{"brand": "...", "model": "...", "reference": "...", "dialText": "...", "estimatedColor": "...", "confidence": "...", "productUrl": "...", "boundingBox": [${bb.join(", ")}]}`,
              },
            ],
          }],
        }),
      });
    });

    // Run all per-watch identification calls in parallel
    const pass2Responses = await Promise.all(identifyPromises);
    const watches = [];

    for (let i = 0; i < pass2Responses.length; i++) {
      const resp = pass2Responses[i];
      if (!resp.ok) {
        console.error(`[identify-watch] Pass 2 watch ${i} error:`, resp.status);
        continue;
      }
      const result = await resp.json();
      const text = result.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (parsed) {
        watches.push(parsed);
      }
    }

    return new Response(JSON.stringify({ watches }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[identify-watch] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
