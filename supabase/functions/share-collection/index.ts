// Supabase Edge Function: share-collection
// GET /share-collection?u=<username>       → HTML page with OG tags
// GET /share-collection?u=<username>&img=1 → SVG og:image of collection grid

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import {
  type CollectionPageData,
  collectionStatePage,
  computeWearCounts,
  generateOgSvg,
  isCollectionViewable,
  renderCollectionPage,
  sortByWears,
} from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { pageLang, VARY_LANG } from "../_shared/lang.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Shared DB fetch logic
async function fetchCollectionData(db: ReturnType<typeof createClient>, username: string) {
  const { data: profile, error: profErr } = await db
    .from("profiles")
    .select("id, username, display_name, bio, avatar_url, is_official, profile_privacy, collection_visibility")
    .eq("username", username)
    .maybeSingle();

  if (!isCollectionViewable(profile, profErr)) return null;

  // Watches and logs both key on profile.id alone, so they run in parallel.
  // The logs query is filtered by user only (not by the watch-id list): private
  // watches' logs are dropped in computeWearCounts via `allowedIds` instead,
  // which keeps the rendered counts identical while saving a serial round-trip
  // and a URL carrying every watch id.
  //
  // Wears are DISTINCT dates per watch (multiple logs same day = 1 wear — the
  // app-wide definition), so the raw (watch_id, date) pairs still have to come
  // over: PostgREST aggregates are disabled on this instance (PGRST123, checked
  // 2026-09-01) and count()/head would count duplicate same-day rows. A
  // GROUP-BY-watch RPC is the real fix if this ever grows. The cap is ordered
  // newest-first so, if a user ever exceeds it, recent wears are the ones that
  // count (observed max is 422 log rows/user as of 2026-09-01).
  const [{ data: watchRows }, { data: logs }] = await Promise.all([
    db.from("watches")
      .select("id, brand, name, image, watch_privacy")
      .eq("user_id", profile.id)
      .or("watch_privacy.eq.public,watch_privacy.is.null"),
    db.from("logs")
      .select("watch_id, date")
      .eq("user_id", profile.id)
      .order("date", { ascending: false })
      .limit(2500),
  ]);

  const watches = watchRows || [];
  const wearCounts = computeWearCounts(logs, new Set(watches.map((w: { id: string }) => w.id)));

  const sorted = sortByWears(watches, wearCounts);
  return { profile, watches, sorted, wearCounts };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const username = url.searchParams.get("u");
  const imgMode = url.searchParams.get("img") === "1";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = serviceKey();
  const db = createClient(supabaseUrl, supabaseKey);

  // --- Image mode: return SVG of collection grid ---
  if (imgMode && username) {
    const data = await fetchCollectionData(db, username);
    const displayName = data?.profile?.display_name || data?.profile?.username || username;
    const svg = generateOgSvg(displayName, data?.sorted || [], data?.wearCounts || {});
    return new Response(svg, {
      headers: { ...CORS_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }

  // --- HTML page mode ---
  // The reader's language: ?lang=, else the browser's; a preview fetcher gets
  // English. Every HTML answer says so in Vary, since the 200 is cacheable.
  // (The SVG above is always English: only preview fetchers ask for it.)
  const lang = pageLang(url.searchParams.get("lang"), req.headers.get("accept-language"), req.headers.get("user-agent"));
  const HTML_HEADERS = { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Vary": VARY_LANG };

  if (!username) {
    return new Response(collectionStatePage("missing", supabaseUrl, null, lang), { status: 400, headers: HTML_HEADERS });
  }

  const data = await fetchCollectionData(db, username);

  if (!data) {
    return new Response(collectionStatePage("notFound", supabaseUrl, username, lang), { status: 404, headers: HTML_HEADERS });
  }

  const html = renderCollectionPage({ ...data, supabaseUrl, username } as unknown as CollectionPageData, lang);
  return new Response(html, {
    status: 200,
    headers: { ...HTML_HEADERS, "Cache-Control": "public, max-age=300" },
  });
});
