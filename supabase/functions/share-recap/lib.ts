// share-recap — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them.
//
// The month-in-review card in the app is personal and private. This is the
// public face of it: a page the sharer deliberately linked to, plus the
// og:image that renders in a message thread.
//
// The counting rules here MUST match monthRecap() in index.html — a sharer who
// sends their July and then sees different numbers on the page has caught us
// contradicting ourselves. Those rules: a measurement share is not a wear, a
// log for a watch no longer in the collection does not count, and a watch worn
// twice in one day counts once.

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initials(brand: string, name: string): string {
  const raw = (brand + " " + name).trim();
  return raw.split(/\s+/).map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}

// "2026-07" and nothing else. The month comes from a URL anyone can edit, and
// it is interpolated into SQL filters and page copy.
export function isValidPeriod(m: string | null | undefined): boolean {
  if (!m || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return false;
  const y = Number(m.slice(0, 4));
  return y >= 2020 && y <= 2100;
}

export function prevPeriodOf(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(period: string, withYear = true): string {
  const NAMES = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];
  const name = NAMES[Number(period.slice(5, 7)) - 1] || "";
  return withYear ? `${name} ${period.slice(0, 4)}` : name;
}

// Same gate as share-collection: a private profile, or one whose collection is
// hidden, has no public face at all.
export function isRecapViewable(
  profile: { profile_privacy?: string | null; collection_visibility?: string | null } | null | undefined,
  profErr: unknown,
): boolean {
  if (profErr || !profile) return false;
  const privacy = profile.profile_privacy || "public";
  const collVis = profile.collection_visibility || "public";
  return privacy === "public" && collVis !== "private";
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type RecapLog = { watch_id: string; date: string; use_case?: string | null };
export type Recap = {
  period: string;
  totalWears: number;
  wearDays: number;
  uniqueCount: number;
  top: { id: string; count: number }[];
  streak: { days: number; start: string; end: string } | null;
};

// `ownedIds` is every watch still in the collection — it decides what COUNTS.
// `publicIds` is the subset that may be NAMED — it decides what is shown.
//
// The split is deliberate. Totals are aggregates and identify nothing, so they
// are computed over the whole collection and match what the sharer saw in the
// app. The podium names and pictures watches, so it is drawn only from public
// ones: a private watch must not become public because its owner shared a
// month. The consequence is that the podium can be shorter than the unique
// count implies, which is correct and not worth explaining on the page.
export function computeRecap(
  logs: RecapLog[] | null | undefined,
  ownedIds: Set<string>,
  publicIds: Set<string>,
  period: string,
): Recap {
  const perWatch: Record<string, number> = {};
  const days = new Set<string>();
  const seen = new Set<string>();
  for (const l of (logs || [])) {
    if (!l || !l.watch_id || l.use_case === "measurement") continue;
    if (!l.date || String(l.date).slice(0, 7) !== period) continue;
    if (!ownedIds.has(l.watch_id)) continue;
    days.add(l.date);
    const k = l.watch_id + "|" + l.date;
    if (seen.has(k)) continue;
    seen.add(k);
    perWatch[l.watch_id] = (perWatch[l.watch_id] || 0) + 1;
  }

  const top = Object.keys(perWatch)
    .filter((id) => publicIds.has(id))
    .sort((a, b) => perWatch[b] - perWatch[a] || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 3)
    .map((id) => ({ id, count: perWatch[id] }));

  const sortedDays = [...days].sort();
  let best = 0, run = 0, bestEnd: string | null = null;
  for (let i = 0; i < sortedDays.length; i++) {
    run = (i > 0 && addDays(sortedDays[i - 1], 1) === sortedDays[i]) ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = sortedDays[i]; }
  }
  const streak = (best >= 3 && bestEnd)
    ? { days: best, start: addDays(bestEnd, -(best - 1)), end: bestEnd } : null;

  return {
    period,
    totalWears: seen.size,
    wearDays: days.size,
    uniqueCount: Object.keys(perWatch).length,
    top,
    streak,
  };
}

export function buildRecapOg(
  displayName: string,
  recap: Recap,
  watchName: string | null,
): { ogTitle: string; ogDescription: string } {
  const ogTitle = `${displayName}'s ${monthLabel(recap.period)} — WRotate`;
  const bits = [
    `${recap.totalWears} wear${recap.totalWears !== 1 ? "s" : ""}`,
    `${recap.uniqueCount} watch${recap.uniqueCount !== 1 ? "es" : ""}`,
    `${recap.wearDays} day${recap.wearDays !== 1 ? "s" : ""} logged`,
  ];
  if (watchName) bits.push(`Most worn: ${watchName}`);
  return { ogTitle, ogDescription: bits.join(" · ") };
}

// 1200x630 og:image. This is what most recipients actually see — the page
// behind it is the click-through, not the payload.
export function generateRecapSvg(
  displayName: string,
  recap: Recap,
  // deno-lint-ignore no-explicit-any
  watchById: Record<string, any>,
): string {
  const W = 1200, H = 630;
  const bg = "#f5f5f8", surface = "#ffffff", ph = "#e8e9f2";
  const gold = "#9a7628", text = "#16161e", muted = "#70708a", border = "#d8d9e8";
  const font = `font-family="Arial, Helvetica, sans-serif"`;

  // Baselines, not a layout engine — SVG text has no flow, so the vertical
  // rhythm is hand-set. An 86px numeral reaches ~62px above its baseline, so
  // STAT_Y has to clear the byline above it or the two collide.
  const STAT_Y = 336, PODIUM_Y = 400;
  const stat = (x: number, value: string, label: string) => `
    <text x="${x}" y="${STAT_Y}" text-anchor="middle" font-size="86" font-weight="800" fill="${gold}" ${font}>${esc(value)}</text>
    <text x="${x}" y="${STAT_Y + 38}" text-anchor="middle" font-size="20" font-weight="600" fill="${muted}" ${font} letter-spacing="2">${esc(label)}</text>`;

  const tiles = recap.top.map((t, i) => {
    const w = watchById[t.id] || {};
    const CELL = 200, GAP = 40;
    const totalW = recap.top.length * CELL + (recap.top.length - 1) * GAP;
    const x = Math.round((W - totalW) / 2) + i * (CELL + GAP);
    const y = PODIUM_Y + 30;
    const r = 46;
    const cx = x + CELL / 2, cy = y + r;
    const label = (w.name || "").length > 20 ? (w.name || "").slice(0, 19) + "…" : (w.name || "—");
    const art = w.image
      ? `<clipPath id="cc${i}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
         <image href="${esc(w.image)}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cc${i})"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ph}"/>
         <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="34" font-weight="700" fill="${gold}" ${font}>${esc(initials(w.brand || "", w.name || ""))}</text>`;
    return `${art}
      <text x="${cx}" y="${cy + r + 32}" text-anchor="middle" font-size="19" font-weight="700" fill="${text}" ${font}>${esc(label)}</text>
      <text x="${cx}" y="${cy + r + 56}" text-anchor="middle" font-size="16" fill="${muted}" ${font}>${t.count} wear${t.count !== 1 ? "s" : ""}</text>`;
  }).join("");

  const name = displayName.length > 24 ? displayName.slice(0, 23) + "…" : displayName;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="24" fill="${surface}" stroke="${border}" stroke-width="2"/>
  <text x="${W / 2}" y="130" text-anchor="middle" font-size="22" font-weight="700" fill="${gold}" ${font} letter-spacing="6">MONTH IN REVIEW</text>
  <text x="${W / 2}" y="205" text-anchor="middle" font-size="62" font-weight="800" fill="${text}" ${font}>${esc(monthLabel(recap.period))}</text>
  <text x="${W / 2}" y="240" text-anchor="middle" font-size="22" fill="${muted}" ${font}>${esc(name)} on WRotate</text>
  ${stat(300, String(recap.totalWears), "WEARS")}
  ${stat(600, String(recap.uniqueCount), "WATCHES")}
  ${stat(900, String(recap.wearDays), "DAYS")}
  ${tiles}
</svg>`;
}

export function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex">
  <meta property="og:site_name" content="WRotate">
  <meta property="og:type" content="article">
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
      --text: #16161e; --muted: #70708a;
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
    .topbar-logo { display: inline-flex; align-items: center; gap: .4rem; font-size: 1.1rem; font-weight: 800; letter-spacing: -.02em; color: var(--gold); }
    .topbar-logo img { width: 24px; height: 24px; border-radius: 5px; }
    .page-wrap { max-width: 520px; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
    .rc-eyebrow { text-align: center; font-size: .72rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--gold); }
    .rc-month { text-align: center; font-size: 2.4rem; font-weight: 800; letter-spacing: -.02em; margin: .15rem 0 .1rem; }
    .rc-who { text-align: center; font-size: .9rem; color: var(--muted); margin-bottom: 1.5rem; }
    .rc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; margin-bottom: 1.25rem; }
    .rc-stat { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: .9rem .5rem; text-align: center; }
    .rc-stat-val { font-size: 1.7rem; font-weight: 800; color: var(--gold); line-height: 1.1; }
    .rc-stat-lbl { font-size: .68rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-top: .2rem; }
    .rc-sect { font-size: .72rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin: 1.25rem 0 .6rem; text-align: center; }
    .rc-podium { display: flex; justify-content: center; gap: 1rem; }
    .rc-item { flex: 1 1 0; min-width: 0; text-align: center; }
    .rc-thumb { width: 76px; height: 76px; border-radius: 50%; margin: 0 auto .4rem; overflow: hidden; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--muted); }
    .rc-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .rc-name { font-size: .8rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc-count { font-size: .72rem; color: var(--muted); }
    .rc-streak { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1rem; text-align: center; margin-top: 1.25rem; }
    .rc-streak-val { font-size: 2rem; font-weight: 800; color: var(--gold); line-height: 1; }
    .rc-streak-lbl { font-size: .85rem; color: var(--muted); margin-top: .2rem; }
    .state-wrap { text-align: center; padding: 3rem 1rem; }
    .state-icon { font-size: 2.5rem; margin-bottom: .5rem; }
    .state-title { font-size: 1.1rem; font-weight: 700; margin-bottom: .3rem; }
    .state-sub { font-size: .88rem; color: var(--muted); line-height: 1.5; }
    .cta-wrap { text-align: center; margin-top: 2rem; }
    .btn-cta { display: inline-block; background: var(--gold); color: #fff; border-radius: 8px; padding: .7rem 1.6rem; font-size: .95rem; font-weight: 700; }
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
