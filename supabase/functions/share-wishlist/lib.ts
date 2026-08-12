// share-wishlist — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them.
//
// The public face of a deliberately-sent wishlist link. Unlike share-collection,
// which is addressed by username and gated on profile privacy, this page is
// reached only by possessing the token — so the privacy gate lives in the token,
// and what the page may SHOW is restricted here instead.

export type ShareWatch = {
  id: string;
  brand?: string | null;
  name?: string | null;
  ref?: string | null;
  image?: string | null;
};

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

// THE PRIVACY BOUNDARY. Exactly four fields are read off each item; anything
// else the caller happens to pass — price, market value, notes, tags, the saved
// URL, wish_privacy — is not read, so it cannot reach the markup. Keep it that
// way: never widen this to spread the input object.
export function wishlistCardsHtml(items: ShareWatch[]): string {
  return (items || []).map((w) => {
    const brand = String(w.brand || "");
    const name = String(w.name || "");
    const ref = String(w.ref || "");
    const img = w.image
      ? `<img class="wl-card-img" src="${esc(String(w.image))}" alt="" loading="lazy">`
      : `<div class="wl-card-ph">${esc(initials(brand, name))}</div>`;
    return `<div class="wl-card">
      ${img}
      <div class="wl-card-body">
        <div class="wl-card-brand">${esc(brand)}</div>
        <div class="wl-card-name">${esc(name)}</div>
        ${ref ? `<div class="wl-card-ref">Ref. ${esc(ref)}</div>` : ""}
      </div>
    </div>`;
  }).join("");
}

export function buildWishlistOg(
  displayName: string,
  label: string | null | undefined,
  items: ShareWatch[],
): { ogTitle: string; ogDescription: string } {
  const n = (items || []).length;
  const ogTitle = `${displayName}'s wishlist — WRotate`;
  const names = (items || []).slice(0, 3)
    .map((w) => `${w.brand || ""} ${w.name || ""}`.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [`${n} watch${n !== 1 ? "es" : ""}`];
  const trimmedLabel = (label || "").trim();
  if (trimmedLabel) parts.push(trimmedLabel);
  if (names) parts.push(names);
  return { ogTitle, ogDescription: parts.join(" · ") };
}

// 1200x630, the same geometry share-collection uses, so previews match.
export function generateWishlistOgSvg(displayName: string, items: ShareWatch[]): string {
  const W = 1200, H = 630;
  const bg = "#f5f5f8", surface = "#ffffff", ph = "#e8e9f2";
  const gold = "#9a7628", text = "#16161e", muted = "#70708a", border = "#d8d9e8";

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

  const nameLabel = (displayName.length > 28 ? displayName.slice(0, 27) + "…" : displayName) + "'s Wishlist";

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
): string {
  return `<!DOCTYPE html>
<html lang="en">
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
    .page-wrap { max-width: 520px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
    .col-hero { text-align: center; padding: 0 0 1.25rem; }
    .col-avatar { width: 72px; height: 72px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; color: var(--muted); overflow: hidden; margin: 0 auto .75rem; }
    .col-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .col-name { font-size: 1.2rem; font-weight: 800; margin-bottom: .15rem; }
    .col-uname { font-size: .82rem; color: var(--muted); margin-bottom: .4rem; }
    .col-label { font-size: .88rem; color: var(--muted); line-height: 1.5; }
    .wl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .wl-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    /* The surface2 background is the broken-image fallback: an image URL that
       404s leaves a neutral square rather than a torn-page icon. */
    .wl-card-img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: var(--surface2); }
    .wl-card-ph { width: 100%; aspect-ratio: 1; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 700; color: var(--muted); }
    .wl-card-body { padding: .6rem .75rem; }
    .wl-card-brand { font-size: .7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .wl-card-name { font-size: .85rem; font-weight: 700; margin: .1rem 0; }
    .wl-card-ref { font-size: .72rem; color: var(--muted); }
    .state-wrap { text-align: center; padding: 3rem 1rem; }
    .state-icon { font-size: 2.5rem; margin-bottom: .5rem; }
    .state-title { font-size: 1.1rem; font-weight: 700; margin-bottom: .3rem; }
    .state-sub { font-size: .88rem; color: var(--muted); line-height: 1.5; }
    .btn-cta { display: inline-block; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .6rem 1.5rem; font-size: .92rem; font-weight: 600; text-decoration: none; font-family: inherit; margin-top: 1rem; }
    .foot { text-align: center; margin-top: 2rem; font-size: .8rem; color: var(--muted); }
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
