// share-collection — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

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
  const bg = "#f5f5f8", surface = "#ffffff", ph = "#e8e9f2";
  const gold = "#9a7628", text = "#16161e", muted = "#70708a", border = "#d8d9e8";

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

export function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
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
    .col-hero { text-align: center; padding: 0 0 1.25rem; }
    .col-avatar { width: 72px; height: 72px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; color: var(--muted); overflow: hidden; margin: 0 auto .75rem; }
    .col-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .col-name { font-size: 1.2rem; font-weight: 800; margin-bottom: .15rem; }
    .col-uname { font-size: .82rem; color: var(--muted); margin-bottom: .4rem; }
    .col-bio { font-size: .88rem; color: var(--muted); line-height: 1.5; max-width: 340px; margin: 0 auto; }
    .watch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .watch-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .watch-card-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .watch-card-ph { width: 100%; aspect-ratio: 1; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; color: var(--muted); }
    .watch-card-body { padding: .6rem .75rem; }
    .watch-card-brand { font-size: .7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .watch-card-name { font-size: .85rem; font-weight: 700; margin: .1rem 0; }
    .watch-card-wears { font-size: .72rem; color: var(--muted); }
    .link-block { display: block; text-decoration: none; color: inherit; }
    .state-wrap { text-align: center; padding: 3rem 1rem; }
    .state-icon { font-size: 2.5rem; margin-bottom: .5rem; }
    .state-title { font-size: 1.1rem; font-weight: 700; margin-bottom: .3rem; }
    .state-sub { font-size: .88rem; color: var(--muted); line-height: 1.5; }
    .btn-cta { display: inline-block; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .6rem 1.5rem; font-size: .92rem; font-weight: 600; text-decoration: none; font-family: inherit; margin-top: 1rem; }
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
  const collVis = profile.collection_visibility || "public";
  return privacy === "public" && collVis !== "private";
}

// Count unique (watch_id, date) wears per watch from raw log rows.
export function computeWearCounts(logs: { watch_id: string; date: string }[] | null | undefined): Record<string, number> {
  const wearCounts: Record<string, number> = {};
  const seen = new Set<string>();
  for (const log of (logs || [])) {
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
): { ogTitle: string; ogDescription: string } {
  const ogTitle = `${displayName}'s Watch Collection — WRotate`;
  const mostWorn = sorted[0] && (wearCounts[sorted[0].id] || 0) > 0 ? sorted[0] : null;
  const mostWornName = mostWorn ? `${mostWorn.brand || ""} ${mostWorn.name || ""}`.trim() : null;
  const totalWears = Object.values(wearCounts).reduce((a: number, b: number) => a + b, 0);
  const ogDescription = mostWornName
    ? `${watches.length} watch${watches.length !== 1 ? "es" : ""} · ${totalWears} total wear${totalWears !== 1 ? "s" : ""} · Most worn: ${mostWornName}`
    : `${watches.length} watch${watches.length !== 1 ? "es" : ""} · ${totalWears} total wear${totalWears !== 1 ? "s" : ""}`;
  return { ogTitle, ogDescription };
}

// Avatar inner HTML: <img> if avatar_url present, else escaped initials of the display name.
export function avatarInnerHtml(avatarUrl: string | null | undefined, displayName: string): string {
  return avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="">`
    : esc((displayName).trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase());
}
