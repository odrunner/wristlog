// share-post — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them.
//
// The page is written in the reader's language (pageLang in _shared/lang.ts);
// every `lang` below defaults to English, which is the text the page always had.
import { fill, LOCALES, SHELL_STRINGS } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { SHARE_STRINGS } from "../_shared/share-strings.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string, _logId?: string, lang: Lang = "en"): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
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
    .post-card { background: var(--surface); border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); cursor: pointer; transition: box-shadow .15s; display: block; text-decoration: none; color: var(--text); }
    .post-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); }
    .post-photo { width: 100%; display: block; }
    .post-body { padding: 1rem 1.15rem; }
    .post-header { display: flex; align-items: center; gap: .6rem; margin-bottom: .75rem; }
    .post-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 700; color: var(--muted); overflow: hidden; flex-shrink: 0; }
    .post-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .post-name { font-weight: 700; font-size: .92rem; }
    .post-meta { font-size: .75rem; color: var(--muted); }
    .post-caption { font-size: .92rem; line-height: 1.5; margin-bottom: .75rem; }
    .post-watch { display: inline-flex; align-items: center; gap: .4rem; background: var(--surface2); border-radius: 20px; padding: .3rem .75rem .3rem .4rem; font-size: .78rem; font-weight: 600; color: var(--text); }
    .post-watch img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
    .cta-wrap { text-align: center; margin-top: 1.5rem; }
    .btn-cta { display: inline-block; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .6rem 1.5rem; font-size: .92rem; font-weight: 600; text-decoration: none; font-family: inherit; }
    .state-wrap { text-align: center; padding: 3rem 1rem; }
    .state-icon { font-size: 2.5rem; margin-bottom: .5rem; }
    .state-title { font-size: 1.1rem; font-weight: 700; margin-bottom: .3rem; }
    .state-sub { font-size: .88rem; color: var(--muted); line-height: 1.5; }
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

// Use case slug → human label. Empty string means "no label". A slug we have
// no label for is shown as it is, in every language.
export const USE_CASE_LABELS: Record<string, string> = SHARE_STRINGS.en.post.useCases;

export function useCaseLabel(useCase: string | null | undefined, lang: Lang = "en"): string {
  const labels = SHARE_STRINGS[lang].post.useCases;
  const own = useCase && Object.prototype.hasOwnProperty.call(labels, useCase) ? labels[useCase] : "";
  return useCase ? (own || useCase) : "";
}

// "Brand Name" trimmed; empty string when no watch.
export function watchDisplayName(watch: { brand?: string | null; name?: string | null } | null | undefined): string {
  return watch ? `${watch.brand || ""} ${watch.name || ""}`.trim() : "";
}

// Format a YYYY-MM-DD date string to "Mon D, YYYY" (en-US; the reader's own
// locale otherwise), falling back to raw on error.
export function formatPostDate(dateStr: string | null | undefined, lang: Lang = "en"): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString(LOCALES[lang], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// Build OG title/description/image for a post.
export function buildPostOg(opts: {
  displayName: string;
  watchName: string;
  caption: string;
  photoUrl: string;
  fallbackImage: string;
}, lang: Lang = "en"): { ogTitle: string; ogDescription: string; ogImage: string } {
  const { displayName, watchName, caption, photoUrl, fallbackImage } = opts;
  const S = SHARE_STRINGS[lang].post;
  const ogTitle = watchName
    ? fill(S.titleWatch, { n: displayName, w: watchName })
    : fill(S.titlePost, { n: displayName });
  const ogDescription = caption
    ? caption.slice(0, 200)
    : watchName
      ? fill(S.wore, { n: displayName, w: watchName })
      : S.checkOut;
  const ogImage = photoUrl || fallbackImage;
  return { ogTitle, ogDescription, ogImage };
}

// Avatar inner HTML: <img> if avatar_url present, else escaped initials of the display name.
export function avatarInnerHtml(avatarUrl: string | null | undefined, displayName: string): string {
  return avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="">`
    : esc((displayName || "?").trim().split(/\s+/).map((w: string) => w[0] || "").join("").slice(0, 2).toUpperCase());
}

// Profile link: /profile/?u=<username> when username present, else WRotate home.
// Trailing slash avoids the 301 that /profile?u=x would take.
export function profileUrl(username: string | null | undefined): string {
  return username ? `https://wrotate.com/profile/?u=${encodeURIComponent(username)}` : "https://wrotate.com/";
}

export const POST_FALLBACK_IMAGE = "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG";

// The two pages with no post on them: a link with no id (400) and a post that
// is private, moderated or gone (404).
export function postStatePage(kind: "missing" | "notFound", lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  const open = SHELL_STRINGS[lang].open;
  if (kind === "missing") {
    return htmlPage(
      "WRotate",
      S.tagline,
      POST_FALLBACK_IMAGE,
      "https://wrotate.com/",
      `<div class="state-wrap">
        <div class="state-icon">⌚</div>
        <div class="state-title">${S.post.none}</div>
        <div class="state-sub">${S.visit}</div>
        <div class="cta-wrap"><a href="https://wrotate.com/" class="btn-cta">${open}</a></div>
      </div>`,
      undefined,
      lang,
    );
  }
  return htmlPage(
    `${S.post.notFound} — WRotate`,
    S.post.notFoundDesc,
    POST_FALLBACK_IMAGE,
    "https://wrotate.com/",
    `<div class="state-wrap">
        <div class="state-icon">🔒</div>
        <div class="state-title">${S.post.notFound}</div>
        <div class="state-sub">${S.post.notFoundSub}</div>
        <div class="cta-wrap"><a href="https://wrotate.com/" class="btn-cta">${open}</a></div>
      </div>`,
    undefined,
    lang,
  );
}

export type PostPageData = {
  logId: string;
  supabaseUrl: string;
  log: { notes?: string | null; photo_url?: string | null; use_case?: string | null; date?: string | null };
  profile: { username?: string | null; display_name?: string | null; avatar_url?: string | null; is_official?: boolean | null } | null | undefined;
  watch: { brand?: string | null; name?: string | null; image?: string | null } | null | undefined;
};

// The whole page for a public post. The name, caption and watch name are the
// member's own words and go out as written; everything around them is ours.
export function renderPostPage(d: PostPageData, lang: Lang = "en"): string {
  const S = SHARE_STRINGS[lang];
  const { log, profile, watch, logId } = d;
  const displayName = profile?.display_name || profile?.username || S.someone;
  const watchName = watchDisplayName(watch);
  const caption = log.notes || "";
  const photoUrl = log.photo_url || watch?.image || "";
  const dateStr = log.date || "";

  const { ogTitle, ogDescription, ogImage } = buildPostOg({
    displayName,
    watchName,
    caption,
    photoUrl,
    fallbackImage: POST_FALLBACK_IMAGE,
  }, lang);
  const canonicalUrl = `${d.supabaseUrl}/functions/v1/share-post?id=${logId}`;

  const avatarInner = avatarInnerHtml(profile?.avatar_url, displayName);
  const useCaseLabelStr = useCaseLabel(log.use_case, lang);
  const dateLabel = formatPostDate(dateStr, lang);
  const metaParts = [dateLabel, useCaseLabelStr].filter(Boolean).join(" · ");

  const photoHtml = photoUrl
    ? `<img class="post-photo" src="${esc(photoUrl)}" alt="${esc(watchName || S.post.photoAlt)}">`
    : "";

  const captionHtml = caption
    ? `<div class="post-caption">${esc(caption)}</div>`
    : "";

  const watchChipHtml = watchName
    ? `<div class="post-watch">${watch?.image ? `<img src="${esc(watch.image)}" alt="">` : "⌚"} ${esc(watchName)}</div>`
    : "";

  const officialBadge = profile?.is_official
    ? ' <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--gold)" style="vertical-align:middle;"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 12c0 4.418 2.865 8.166 6.839 9.489.308.105.633.105.941.005L12 21.056l1.22.438a1.1 1.1 0 0 0 .941-.005C18.135 20.166 21 16.418 21 12c0-.69-.058-1.365-.17-2.022Z"/></svg>'
    : "";

  const bodyHtml = `
    <a href="https://wrotate.com/" class="post-card">
      ${photoHtml}
      <div class="post-body">
        <div class="post-header">
          <div class="post-avatar">${avatarInner}</div>
          <div>
            <div class="post-name">${esc(displayName)}${officialBadge}</div>
            ${metaParts ? `<div class="post-meta">${esc(metaParts)}</div>` : ""}
          </div>
        </div>
        ${captionHtml}
        ${watchChipHtml}
      </div>
    </a>
    <div class="cta-wrap">
      <a href="https://apps.apple.com/us/app/wrotate/id6760091102">
        <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="${S.post.appStoreAlt}" width="130">
      </a>
    </div>`;

  return htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, bodyHtml, logId, lang);
}
