// Supabase Edge Function: search-watch-image
// Searches for a stock photo of a watch given brand, model, and optional reference.
//
// Strategy priority:
//   1. Product URL from Claude (if provided and looks like a real product page)
//   2. Direct brand website URLs (constructed from known patterns)
//   If none finds an image, client falls back to cropping user's original photo.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildBrandSiteUrls,
  buildFallbackBrandUrl,
  extractImages,
  isLikelyProductImage,
  looksLikeProductUrl,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Validate that a URL points to a real product image.
 */
async function validateImageUrl(url: string): Promise<boolean> {
  if (!isLikelyProductImage(url)) return false;
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] },
    });
    if (!resp.ok) return false;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return false;
    const cl = parseInt(resp.headers.get("content-length") || "0", 10);
    if (cl > 0 && cl < 5000) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Scrape a page URL for product images.
 */
async function scrapePageForImage(pageUrl: string): Promise<{ imageUrl: string; sourceUrl: string } | null> {
  try {
    const resp = await fetch(pageUrl, {
      signal: AbortSignal.timeout(10000),
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const candidates = extractImages(html, pageUrl);
    for (const imgUrl of candidates.slice(0, 10)) {
      if (await validateImageUrl(imgUrl)) {
        return { imageUrl: imgUrl, sourceUrl: pageUrl };
      }
    }
  } catch { /* ignore */ }
  return null;
}


// ═══════════════════════════════════════════════════════════════
// STRATEGIES
// ═══════════════════════════════════════════════════════════════

/**
 * STRATEGY 1: Product URL from Claude (skip homepages).
 */
async function searchProductUrl(url: string): Promise<{ imageUrl: string; sourceUrl: string } | null> {
  if (!looksLikeProductUrl(url)) return null; // missing/invalid/homepage-like

  console.log("[search-watch-image] Trying product URL:", url);
  return await scrapePageForImage(url);
}

/**
 * STRATEGY 2: Direct brand website URLs.
 * Many brand sites have predictable URL patterns for model/collection pages.
 * Also tries the brand's search endpoint.
 */
async function searchBrandSite(brand: string, model: string, reference: string): Promise<{ imageUrl: string; sourceUrl: string } | null> {
  const urls = buildBrandSiteUrls(brand, model, reference);
  if (!urls) {
    // Fallback: try brand.com
    const url = buildFallbackBrandUrl(brand, model);
    console.log("[search-watch-image] Trying fallback domain:", url);
    return await scrapePageForImage(url);
  }

  // Try each URL
  for (const url of urls) {
    console.log("[search-watch-image] Trying brand URL:", url);
    const result = await scrapePageForImage(url);
    if (result) {
      console.log("[search-watch-image] Brand site found image from:", url);
      return result;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Rate limiting: 200/hour ──
  const RATE_LIMIT = 200;
  const WINDOW_MS = 60 * 60 * 1000;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  try {
    const { data: rl } = await supabase
      .from("rate_limits").select("window_start, request_count")
      .eq("user_id", user.id).eq("function_name", "search-watch-image").single();
    if (rl) {
      const rlWindowStart = new Date(rl.window_start);
      if (rlWindowStart > windowStart) {
        if (rl.request_count >= RATE_LIMIT) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
            status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        await supabase.from("rate_limits").update({ request_count: rl.request_count + 1 })
          .eq("user_id", user.id).eq("function_name", "search-watch-image");
      } else {
        await supabase.from("rate_limits").update({ window_start: now.toISOString(), request_count: 1 })
          .eq("user_id", user.id).eq("function_name", "search-watch-image");
      }
    } else {
      await supabase.from("rate_limits").insert({
        user_id: user.id, function_name: "search-watch-image",
        window_start: now.toISOString(), request_count: 1,
      });
    }
  } catch (rlErr) {
    console.error("[search-watch-image] Rate limit error:", rlErr);
  }

  try {
    const { brand, model, reference, productUrl } = await req.json();
    if (!brand && !model) {
      return new Response(JSON.stringify({ error: "brand or model required" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const b = (brand || "").trim();
    const m = (model || "").trim();
    const r = (reference || "").trim();
    console.log(`[search-watch-image] Searching for: ${b} ${m} ${r}`);

    // ── Priority 1: Product URL from Claude ──
    if (productUrl) {
      const result = await searchProductUrl(productUrl);
      if (result) {
        return new Response(JSON.stringify({ ...result, source: "productUrl" }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // ── Priority 2: Direct brand website (constructed URLs) ──
    const brandResult = await searchBrandSite(b, m, r);
    if (brandResult) {
      return new Response(JSON.stringify({ ...brandResult, source: "brand" }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    console.log("[search-watch-image] No image found for:", b, m);
    return new Response(JSON.stringify({ imageUrl: null, sourceUrl: null, source: null }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[search-watch-image] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
