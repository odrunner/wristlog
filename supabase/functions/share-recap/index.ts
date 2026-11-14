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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import {
  computeRecap,
  generateRecapSvg,
  isCrawlerUA,
  isRecapViewable,
  isValidPeriod,
  recapStatePage,
  renderRecapPage,
} from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { pageLang, VARY_LANG } from "../_shared/lang.ts";

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

  // Watches and the month's logs both key on profile.id alone — run them in
  // parallel. The logs read is bounded to the month, so it stays a small read
  // however long the account has been going.
  const [{ data: watchRows }, { data: logs }] = await Promise.all([
    db.from("watches")
      .select("id, brand, name, image, watch_privacy")
      .eq("user_id", profile.id),
    db.from("logs")
      .select("watch_id, date, use_case")
      .eq("user_id", profile.id)
      .gte("date", `${period}-01`)
      .lte("date", `${period}-31`)
      .limit(2000),
  ]);

  const watches = watchRows || [];
  // Owned decides what counts; public decides what may be named. See computeRecap.
  const ownedIds = new Set<string>(watches.map((w: { id: string }) => w.id));
  const publicIds = new Set<string>(
    watches
      .filter((w: { watch_privacy?: string | null }) => !w.watch_privacy || w.watch_privacy === "public")
      .map((w: { id: string }) => w.id),
  );

  const recap = computeRecap(logs, ownedIds, publicIds, period);
  // deno-lint-ignore no-explicit-any
  const watchById: Record<string, any> = {};
  for (const w of watches) if (publicIds.has(w.id)) watchById[w.id] = w;

  return { profile, recap, watchById };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const username = url.searchParams.get("u");
  const imgMode = url.searchParams.get("img") === "1";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = serviceKey();
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
  // The reader's language: ?lang=, else the browser's; a preview fetcher gets
  // English. Every HTML answer says so in Vary, since the 200 is cacheable.
  // (The SVG above is always English: only preview fetchers ask for it.)
  const lang = pageLang(url.searchParams.get("lang"), req.headers.get("accept-language"), req.headers.get("user-agent"));
  const HTML_HEADERS = { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Vary": VARY_LANG };

  if (!ok) {
    return new Response(recapStatePage("bad", supabaseUrl, lang), { status: 400, headers: HTML_HEADERS });
  }
  if (!data) {
    return new Response(recapStatePage("private", supabaseUrl, lang), { status: 404, headers: HTML_HEADERS });
  }

  const html = renderRecapPage({ ...data, supabaseUrl, token, username }, lang);
  // A month with no wears is a page of its own and, as before, is not cached.
  if (!data.recap.totalWears) return new Response(html, { status: 200, headers: HTML_HEADERS });
  return new Response(html, {
    status: 200,
    headers: { ...HTML_HEADERS, "Cache-Control": "public, max-age=300" },
  });
});
