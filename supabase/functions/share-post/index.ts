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
import {
  avatarInnerHtml,
  buildPostOg,
  esc,
  formatPostDate,
  htmlPage,
  profileUrl,
  useCaseLabel,
  watchDisplayName,
} from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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
  const watchName = watchDisplayName(watch);
  const caption = log.notes || "";
  const photoUrl = log.photo_url || watch?.image || "";
  const dateStr = log.date || "";

  // OG fields
  const { ogTitle, ogDescription, ogImage } = buildPostOg({
    displayName,
    watchName,
    caption,
    photoUrl,
    fallbackImage: "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG",
  });
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-post?id=${logId}`;

  // Build avatar HTML
  const avatarInner = avatarInnerHtml(profile?.avatar_url, displayName);

  // Use case label
  const useCaseLabelStr = useCaseLabel(log.use_case);

  // Format date
  const dateLabel = formatPostDate(dateStr);
  const metaParts = [dateLabel, useCaseLabelStr].filter(Boolean).join(" · ");

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

  const _profileUrl = profileUrl(profile?.username);

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

  const html = htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml, logId!);
  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
