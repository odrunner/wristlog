// Supabase Edge Function: identify-watch
// Called from the client to identify watches in a photo using Claude Vision.
//
// Required Supabase secrets (set via `supabase secrets set`):
//   ANTHROPIC_API_KEY  — API key from anthropic.com

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
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
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
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
    const { image } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Strip data-URL prefix if present
    const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, "");
    const mediaType = image.startsWith("data:image/png") ? "image/png" : "image/jpeg";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: `You are a luxury watch identification expert. Analyze this image and identify every watch visible in the photo.

For each watch, provide your best identification with these fields:
- brand: The manufacturer (e.g., "Rolex", "Omega", "Seiko")
- model: The specific model name (e.g., "Submariner", "Speedmaster", "Presage")
- reference: The reference number if you can determine it (e.g., "126610LN", "310.30.42.50.01.001"). Leave empty string if unsure.
- estimatedColor: A hex color code that best represents the watch's overall tone. Pick from these: #c9a84c (gold), #4caf7d (teal), #818cf8 (indigo), #ef7942 (orange), #38bdf8 (sky blue), #e879f9 (magenta), #f43f5e (rose), #94a3b8 (slate/silver), #fbbf24 (amber), #34d399 (emerald), #fb923c (orange-alt), #a78bfa (purple)
- confidence: "high", "medium", or "low" based on how certain you are of the identification
- productUrl: ONLY provide a URL if you are CERTAIN it is a real, direct product page URL for this specific watch model (not a brand homepage). Prefer chrono24.com listing URLs. If you are not confident the URL points to the exact product page, use empty string "". Do NOT guess or construct URLs.
- boundingBox: The approximate location of this watch in the image as [x, y, width, height] where values are percentages (0-100) of the image dimensions. x is from left edge, y is from top edge. For example [25, 10, 50, 80] means the watch starts 25% from left, 10% from top, is 50% of image width and 80% of image height. Be generous with padding — include the full watch face, case, and some of the strap.

Return ONLY valid JSON in this exact format, no other text:
{"watches": [{"brand": "...", "model": "...", "reference": "...", "estimatedColor": "...", "confidence": "...", "productUrl": "...", "boundingBox": [x, y, w, h]}]}

If no watches are visible in the image, return: {"watches": []}
If you can identify the brand but not the exact model, still include it with your best guess and "low" confidence.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[identify-watch] Anthropic API error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "AI identification failed", detail: response.status }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const text = result.content?.[0]?.text ?? "";

    // Extract JSON from Claude's response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(
        JSON.stringify({ error: "Could not parse AI response", raw: text }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[identify-watch] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
