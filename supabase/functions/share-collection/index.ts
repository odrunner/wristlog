// Supabase Edge Function: share-collection
// GET /share-collection?u=<username>       → HTML page with OG tags
// GET /share-collection?u=<username>&img=1 → SVG og:image of collection grid

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  avatarInnerHtml,
  buildCollectionOg,
  computeWearCounts,
  esc,
  generateOgSvg,
  htmlPage,
  initials,
  isCollectionViewable,
  sortByWears,
} from "./lib.ts";

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
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
  if (!username) {
    const html = htmlPage(
      "WRotate", "The watch collection tracker for enthusiasts.",
      `${supabaseUrl}/functions/v1/share-collection?img=1&u=`,
      "https://wrotate.com/",
      `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">No user specified</div>
       <div class="state-sub">Visit WRotate to explore watch collections.</div>
       <div><a href="https://wrotate.com/" class="btn-cta" style="margin-top:1rem">Open WRotate</a></div></div>`
    );
    return new Response(html, { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  }

  const data = await fetchCollectionData(db, username);

  if (!data) {
    const html = htmlPage(
      "Private Collection — WRotate", "This collection is private or no longer available.",
      `${supabaseUrl}/functions/v1/share-collection?img=1&u=${encodeURIComponent(username || "")}`,
      "https://wrotate.com/",
      `<div class="state-wrap"><div class="state-icon">🔒</div><div class="state-title">Collection not found</div>
       <div class="state-sub">This collection may be private or no longer available.</div>
       <div><a href="https://wrotate.com/" class="btn-cta" style="margin-top:1rem">Open WRotate</a></div></div>`
    );
    return new Response(html, { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  }

  const { profile, watches, sorted, wearCounts } = data;
  const displayName = profile.display_name || profile.username || "Someone";
  const { ogTitle, ogDescription } = buildCollectionOg(displayName, watches, sorted, wearCounts);
  const ogImage = `${supabaseUrl}/functions/v1/share-collection?img=1&u=${encodeURIComponent(username)}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-collection?u=${encodeURIComponent(username)}`;

  const avatarInner = avatarInnerHtml(profile.avatar_url, displayName);

  const officialBadge = profile.is_official
    ? ' <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)" style="vertical-align:middle;"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 12c0 4.418 2.865 8.166 6.839 9.489.308.105.633.105.941.005L12 21.056l1.22.438a1.1 1.1 0 0 0 .941-.005C18.135 20.166 21 16.418 21 12c0-.69-.058-1.365-.17-2.022Z"/></svg>'
    : "";

  const bioHtml = profile.bio ? `<div class="col-bio">${esc(profile.bio)}</div>` : "";

  const gridHtml = sorted.slice(0, 12).map((w: { id: string; brand?: string; name?: string; image?: string }) => {
    const wears = wearCounts[w.id] || 0;
    const imgHtml = w.image
      ? `<img class="watch-card-img" src="${esc(w.image)}" alt="" loading="lazy">`
      : `<div class="watch-card-ph">${esc(initials(w.brand || "", w.name || ""))}</div>`;
    return `<a href="https://wrotate.com/" class="watch-card link-block">
      ${imgHtml}
      <div class="watch-card-body">
        ${w.brand ? `<div class="watch-card-brand">${esc(w.brand)}</div>` : ""}
        <div class="watch-card-name">${esc(w.name || "—")}</div>
        <div class="watch-card-wears">${wears} wear${wears !== 1 ? "s" : ""}</div>
      </div>
    </a>`;
  }).join("");

  const bodyHtml = `
    <a href="https://wrotate.com/" class="col-hero link-block">
      <div class="col-avatar">${avatarInner}</div>
      <div class="col-name">${esc(displayName)}${officialBadge}</div>
      <div class="col-uname">@${esc(profile.username || "")}</div>
      ${bioHtml}
    </a>
    ${watches.length > 0
      ? `<div class="watch-grid">${gridHtml}</div>`
      : `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">No public watches yet</div></div>`}`;

  const html = htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml);
  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
