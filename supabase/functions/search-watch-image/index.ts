// Supabase Edge Function: search-watch-image
// Searches for a stock photo of a watch given brand, model, and optional reference.
//
// Strategy priority:
//   1. Product URL from Claude (if provided and looks like a real product page)
//   2. Direct brand website URLs (constructed from known patterns)
//   If none finds an image, client falls back to cropping user's original photo.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BAD_IMAGE_KEYWORDS = /logo|logotype|icon|favicon|sprite|banner|placeholder|badge|seal|emblem|crest|header-bg|footer|menu|nav-|social-|share-|arrow|close|search-icon|avatar|profile|author|gravatar|ads?-|advertisement|pixel|tracking|spacer|blank|transparent|loading/i;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Brand → website domain ──
const BRAND_DOMAINS: Record<string, string> = {
  "rolex": "rolex.com", "omega": "omegawatches.com",
  "patek philippe": "patek.com", "audemars piguet": "audemarspiguet.com",
  "iwc": "iwc.com", "jaeger-lecoultre": "jaeger-lecoultre.com",
  "jaeger lecoultre": "jaeger-lecoultre.com", "breitling": "breitling.com",
  "tag heuer": "tagheuer.com", "cartier": "cartier.com",
  "panerai": "panerai.com", "tudor": "tudorwatch.com",
  "blancpain": "blancpain.com", "vacheron constantin": "vacheron-constantin.com",
  "zenith": "zenith-watches.com", "hublot": "hublot.com",
  "longines": "longines.com", "tissot": "tissotwatches.com",
  "seiko": "seikowatches.com", "grand seiko": "grand-seiko.com",
  "citizen": "citizenwatch.com", "casio": "casio.com",
  "g-shock": "gshock.com", "hamilton": "hamiltonwatch.com",
  "oris": "oris.com", "bell & ross": "bellross.com",
  "bell ross": "bellross.com", "chopard": "chopard.com",
  "girard-perregaux": "girard-perregaux.com",
  "girard perregaux": "girard-perregaux.com",
  "ulysse nardin": "ulysse-nardin.com",
  "frederique constant": "frederiqueconstant.com",
  "montblanc": "montblanc.com", "baume & mercier": "baume-et-mercier.com",
  "baume mercier": "baume-et-mercier.com",
  "nomos": "nomos-glashuette.com", "a. lange & sohne": "alange-soehne.com",
  "a lange sohne": "alange-soehne.com",
  "glashutte original": "glashuette-original.com",
  "junghans": "junghans.de", "rado": "rado.com",
  "swatch": "swatch.com", "orient": "orient-watch.com",
  "bulova": "bulova.com", "movado": "movado.com",
  "mido": "mido.com", "certina": "certina.com",
  "piaget": "piaget.com", "chanel": "chanel.com",
  "hermes": "hermes.com", "bvlgari": "bulgari.com",
  "bulgari": "bulgari.com", "sinn": "sinn.de",
  "ming": "ming.watch", "moser": "h-moser.com",
  "h. moser": "h-moser.com", "h moser": "h-moser.com",
  "roger dubuis": "rogerdubuis.com", "richard mille": "richardmille.com",
  "franck muller": "franckmuller.com", "jacob & co": "jacobandco.com",
};

function getBrandDomain(brand: string): string | null {
  return BRAND_DOMAINS[brand.toLowerCase().trim()] || null;
}

/**
 * Validate that a URL points to a real product image.
 */
async function validateImageUrl(url: string): Promise<boolean> {
  if (!url || BAD_IMAGE_KEYWORDS.test(url)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(url)) return false;
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
 * Extract image URLs from HTML.
 */
function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];

  // og:image
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogMatch?.[1]) images.push(ogMatch[1]);

  // twitter:image
  const twMatch = html.match(/<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image["']/i);
  if (twMatch?.[1]) images.push(twMatch[1]);

  // JSON-LD Product images
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonLdMatches) {
    try {
      const ld = JSON.parse(m[1]);
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item["@type"] === "Product" || item["@type"]?.includes?.("Product")) {
          const img = item.image;
          if (typeof img === "string") images.push(img);
          else if (Array.isArray(img)) images.push(...img.filter((x: unknown) => typeof x === "string"));
          else if (img?.url) images.push(img.url);
        }
      }
    } catch { /* ignore */ }
  }

  // img tags — prioritize larger images (those with width/height attributes or in main content areas)
  const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const src = imgMatch[1];
    if (src && !BAD_IMAGE_KEYWORDS.test(src) && !/\.(svg|gif)(\?|$)/i.test(src)) {
      images.push(src);
    }
  }

  return [...new Set(images.map(u => {
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) {
      try { return new URL(u, baseUrl).href; } catch { return u; }
    }
    return u;
  }).filter(u => u.startsWith("https://") || u.startsWith("http://")))];
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
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return null; // homepage-like
  } catch { return null; }

  console.log("[search-watch-image] Trying product URL:", url);
  return await scrapePageForImage(url);
}

/**
 * STRATEGY 2: Direct brand website URLs.
 * Many brand sites have predictable URL patterns for model/collection pages.
 * Also tries the brand's search endpoint.
 */
async function searchBrandSite(brand: string, model: string, reference: string): Promise<{ imageUrl: string; sourceUrl: string } | null> {
  const domain = getBrandDomain(brand);
  if (!domain) {
    // Fallback: try brand.com
    const fallbackDomain = brand.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
    console.log("[search-watch-image] Trying fallback domain:", fallbackDomain);
    const url = `https://www.${fallbackDomain}/${model.toLowerCase().replace(/\s+/g, "-")}`;
    return await scrapePageForImage(url);
  }

  const modelSlug = model.toLowerCase().replace(/\s+/g, "-");
  const modelEncoded = encodeURIComponent(model);
  const refEncoded = reference ? encodeURIComponent(reference) : "";

  // Build list of URLs to try, specific to brand patterns
  const urls: string[] = [];

  // ── Brand-specific URL patterns ──
  const bl = brand.toLowerCase();
  if (bl.includes("rolex")) {
    urls.push(`https://www.rolex.com/watches/${modelSlug}`);
    if (reference) urls.push(`https://www.rolex.com/watches/${modelSlug}/m${reference.toLowerCase()}`);
  } else if (bl.includes("omega")) {
    urls.push(`https://www.omegawatches.com/en-us/watches/${modelSlug}`);
    if (reference) urls.push(`https://www.omegawatches.com/watch-omega-${modelSlug}-${reference.toLowerCase()}`);
  } else if (bl.includes("tudor")) {
    urls.push(`https://www.tudorwatch.com/en/watches/${modelSlug}`);
  } else if (bl.includes("tag") && bl.includes("heuer")) {
    urls.push(`https://www.tagheuer.com/us/en/timepieces/collections/${modelSlug}/`);
  } else if (bl.includes("breitling")) {
    urls.push(`https://www.breitling.com/us-en/watches/${modelSlug}/`);
  } else if (bl.includes("iwc")) {
    urls.push(`https://www.iwc.com/us/en/watch-collections/${modelSlug}.html`);
  } else if (bl.includes("panerai")) {
    urls.push(`https://www.panerai.com/us/en/collections/watch-collection/${modelSlug}.html`);
  } else if (bl.includes("cartier")) {
    urls.push(`https://www.cartier.com/en-us/watches/${modelSlug}/`);
  } else if (bl.includes("blancpain")) {
    urls.push(`https://www.blancpain.com/en/watches/${modelSlug}`);
  } else if (bl.includes("hublot")) {
    urls.push(`https://www.hublot.com/en-us/watches/${modelSlug}`);
  } else if (bl.includes("zenith")) {
    urls.push(`https://www.zenith-watches.com/en_us/watches/${modelSlug}`);
  } else if (bl.includes("longines")) {
    urls.push(`https://www.longines.com/en-us/watches/${modelSlug}`);
  }

  // ── Generic patterns that work for many brands ──
  urls.push(`https://www.${domain}/watches/${modelSlug}`);
  urls.push(`https://www.${domain}/collections/${modelSlug}`);
  urls.push(`https://www.${domain}/${modelSlug}`);

  // ── Brand search/product endpoints ──
  if (bl.includes("seiko")) {
    urls.push(`https://www.seikowatches.com/us-en/products?q=${modelEncoded}`);
    if (reference) urls.push(`https://www.seikowatches.com/us-en/products/${reference.toLowerCase()}`);
  } else if (bl.includes("grand seiko")) {
    urls.push(`https://www.grand-seiko.com/us-en/collections?q=${modelEncoded}`);
  } else if (bl.includes("citizen")) {
    urls.push(`https://www.citizenwatch.com/us/en/search?q=${modelEncoded}`);
  } else if (bl.includes("hamilton")) {
    urls.push(`https://www.hamiltonwatch.com/en-us/collection/${modelSlug}.html`);
  } else if (bl.includes("tissot")) {
    urls.push(`https://www.tissotwatches.com/en-us/collection/${modelSlug}.html`);
  } else if (bl.includes("oris")) {
    urls.push(`https://www.oris.com/en/watch/${modelSlug}`);
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
