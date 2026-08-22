// Supabase Edge Function: share-watches
// GET /share-watches?t=<token>        → HTML page listing the shared watches
// GET /share-watches?t=<token>&img=1  → SVG og:image
//
// The token-addressed COLLECTION share — share-wishlist pointed at `watches`.
// The recipient is typically NOT a WRotate user. Possession of the token IS
// the authorisation: the owner picked these watches and sent the link, so
// unlike share-collection (the ?u=<username> page) this path applies no
// profile-privacy gate, and a private watch the owner ticked is shown.
//
// What the page may show is deliberately narrow: photo, brand, model,
// reference and the saved link. Paid price, market value, wears, notes, tags,
// straps, box/papers, insurance and receipts are not even selected.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  avatarInnerHtml,
  buildWatchesOg,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  isShareUsable,
  type ShareWatch,
  sortSharedWatches,
  WATCHES_SHARE_SELECT,
  watchesHeading,
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
    .from("collection_shares")
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
    .from("watches")
    .select(WATCHES_SHARE_SELECT)
    .eq("user_id", row.user_id)
    .in("id", row.item_ids.length ? row.item_ids : ["__none__"]);

  // Ordered like the Collection tab (sortSharedWatches), then stripped to the
  // five publishable fields — purchase_date/created_at never reach the page.
  type Row = ShareWatch & { created_at?: string | null; purchase_date?: string | null };
  const items: ShareWatch[] = sortSharedWatches((itemRows || []) as Row[]).map((w) => ({
    id: w.id, brand: w.brand, name: w.name, ref: w.ref, image: w.image, url: w.url,
  }));

  return { profile, items, label: row.label };
}

// Fire-and-forget. A counter that fails must never cost the recipient the page.
// deno-lint-ignore no-explicit-any
async function bumpViews(db: any, token: string) {
  try {
    await db.rpc("bump_collection_share_view", { p_token: token });
  } catch (_e) { /* ignore */ }
}

function statePage(supabaseUrl: string, title: string, icon: string, heading: string, sub: string) {
  return htmlPage(
    title,
    sub,
    `${supabaseUrl}/functions/v1/share-watches?img=1`,
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
    const svg = generateWishlistOgSvg(displayName, data?.items || [], watchesHeading);
    return new Response(svg, {
      // Short on purpose: a chat service's cached preview outlives a revocation by
      // exactly this long.
      headers: { ...CORS_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=60" },
    });
  }

  if (!token) {
    return new Response(
      statePage(supabaseUrl, "WRotate", "⌚", "No watches specified", "This link is incomplete. Visit WRotate to explore watch collections."),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const data = await fetchShareData(db, token);

  if (!data) {
    return new Response(
      statePage(supabaseUrl, "Collection link — WRotate", "🔒", "This link is no longer available", "The owner may have revoked it, or it never existed."),
      { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const { profile, items, label } = data;
  const displayName = profile.display_name || profile.username || "Someone";
  const { ogTitle, ogDescription } = buildWatchesOg(displayName, label, items);
  const ogImage = `${supabaseUrl}/functions/v1/share-watches?img=1&t=${encodeURIComponent(token)}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-watches?t=${encodeURIComponent(token)}`;

  const n = items.length;
  const body = `
    <div class="col-hero">
      <div class="col-avatar">${avatarInnerHtml(profile.avatar_url, displayName)}</div>
      <div class="col-name">${esc(watchesHeading(displayName))}</div>
      <div class="col-uname">${n} watch${n !== 1 ? "es" : ""}</div>
      ${label ? `<div class="col-label">${esc(label)}</div>` : ""}
    </div>
    ${n === 0
      ? `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">Nothing left on this link</div>
         <div class="state-sub">The watches on this link are no longer in the owner's collection.</div></div>`
      : `<div class="wl-grid">${wishlistCardsHtml(items)}</div>`}
    <div class="foot">Shared from WRotate · <a href="https://wrotate.com/open">Track your own collection</a></div>`;

  // The counter must outlive the response without delaying it: the runtime may
  // tear the isolate down the moment the body is flushed, dropping the update.
  // deno-lint-ignore no-explicit-any
  const _rt = (globalThis as any).EdgeRuntime;
  const _bump = bumpViews(db, token);
  if (_rt && typeof _rt.waitUntil === "function") _rt.waitUntil(_bump);

  return new Response(htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, body), {
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
});
