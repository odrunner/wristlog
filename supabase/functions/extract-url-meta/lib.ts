// extract-url-meta — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

/** Decode HTML entities (named + numeric) */
export function decodeEntities(str: string): string {
  const named: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
    "&apos;": "'", "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—",
    "&lsquo;": "‘", "&rsquo;": "’", "&ldquo;": "“", "&rdquo;": "”",
    "&hellip;": "…", "&copy;": "©", "&reg;": "®", "&trade;": "™",
  };
  return str
    .replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(\w+));/g, (m, hex, dec, name) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      if (name) return named[`&${name};`] ?? m;
      return m;
    });
}

/** Extract OG/meta tags from HTML string */
export function extractMeta(html: string) {
  const get = (property: string): string => {
    // Try og: tags first, then twitter: tags, then standard meta
    for (const prefix of [`og:${property}`, `twitter:${property}`, property]) {
      const match = html.match(
        new RegExp(
          `<meta[^>]*(?:property|name)=["']${prefix}["'][^>]*content=["']([^"']*)["']` +
          `|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${prefix}["']`,
          "i",
        ),
      );
      if (match) return match[1] || match[2] || "";
    }
    return "";
  };

  // Fallback title from <title> tag
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  // Fallback image: first large img src
  let fallbackImage = "";
  if (!get("image")) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (imgMatch) fallbackImage = imgMatch[1];
  }

  return {
    image_url: get("image") || fallbackImage,
    title: decodeEntities(get("title") || (titleTag ? titleTag[1].trim() : "")),
    description: decodeEntities(get("description")),
    site_name: decodeEntities(get("site_name")),
  };
}

/** True if a hostname is a private/internal/loopback address that must be blocked (SSRF guard). */
export function isBlockedHost(host: string): boolean {
  return host === "localhost" || host.startsWith("127.") || host.startsWith("10.") ||
    host.startsWith("192.168.") || host.startsWith("169.254.") || host === "0.0.0.0" ||
    host.startsWith("172.") && (() => { const b = parseInt(host.split(".")[1]); return b >= 16 && b <= 31; })() ||
    host.endsWith(".internal") || host.endsWith(".local");
}

export type UrlValidation =
  | { ok: true; parsed: URL }
  | { ok: false; error: string };

/**
 * Validate a user-supplied URL: must be a parseable http(s) URL and not a
 * private/internal host. Returns the parsed URL on success, or an error string
 * matching the original inline messages.
 */
export function validateUrl(url: unknown): UrlValidation {
  if (!url || typeof url !== "string") {
    return { ok: false, error: "No url provided" };
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: "Invalid URL" }; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http/https URLs allowed" };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, error: "Private/internal URLs not allowed" };
  }
  return { ok: true, parsed };
}

/** Make a relative image URL absolute against the page's origin. Absolute URLs pass through. */
export function absolutizeImageUrl(imageUrl: string, pageUrl: string): string {
  if (imageUrl && !imageUrl.startsWith("http")) {
    const base = new URL(pageUrl);
    return new URL(imageUrl, base.origin).href;
  }
  return imageUrl;
}

/**
 * Follow redirects one hop at a time, revalidating each Location against
 * validateUrl. With redirect:"follow" the up-front private-host check was
 * bypassable — a public URL could 302 to 169.254.169.254 and fetch would follow
 * it (2026-07-19 audit, Low S-9).
 *
 * `fetchImpl` is injectable so the redirect chain is testable without network.
 */
export async function fetchFollowingSafeRedirects(
  startUrl: string,
  maxHops = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const res = await fetchImpl(current, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WRotateBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });
    if (res.status < 300 || res.status > 399) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    const next = new URL(loc, current).href;   // Location may be relative
    const check = validateUrl(next);
    if (!check.ok) {
      throw new Error(`Blocked redirect to disallowed host: ${check.error}`);
    }
    current = next;
  }
  throw new Error("Too many redirects");
}
