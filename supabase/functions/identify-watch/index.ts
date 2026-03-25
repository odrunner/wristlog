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
      collectionHint = `\n\nThe user owns these watches: ${items}\nIf you recognize a watch as one of these, use the exact names. Do NOT force a match — accuracy over matching.`;
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

    // ── PASS 1: Detect watches and locate them ──
    const pass1 = await fetch("https://api.anthropic.com/v1/messages", {
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
              text: `Count every watch visible in this image and locate each one.

For each watch, provide:
- position: brief description (e.g., "top", "second from top", "bottom-left")
- boundingBox: [x, y, width, height] as percentages (0-100) of image dimensions. Be generous — include full case and some strap.
- firstImpression: what brand/type it looks like at first glance (quick note, not final)

Return ONLY valid JSON:
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
        JSON.stringify({ error: "AI detection failed", detail: pass1.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const pass1Text = (await pass1.json()).content?.[0]?.text ?? "";
    const detected = extractJson(pass1Text);
    if (!detected?.watches?.length) {
      return new Response(JSON.stringify({ watches: [] }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ── PASS 2: Detailed identification using locations from pass 1 ──
    const watchList = detected.watches.map((w: any, i: number) => {
      const bb = w.boundingBox || [0, 0, 100, 100];
      return `Watch ${i + 1}: at [${bb.join(", ")}] (${w.position}). First impression: ${w.firstImpression}.`;
    }).join("\n");

    const pass2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            imageContent,
            {
              type: "text",
              text: `You are an expert watch identifier. This image has ${detected.watches.length} watch(es):

${watchList}

Carefully identify each watch. Study the dial text, bezel shape, case design, crown, pushers, and bracelet/strap to determine the exact brand, model, and reference.

For each watch (same order), provide:
- brand: Manufacturer (e.g., "Patek Philippe", "Audemars Piguet", "Vacheron Constantin")
- model: Model name with case size if determinable (e.g., "Calatrava 39", "Royal Oak Chronograph 41", "Overseas 41")
- reference: Reference number if determinable (e.g., "5227G-010", "26331ST.OO.1220ST.01"). Empty string if unsure.
- dialText: All visible text on dial, comma-separated. Read carefully.
- estimatedColor: Pick from: #c9a84c (gold), #94a3b8 (slate/silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (sky blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
- confidence: "high", "medium", or "low"
- productUrl: Product page URL if you know the brand site. Empty string if unsure.
- boundingBox: [x, y, w, h] percentages from the detection pass

Return ONLY valid JSON:
{"watches": [{"brand": "...", "model": "...", "reference": "...", "dialText": "...", "estimatedColor": "...", "confidence": "...", "productUrl": "...", "boundingBox": [x, y, w, h]}]}${collectionHint}`,
            },
          ],
        }],
      }),
    });

    if (!pass2.ok) {
      const errText = await pass2.text();
      console.error("[identify-watch] Pass 2 error:", pass2.status, errText);
      return new Response(
        JSON.stringify({ error: "AI identification failed", detail: pass2.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const pass2Text = (await pass2.json()).content?.[0]?.text ?? "";
    const parsed = extractJson(pass2Text);
    if (!parsed) {
      return new Response(
        JSON.stringify({ error: "Could not parse identification response", raw: pass2Text }),
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
