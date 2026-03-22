// Supabase Edge Function: share-collection
// Serves a public collection page with OG meta tags for rich link previews.
// GET /share-collection?u=<username>
//
// Returns an HTML page with:
// - OG tags (og:title, og:description, og:image, twitter:card) for previews
// - Profile hero (avatar, name, bio), stats bar, watch grid
// - CTA to download WRotate
// Only serves public profiles with non-private collections.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function initials(brand: string, name: string): string {
  const raw = (brand + " " + name).trim();
  return raw.split(/\s+/).map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}

function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string): string {
  const ogImageTags = imageUrl
    ? `  <meta property="og:image" content="${esc(imageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(imageUrl)}">`
    : `  <meta name="twitter:card" content="summary">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta property="og:site_name" content="WRotate">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonicalUrl)}">
${ogImageTags}
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <link rel="icon" type="image/svg+xml" href="https://wrotate.com/icon.svg">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #f5f5f8; --surface: #ffffff; --surface2: #eeeff5;
      --border: #d8d9e8; --gold: #9a7628; --gold-lt: #c9a84c;
      --text: #16161e; --muted: #70708a; --radius: 10px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0b10; --surface: #141419; --surface2: #1c1c25;
        --border: #272734; --gold: #c9a84c; --gold-lt: #dbbe72;
        --text: #e6e6f0; --muted: #7a7a95;
      }
    }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; font-size: 15px; }
    a { color: var(--gold); text-decoration: none; }
    .topbar { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: .75rem 1.25rem; background: var(--surface); border-bottom: 1px solid var(--border); }
    .topbar-logo { display: inline-flex; align-items: center; gap: .4rem; font-size: 1.1rem; font-weight: 800; letter-spacing: -.02em; color: var(--gold); text-decoration: none; }
    .topbar-logo img { width: 24px; height: 24px; border-radius: 5px; }
    .topbar-logo:hover { color: var(--gold-lt); }
    .page-wrap { max-width: 520px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
    /* Profile hero */
    .col-hero { text-align: center; padding: 0 0 1.25rem; }
    .col-avatar { width: 72px; height: 72px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; color: var(--muted); overflow: hidden; margin: 0 auto .75rem; }
    .col-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .col-name { font-size: 1.2rem; font-weight: 800; margin-bottom: .15rem; }
    .col-uname { font-size: .82rem; color: var(--muted); margin-bottom: .4rem; }
    .col-bio { font-size: .88rem; color: var(--muted); line-height: 1.5; max-width: 340px; margin: 0 auto; }
    /* Stats bar */
    .stats-bar { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); margin-bottom: 1rem; }
    .stat-cell { flex: 1; text-align: center; padding: .75rem .5rem; border-right: 1px solid var(--border); }
    .stat-cell:last-child { border-right: none; }
    .stat-val { font-size: 1rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stat-lbl { font-size: .7rem; color: var(--muted); margin-top: .1rem; text-transform: uppercase; letter-spacing: .04em; }
    /* Watch grid */
    .watch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .watch-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .watch-card-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .watch-card-ph { width: 100%; aspect-ratio: 1; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; color: var(--muted); }
    .watch-card-body { padding: .6rem .75rem; }
    .watch-card-brand { font-size: .7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .watch-card-name { font-size: .85rem; font-weight: 700; margin: .1rem 0; }
    .watch-card-wears { font-size: .72rem; color: var(--muted); }
    /* Clickable blocks */
    .link-block { display: block; text-decoration: none; color: inherit; }
    /* Error states */
    .state-wrap { text-align: center; padding: 3rem 1rem; }
    .state-icon { font-size: 2.5rem; margin-bottom: .5rem; }
    .state-title { font-size: 1.1rem; font-weight: 700; margin-bottom: .3rem; }
    .state-sub { font-size: .88rem; color: var(--muted); line-height: 1.5; }
    .btn-cta { display: inline-block; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .6rem 1.5rem; font-size: .92rem; font-weight: 600; text-decoration: none; font-family: inherit; margin-top: 1rem; }
  </style>
</head>
<body>
  <header class="topbar">
    <a href="https://wrotate.com/" class="topbar-logo"><img src="https://wrotate.com/icon.svg" alt=""> WRotate</a>
  </header>
  <main class="page-wrap">
    ${bodyHtml}
  </main>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const username = url.searchParams.get("u");

  const fallbackImage = "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG";

  if (!username) {
    const html = htmlPage(
      "WRotate",
      "The watch collection tracker for enthusiasts.",
      fallbackImage,
      "https://wrotate.com/",
      `<div class="state-wrap">
        <div class="state-icon">⌚</div>
        <div class="state-title">No user specified</div>
        <div class="state-sub">Visit WRotate to explore watch collections.</div>
        <div class="cta-wrap"><a href="https://wrotate.com/" class="btn-cta">Open WRotate</a></div>
      </div>`
    );
    return new Response(html, { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch profile
  const { data: profile, error: profErr } = await db
    .from("profiles")
    .select("id, username, display_name, bio, avatar_url, is_official, profile_privacy, collection_visibility")
    .eq("username", username)
    .maybeSingle();

  // Privacy gate: don't reveal whether the user exists if private
  const privacy = profile?.profile_privacy || "public";
  const collVis = profile?.collection_visibility || "public";
  if (profErr || !profile || privacy !== "public" || collVis === "private") {
    const html = htmlPage(
      "Private Collection — WRotate",
      "This collection is private or no longer available.",
      fallbackImage,
      "https://wrotate.com/",
      `<div class="state-wrap">
        <div class="state-icon">🔒</div>
        <div class="state-title">Collection not found</div>
        <div class="state-sub">This collection may be private or no longer available.</div>
        <div class="cta-wrap"><a href="https://wrotate.com/" class="btn-cta">Open WRotate</a></div>
      </div>`
    );
    return new Response(html, { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  }

  // 2. Fetch public watches
  const { data: watchRows } = await db
    .from("watches")
    .select("id, brand, name, image, watch_privacy")
    .eq("user_id", profile.id)
    .or("watch_privacy.eq.public,watch_privacy.is.null");

  const watches = watchRows || [];

  // 3. Fetch wear counts (all logs for these watches — matches profile/index.html logic)
  const wearCounts: Record<string, number> = {};
  if (watches.length > 0) {
    const watchIds = watches.map((w: { id: string }) => w.id);
    const { data: logs } = await db
      .from("logs")
      .select("watch_id")
      .eq("user_id", profile.id)
      .in("watch_id", watchIds);
    for (const log of (logs || [])) {
      wearCounts[log.watch_id] = (wearCounts[log.watch_id] || 0) + 1;
    }
  }

  // Derived stats
  const totalWears = Object.values(wearCounts).reduce((a: number, b: number) => a + b, 0);
  let mostWorn: typeof watches[0] | null = null;
  let mostWears = 0;
  for (const w of watches) {
    const c = wearCounts[w.id] || 0;
    if (c > mostWears) { mostWears = c; mostWorn = w; }
  }
  const sorted = [...watches].sort((a, b) => (wearCounts[b.id] || 0) - (wearCounts[a.id] || 0));

  // OG fields
  const displayName = profile.display_name || profile.username || "Someone";
  const ogTitle = `${displayName}'s Watch Collection — WRotate`;
  const mostWornName = mostWorn ? `${mostWorn.brand || ""} ${mostWorn.name || ""}`.trim() : null;
  const ogDescription = mostWornName
    ? `${watches.length} watch${watches.length !== 1 ? "es" : ""} · ${totalWears} total wear${totalWears !== 1 ? "s" : ""} · Most worn: ${mostWornName}`
    : `${watches.length} watch${watches.length !== 1 ? "es" : ""} · ${totalWears} total wear${totalWears !== 1 ? "s" : ""}`;
  // Use watch photo if available; fall back to avatar; omit entirely if neither (avoids generic landing image)
  const ogImage = mostWorn?.image || sorted.find((w) => w.image)?.image || profile.avatar_url || "";
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-collection?u=${encodeURIComponent(username)}`;

  // Build avatar HTML
  const avatarInner = profile.avatar_url
    ? `<img src="${esc(profile.avatar_url)}" alt="">`
    : esc((displayName).trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase());

  const officialBadge = profile.is_official
    ? ' <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)" style="vertical-align:middle;"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 12c0 4.418 2.865 8.166 6.839 9.489.308.105.633.105.941.005L12 21.056l1.22.438a1.1 1.1 0 0 0 .941-.005C18.135 20.166 21 16.418 21 12c0-.69-.058-1.365-.17-2.022Z"/></svg>'
    : "";

  const bioHtml = profile.bio ? `<div class="col-bio">${esc(profile.bio)}</div>` : "";

  // Stats bar
  const mostWornCell = mostWornName
    ? esc(mostWornName.length > 18 ? mostWornName.slice(0, 17) + "…" : mostWornName)
    : "—";

  // Watch grid (max 12, sorted by wear count) — each card links to wrotate.com
  const gridHtml = sorted.slice(0, 12).map((w) => {
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
    <a href="https://wrotate.com/" class="stats-bar link-block">
      <div class="stat-cell">
        <div class="stat-val">${watches.length}</div>
        <div class="stat-lbl">Watches</div>
      </div>
      <div class="stat-cell">
        <div class="stat-val">${totalWears}</div>
        <div class="stat-lbl">Total Wears</div>
      </div>
      <div class="stat-cell">
        <div class="stat-val">${mostWornCell}</div>
        <div class="stat-lbl">Most Worn</div>
      </div>
    </a>
    ${watches.length > 0 ? `<div class="watch-grid">${gridHtml}</div>` : `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">No public watches yet</div></div>`}`;

  const html = htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml);
  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
