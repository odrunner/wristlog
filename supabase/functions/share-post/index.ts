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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { postStatePage, renderPostPage } from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { pageLang, VARY_LANG } from "../_shared/lang.ts";

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

  // The reader's language: ?lang=, else the browser's; a preview fetcher gets
  // English. Every HTML answer says so in Vary, since the 200 is cacheable.
  const lang = pageLang(url.searchParams.get("lang"), req.headers.get("accept-language"), req.headers.get("user-agent"));
  const HTML_HEADERS = { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Vary": VARY_LANG };

  if (!logId) {
    return new Response(postStatePage("missing", lang), { status: 400, headers: HTML_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = serviceKey();
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
    return new Response(postStatePage("notFound", lang), { status: 404, headers: HTML_HEADERS });
  }

  // Fetch profile and watch in parallel
  const [profileRes, watchRes] = await Promise.all([
    db.from("profiles").select("id, username, display_name, avatar_url, is_official").eq("id", log.user_id).maybeSingle(),
    log.watch_id
      ? db.from("watches").select("id, brand, name, image").eq("id", log.watch_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const html = renderPostPage({ logId, supabaseUrl, log, profile: profileRes.data, watch: watchRes.data }, lang);
  return new Response(html, {
    status: 200,
    headers: { ...HTML_HEADERS, "Cache-Control": "public, max-age=300" },
  });
});
