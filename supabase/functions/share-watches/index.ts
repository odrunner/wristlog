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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { handleCommentPost, loadComments } from "../_shared/share-comments.ts";
import {
  generateWishlistOgSvg,
  isShareUsable,
  renderSharePage,
  shareStatePage,
  type ShareWatch,
  sortSharedWatches,
  WATCHES_SHARE_SELECT,
  watchesHeading,
} from "./lib.ts";
import { serviceKey } from "../_shared/keys.ts";
import { pageLang, VARY_LANG } from "../_shared/lang.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  // Profile and items both key on the share row alone — run them in parallel.
  // user_id is not redundant next to the id filter: it guarantees a token can
  // never surface a row belonging to anyone but its owner, whatever ids the
  // array happens to contain.
  const [{ data: profile, error: profErr }, { data: itemRows }] = await Promise.all([
    db.from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("id", row.user_id)
      .maybeSingle(),
    db.from("watches")
      .select(WATCHES_SHARE_SELECT)
      .eq("user_id", row.user_id)
      .in("id", row.item_ids.length ? row.item_ids : ["__none__"]),
  ]);
  if (profErr || !profile) return null;

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

// Light resolver for the comment POST: the owning user + label of a LIVE share.
// deno-lint-ignore no-explicit-any
async function resolveShareOwner(db: any, token: string) {
  const { data, error } = await db.from("collection_shares").select("user_id, label, revoked_at").eq("token", token).maybeSingle();
  return isShareUsable(data, error) ? { user_id: data.user_id as string, label: (data.label ?? null) as string | null } : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const imgMode = url.searchParams.get("img") === "1";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = serviceKey();
  const db = createClient(supabaseUrl, supabaseKey);

  // A comment from the page: validated, rate-limited, stored, then the owner is
  // told (bell/push via the notifications webhook, email from here).
  if (req.method === "POST") {
    return handleCommentPost(req, db, "collection", {
      supabaseUrl, corsHeaders: CORS_HEADERS, resolveShare: (t) => resolveShareOwner(db, t),
    });
  }

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

  // The reader's language: ?lang=, else the browser's; a preview fetcher gets
  // English. Every HTML answer says so in Vary, since the 200 is cacheable.
  // (The SVG above is always English: only preview fetchers ask for it.)
  const lang = pageLang(url.searchParams.get("lang"), req.headers.get("accept-language"), req.headers.get("user-agent"));
  const HTML_HEADERS = { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Vary": VARY_LANG };

  if (!token) {
    return new Response(shareStatePage("watches", "missing", supabaseUrl, lang), { status: 400, headers: HTML_HEADERS });
  }

  // Comments depend only on the token, not on the share data — fetch both in
  // parallel. A dead token costs one wasted (tiny, indexed) comments read.
  const [data, comments] = await Promise.all([
    fetchShareData(db, token),
    loadComments(db, "collection", token),
  ]);

  if (!data) {
    return new Response(shareStatePage("watches", "dead", supabaseUrl, lang), { status: 404, headers: HTML_HEADERS });
  }

  const html = renderSharePage("watches", { ...data, supabaseUrl, token, comments, nowMs: Date.now() }, lang);

  // The counter must outlive the response without delaying it: the runtime may
  // tear the isolate down the moment the body is flushed, dropping the update.
  // deno-lint-ignore no-explicit-any
  const _rt = (globalThis as any).EdgeRuntime;
  const _bump = bumpViews(db, token);
  if (_rt && typeof _rt.waitUntil === "function") _rt.waitUntil(_bump);

  return new Response(html, {
    // Same 60s window as the og:image above, and for the same reason: it is
    // exactly how long a revoked link (or a fresh comment) can lag behind.
    // Siblings without revocable tokens (share-collection/share-post) use 300.
    headers: { ...HTML_HEADERS, "Cache-Control": "public, max-age=60" },
  });
});
