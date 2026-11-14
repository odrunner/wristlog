// share-collection — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them.
//
// The page is written in the reader's language (pageLang in _shared/lang.ts);
// every `lang` below defaults to English, which is the text the page always
// had. The og:image SVG stays English: only preview fetchers request it.
import { PAGE_TOKENS_CSS } from "../_shared/page-tokens.ts";
import { count, fill, SHELL_STRINGS } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { SHARE_STRINGS } from "../_shared/share-strings.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initials(brand: string, name: string): string {
  const raw = (brand + " " + name).trim();
  return raw.split(/\s+/).map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}

// Generates a 1200x630 SVG representing the watch collection grid
// deno-lint-ignore no-explicit-any
export function generateOgSvg(displayName: string, watches: any[], wearCounts: Record<string, number>): string {
  const W = 1200, H = 630;
  const bg = "#e9edf1", surface = "#ffffff", ph = "#e8e9f2";
  const gold = "#87661a", text = "#141a24", muted = "#566070", border = "#d3d9e1";

  const displayed = watches.slice(0, 6);
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

  const tiles = displayed.map((w: { id: string; brand?: string; name?: string; image?: string }, i: number) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = gridX + col * (CELL_W + GAP);
    const y = gridY + row * (CELL_H + GAP);
    const imgH = CELL_H - 60;
    const inits = initials(w.brand || "", w.name || "");
    const wears = wearCounts[w.id] || 0;
    const label = (w.name || "—").length > 18 ? (w.name || "").slice(0, 17) + "…" : (w.name || "—");

    const imgContent = w.image
      ? `<image href="${esc(w.image)}" x="${x}" y="${y}" width="${CELL_W}" height="${imgH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${i})"/>`
      : `<rect x="${x}" y="${y}" width="${CELL_W}" height="${imgH}" rx="8" fill="${ph}"/>
         <text x="${x + CELL_W / 2}" y="${y + imgH / 2 + 14}" text-anchor="middle" font-size="48" font-weight="700" fill="${gold}" font-family="Arial, Helvetica, sans-serif">${esc(inits)}</text>`;

    return `
      <rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="10" fill="${surface}" stroke="${border}" stroke-width="1"/>
      ${imgContent}
      <text x="${x + CELL_W / 2}" y="${y + imgH + 22}" text-anchor="middle" font-size="14" font-weight="700" fill="${text}" font-family="Arial, Helvetica, sans-serif">${esc(label)}</text>
      <text x="${x + CELL_W / 2}" y="${y + imgH + 42}" text-anchor="middle" font-size="12" fill="${muted}" font-family="Arial, Helvetica, sans-serif">${wears} wear${wears !== 1 ? "s" : ""}</text>`;
  }).join("");

  const nameLabel = (displayName.length > 28 ? displayName.slice(0, 27) + "…" : displayName) + "'s Collection";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${clips}</defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <text x="60" y="62" font-size="20" font-weight="800" fill="${gold}" font-family="Arial, Helvetica, sans-serif" letter-spacing="-0.5">WRotate</text>
  <text x="60" y="100" font-size="30" font-weight="800" fill="${text}" font-family="Arial, Helvetica, sans-serif">${esc(nameLabel)}</text>
  ${watches.length === 0 ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="24" fill="${muted}" font-family="Arial">No public watches yet</text>` : tiles}
</svg>`;
}

export function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string, lang: Lang = "en"): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta property="og:site_name" content="WRotate">
  <meta property="og:type" content="profile">
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
    .topbar-logo:hover { color: var(--gold-lt); }
    .page-wrap { max-width: var(--size-130); margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); }
    .col-hero { text-align: center; padding: 0 0 var(--space-5); }
    .col-avatar { width: var(--size-18); height: var(--size-18); border-radius: var(--radius-round); background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: var(--fs-2xl); font-weight: var(--fw-bold); color: var(--muted); overflow: hidden; margin: 0 auto var(--space-3); }
    .col-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .col-name { font-size: var(--fs-2xl); font-weight: var(--fw-heavy); margin-bottom: var(--space-0-5); }
    .col-uname { font-size: var(--fs-base); color: var(--muted); margin-bottom: var(--space-1-5); }
    .col-bio { font-size: var(--fs-md); color: var(--muted); line-height: var(--lh-body); max-width: var(--size-85); margin: 0 auto; }
    .watch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    .watch-card { background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .watch-card-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .watch-card-ph { width: 100%; aspect-ratio: 1; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: var(--fs-2xl); font-weight: var(--fw-bold); color: var(--muted); }
    .watch-card-body { padding: var(--space-2-5) var(--space-3); }
    .watch-card-brand { font-size: var(--fs-xs); color: var(--muted); text-transform: uppercase; letter-spacing: var(--ls-tight); }
    .watch-card-name { font-size: var(--fs-md); font-weight: var(--fw-bold); margin: var(--space-0-5) 0; }
    .watch-card-wears { font-size: var(--fs-sm); color: var(--muted); }
    .link-block { display: block; text-decoration: none; color: inherit; }
    .state-wrap { text-align: center; padding: var(--space-12) var(--space-4); }
    .state-icon { font-size: var(--fs-4xl); margin-bottom: var(--space-2); }
    .state-title { font-size: var(--fs-xl); font-weight: var(--fw-bold); margin-bottom: var(--space-1); }
    .state-sub { font-size: var(--fs-md); color: var(--muted); line-height: var(--lh-body); }
    .btn-cta { display: inline-block; background: var(--gold); color: var(--white); border: none; border-radius: var(--radius-btn); padding: var(--space-2-5) var(--space-6); font-size: var(--fs-body); font-weight: var(--fw-semibold); text-decoration: none; font-family: inherit; margin-top: var(--space-4); }
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

// Decide whether a fetched profile's collection is publicly viewable.
export function isCollectionViewable(
  profile: { profile_privacy?: string | null; collection_visibility?: string | null } | null | undefined,
  profErr: unknown,
): boolean {
  if (profErr || !profile) return false;
  const privacy = profile.profile_privacy || "public";
  // Match the app (viewUserProfile): missing/unknown visibility means
  // 'followers', and a logged-out viewer is nobody's follower — so only an
  // explicitly public collection has a public page (audit SEC-23-16; this used
  // to block 'private' only, exposing followers/close-friends collections).
  const v = profile.collection_visibility;
  const collVis = v === "public" || v === "followers" || v === "friends" || v === "private" ? v : "followers";
  return privacy === "public" && collVis === "public";
}

// Count unique (watch_id, date) wears per watch from raw log rows.
// `allowedIds`, when given, restricts counting to those watch ids — the caller
// now fetches logs by user_id alone (so the logs query can run in parallel with
// the watches query instead of waiting for its id list), and logs of private or
// since-deleted watches must not leak into the rendered counts or the OG total.
export function computeWearCounts(
  logs: { watch_id: string; date: string }[] | null | undefined,
  allowedIds?: Set<string>,
): Record<string, number> {
  const wearCounts: Record<string, number> = {};
  const seen = new Set<string>();
  for (const log of (logs || [])) {
    if (allowedIds && !allowedIds.has(log.watch_id)) continue;
    const k = log.watch_id + "|" + log.date;
    if (!seen.has(k)) { seen.add(k); wearCounts[log.watch_id] = (wearCounts[log.watch_id] || 0) + 1; }
  }
  return wearCounts;
}

// Sort watches by descending wear count (stable copy).
export function sortByWears<T extends { id: string }>(watches: T[], wearCounts: Record<string, number>): T[] {
  return [...watches].sort((a, b) => (wearCounts[b.id] || 0) - (wearCounts[a.id] || 0));
}

// Build the OG title + description strings for a viewable collection.
export function buildCollectionOg(
  displayName: string,
  watches: { id: string; brand?: string; name?: string }[],
  sorted: { id: string; brand?: string; name?: string }[],
  wearCounts: Record<string, number>,
  lang: Lang = "en",
): { ogTitle: string; ogDescription: string } {
  const S = SHARE_STRINGS[lang];
  const ogTitle = fill(S.collection.title, { n: displayName });
  const mostWorn = sorted[0] && (wearCounts[sorted[0].id] || 0) > 0 ? sorted[0] : null;
  const mostWornName = mostWorn ? `${mostWorn.brand || ""} ${mostWorn.name || ""}`.trim() : null;
  const totalWears = Object.values(wearCounts).reduce((a: number, b: number) => a + b, 0);
  const counts = `${count(lang, watches.length, S.watches)} · ${count(lang, totalWears, S.collection.totalWears)}`;
  const ogDescription = mostWornName
    ? `${counts} · ${fill(S.mostWornIs, { w: mostWornName })}`
    : counts;
  return { ogTitle, ogDescription };
}

// Avatar inner HTML: <img> if avatar_url present, else escaped initials of the display name.
export function avatarInnerHtml(avatarUrl: string | null | undefined, displayName: string): string {
  return avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="">`
    : esc((displayName).trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase());
}

// The two pages with no collection on them: a link with no username (400) and
// a profile that is private, hidden or gone (404).
export function collectionStatePage(kind: "missing" | "notFound", supabaseUrl: string, username: string | null, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  const open = SHELL_STRINGS[lang].open;
  if (kind === "missing") {
    return htmlPage(
      "WRotate", S.tagline,
      `${supabaseUrl}/functions/v1/share-collection?img=1&u=`,
      "https://wrotate.com/",
      `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">${S.collection.none}</div>
       <div class="state-sub">${S.visit}</div>
       <div><a href="https://wrotate.com/" class="btn-cta" style="margin-top:var(--space-4)">${open}</a></div></div>`,
      lang,
    );
  }
  return htmlPage(
    S.collection.privateTitle, S.collPrivate,
    `${supabaseUrl}/functions/v1/share-collection?img=1&u=${encodeURIComponent(username || "")}`,
    "https://wrotate.com/",
    `<div class="state-wrap"><div class="state-icon">🔒</div><div class="state-title">${S.collection.notFound}</div>
       <div class="state-sub">${S.collection.notFoundSub}</div>
       <div><a href="https://wrotate.com/" class="btn-cta" style="margin-top:var(--space-4)">${open}</a></div></div>`,
    lang,
  );
}

type CollectionWatch = { id: string; brand?: string; name?: string; image?: string };
export type CollectionPageData = {
  supabaseUrl: string;
  username: string;
  profile: { username?: string | null; display_name?: string | null; bio?: string | null; avatar_url?: string | null; is_official?: boolean | null };
  watches: CollectionWatch[];
  sorted: CollectionWatch[];
  wearCounts: Record<string, number>;
};

// The whole page for a public collection. Name, bio and watch names are the
// member's own and go out as written.
export function renderCollectionPage(d: CollectionPageData, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  const { profile, watches, sorted, wearCounts, supabaseUrl, username } = d;
  const displayName = profile.display_name || profile.username || S.someone;
  const { ogTitle, ogDescription } = buildCollectionOg(displayName, watches, sorted, wearCounts, lang);
  const ogImage = `${supabaseUrl}/functions/v1/share-collection?img=1&u=${encodeURIComponent(username)}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-collection?u=${encodeURIComponent(username)}`;

  const avatarInner = avatarInnerHtml(profile.avatar_url, displayName);

  const officialBadge = profile.is_official
    ? ' <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)" style="vertical-align:middle;"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 12c0 4.418 2.865 8.166 6.839 9.489.308.105.633.105.941.005L12 21.056l1.22.438a1.1 1.1 0 0 0 .941-.005C18.135 20.166 21 16.418 21 12c0-.69-.058-1.365-.17-2.022Z"/></svg>'
    : "";

  const bioHtml = profile.bio ? `<div class="col-bio">${esc(profile.bio)}</div>` : "";

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
        <div class="watch-card-wears">${count(lang, wears, S.wears)}</div>
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
    ${watches.length > 0
      ? `<div class="watch-grid">${gridHtml}</div>`
      : `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">${S.collection.empty}</div></div>`}`;

  return htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml, lang);
}
