// share-wishlist — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them.
//
// The public face of a deliberately-sent wishlist link. Unlike share-collection,
// which is addressed by username and gated on profile privacy, this page is
// reached only by possessing the token — so the privacy gate lives in the token,
// and what the page may SHOW is restricted here instead.
//
// The page is written in the reader's language (pageLang in _shared/lang.ts);
// every `lang` below defaults to English, which is the text the page always
// had. The og:image SVG stays English: only preview fetchers request it.
import { PAGE_TOKENS_CSS } from "../_shared/page-tokens.ts";
import { count, fill, SHELL_STRINGS } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { SHARE_STRINGS } from "../_shared/share-strings.ts";
import { commentsSectionHtml, type PublicComment } from "../_shared/share-comments-lib.ts";

export type ShareWatch = {
  id: string;
  brand?: string | null;
  name?: string | null;
  ref?: string | null;
  image?: string | null;
  url?: string | null;
};

// The saved link is the ONE user-supplied URL the page publishes, so it is the one
// place an attacker-controlled scheme could reach an href. Only http(s) survives:
// a `javascript:` or `data:` URL saved on a wishlist item would otherwise run in
// the recipient's browser when they tapped through.
export function safeLinkUrl(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href : "";
  } catch (_e) {
    return "";
  }
}

// "chrono24.com" out of "https://www.chrono24.com/rolex/...", for the link's label.
export function linkDomain(raw: string | null | undefined): string {
  const safe = safeLinkUrl(raw);
  if (!safe) return "";
  try {
    return new URL(safe).hostname.replace(/^www\./, "");
  } catch (_e) {
    return "";
  }
}

// The decisive privacy boundary of this whole feature: the columns the public
// page is allowed to read out of `wishlist`. It lives here, rather than inline in
// index.ts, so lib.test.ts can assert on it — index.ts has no test, and widening
// its select list to "*" would ship every suppressed field without failing one of
// the ~2900 tests in this repo.
//
// sort_order is fetched only to order the grid and is stripped before render.
// `url` is the owner's saved listing link, published deliberately (2026-08-12) and
// scheme-checked by safeLinkUrl before it becomes an href.
// NEVER add: price, market_price, market_price_date, market_price_src,
// watch_charts_url, notes, tags, added_date, wish_privacy.
export const SHARE_SELECT = "id, brand, name, ref, image, url, sort_order";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initials(brand: string, name: string): string {
  const raw = (brand + " " + name).trim();
  return raw.split(/\s+/).map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}

export function avatarInnerHtml(avatarUrl: string | null | undefined, displayName: string): string {
  return avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="">`
    : esc(displayName.trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase());
}

// A revoked link is gone the moment the owner says so. So is one whose lookup
// errored — failing open here would publish a wishlist on a transient fault.
export function isShareUsable(
  row: { revoked_at?: string | null } | null | undefined,
  err: unknown,
): boolean {
  if (err || !row) return false;
  return !row.revoked_at;
}

// THE PRIVACY BOUNDARY. Exactly five fields are read off each item — brand, name,
// ref, image and the saved url; anything else the caller happens to pass (price,
// market value, notes, tags, wish_privacy) is not read, so it cannot reach the
// markup. Keep it that way: never widen this to spread the input object.
export function wishlistCardsHtml(items: ShareWatch[]): string {
  return (items || []).map((w) => {
    const brand = String(w.brand || "");
    const name = String(w.name || "");
    const ref = String(w.ref || "");
    const img = w.image
      ? `<img class="wl-card-img" src="${esc(String(w.image))}" alt="" loading="lazy">`
      : `<div class="wl-card-ph">${esc(initials(brand, name))}</div>`;
    // The owner's saved link, when they kept one — the listing or product page they
    // had in mind. noopener/noreferrer so the destination gets neither a handle on
    // this window nor the share token in a Referer header.
    const href = safeLinkUrl(w.url);
    const domain = linkDomain(w.url);
    const link = href
      ? `<a class="wl-card-url" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(domain)} ↗</a>`
      : "";
    return `<div class="wl-card">
      ${img}
      <div class="wl-card-body">
        <div class="wl-card-brand">${esc(brand)}</div>
        <div class="wl-card-name">${esc(name)}</div>
        ${ref ? `<div class="wl-card-ref">Ref. ${esc(ref)}</div>` : ""}
        ${link}
      </div>
    </div>`;
  }).join("");
}

export function buildWishlistOg(
  displayName: string,
  label: string | null | undefined,
  items: ShareWatch[],
  lang: Lang = "en",
): { ogTitle: string; ogDescription: string } {
  const S = SHARE_STRINGS[lang];
  const n = (items || []).length;
  const ogTitle = `${fill(S.wishlist.heading, { n: displayName })} — WRotate`;
  const names = (items || []).slice(0, 3)
    .map((w) => `${w.brand || ""} ${w.name || ""}`.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [count(lang, n, S.watches)];
  const trimmedLabel = (label || "").trim();
  if (trimmedLabel) parts.push(trimmedLabel);
  if (names) parts.push(names);
  return { ogTitle, ogDescription: parts.join(" · ") };
}

// 1200x630, the same geometry share-collection uses, so previews match.
// `heading` lets share-watches reuse this image with its own title line; the
// default keeps every existing share-wishlist preview byte-identical.
export function generateWishlistOgSvg(
  displayName: string,
  items: ShareWatch[],
  heading: (name: string) => string = (name) => `${name}'s Wishlist`,
): string {
  const W = 1200, H = 630;
  const bg = "#e9edf1", surface = "#ffffff", ph = "#e8e9f2";
  const gold = "#87661a", text = "#141a24", muted = "#566070", border = "#d3d9e1";

  const displayed = (items || []).slice(0, 6);
  const cols = Math.min(displayed.length, 3) || 1;
  const rows = Math.ceil(displayed.length / cols);
  const CELL_W = 220, CELL_H = 240, GAP = 16;
  const gridW = cols * CELL_W + (cols - 1) * GAP;
  const gridH = rows * CELL_H + (rows - 1) * GAP;
  const gridX = Math.round((W - gridW) / 2);
  const gridY = Math.round((H - gridH) / 2) + 50;

  const clips = displayed.map((_: unknown, i: number) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = gridX + col * (CELL_W + GAP);
    const y = gridY + row * (CELL_H + GAP);
    return `<clipPath id="c${i}"><rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H - 60}" rx="8"/></clipPath>`;
  }).join("");

  const tiles = displayed.map((w: ShareWatch, i: number) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = gridX + col * (CELL_W + GAP);
    const y = gridY + row * (CELL_H + GAP);
    const imgH = CELL_H - 60;
    const inits = initials(String(w.brand || ""), String(w.name || ""));
    const nm = String(w.name || "—");
    const label = nm.length > 18 ? nm.slice(0, 17) + "…" : nm;
    const brand = String(w.brand || "");
    const brandLabel = brand.length > 22 ? brand.slice(0, 21) + "…" : brand;

    const imgContent = w.image
      ? `<image href="${esc(String(w.image))}" x="${x}" y="${y}" width="${CELL_W}" height="${imgH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>`
      : `<rect x="${x}" y="${y}" width="${CELL_W}" height="${imgH}" rx="8" fill="${ph}"/>
         <text x="${x + CELL_W / 2}" y="${y + imgH / 2 + 14}" text-anchor="middle" font-size="48" font-weight="700" fill="${gold}" font-family="Arial, Helvetica, sans-serif">${esc(inits)}</text>`;

    return `
      <rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="10" fill="${surface}" stroke="${border}" stroke-width="1"/>
      ${imgContent}
      <text x="${x + CELL_W / 2}" y="${y + imgH + 22}" text-anchor="middle" font-size="14" font-weight="700" fill="${text}" font-family="Arial, Helvetica, sans-serif">${esc(label)}</text>
      <text x="${x + CELL_W / 2}" y="${y + imgH + 42}" text-anchor="middle" font-size="12" fill="${muted}" font-family="Arial, Helvetica, sans-serif">${esc(brandLabel)}</text>`;
  }).join("");

  const nameLabel = heading(displayName.length > 28 ? displayName.slice(0, 27) + "…" : displayName);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${clips}</defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <text x="60" y="62" font-size="20" font-weight="800" fill="${gold}" font-family="Arial, Helvetica, sans-serif" letter-spacing="-0.5">WRotate</text>
  <text x="60" y="100" font-size="30" font-weight="800" fill="${text}" font-family="Arial, Helvetica, sans-serif">${esc(nameLabel)}</text>
  ${displayed.length === 0 ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="24" fill="${muted}" font-family="Arial">No watches in this list</text>` : tiles}
</svg>`;
}

export function htmlPage(
  title: string,
  description: string,
  imageUrl: string,
  canonicalUrl: string,
  bodyHtml: string,
  lang: Lang = "en",
): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex,nofollow">
  <meta property="og:site_name" content="WRotate">
  <meta property="og:type" content="website">
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
    ${PAGE_TOKENS_CSS}
    body { background: var(--bg); color: var(--text); font-family: var(--font-sans); min-height: 100vh; font-size: var(--fs-body); }
    a { color: var(--gold); text-decoration: none; }
    .topbar { position: sticky; top: 0; z-index: var(--z-header); display: flex; align-items: center; justify-content: center; padding: var(--space-3) var(--space-5); background: var(--surface); border-bottom: var(--space-px) solid var(--border); }
    .topbar-logo { display: inline-flex; align-items: center; gap: var(--space-1-5); font-size: var(--fs-xl); font-weight: var(--fw-heavy); letter-spacing: var(--ls-display); color: var(--gold); text-decoration: none; }
    .topbar-logo img { width: var(--size-6); height: var(--size-6); border-radius: var(--radius-sm); }
    .page-wrap { max-width: var(--size-130); margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); }
    .col-hero { text-align: center; padding: 0 0 var(--space-5); }
    .col-avatar { width: var(--size-18); height: var(--size-18); border-radius: var(--radius-round); background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: var(--fs-2xl); font-weight: var(--fw-bold); color: var(--muted); overflow: hidden; margin: 0 auto var(--space-3); }
    .col-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .col-name { font-size: var(--fs-2xl); font-weight: var(--fw-heavy); margin-bottom: var(--space-0-5); }
    .col-uname { font-size: var(--fs-base); color: var(--muted); margin-bottom: var(--space-1-5); }
    .col-label { font-size: var(--fs-md); color: var(--muted); line-height: var(--lh-body); white-space: pre-wrap; text-align: left; background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); padding: var(--space-3) var(--space-3-5); margin-top: var(--space-2-5); }
    .wl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    .wl-card { background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); overflow: hidden; }
    /* The surface2 background is the broken-image fallback: an image URL that
       404s leaves a neutral square rather than a torn-page icon. */
    .wl-card-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: var(--surface2); }
    .wl-card-ph { width: 100%; aspect-ratio: 1; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: var(--fs-2xl); font-weight: var(--fw-bold); color: var(--muted); }
    .wl-card-body { padding: var(--space-2-5) var(--space-3); }
    .wl-card-brand { font-size: var(--fs-xs); color: var(--muted); text-transform: uppercase; letter-spacing: var(--ls-tight); }
    .wl-card-name { font-size: var(--fs-md); font-weight: var(--fw-bold); margin: var(--space-0-5) 0; }
    .wl-card-ref { font-size: var(--fs-sm); color: var(--muted); }
    .wl-card-url { display: inline-block; font-size: var(--fs-sm); margin-top: var(--space-1); word-break: break-all; }
    .state-wrap { text-align: center; padding: var(--space-12) var(--space-4); }
    .state-icon { font-size: var(--fs-4xl); margin-bottom: var(--space-2); }
    .state-title { font-size: var(--fs-xl); font-weight: var(--fw-bold); margin-bottom: var(--space-1); }
    .state-sub { font-size: var(--fs-md); color: var(--muted); line-height: var(--lh-body); }
    .btn-cta { display: inline-block; background: var(--gold); color: var(--white); border: none; border-radius: var(--radius-btn); padding: var(--space-2-5) var(--space-6); font-size: var(--fs-body); font-weight: var(--fw-semibold); text-decoration: none; font-family: inherit; margin-top: var(--space-4); }
    .foot { text-align: center; margin-top: var(--space-8); font-size: var(--fs-base); color: var(--muted); }
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

// The two pages with no list on them, for share-wishlist and share-watches
// alike: a link with no token (400) and a token that is revoked or unknown (404).
export function shareStatePage(
  page: "wishlist" | "watches",
  kind: "missing" | "dead",
  supabaseUrl: string,
  lang: Lang = "en",
): string {
  const S = SHARE_STRINGS[lang];
  const P = page === "wishlist" ? S.wishlist : S.watchesPage;
  const title = kind === "missing" ? "WRotate" : P.deadTitle;
  const icon = kind === "missing" ? "⌚" : "🔒";
  const heading = kind === "missing" ? P.none : P.dead;
  const sub = kind === "missing" ? S.incomplete : S.revoked;
  return htmlPage(
    title,
    sub,
    `${supabaseUrl}/functions/v1/share-${page}?img=1`,
    "https://wrotate.com/",
    `<div class="state-wrap"><div class="state-icon">${icon}</div><div class="state-title">${esc(heading)}</div>
     <div class="state-sub">${esc(sub)}</div>
     <div><a href="https://wrotate.com/open" class="btn-cta">${SHELL_STRINGS[lang].open}</a></div></div>`,
    lang,
  );
}

export type SharePageData = {
  supabaseUrl: string;
  token: string;
  profile: { username?: string | null; display_name?: string | null; avatar_url?: string | null };
  items: ShareWatch[];
  label: string | null;
  comments: PublicComment[];
  nowMs: number;
};

// The whole page behind a live token, for share-wishlist and share-watches
// alike. The name, the owner's note and the watch names are theirs and go out
// as written. (`Ref.` is said the same way in every app language.)
export function renderSharePage(page: "wishlist" | "watches", d: SharePageData, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  const P = page === "wishlist" ? S.wishlist : S.watchesPage;
  const { profile, items, label, token, supabaseUrl } = d;
  const displayName = profile.display_name || profile.username || S.someone;
  const heading = fill(P.heading, { n: displayName });
  const n = items.length;

  // The two pages describe themselves the same way; only the heading differs.
  const { ogDescription } = buildWishlistOg(displayName, label, items, lang);

  const ogImage = `${supabaseUrl}/functions/v1/share-${page}?img=1&t=${encodeURIComponent(token)}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-${page}?t=${encodeURIComponent(token)}`;

  const body = `
    <div class="col-hero">
      <div class="col-avatar">${avatarInnerHtml(profile.avatar_url, displayName)}</div>
      <div class="col-name">${esc(heading)}</div>
      <div class="col-uname">${count(lang, n, S.watches)}</div>
      ${label ? `<div class="col-label">${esc(label)}</div>` : ""}
    </div>
    ${n === 0
      ? `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">${P.emptied}</div>
         <div class="state-sub">${P.emptiedSub}</div></div>`
      : `<div class="wl-grid">${wishlistCardsHtml(items)}</div>`}
    ${commentsSectionHtml(page === "wishlist" ? "wishlist" : "collection", token, d.comments, d.nowMs, lang)}
    <div class="foot">${S.sharedFrom} · <a href="https://wrotate.com/open">${P.cta}</a></div>`;

  return htmlPage(`${heading} — WRotate`, ogDescription, ogImage, canonicalUrl, body, lang);
}
