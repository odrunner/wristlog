// Supabase Edge Function: share-recap
// GET /share-recap?u=<username>&m=YYYY-MM       → HTML page with OG tags
// GET /share-recap?u=<username>&m=YYYY-MM&img=1 → SVG og:image
//
// The public face of the in-app "month in review" card. A sharer taps Share on
// their own recap; this is what the recipient's messaging app renders, and what
// they land on if they tap it.
//
// Only serves profiles that are public with a non-private collection — the same
// gate share-collection uses. Watches marked private are counted but never
// named (see computeRecap).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildRecapOg,
  computeRecap,
  esc,
  generateRecapSvg,
  htmlPage,
  initials,
  isCrawlerUA,
  isRecapViewable,
  isValidPeriod,
  monthLabel,
} from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Resolves a share token to the (user, month) it was minted for. Possession of
// the token IS the authorisation — the owner generated it and sent it — so this
// path deliberately skips the profile-privacy gate that the ?u= path applies.
// Guessing a token is the only way in, and it is a UUID's worth of entropy.
// deno-lint-ignore no-explicit-any
async function resolveToken(db: any, token: string) {
  const { data, error } = await db
    .from("recap_shares")
    .select("user_id, period")
    .eq("token", token)
    .maybeSingle();
  if (error || !data || !isValidPeriod(data.period)) return null;
  return data as { user_id: string; period: string };
}

// `by` is either a username (public profiles only) or a resolved user id from a
// share token (any profile). Everything after the lookup is identical.
// deno-lint-ignore no-explicit-any
async function fetchRecapData(
  db: any,
  by: { username: string } | { userId: string },
  period: string,
) {
  const cols = "id, username, display_name, avatar_url, is_official, profile_privacy, collection_visibility";
  const q = db.from("profiles").select(cols);
  const { data: profile, error: profErr } = await ("userId" in by
    ? q.eq("id", by.userId)
    : q.eq("username", by.username)).maybeSingle();

  // The gate applies to the guessable ?u= URL only. A token-borne link is the
  // owner's own act of sharing, so a followers-only or private profile is
  // honoured rather than refused.
  if ("username" in by) {
    if (!isRecapViewable(profile, profErr)) return null;
  } else if (profErr || !profile) {
    return null;
  }

  const { data: watchRows } = await db
    .from("watches")
    .select("id, brand, name, image, watch_privacy")
    .eq("user_id", profile.id);

  const watches = watchRows || [];
  // Owned decides what counts; public decides what may be named. See computeRecap.
  const ownedIds = new Set<string>(watches.map((w: { id: string }) => w.id));
  const publicIds = new Set<string>(
    watches
      .filter((w: { watch_privacy?: string | null }) => !w.watch_privacy || w.watch_privacy === "public")
      .map((w: { id: string }) => w.id),
  );

  // Bounded to the month, so this stays a small read however long the account
  // has been going.
  const { data: logs } = await db
    .from("logs")
    .select("watch_id, date, use_case")
    .eq("user_id", profile.id)
    .gte("date", `${period}-01`)
    .lte("date", `${period}-31`)
    .limit(2000);

  const recap = computeRecap(logs, ownedIds, publicIds, period);
  // deno-lint-ignore no-explicit-any
  const watchById: Record<string, any> = {};
  for (const w of watches) if (publicIds.has(w.id)) watchById[w.id] = w;

  return { profile, recap, watchById };
}

function emptyState(supabaseUrl: string, title: string, icon: string, heading: string, sub: string, status: number) {
  const html = htmlPage(
    title,
    sub,
    `${supabaseUrl}/functions/v1/share-recap?img=1`,
    "https://wrotate.com/open",
    `<div class="state-wrap">
      <div class="state-icon">${icon}</div>
      <div class="state-title">${esc(heading)}</div>
      <div class="state-sub">${esc(sub)}</div>
      <div class="cta-wrap"><a href="https://wrotate.com/open" class="btn-cta">Open WRotate</a></div>
    </div>`,
  );
  return new Response(html, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const username = url.searchParams.get("u");
  const imgMode = url.searchParams.get("img") === "1";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, supabaseKey);

  // A token carries its own month, so ?t= needs no ?m=. The ?u= form still
  // takes one, and still only works for a public profile.
  const share = token ? await resolveToken(db, token) : null;
  let period = share ? share.period : url.searchParams.get("m");
  const ok = token ? !!share : (!!username && isValidPeriod(period));
  const data = !ok
    ? null
    : share
    ? await fetchRecapData(db, { userId: share.user_id }, share.period)
    : await fetchRecapData(db, { username: username as string }, period as string);
  if (!isValidPeriod(period)) period = null;

  // Fire-and-forget: a view is worth recording, never worth delaying or
  // failing the page for. See sql/2026-08-29-recap-share-views.sql.
  db.from("recap_share_views").insert({
    user_id: data?.profile?.id ?? null,
    period: period,
    via: token ? "token" : username ? "username" : "none",
    mode: imgMode ? "image" : "page",
    crawler: isCrawlerUA(req.headers.get("user-agent")),
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300) || null,
    referer: (req.headers.get("referer") || "").slice(0, 300) || null,
  }).then(({ error }: { error: unknown }) => { if (error) console.error("recap_share_views", error); });

  // --- Image mode ---
  // Always answers with an image, even on a bad or private request: a link
  // preview that 404s the image renders as a bare grey box in the thread.
  if (imgMode) {
    const displayName = data?.profile?.display_name || data?.profile?.username || "A collector";
    const svg = data
      ? generateRecapSvg(displayName, data.recap, data.watchById)
      : generateRecapSvg("A collector", {
          period: isValidPeriod(period) ? (period as string) : "2026-01",
          totalWears: 0, wearDays: 0, uniqueCount: 0, top: [], streak: null,
        }, {});
    return new Response(svg, {
      headers: { ...CORS_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }

  // --- HTML page mode ---
  if (!ok) {
    return emptyState(supabaseUrl, "WRotate", "⌚", "Nothing to show here",
      "This link is missing a collector or a month.", 400);
  }
  if (!data) {
    return emptyState(supabaseUrl, "Private — WRotate", "🔒", "Not available",
      "This collection is private or no longer available.", 404);
  }

  const { profile, recap, watchById } = data;
  const displayName = profile.display_name || profile.username || "Someone";

  if (!recap.totalWears) {
    return emptyState(supabaseUrl, `${displayName}'s ${monthLabel(recap.period)} — WRotate`, "⌚",
      "No wears that month", `${displayName} didn't log any wears in ${monthLabel(recap.period)}.`, 200);
  }

  const topWatch = recap.top[0] ? watchById[recap.top[0].id] : null;
  const topName = topWatch ? `${topWatch.brand || ""} ${topWatch.name || ""}`.trim() : null;
  const { ogTitle, ogDescription } = buildRecapOg(displayName, recap, topName);

  // The og:image URL has to be fetchable by a crawler with no session, so it
  // repeats whichever credential the page itself was opened with — the token
  // for a shared link, the username for a public one.
  const q = token
    ? `t=${encodeURIComponent(token)}`
    : `u=${encodeURIComponent(username as string)}&m=${encodeURIComponent(recap.period)}`;
  const ogImage = `${supabaseUrl}/functions/v1/share-recap?img=1&${q}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-recap?${q}`;

  const podium = recap.top.map((t) => {
    const w = watchById[t.id] || {};
    const art = w.image
      ? `<img src="${esc(w.image)}" alt="" loading="lazy">`
      : esc(initials(w.brand || "", w.name || ""));
    return `<div class="rc-item">
      <div class="rc-thumb">${art}</div>
      <div class="rc-name">${esc(w.name || "—")}</div>
      <div class="rc-count">${t.count} wear${t.count !== 1 ? "s" : ""}</div>
    </div>`;
  }).join("");

  const streakHtml = recap.streak
    ? `<div class="rc-streak">
         <div class="rc-streak-val">${recap.streak.days}</div>
         <div class="rc-streak-lbl">days logged in a row</div>
       </div>`
    : "";

  const bodyHtml = `
    <div class="rc-eyebrow">Month in review</div>
    <div class="rc-month">${esc(monthLabel(recap.period, false))}</div>
    <div class="rc-who">${esc(displayName)} · ${esc(recap.period.slice(0, 4))}</div>
    <div class="rc-stats">
      <div class="rc-stat"><div class="rc-stat-val">${recap.totalWears}</div><div class="rc-stat-lbl">Wears</div></div>
      <div class="rc-stat"><div class="rc-stat-val">${recap.uniqueCount}</div><div class="rc-stat-lbl">Watches</div></div>
      <div class="rc-stat"><div class="rc-stat-val">${recap.wearDays}</div><div class="rc-stat-lbl">Days</div></div>
    </div>
    ${podium ? `<div class="rc-sect">Most worn</div><div class="rc-podium">${podium}</div>` : ""}
    ${streakHtml}
    <div class="cta-wrap"><a href="https://wrotate.com/open" class="btn-cta">Track your own rotation</a></div>`;

  const html = htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml);
  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
