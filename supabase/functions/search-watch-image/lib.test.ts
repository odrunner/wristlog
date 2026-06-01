import { assertEquals } from "jsr:@std/assert";
import {
  buildBrandSiteUrls,
  buildFallbackBrandUrl,
  extractImages,
  getBrandDomain,
  isLikelyProductImage,
  looksLikeProductUrl,
  normalizeImageUrl,
} from "./lib.ts";

// ── getBrandDomain ──
Deno.test("getBrandDomain — known brand, case/space insensitive", () => {
  assertEquals(getBrandDomain("Rolex"), "rolex.com");
  assertEquals(getBrandDomain("  PATEK PHILIPPE  "), "patek.com");
  assertEquals(getBrandDomain("grand seiko"), "grand-seiko.com");
});

Deno.test("getBrandDomain — unknown brand returns null", () => {
  assertEquals(getBrandDomain("Acme Watches"), null);
  assertEquals(getBrandDomain(""), null);
});

// ── isLikelyProductImage ──
Deno.test("isLikelyProductImage — accepts a normal product jpg/png", () => {
  assertEquals(isLikelyProductImage("https://x.com/products/submariner.jpg"), true);
  assertEquals(isLikelyProductImage("https://x.com/img/watch_001.png"), true);
});

Deno.test("isLikelyProductImage — rejects bad keywords", () => {
  assertEquals(isLikelyProductImage("https://x.com/logo.png"), false);
  assertEquals(isLikelyProductImage("https://x.com/favicon.png"), false);
  assertEquals(isLikelyProductImage("https://x.com/social-share.jpg"), false);
  assertEquals(isLikelyProductImage("https://x.com/tracking-pixel.png"), false);
});

Deno.test("isLikelyProductImage — rejects svg and gif", () => {
  assertEquals(isLikelyProductImage("https://x.com/watch.svg"), false);
  assertEquals(isLikelyProductImage("https://x.com/watch.gif?v=2"), false);
});

Deno.test("isLikelyProductImage — rejects empty", () => {
  assertEquals(isLikelyProductImage(""), false);
});

// ── looksLikeProductUrl ──
Deno.test("looksLikeProductUrl — deep path is a product page", () => {
  assertEquals(looksLikeProductUrl("https://www.rolex.com/watches/submariner"), true);
});

Deno.test("looksLikeProductUrl — homepage / single segment is not", () => {
  assertEquals(looksLikeProductUrl("https://www.rolex.com/"), false);
  assertEquals(looksLikeProductUrl("https://www.rolex.com/watches"), false);
});

Deno.test("looksLikeProductUrl — empty/invalid is false", () => {
  assertEquals(looksLikeProductUrl(""), false);
  assertEquals(looksLikeProductUrl("not a url"), false);
});

// ── normalizeImageUrl ──
Deno.test("normalizeImageUrl — protocol-relative gets https", () => {
  assertEquals(normalizeImageUrl("//cdn.x.com/a.jpg", "https://x.com/page"), "https://cdn.x.com/a.jpg");
});

Deno.test("normalizeImageUrl — root-relative resolved against base", () => {
  assertEquals(normalizeImageUrl("/img/a.jpg", "https://x.com/page"), "https://x.com/img/a.jpg");
});

Deno.test("normalizeImageUrl — absolute url unchanged", () => {
  assertEquals(normalizeImageUrl("https://y.com/a.jpg", "https://x.com/page"), "https://y.com/a.jpg");
});

// ── extractImages ──
Deno.test("extractImages — pulls og:image, twitter:image, img tags; dedups; resolves relative", () => {
  const html = `
    <meta property="og:image" content="https://x.com/og.jpg">
    <meta name="twitter:image" content="//cdn.x.com/tw.jpg">
    <img src="/img/watch.jpg">
    <img data-src="https://x.com/og.jpg">
  `;
  const out = extractImages(html, "https://x.com/page");
  assertEquals(out, [
    "https://x.com/og.jpg",
    "https://cdn.x.com/tw.jpg",
    "https://x.com/img/watch.jpg",
  ]);
});

Deno.test("extractImages — filters out logos/icons and svg/gif in img tags", () => {
  const html = `
    <img src="https://x.com/logo.png">
    <img src="https://x.com/watch.svg">
    <img src="https://x.com/real-watch.jpg">
  `;
  assertEquals(extractImages(html, "https://x.com/page"), ["https://x.com/real-watch.jpg"]);
});

Deno.test("extractImages — JSON-LD Product image (string and array)", () => {
  const html = `
    <script type="application/ld+json">
    {"@type":"Product","image":["https://x.com/p1.jpg","https://x.com/p2.jpg"]}
    </script>
  `;
  assertEquals(extractImages(html, "https://x.com/page"), [
    "https://x.com/p1.jpg",
    "https://x.com/p2.jpg",
  ]);
});

Deno.test("extractImages — JSON-LD image object with url", () => {
  const html = `
    <script type="application/ld+json">
    {"@type":"Product","image":{"url":"https://x.com/po.jpg"}}
    </script>
  `;
  assertEquals(extractImages(html, "https://x.com/page"), ["https://x.com/po.jpg"]);
});

Deno.test("extractImages — empty for html without images", () => {
  assertEquals(extractImages("<p>hello</p>", "https://x.com/page"), []);
});

// ── buildBrandSiteUrls ──
Deno.test("buildBrandSiteUrls — null for unknown brand", () => {
  assertEquals(buildBrandSiteUrls("Acme", "Diver", ""), null);
});

Deno.test("buildBrandSiteUrls — Rolex brand-specific + generic patterns, with reference", () => {
  const urls = buildBrandSiteUrls("Rolex", "Submariner Date", "126610LN");
  assertEquals(urls, [
    "https://www.rolex.com/watches/submariner-date",
    "https://www.rolex.com/watches/submariner-date/m126610ln",
    "https://www.rolex.com/watches/submariner-date",
    "https://www.rolex.com/collections/submariner-date",
    "https://www.rolex.com/submariner-date",
  ]);
});

Deno.test("buildBrandSiteUrls — Omega without reference omits ref-specific URL", () => {
  const urls = buildBrandSiteUrls("Omega", "Seamaster", "");
  assertEquals(urls?.[0], "https://www.omegawatches.com/en-us/watches/seamaster");
  assertEquals(urls?.includes("https://www.omegawatches.com/watches/seamaster"), true);
  assertEquals(urls?.some((u) => u.includes("watch-omega-")), false);
});

Deno.test("buildBrandSiteUrls — Seiko appends search endpoint with encoded model", () => {
  const urls = buildBrandSiteUrls("Seiko", "Prospex Diver", "SPB143");
  assertEquals(urls?.includes("https://www.seikowatches.com/us-en/products?q=Prospex%20Diver"), true);
  assertEquals(urls?.includes("https://www.seikowatches.com/us-en/products/spb143"), true);
});

Deno.test("buildBrandSiteUrls — TAG Heuer requires both words", () => {
  const urls = buildBrandSiteUrls("TAG Heuer", "Carrera", "");
  assertEquals(urls?.[0], "https://www.tagheuer.com/us/en/timepieces/collections/carrera/");
});

// ── buildFallbackBrandUrl ──
Deno.test("buildFallbackBrandUrl — strips non-alphanumerics and slugifies model", () => {
  assertEquals(
    buildFallbackBrandUrl("Bell & Ross", "BR 03"),
    "https://www.bellross.com/br-03",
  );
});
