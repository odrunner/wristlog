// fetch-image — pure logic (tested in lib.test.ts). Replaces the third-party
// CORS proxies (corsproxy.io, api.allorigins.win) the web app used to pull a
// watch photo off a shop's site: those saw every URL, and anything they
// returned was trusted. Audit 2026-09-23 low tail (L5).

export const MAX_IMAGE_BYTES = 8_000_000;
export const RATE_LIMIT_PER_HOUR = 200;

/** Only real raster images come back (no SVG: it can carry script). */
export function isAllowedImageType(contentType: string | null): boolean {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return /^image\/(jpeg|jpg|png|webp|gif|avif|heic|heif)$/.test(t);
}

/** Parse the request body's `url`: an https/http string, else null. */
export function requestedUrl(body: unknown): string | null {
  const u = (body as { url?: unknown } | null)?.url;
  if (typeof u !== "string" || u.length > 2000) return null;
  return /^https?:\/\//i.test(u) ? u : null;
}
