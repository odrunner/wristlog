// Supabase Edge Function: share-wishlist
// GET /share-wishlist?t=<token>        → HTML page listing the shared watches
// GET /share-wishlist?t=<token>&img=1  → SVG og:image
//
// The recipient is typically NOT a WRotate user — an authorised dealer, or
// someone shopping for a gift. Possession of the token IS the authorisation:
// the owner minted it and sent it, so unlike share-collection this path applies
// no profile-privacy gate. Guessing a token is the only way in, and that is a
// UUID's worth of entropy.
//
// What the page may show is deliberately narrow: photo, brand, model, reference.
// Price, market value, notes, tags and the saved URL are not even selected.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  avatarInnerHtml,
  buildWishlistOg,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  isShareUsable,
  type ShareWatch,
  wishlistCardsHtml,
} from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type ShareRow = {
  user_id: string;
  label: string | null;
  item_ids: string[];
  revoked_at: string | null;
};

// deno-lint-ignore no-explicit-any
async function fetchShareData(db: any, token: string) {
  const { data: share, error: shareErr } = await db
    .from("wishlist_shares")
    .select("user_id, label, item_ids, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!isShareUsable(share, shareErr)) return null;
  const row = share as ShareRow;

  const { data: profile, error: profErr } = await db
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", row.user_id)
    .maybeSingle();
  if (profErr || !profile) return null;

  // user_id is not redundant next to the id filter: it guarantees a token can
  // never surface a row belonging to anyone but its owner, whatever ids the
  // array happens to contain.
  const { data: itemRows } = await db
    .from("wishlist")
    .select("id, brand, name, ref, image, sort_order")
    .eq("user_id", row.user_id)
    .in("id", row.item_ids.length ? row.item_ids : ["__none__"])
    .order("sort_order", { ascending: true });

  const items = (itemRows || []).map((w: ShareWatch & { sort_order?: number }) => ({
    id: w.id, brand: w.brand, name: w.name, ref: w.ref, image: w.image,
  })) as ShareWatch[];

  return { profile, items, label: row.label };
}

// Fire-and-forget. A counter that fails must never cost the recipient the page.
// deno-lint-ignore no-explicit-any
async function bumpViews(db: any, token: string) {
  try {
    await db.rpc("bump_wishlist_share_view", { p_token: token });
  } catch (_e) { /* ignore */ }
}

function statePage(supabaseUrl: string, title: string, icon: string, heading: string, sub: string) {
  return htmlPage(
    title,
    sub,
    `${supabaseUrl}/functions/v1/share-wishlist?img=1`,
    "https://wrotate.com/",
    `<div class="state-wrap"><div class="state-icon">${icon}</div><div class="state-title">${esc(heading)}</div>
     <div class="state-sub">${esc(sub)}</div>
     <div><a href="https://wrotate.com/open" class="btn-cta">Open WRotate</a></div></div>`,
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const imgMode = url.searchParams.get("img") === "1";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, supabaseKey);

  // Image mode answers with an SVG even when there is nothing behind the token:
  // a preview whose image 404s renders as a grey box in the thread.
  if (imgMode) {
    const data = token ? await fetchShareData(db, token) : null;
    const displayName = data?.profile?.display_name || data?.profile?.username || "WRotate";
    const svg = generateWishlistOgSvg(displayName, data?.items || []);
    return new Response(svg, {
      headers: { ...CORS_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }

  if (!token) {
    return new Response(
      statePage(supabaseUrl, "WRotate", "⌚", "No wishlist specified", "This link is incomplete. Visit WRotate to explore watch collections."),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const data = await fetchShareData(db, token);

  if (!data) {
    return new Response(
      statePage(supabaseUrl, "Wishlist link — WRotate", "🔒", "This wishlist link is no longer available", "The owner may have revoked it, or it never existed."),
      { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const { profile, items, label } = data;
  const displayName = profile.display_name || profile.username || "Someone";
  const { ogTitle, ogDescription } = buildWishlistOg(displayName, label, items);
  const ogImage = `${supabaseUrl}/functions/v1/share-wishlist?img=1&t=${encodeURIComponent(token)}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-wishlist?t=${encodeURIComponent(token)}`;

  const n = items.length;
  const body = `
    <div class="col-hero">
      <div class="col-avatar">${avatarInnerHtml(profile.avatar_url, displayName)}</div>
      <div class="col-name">${esc(displayName)}'s wishlist</div>
      <div class="col-uname">${n} watch${n !== 1 ? "es" : ""}</div>
      ${label ? `<div class="col-label">${esc(label)}</div>` : ""}
    </div>
    ${n === 0
      ? `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">Nothing left in this list</div>
         <div class="state-sub">The watches on this link are no longer on the owner's wishlist.</div></div>`
      : `<div class="wl-grid">${wishlistCardsHtml(items)}</div>`}
    <div class="foot">Shared from WRotate · <a href="https://wrotate.com/open">Start your own wishlist</a></div>`;

  bumpViews(db, token);

  return new Response(htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, body), {
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
});
