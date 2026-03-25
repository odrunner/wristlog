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
    const { image, collection, mode } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
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

    // ── DETECT MODE: find bounding boxes only (Opus for accurate spatial reasoning) ──
    if (mode === "detect") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-opus-4-20250514",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [
              imageContent,
              {
                type: "text",
                text: `Count every distinct wristwatch visible in this image and return their bounding boxes. Order them from top to bottom, left to right.

For each watch, return its bounding box: [x, y, width, height] as percentages (0-100) of image dimensions.

CRITICAL: The bounding box must be centered on the watch DIAL (the face where brand text is printed). Be very generous with size — include significant padding around the watch. It is much better to include too much background than to cut off any part of the dial or case. Add at least 20% extra padding on all sides.

Return ONLY valid JSON:
{"count": N, "watches": [{"boundingBox": [x, y, w, h]}]}

If no watches visible: {"count": 0, "watches": []}`,
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[identify-watch] Detect error:", response.status, errText);
        return new Response(
          JSON.stringify({ error: "Watch detection failed", detail: response.status }),
          { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const text = result.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (!parsed) {
        return new Response(
          JSON.stringify({ error: "Could not parse detection response" }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      parsed.count = parsed.count ?? parsed.watches?.length ?? 0;
      return new Response(JSON.stringify(parsed), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── IDENTIFY MODE (default): full identification of a single watch ──
    let collectionHint = "";
    if (Array.isArray(collection) && collection.length > 0) {
      const items = collection.map((w: any) =>
        `${w.brand} ${w.name}${w.ref ? ` (ref: ${w.ref})` : ""}`
      ).join(", ");
      collectionHint = `\nThe user owns these watches: ${items}\nIf you recognize a watch as one of these, use the exact names. Do NOT force a match — accuracy over matching.`;
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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            imageContent,
            {
              type: "text",
              text: `You are a world-class luxury watch expert. This image contains a watch. Focus all your attention on identifying it precisely.

${BRAND_CUES}

CRITICAL RULES:
1. Read the text on the dial FIRST. The brand name is almost always printed on the dial. If you can read it, use exactly what it says.
2. Look for the logo at 12 o'clock — crown = Rolex, shield = Tudor, cross = Patek Philippe, octagonal bezel = AP.
3. If you CANNOT clearly read or identify the brand, return brand as "Unknown". NEVER guess a brand you are not confident about. Returning "Unknown" is always better than a wrong answer.
4. Only use "high" confidence when you can clearly read the brand name on the dial or unmistakably recognize the design.

Provide:
- brand: The manufacturer. Use "Unknown" if you cannot clearly identify it.
- model: Model name with case size if determinable. Use "Unknown" if unsure.
- reference: Reference number if determinable. Empty string if unsure.
- dialText: ALL text visible on the dial, comma-separated. Read very carefully.
- estimatedColor: Pick from: #c9a84c (gold), #94a3b8 (slate/silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (sky blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
- confidence: "high", "medium", or "low"
- productUrl: Product page URL if known. Empty string if not.

Return ONLY valid JSON:
{"watches": [{"brand": "...", "model": "...", "reference": "...", "dialText": "...", "estimatedColor": "...", "confidence": "...", "productUrl": "..."}]}

If no watch visible: {"watches": []}${collectionHint}`,
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[identify-watch] API error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "AI identification failed", detail: response.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.content?.[0]?.text ?? "";
    const parsed = extractJson(text);
    if (!parsed) {
      return new Response(
        JSON.stringify({ error: "Could not parse AI response", raw: text }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
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
