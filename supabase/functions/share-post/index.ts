// Supabase Edge Function: share-post
// Serves a public post page with OG meta tags for rich link previews.
// GET /share-post?id=<log_uuid>
//
// Returns an HTML page with:
// - OG tags (og:title, og:description, og:image, twitter:card) for previews
// - A styled post card (photo, caption, watch name, user info)
// - CTA to open/join WRotate
// Only serves public, non-moderated posts.

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

function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta property="og:site_name" content="WRotate">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(imageUrl)}">
  <meta property="og:url" content="${esc(canonicalUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(imageUrl)}">
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
    .post-card { background: var(--surface); border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); cursor: pointer; transition: box-shadow .15s; display: block; text-decoration: none; color: var(--text); }
    .post-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); }
    .post-photo { width: 100%; display: block; }
    .post-body { padding: 1rem 1.15rem; }
    .post-header { display: flex; align-items: center; gap: .6rem; margin-bottom: .75rem; }
    .post-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 700; color: var(--muted); overflow: hidden; flex-shrink: 0; }
    .post-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .post-name { font-weight: 700; font-size: .92rem; }
    .post-meta { font-size: .75rem; color: var(--muted); }
    .post-caption { font-size: .92rem; line-height: 1.5; margin-bottom: .75rem; }
    .post-watch { display: inline-flex; align-items: center; gap: .4rem; background: var(--surface2); border-radius: 20px; padding: .3rem .75rem .3rem .4rem; font-size: .78rem; font-weight: 600; color: var(--text); }
    .post-watch img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
    .cta-wrap { text-align: center; margin-top: 1.5rem; }
    .btn-cta { display: inline-block; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .6rem 1.5rem; font-size: .92rem; font-weight: 600; text-decoration: none; font-family: inherit; }
    .state-wrap { text-align: center; padding: 3rem 1rem; }
    .state-icon { font-size: 2.5rem; margin-bottom: .5rem; }
    .state-title { font-size: 1.1rem; font-weight: 700; margin-bottom: .3rem; }
    .state-sub { font-size: .88rem; color: var(--muted); line-height: 1.5; }
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
  const logId = url.searchParams.get("id");

  if (!logId) {
    const html = htmlPage(
      "WRotate",
      "The watch collection tracker for enthusiasts.",
      "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG",
      "https://wrotate.com/",
      `<div class="state-wrap">
        <div class="state-icon">⌚</div>
        <div class="state-title">No post specified</div>
        <div class="state-sub">Visit WRotate to explore watch collections.</div>
        <div class="cta-wrap"><a href="https://wrotate.com/" class="btn-cta">Open WRotate</a></div>
      </div>`
    );
    return new Response(html, { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, supabaseKey);

  // Fetch the log (must be public and not moderated)
  const { data: log, error: logErr } = await db
    .from("logs")
    .select("id, user_id, watch_id, photo_url, notes, use_case, date, created_at, visibility")
    .eq("id", logId)
    .eq("visibility", "public")
    .is("moderation_status", null)
    .maybeSingle();

  if (logErr || !log) {
    const html = htmlPage(
      "Post not found — WRotate",
      "This post is private or no longer available.",
      "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG",
      "https://wrotate.com/",
      `<div class="state-wrap">
        <div class="state-icon">🔒</div>
        <div class="state-title">Post not found</div>
        <div class="state-sub">This post may be private, deleted, or no longer available.</div>
        <div class="cta-wrap"><a href="https://wrotate.com/" class="btn-cta">Open WRotate</a></div>
      </div>`
    );
    return new Response(html, { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  }

  // Fetch profile and watch in parallel
  const [profileRes, watchRes] = await Promise.all([
    db.from("profiles").select("id, username, display_name, avatar_url, is_official").eq("id", log.user_id).maybeSingle(),
    log.watch_id
      ? db.from("watches").select("id, brand, name, image").eq("id", log.watch_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profile = profileRes.data;
  const watch = watchRes.data;

  // Build content
  const displayName = profile?.display_name || profile?.username || "Someone";
  const watchName = watch ? `${watch.brand || ""} ${watch.name || ""}`.trim() : "";
  const caption = log.notes || "";
  const photoUrl = log.photo_url || watch?.image || "";
  const dateStr = log.date || "";

  // OG fields
  const ogTitle = watchName
    ? `${displayName}'s ${watchName} — WRotate`
    : `${displayName}'s post — WRotate`;
  const ogDescription = caption
    ? caption.slice(0, 200)
    : watchName
      ? `${displayName} wore their ${watchName}`
      : `Check out this post on WRotate`;
  const ogImage = photoUrl || "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG";
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-post?id=${logId}`;

  // Build avatar HTML
  const avatarInner = profile?.avatar_url
    ? `<img src="${esc(profile.avatar_url)}" alt="">`
    : esc((displayName || "?").trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase());

  // Use case label
  const useCaseLabels: Record<string, string> = {
    casual: "Casual", formal: "Formal", sport: "Sport", dive: "Dive",
    travel: "Travel", work: "Work", special: "Special Occasion",
    outdoor: "Outdoor", dinner: "Dinner", unspecified: "",
  };
  const useCaseLabel = log.use_case ? (useCaseLabels[log.use_case] || log.use_case) : "";

  // Format date
  let dateLabel = "";
  if (dateStr) {
    try {
      const d = new Date(dateStr + "T12:00:00");
      dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch { dateLabel = dateStr; }
  }
  const metaParts = [dateLabel, useCaseLabel].filter(Boolean).join(" · ");

  // Build card HTML
  const photoHtml = photoUrl
    ? `<img class="post-photo" src="${esc(photoUrl)}" alt="${esc(watchName || "Watch post")}">`
    : "";

  const captionHtml = caption
    ? `<div class="post-caption">${esc(caption)}</div>`
    : "";

  const watchChipHtml = watchName
    ? `<div class="post-watch">${watch?.image ? `<img src="${esc(watch.image)}" alt="">` : "⌚"} ${esc(watchName)}</div>`
    : "";

  const officialBadge = profile?.is_official
    ? ' <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)" style="vertical-align:middle;"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 12c0 4.418 2.865 8.166 6.839 9.489.308.105.633.105.941.005L12 21.056l1.22.438a1.1 1.1 0 0 0 .941-.005C18.135 20.166 21 16.418 21 12c0-.69-.058-1.365-.17-2.022Z"/></svg>'
    : "";

  const profileUrl = profile?.username ? `https://wrotate.com/profile?u=${encodeURIComponent(profile.username)}` : "https://wrotate.com/";

  const bodyHtml = `
    <a href="https://wrotate.com/" class="post-card">
      ${photoHtml}
      <div class="post-body">
        <div class="post-header">
          <div class="post-avatar">${avatarInner}</div>
          <div>
            <div class="post-name">${esc(displayName)}${officialBadge}</div>
            ${metaParts ? `<div class="post-meta">${esc(metaParts)}</div>` : ""}
          </div>
        </div>
        ${captionHtml}
        ${watchChipHtml}
      </div>
    </a>
    <div class="cta-wrap">
      <a href="https://apps.apple.com/us/app/wrotate/id6760091102">
        <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" width="130">
      </a>
    </div>`;

  const html = htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml);
  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
