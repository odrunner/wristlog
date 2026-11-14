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
//
// The page is written in the reader's language (pageLang in _shared/lang.ts);
// every `lang` below defaults to English, which is the text the page always
// had. The og:image SVG stays English: only preview fetchers request it.
import { PAGE_TOKENS_CSS } from "../_shared/page-tokens.ts";
import { count, fill, isCrawlerUA, LOCALES, num, SHELL_STRINGS } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { SHARE_STRINGS } from "../_shared/share-strings.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function initials(brand: string, name: string): string {
  const raw = (brand + " " + name).trim();
  return raw.split(/\s+/).map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase() || "?";
}

// Link-preview crawlers fetch the page and og:image the moment a link is
// pasted, before anyone taps it. They are counted separately so "views" means
// people, not iMessage. The test itself lives in _shared/lang.ts, which also
// uses it to keep previews English.
export { isCrawlerUA };

// "2026-07" and nothing else. The month comes from a URL anyone can edit, and
// it is interpolated into SQL filters and page copy.
export function isValidPeriod(m: string | null | undefined): boolean {
  if (!m || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return false;
  const y = Number(m.slice(0, 4));
  return y >= 2020 && y <= 2100;
}

// "July 2026" / "July". In another language the month is written by that
// locale ("julio de 2026", "Juli 2026"); alone it is a heading, so it gets a
// capital where the locale writes months in lower case.
export function monthLabel(period: string, withYear = true, lang: Lang = "en"): string {
  const NAMES = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];
  const mi = Number(period.slice(5, 7)) - 1;
  if (lang === "en" || !NAMES[mi]) {
    const name = NAMES[mi] || "";
    return withYear ? `${name} ${period.slice(0, 4)}` : name;
  }
  const d = new Date(Date.UTC(Number(period.slice(0, 4)), mi, 15));
  const loc = LOCALES[lang];
  if (withYear) return new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const name = new Intl.DateTimeFormat(loc, { month: "long", timeZone: "UTC" }).format(d);
  return name.charAt(0).toLocaleUpperCase(loc) + name.slice(1);
}

// Same gate as share-collection: a private profile, or one whose collection is
// hidden, has no public face at all.
export function isRecapViewable(
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
  lang: Lang = "en",
): { ogTitle: string; ogDescription: string } {
  const S = SHARE_STRINGS[lang];
  const ogTitle = fill(S.recap.title, { n: displayName, m: monthLabel(recap.period, true, lang) });
  const bits = [
    count(lang, recap.totalWears, S.wears),
    count(lang, recap.uniqueCount, S.watches),
    count(lang, recap.wearDays, S.recap.daysLogged),
  ];
  if (watchName) bits.push(fill(S.mostWornIs, { w: watchName }));
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
  const bg = "#e9edf1", surface = "#ffffff", ph = "#e8e9f2";
  const gold = "#87661a", text = "#141a24", muted = "#566070", border = "#d3d9e1";
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

export function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string, lang: Lang = "en"): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
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
    ${PAGE_TOKENS_CSS}
    body { background: var(--bg); color: var(--text); font-family: var(--font-sans); min-height: 100vh; font-size: var(--fs-body); }
    a { color: var(--gold); text-decoration: none; }
    .topbar { position: sticky; top: 0; z-index: var(--z-header); display: flex; align-items: center; justify-content: center; padding: var(--space-3) var(--space-5); background: var(--surface); border-bottom: var(--space-px) solid var(--border); }
    .topbar-logo { display: inline-flex; align-items: center; gap: var(--space-1-5); font-size: var(--fs-xl); font-weight: var(--fw-heavy); letter-spacing: var(--ls-display); color: var(--gold); }
    .topbar-logo img { width: var(--size-6); height: var(--size-6); border-radius: var(--radius-sm); }
    .page-wrap { max-width: var(--size-130); margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-16); }
    .rc-eyebrow { text-align: center; font-size: var(--fs-sm); font-weight: var(--fw-bold); letter-spacing: var(--ls-wide); text-transform: uppercase; color: var(--gold); }
    .rc-month { text-align: center; font-size: var(--fs-4xl); font-weight: var(--fw-heavy); letter-spacing: var(--ls-display); margin: var(--space-0-5) 0 var(--space-0-5); }
    .rc-who { text-align: center; font-size: var(--fs-md); color: var(--muted); margin-bottom: var(--space-6); }
    .rc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2-5); margin-bottom: var(--space-5); }
    .rc-stat { background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); padding: var(--space-3-5) var(--space-2); text-align: center; }
    .rc-stat-val { font-size: var(--fs-3xl); font-weight: var(--fw-heavy); color: var(--gold); line-height: var(--lh-none); }
    .rc-stat-lbl { font-size: var(--fs-xs); font-weight: var(--fw-semibold); letter-spacing: var(--ls-eyebrow); text-transform: uppercase; color: var(--muted); margin-top: var(--space-1); }
    .rc-sect { font-size: var(--fs-sm); font-weight: var(--fw-bold); letter-spacing: var(--ls-wide); text-transform: uppercase; color: var(--muted); margin: var(--space-5) 0 var(--space-2-5); text-align: center; }
    .rc-podium { display: flex; justify-content: center; gap: var(--space-4); }
    .rc-item { flex: 1 1 0; min-width: 0; text-align: center; }
    .rc-thumb { width: var(--size-18); height: var(--size-18); border-radius: var(--radius-round); margin: 0 auto var(--space-1-5); overflow: hidden; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-weight: var(--fw-bold); color: var(--muted); }
    .rc-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .rc-name { font-size: var(--fs-base); font-weight: var(--fw-bold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc-count { font-size: var(--fs-sm); color: var(--muted); }
    .rc-streak { background: var(--surface); border: var(--space-px) solid var(--border); border-radius: var(--radius); padding: var(--space-4); text-align: center; margin-top: var(--space-5); }
    .rc-streak-val { font-size: var(--fs-display); font-weight: var(--fw-heavy); color: var(--gold); line-height: var(--lh-none); }
    .rc-streak-lbl { font-size: var(--fs-md); color: var(--muted); margin-top: var(--space-1); }
    .state-wrap { text-align: center; padding: var(--space-12) var(--space-4); }
    .state-icon { font-size: var(--fs-4xl); margin-bottom: var(--space-2); }
    .state-title { font-size: var(--fs-xl); font-weight: var(--fw-bold); margin-bottom: var(--space-1); }
    .state-sub { font-size: var(--fs-md); color: var(--muted); line-height: var(--lh-body); }
    .cta-wrap { text-align: center; margin-top: var(--space-8); }
    .btn-cta { display: inline-block; background: var(--gold); color: var(--white); border-radius: var(--radius-btn); padding: var(--space-3) var(--space-6); font-size: var(--fs-body); font-weight: var(--fw-bold); }
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

function recapStateHtml(supabaseUrl: string, title: string, icon: string, heading: string, sub: string, lang: Lang): string {
  return htmlPage(
    title,
    sub,
    `${supabaseUrl}/functions/v1/share-recap?img=1`,
    "https://wrotate.com/open",
    `<div class="state-wrap">
      <div class="state-icon">${icon}</div>
      <div class="state-title">${esc(heading)}</div>
      <div class="state-sub">${esc(sub)}</div>
      <div class="cta-wrap"><a href="https://wrotate.com/open" class="btn-cta">${SHELL_STRINGS[lang].open}</a></div>
    </div>`,
    lang,
  );
}

// The pages with no recap on them: a link missing its collector or month
// (400), and a profile that is private or gone (404).
export function recapStatePage(kind: "bad" | "private", supabaseUrl: string, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  return kind === "bad"
    ? recapStateHtml(supabaseUrl, "WRotate", "⌚", S.recap.bad, S.recap.badSub, lang)
    : recapStateHtml(supabaseUrl, S.recap.privateTitle, "🔒", S.recap.private, S.collPrivate, lang);
}

export type RecapPageData = {
  supabaseUrl: string;
  token: string | null;
  username: string | null;
  profile: { username?: string | null; display_name?: string | null };
  recap: Recap;
  // deno-lint-ignore no-explicit-any
  watchById: Record<string, any>;
};

// The whole page for a month that can be shown (including the "no wears that
// month" page, which is a 200). Names are the member's own and go out as written.
export function renderRecapPage(d: RecapPageData, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  const { profile, recap, watchById, supabaseUrl, token, username } = d;
  const displayName = profile.display_name || profile.username || S.someone;

  if (!recap.totalWears) {
    const m = monthLabel(recap.period, true, lang);
    return recapStateHtml(supabaseUrl, fill(S.recap.title, { n: displayName, m }), "⌚",
      S.recap.noWears, fill(S.recap.noWearsSub, { n: displayName, m }), lang);
  }

  const topWatch = recap.top[0] ? watchById[recap.top[0].id] : null;
  const topName = topWatch ? `${topWatch.brand || ""} ${topWatch.name || ""}`.trim() : null;
  const { ogTitle, ogDescription } = buildRecapOg(displayName, recap, topName, lang);

  // The og:image URL has to be fetchable by a crawler with no session, so it
  // repeats whichever credential the page itself was opened with — the token
  // for a shared link, the username for a public one.
  const q = token
    ? `t=${encodeURIComponent(token)}`
    : `u=${encodeURIComponent(username as string)}&m=${encodeURIComponent(recap.period)}`;
  const ogImage = `${supabaseUrl}/functions/v1/share-recap?img=1&${q}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-recap?${q}`;

  const podium = recap.top.map((t) => {
    const w = watchById[t.id] || {};
    const art = w.image
      ? `<img src="${esc(w.image)}" alt="" loading="lazy">`
      : esc(initials(w.brand || "", w.name || ""));
    return `<div class="rc-item">
      <div class="rc-thumb">${art}</div>
      <div class="rc-name">${esc(w.name || "—")}</div>
      <div class="rc-count">${count(lang, t.count, S.wears)}</div>
    </div>`;
  }).join("");

  const streakHtml = recap.streak
    ? `<div class="rc-streak">
         <div class="rc-streak-val">${num(lang, recap.streak.days)}</div>
         <div class="rc-streak-lbl">${S.recap.streak}</div>
       </div>`
    : "";

  const bodyHtml = `
    <div class="rc-eyebrow">${S.recap.eyebrow}</div>
    <div class="rc-month">${esc(monthLabel(recap.period, false, lang))}</div>
    <div class="rc-who">${esc(displayName)} · ${esc(recap.period.slice(0, 4))}</div>
    <div class="rc-stats">
      <div class="rc-stat"><div class="rc-stat-val">${num(lang, recap.totalWears)}</div><div class="rc-stat-lbl">${S.recap.statWears}</div></div>
      <div class="rc-stat"><div class="rc-stat-val">${num(lang, recap.uniqueCount)}</div><div class="rc-stat-lbl">${S.recap.statWatches}</div></div>
      <div class="rc-stat"><div class="rc-stat-val">${num(lang, recap.wearDays)}</div><div class="rc-stat-lbl">${S.recap.statDays}</div></div>
    </div>
    ${podium ? `<div class="rc-sect">${S.recap.mostWorn}</div><div class="rc-podium">${podium}</div>` : ""}
    ${streakHtml}
    <div class="cta-wrap"><a href="https://wrotate.com/open" class="btn-cta">${S.recap.cta}</a></div>`;

  return htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml, lang);
}
