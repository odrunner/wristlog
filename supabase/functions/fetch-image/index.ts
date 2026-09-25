// fetch-image — fetch one image for a signed-in user and hand back its bytes.
// POST { url } → image bytes (Content-Type preserved). Guarded by the shared
// outbound-fetch rules (_shared/ssrf.ts: no internal addresses, every redirect
// re-checked), raster types only, 8 MB cap, 200 per user per hour.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { serviceKey } from "../_shared/keys.ts";
import { safeFetch } from "../_shared/ssrf.ts";
import { isAllowedImageType, MAX_IMAGE_BYTES, RATE_LIMIT_PER_HOUR, requestedUrl } from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey());
  const { data: { user } } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ error: "Unauthorized" }, 401);

  const now = Date.now();
  const { data: count, error: rlErr } = await supabase.rpc("bump_rate_limit", {
    p_user: user.id, p_fn: "fetch-image",
    p_window_floor: new Date(now - 3600_000).toISOString(), p_now: new Date(now).toISOString(),
  });
  if (rlErr || typeof count !== "number") return json({ error: "Busy — try again in a moment." }, 503);
  if (count > RATE_LIMIT_PER_HOUR) return json({ error: "Too many image fetches — try again later." }, 429);

  const url = requestedUrl(await req.json().catch(() => null));
  if (!url) return json({ error: "Bad url" }, 400);

  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(12000),
      // A browser UA: shops (and Wikimedia) refuse generic bot agents, and the
      // proxies this replaces forwarded the visitor's own.
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    const type = res.headers.get("content-type");
    if (!res.ok || !isAllowedImageType(type) || !res.body) {
      console.warn("[fetch-image] refused:", res.status, type, new URL(url).hostname);
      return json({ error: "Not an image" }, 422);
    }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) return json({ error: "Image too large" }, 413);

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) { await reader.cancel(); return json({ error: "Image too large" }, 413); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return new Response(out, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": type!, "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[fetch-image]", (e as Error).message);
    return json({ error: "Could not fetch that image" }, 502);
  }
});
