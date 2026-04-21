// Supabase Edge Function: identify-watch
// Called from the client to identify watches in a photo using Claude Vision.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY  — API key from anthropic.com

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

  const t0 = Date.now();
  let loggedMode = "identify";
  let loggedHasCollection = false;
  const logAttempt = async (watchesDetected: number | null, errMsg: string | null) => {
    try {
      await supabase.from("identify_attempts").insert({
        user_id: user.id,
        mode: loggedMode,
        has_collection: loggedHasCollection,
        watches_detected: watchesDetected,
        duration_ms: Date.now() - t0,
        error: errMsg,
      });
    } catch (logErr) {
      console.error("[identify-watch] log insert failed:", logErr);
    }
  };

  try {
    const { image, collection, mode, watchInfo } = await req.json();
    loggedMode = mode === "detect" ? "detect" : mode === "enhance" ? "enhance" : "identify";
    loggedHasCollection = Array.isArray(collection) && collection.length > 0;

    // ── ENHANCE MODE: enrich watch data with specs, history, dimensions ──
    if (mode === "enhance" && watchInfo) {
      const { brand, model, reference } = watchInfo;
      if (!brand || !model) {
        await logAttempt(null, "enhance_no_info");
        return new Response(JSON.stringify({ error: "Brand and model required" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const enhancePrompt = `Search for detailed specifications of this watch:
Brand: ${brand}
Model: ${model}
${reference ? `Reference: ${reference}` : ""}

Search thoroughly for this watch's full specifications. Check these sources in order:
1. The official manufacturer website (e.g. rolex.com/watches, audemarspiguet.com/en/watch-collection, omegawatches.com, patek.com) — these ALWAYS have case dimensions, movement info, and water resistance
2. Watch databases: watchbase.com, chrono24.com, watchuseek forums
3. Review sites and spec sheets

IMPORTANT: Major watch brands (Rolex, Omega, AP, Patek, Tudor, IWC, Breitling, Cartier, etc.) publish complete specs on their official websites including diameter, thickness, lug-to-lug, weight, water resistance, and crystal type. Search the manufacturer site directly — these specs ARE available, do not leave them empty.

Return a JSON object. Fill every field you can find — only use empty string "" if the information truly does not exist anywhere:
{
  "movementType": "automatic/manual-wind/quartz/digital/solar/spring-drive or empty",
  "caliber": "movement caliber name/number or empty",
  "caseMaterial": "e.g. stainless steel, 18k yellow gold, titanium or empty",
  "caseDiameter": "e.g. 41mm or empty",
  "caseLength": "lug-to-lug e.g. 48mm or empty",
  "caseThickness": "e.g. 12.5mm or empty",
  "weight": "e.g. 155g or empty",
  "waterResistance": "e.g. 300m or empty",
  "crystalType": "sapphire/mineral/plexiglas/hardlex or empty",
  "yearRange": "production years e.g. 2018-present or empty",
  "gender": "men's/women's/unisex or empty",
  "origin": "country of manufacture e.g. Switzerland, Japan or empty",
  "functions": ["list", "of", "key", "features/complications"],
  "description": "Short 1-2 sentence physical description of the watch",
  "background": "2-4 sentences about the model's history, significance, or notable facts. Include any interesting stories (e.g. NASA certification, celebrity associations, design heritage).",
  "productUrl": "official manufacturer product page URL or empty",
  "retailPrice": "current retail price USD or empty"
}

Rules:
- Search the official manufacturer website FIRST — it has the most accurate and complete specs.
- For description: describe what makes this watch visually distinctive.
- For background: focus on what makes this model interesting or significant — history, heritage, notable wearers, records, etc.
- For functions: list complications and key features (e.g. "date", "chronograph", "GMT", "200m water resistance", "power reserve indicator")
- If a field like caseDiameter or caseThickness is commonly published for this brand, search harder before returning empty.`;

      if (!GEMINI_API_KEY) {
        await logAttempt(null, "enhance_no_gemini_key");
        return new Response(JSON.stringify({ error: "Enhancement not available" }), {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      try {
        const geminiAbort = new AbortController();
        const geminiTimer = setTimeout(() => geminiAbort.abort(), 45000);

        const parts: any[] = [{ text: enhancePrompt }];
        // Include watch image if provided for better context
        if (image) {
          const b64 = image.replace(/^data:image\/[a-z]+;base64,/, "");
          const mt = image.startsWith("data:image/png") ? "image/png" : "image/jpeg";
          parts.unshift({ inline_data: { mime_type: mt, data: b64 } });
        }

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: geminiAbort.signal,
            body: JSON.stringify({
              contents: [{ parts }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          }
        );

        clearTimeout(geminiTimer);
        if (geminiResponse.ok) {
          const geminiResult = await geminiResponse.json();
          const resParts = geminiResult.candidates?.[0]?.content?.parts ?? [];
          const textParts = resParts.filter((p: any) => p.text).map((p: any) => p.text).join("");

          function extractJson(text: string) {
            const m = text.match(/\{[\s\S]*\}/);
            return m ? JSON.parse(m[0]) : null;
          }

          const parsed = extractJson(textParts);
          if (parsed) {
            parsed._engine = "gemini";
            await logAttempt(1, null);
            return new Response(JSON.stringify(parsed), {
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }
          console.error("[identify-watch] Enhance parse failed. Raw:", textParts.slice(0, 500));
        } else {
          const errText = await geminiResponse.text();
          console.error("[identify-watch] Enhance Gemini error:", geminiResponse.status, errText.slice(0, 300));
        }

        await logAttempt(null, "enhance_failed");
        return new Response(JSON.stringify({ error: "Enhancement failed" }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (enhErr: any) {
        console.error("[identify-watch] Enhance error:", enhErr.message);
        await logAttempt(null, `enhance_error_${enhErr.message?.slice(0, 50)}`);
        return new Response(JSON.stringify({ error: "Enhancement failed" }), {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    if (!image) {
      await logAttempt(null, "no_image");
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

    // ── DETECT MODE: count watches and determine layout ──
    if (mode === "detect") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              imageContent,
              {
                type: "text",
                text: `Look at this image and find every wristwatch. For each watch, describe where it is in the image, then provide a bounding box.

The bounding box should be [x, y, width, height] as percentages (0-100) of the image. x is from the left edge, y is from the top edge. The box should be tightly centered on the watch DIAL (the circular/square face where the hands and brand name are). Include the full case and a small margin, but do NOT include other watches or large areas of background.

For a watch box with 4 watches stacked vertically, each watch is roughly 20-25% of the image height. The bounding boxes should NOT overlap.

After your analysis, return JSON:
{"count": N, "watches": [{"boundingBox": [x, y, w, h]}]}

Order watches from top to bottom, left to right.
If no watches visible: {"count": 0, "watches": []}`,
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[identify-watch] Detect error:", response.status, errText);
        await logAttempt(null, `detect_http_${response.status}`);
        return new Response(
          JSON.stringify({ error: "Watch detection failed", detail: response.status }),
          { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const text = result.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (!parsed) {
        await logAttempt(null, "detect_parse_failed");
        return new Response(
          JSON.stringify({ error: "Could not parse detection response" }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      parsed.count = parsed.count ?? parsed.watches?.length ?? 0;
      await logAttempt(parsed.count, null);
      return new Response(JSON.stringify(parsed), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── IDENTIFY MODE (default): full identification ──
    // Collection matching: Claude Sonnet (fast, cheap, good enough for known watches)
    // Cold identification: Gemini 2.5 Pro with grounded search (best accuracy for ref numbers + specs)
    // Fallback: Claude Opus if Gemini key not set or Gemini fails
    const hasCollection = Array.isArray(collection) && collection.length > 0;

    if (hasCollection) {
      // ── COLLECTION MATCHING (Claude Sonnet) ──
      const collectionPrompt = `Identify the watch in this image. The user owns: ${collection.map((w: any) => `${w.brand} ${w.name}${w.ref ? ` (ref: ${w.ref})` : ""}`).join(", ")}

If you recognize it as one of these, use the exact names. Do NOT force a match — if it's not in the list, identify it independently.

Return JSON only, no explanation:
{"watches": [{"brand": "BrandName", "model": "ModelName", "reference": "ref or empty string", "dialText": "text on dial", "estimatedColor": "#hex", "confidence": "high/medium/low", "productUrl": "", "boundingBox": [x, y, width, height]}]}

boundingBox: [x, y, width, height] as percentages (0-100) of image, centered on dial.
estimatedColor: #c9a84c (gold), #94a3b8 (silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
If no watches: {"watches": []}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [imageContent, { type: "text", text: collectionPrompt }],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[identify-watch] Claude collection match error:", response.status, errText);
        await logAttempt(null, `identify_http_${response.status}`);
        return new Response(
          JSON.stringify({ error: "AI identification failed", detail: response.status }),
          { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const text = result.content?.[0]?.text ?? "";
      const parsed = extractJson(text);
      if (!parsed) {
        await logAttempt(null, "identify_parse_failed");
        return new Response(
          JSON.stringify({ error: "Could not parse AI response", raw: text }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      await logAttempt(Array.isArray(parsed.watches) ? parsed.watches.length : 0, null);
      return new Response(JSON.stringify(parsed), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── COLD IDENTIFICATION (Gemini 2.5 Pro with grounded search → Claude Opus fallback) ──
    const coldPrompt = `Look at this image carefully. Identify every watch visible.

For each watch: read all text on the dial, examine the logo, note the case shape, bezel style, bracelet/strap type, and any distinguishing features. Then use search to verify your identification and find the exact reference number, manufacturing years, and specifications.

Brand identification guide:
- Rolex: Crown logo at 12 o'clock, Cyclops lens over date, Oyster/Jubilee/President bracelets
- Tudor: Shield logo, snowflake hands on Black Bay models
- Omega: Ω symbol, Speedmaster has tachymeter bezel, Seamaster has wave dial
- Patek Philippe: Calatrava cross logo, typically dress watches
- Audemars Piguet: Royal Oak octagonal bezel with 8 hex screws, Tapisserie dial
- Vacheron Constantin: Maltese cross logo
- Cartier: Roman numerals, blue sword hands, cursive "Cartier"
- IWC: "IWC SCHAFFHAUSEN" on dial
- Breitling: Winged B logo, slide rule bezel
- Panerai: Cushion case, crown-protecting bridge
- Grand Seiko: "GS" logo, zaratsu polishing

Return a JSON object with your identifications:
{"watches": [{"brand": "BrandName", "model": "ModelName", "reference": "exact reference number or empty string", "dialText": "text you read on dial", "estimatedColor": "#hex", "confidence": "high/medium/low", "yearRange": "e.g. 2018-2023 or empty string", "movementType": "automatic/manual-wind/quartz or empty string", "caliber": "movement caliber name or empty string", "caseMaterial": "e.g. stainless steel, 18k yellow gold, titanium or empty string", "caseDiameter": "e.g. 41mm or empty string", "waterResistance": "e.g. 300m or empty string", "retailPrice": "estimated retail USD or empty string", "productUrl": "official manufacturer product page URL or empty string", "boundingBox": [x, y, width, height]}]}

Rules:
- Only provide reference if you can confirm it via search or clear visual evidence. Do NOT guess.
- productUrl: search for the official product page on the manufacturer's website (e.g. rolex.com, omegawatches.com, patek.com). Only provide verified URLs.
- boundingBox: [x, y, width, height] as percentages (0-100) of image, centered on dial.
- estimatedColor: #c9a84c (gold), #94a3b8 (silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
- If no watches: {"watches": []}`;

    // Try Gemini 2.5 Pro with grounded search first
    if (GEMINI_API_KEY) {
      try {
        const geminiAbort = new AbortController();
        const geminiTimer = setTimeout(() => geminiAbort.abort(), 60000);
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: geminiAbort.signal,
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: mediaType, data: base64Data } },
                  { text: coldPrompt },
                ],
              }],
              tools: [{ google_search: {} }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 8192,
              },
            }),
          }
        );

        clearTimeout(geminiTimer);
        if (geminiResponse.ok) {
          const geminiResult = await geminiResponse.json();
          const parts = geminiResult.candidates?.[0]?.content?.parts ?? [];
          const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join("");
          const parsed = extractJson(textParts);
          if (parsed && Array.isArray(parsed.watches)) {
            parsed._engine = "gemini";
            await logAttempt(parsed.watches.length, null);
            return new Response(JSON.stringify(parsed), {
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }
          console.error("[identify-watch] Gemini parse failed, falling back to Claude. Raw:", textParts.slice(0, 500));
        } else {
          const errText = await geminiResponse.text();
          console.error("[identify-watch] Gemini error:", geminiResponse.status, errText.slice(0, 300));
        }
      } catch (geminiErr) {
        console.error("[identify-watch] Gemini exception, falling back to Claude:", (geminiErr as Error).message);
      }
    }

    // Fallback: Claude Opus for cold identification
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

    const claudeFallbackPrompt = `Look at this image carefully. Identify every watch visible.

For each watch, describe what you see: read the text on the dial, look at the logo, note the case shape, bezel, bracelet/strap, and any distinguishing features. Then give your best identification.

${BRAND_CUES}

After your analysis, return a JSON object with your identifications:
{"watches": [{"brand": "BrandName", "model": "ModelName", "reference": "ref or empty string", "dialText": "text you read on dial", "estimatedColor": "#hex", "confidence": "high/medium/low", "yearRange": "e.g. 2018-2023 or empty string", "movementType": "automatic/manual-wind/quartz or empty string", "caliber": "movement caliber name or empty string", "caseMaterial": "e.g. stainless steel or empty string", "caseDiameter": "e.g. 41mm or empty string", "waterResistance": "e.g. 300m or empty string", "retailPrice": "estimated retail USD or empty string", "productUrl": "", "boundingBox": [x, y, width, height]}]}

For boundingBox: provide [x, y, width, height] as percentages (0-100) of the image dimensions, centered on the watch dial. Order watches from top to bottom.
For estimatedColor pick from: #c9a84c (gold), #94a3b8 (slate/silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (sky blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
Only provide reference if you are confident. Do NOT guess reference numbers.
If no watches: {"watches": []}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: [imageContent, { type: "text", text: claudeFallbackPrompt }],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[identify-watch] Claude fallback error:", response.status, errText);
      await logAttempt(null, `identify_http_${response.status}`);
      return new Response(
        JSON.stringify({ error: "AI identification failed", detail: response.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.content?.[0]?.text ?? "";
    const parsed = extractJson(text);
    if (!parsed) {
      await logAttempt(null, "identify_parse_failed");
      return new Response(
        JSON.stringify({ error: "Could not parse AI response", raw: text }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    parsed._engine = "claude";
    await logAttempt(Array.isArray(parsed.watches) ? parsed.watches.length : 0, null);
    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[identify-watch] Error:", err);
    await logAttempt(null, `exception:${(err as Error).message?.slice(0, 100) || "unknown"}`);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
