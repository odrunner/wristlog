import { assertEquals } from "jsr:@std/assert";
import {
  fetchFollowingSafeRedirects,
  absolutizeImageUrl,
  decodeEntities,
  extractMeta,
  isBlockedHost,
  validateUrl,
} from "./lib.ts";

// ---- decodeEntities ----

Deno.test("decodeEntities — named entities", () => {
  assertEquals(decodeEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assertEquals(decodeEntities("a &lt; b &gt; c"), "a < b > c");
  assertEquals(decodeEntities("&quot;hi&quot;"), '"hi"');
  assertEquals(decodeEntities("don&apos;t"), "don't");
});

Deno.test("decodeEntities — typographic named entities", () => {
  assertEquals(decodeEntities("&ldquo;quote&rdquo;"), "“quote”");
  assertEquals(decodeEntities("it&rsquo;s"), "it’s");
  assertEquals(decodeEntities("&copy;&reg;&trade;"), "©®™");
  assertEquals(decodeEntities("a&hellip;"), "a…");
});

Deno.test("decodeEntities — numeric decimal entity", () => {
  assertEquals(decodeEntities("&#65;&#66;&#67;"), "ABC");
});

Deno.test("decodeEntities — numeric hex entity", () => {
  assertEquals(decodeEntities("&#x41;&#x42;"), "AB");
});

Deno.test("decodeEntities — unknown named entity left intact", () => {
  assertEquals(decodeEntities("&bogus;"), "&bogus;");
});

Deno.test("decodeEntities — no entities passes through", () => {
  assertEquals(decodeEntities("plain text"), "plain text");
  assertEquals(decodeEntities(""), "");
});

// ---- extractMeta ----

Deno.test("extractMeta — prefers og: tags", () => {
  const html = `
    <meta property="og:image" content="https://x.com/a.jpg">
    <meta property="og:title" content="OG Title">
    <meta property="og:description" content="OG Desc">
    <meta property="og:site_name" content="OG Site">
  `;
  assertEquals(extractMeta(html), {
    image_url: "https://x.com/a.jpg",
    title: "OG Title",
    description: "OG Desc",
    site_name: "OG Site",
  });
});

Deno.test("extractMeta — falls back to twitter: then plain meta", () => {
  const html = `
    <meta name="twitter:title" content="Tw Title">
    <meta name="description" content="Plain Desc">
  `;
  const meta = extractMeta(html);
  assertEquals(meta.title, "Tw Title");
  assertEquals(meta.description, "Plain Desc");
});

Deno.test("extractMeta — content-before-property attribute order", () => {
  const html = `<meta content="Reversed" property="og:title">`;
  assertEquals(extractMeta(html).title, "Reversed");
});

Deno.test("extractMeta — title falls back to <title> tag", () => {
  const html = `<title>  Page Title  </title>`;
  assertEquals(extractMeta(html).title, "Page Title");
});

Deno.test("extractMeta — decodes entities in extracted values", () => {
  const html = `<meta property="og:title" content="Tom &amp; Jerry">`;
  assertEquals(extractMeta(html).title, "Tom & Jerry");
});

Deno.test("extractMeta — image fallback to first matching <img> when no og:image", () => {
  const html = `<img src="https://cdn.example.com/photo.png" alt="x">`;
  assertEquals(extractMeta(html).image_url, "https://cdn.example.com/photo.png");
});

Deno.test("extractMeta — empty html yields empty fields", () => {
  assertEquals(extractMeta(""), {
    image_url: "",
    title: "",
    description: "",
    site_name: "",
  });
});

// ---- isBlockedHost ----

Deno.test("isBlockedHost — blocks loopback / private ranges", () => {
  assertEquals(isBlockedHost("localhost"), true);
  assertEquals(isBlockedHost("127.0.0.1"), true);
  assertEquals(isBlockedHost("10.0.0.5"), true);
  assertEquals(isBlockedHost("192.168.1.1"), true);
  assertEquals(isBlockedHost("169.254.1.1"), true);
  assertEquals(isBlockedHost("0.0.0.0"), true);
});

Deno.test("isBlockedHost — 172.16-31 private block boundaries", () => {
  assertEquals(isBlockedHost("172.16.0.1"), true);
  assertEquals(isBlockedHost("172.31.255.255"), true);
  assertEquals(isBlockedHost("172.15.0.1"), false);
  assertEquals(isBlockedHost("172.32.0.1"), false);
});

Deno.test("isBlockedHost — blocks .internal and .local suffixes", () => {
  assertEquals(isBlockedHost("db.internal"), true);
  assertEquals(isBlockedHost("printer.local"), true);
});

Deno.test("isBlockedHost — allows public hosts", () => {
  assertEquals(isBlockedHost("example.com"), false);
  assertEquals(isBlockedHost("chrono24.com"), false);
  assertEquals(isBlockedHost("8.8.8.8"), false);
});

// ---- validateUrl ----

Deno.test("validateUrl — accepts valid https url", () => {
  const r = validateUrl("https://example.com/page");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.parsed.hostname, "example.com");
});

Deno.test("validateUrl — accepts http url", () => {
  assertEquals(validateUrl("http://example.com").ok, true);
});

Deno.test("validateUrl — missing / non-string url", () => {
  assertEquals(validateUrl(undefined), { ok: false, error: "No url provided" });
  assertEquals(validateUrl(""), { ok: false, error: "No url provided" });
  assertEquals(validateUrl(123), { ok: false, error: "No url provided" });
});

Deno.test("validateUrl — unparseable url", () => {
  assertEquals(validateUrl("not a url"), { ok: false, error: "Invalid URL" });
});

Deno.test("validateUrl — non-http(s) scheme rejected", () => {
  assertEquals(validateUrl("ftp://example.com"), { ok: false, error: "Only http/https URLs allowed" });
  assertEquals(validateUrl("javascript:alert(1)"), { ok: false, error: "Only http/https URLs allowed" });
});

Deno.test("validateUrl — private host rejected", () => {
  assertEquals(validateUrl("http://192.168.0.1/x"), { ok: false, error: "Private/internal URLs not allowed" });
  assertEquals(validateUrl("https://localhost:3000"), { ok: false, error: "Private/internal URLs not allowed" });
});

// ---- absolutizeImageUrl ----

Deno.test("absolutizeImageUrl — relative path resolved against origin", () => {
  assertEquals(
    absolutizeImageUrl("/img/a.jpg", "https://example.com/articles/1"),
    "https://example.com/img/a.jpg",
  );
});

Deno.test("absolutizeImageUrl — absolute url passes through", () => {
  assertEquals(
    absolutizeImageUrl("https://cdn.example.com/a.jpg", "https://example.com/page"),
    "https://cdn.example.com/a.jpg",
  );
});

Deno.test("absolutizeImageUrl — empty image stays empty", () => {
  assertEquals(absolutizeImageUrl("", "https://example.com"), "");
});

// ── fetchFollowingSafeRedirects (2026-07-19 audit, Low S-9) ──
// redirect:"follow" made the up-front validateUrl() check bypassable: a public
// URL could 302 to a private host and fetch would follow it.

function res(status: number, location?: string): Response {
  const h = new Headers();
  if (location) h.set("location", location);
  return new Response(null, { status, headers: h });
}

// Returns a fetch stub that walks a scripted list of responses, recording URLs.
function stubFetch(steps: Response[], seen: string[]) {
  let i = 0;
  return ((url: string | URL | Request) => {
    seen.push(String(url));
    return Promise.resolve(steps[i++] ?? res(200));
  }) as unknown as typeof fetch;
}

Deno.test("fetchFollowingSafeRedirects blocks a redirect to a link-local address", async () => {
  const seen: string[] = [];
  const f = stubFetch([res(302, "http://169.254.169.254/latest/meta-data/")], seen);
  let msg = "";
  try {
    await fetchFollowingSafeRedirects("https://example.com/a", 5, f);
  } catch (e) { msg = (e as Error).message; }
  assertEquals(msg.includes("Blocked redirect"), true);
  // The private host must never actually be requested.
  assertEquals(seen.length, 1);
  assertEquals(seen[0], "https://example.com/a");
});

Deno.test("fetchFollowingSafeRedirects blocks a redirect to localhost", async () => {
  const seen: string[] = [];
  const f = stubFetch([res(301, "http://localhost:8000/admin")], seen);
  let threw = false;
  try { await fetchFollowingSafeRedirects("https://example.com/a", 5, f); }
  catch { threw = true; }
  assertEquals(threw, true);
  assertEquals(seen.length, 1);
});

Deno.test("fetchFollowingSafeRedirects follows a safe public redirect", async () => {
  const seen: string[] = [];
  const f = stubFetch([res(302, "https://elsewhere.example/final"), res(200)], seen);
  const out = await fetchFollowingSafeRedirects("https://example.com/a", 5, f);
  assertEquals(out.status, 200);
  assertEquals(seen, ["https://example.com/a", "https://elsewhere.example/final"]);
});

Deno.test("fetchFollowingSafeRedirects resolves a relative Location against the current URL", async () => {
  const seen: string[] = [];
  const f = stubFetch([res(302, "/moved"), res(200)], seen);
  await fetchFollowingSafeRedirects("https://example.com/a/b", 5, f);
  assertEquals(seen[1], "https://example.com/moved");
});

Deno.test("fetchFollowingSafeRedirects enforces the hop limit", async () => {
  const seen: string[] = [];
  // Endless public redirects — must stop rather than loop forever.
  const loop = Array.from({ length: 10 }, (_, i) => res(302, `https://example.com/${i + 1}`));
  let msg = "";
  try { await fetchFollowingSafeRedirects("https://example.com/0", 3, stubFetch(loop, seen)); }
  catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "Too many redirects");
  assertEquals(seen.length, 4);      // initial + 3 hops
});

Deno.test("fetchFollowingSafeRedirects returns a 3xx with no Location rather than looping", async () => {
  const seen: string[] = [];
  const out = await fetchFollowingSafeRedirects("https://example.com/a", 5, stubFetch([res(304)], seen));
  assertEquals(out.status, 304);
});
