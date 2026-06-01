// search-watch-image — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export const BAD_IMAGE_KEYWORDS = /logo|logotype|icon|favicon|sprite|banner|placeholder|badge|seal|emblem|crest|header-bg|footer|menu|nav-|social-|share-|arrow|close|search-icon|avatar|profile|author|gravatar|ads?-|advertisement|pixel|tracking|spacer|blank|transparent|loading/i;

// ── Brand → website domain ──
export const BRAND_DOMAINS: Record<string, string> = {
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

export function getBrandDomain(brand: string): string | null {
  return BRAND_DOMAINS[brand.toLowerCase().trim()] || null;
}

// True if a candidate image URL looks like a real product image (not an
// SVG/GIF and not matching the bad-keyword blocklist).
export function isLikelyProductImage(url: string): boolean {
  if (!url || BAD_IMAGE_KEYWORDS.test(url)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(url)) return false;
  return true;
}

// True if a URL looks like a deep product page (>= 2 path segments), not a homepage.
export function looksLikeProductUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    return pathParts.length >= 2;
  } catch {
    return false;
  }
}

// Normalize a single extracted image URL against a base URL.
export function normalizeImageUrl(u: string, baseUrl: string): string {
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) {
    try { return new URL(u, baseUrl).href; } catch { return u; }
  }
  return u;
}

/**
 * Extract image URLs from HTML. Pure string/regex parsing — no network.
 */
export function extractImages(html: string, baseUrl: string): string[] {
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

  return [...new Set(images.map(u => normalizeImageUrl(u, baseUrl))
    .filter(u => u.startsWith("https://") || u.startsWith("http://")))];
}

/**
 * Build the ordered list of candidate brand-site URLs to scrape for a watch.
 * Pure URL construction — mirrors the logic in searchBrandSite.
 * Returns null when there is no known domain (caller handles the brand.com fallback).
 */
export function buildBrandSiteUrls(brand: string, model: string, reference: string): string[] | null {
  const domain = getBrandDomain(brand);
  if (!domain) return null;

  const modelSlug = model.toLowerCase().replace(/\s+/g, "-");
  const modelEncoded = encodeURIComponent(model);

  const urls: string[] = [];
  const bl = brand.toLowerCase();

  // ── Brand-specific URL patterns ──
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

  return urls;
}

// Build the fallback brand.com URL used when no known domain exists.
export function buildFallbackBrandUrl(brand: string, model: string): string {
  const fallbackDomain = brand.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
  return `https://www.${fallbackDomain}/${model.toLowerCase().replace(/\s+/g, "-")}`;
}
