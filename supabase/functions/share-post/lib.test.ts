import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildPostOg,
  esc,
  formatPostDate,
  htmlPage,
  profileUrl,
  useCaseLabel,
  watchDisplayName,
} from "./lib.ts";

const FALLBACK = "https://api.wrotate.com/storage/v1/object/public/media/landing/collection.PNG";

Deno.test("esc — escapes &, <, >, \"", () => {
  assertEquals(esc(`a & b < c > "d"`), "a &amp; b &lt; c &gt; &quot;d&quot;");
});

Deno.test("useCaseLabel — known slug maps to label", () => {
  assertEquals(useCaseLabel("special"), "Special Occasion");
  assertEquals(useCaseLabel("dive"), "Dive");
});

Deno.test("useCaseLabel — 'unspecified' has empty mapped label so falls back to the slug", () => {
  // Map value is "" (falsy), so `labels[k] || k` returns the slug itself — matches original index.ts behavior.
  assertEquals(useCaseLabel("unspecified"), "unspecified");
});

Deno.test("useCaseLabel — unknown slug falls back to itself", () => {
  assertEquals(useCaseLabel("gardening"), "gardening");
});

Deno.test("useCaseLabel — null/empty yields empty string", () => {
  assertEquals(useCaseLabel(null), "");
  assertEquals(useCaseLabel(undefined), "");
  assertEquals(useCaseLabel(""), "");
});

Deno.test("watchDisplayName — joins brand and name trimmed", () => {
  assertEquals(watchDisplayName({ brand: "Rolex", name: "Submariner" }), "Rolex Submariner");
});

Deno.test("watchDisplayName — brand only / name only", () => {
  assertEquals(watchDisplayName({ brand: "Omega" }), "Omega");
  assertEquals(watchDisplayName({ name: "Speedmaster" }), "Speedmaster");
});

Deno.test("watchDisplayName — null watch yields empty string", () => {
  assertEquals(watchDisplayName(null), "");
  assertEquals(watchDisplayName(undefined), "");
});

Deno.test("formatPostDate — formats YYYY-MM-DD as en-US", () => {
  assertEquals(formatPostDate("2026-06-01"), "Jun 1, 2026");
});

Deno.test("formatPostDate — empty input yields empty string", () => {
  assertEquals(formatPostDate(""), "");
  assertEquals(formatPostDate(null), "");
  assertEquals(formatPostDate(undefined), "");
});

Deno.test("buildPostOg — with watch and caption", () => {
  const og = buildPostOg({
    displayName: "Alice", watchName: "Rolex Sub", caption: "Great day", photoUrl: "https://p/1.jpg", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogTitle, "Alice's Rolex Sub — WRotate");
  assertEquals(og.ogDescription, "Great day");
  assertEquals(og.ogImage, "https://p/1.jpg");
});

Deno.test("buildPostOg — no caption falls back to 'wore their' line", () => {
  const og = buildPostOg({
    displayName: "Alice", watchName: "Rolex Sub", caption: "", photoUrl: "", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogDescription, "Alice wore their Rolex Sub");
  assertEquals(og.ogImage, FALLBACK);
});

Deno.test("buildPostOg — no watch, no caption uses generic title and description", () => {
  const og = buildPostOg({
    displayName: "Alice", watchName: "", caption: "", photoUrl: "", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogTitle, "Alice's post — WRotate");
  assertEquals(og.ogDescription, "Check out this post on WRotate");
});

Deno.test("buildPostOg — caption truncated to 200 chars", () => {
  const long = "x".repeat(250);
  const og = buildPostOg({
    displayName: "Alice", watchName: "", caption: long, photoUrl: "", fallbackImage: FALLBACK,
  });
  assertEquals(og.ogDescription.length, 200);
});

Deno.test("avatarInnerHtml — escaped img when url present", () => {
  assertEquals(avatarInnerHtml("https://x/a.png?a=1&b=2", "Alice"), `<img src="https://x/a.png?a=1&amp;b=2" alt="">`);
});

Deno.test("avatarInnerHtml — initials when no url", () => {
  assertEquals(avatarInnerHtml(null, "Alice Smith"), "AS");
});

Deno.test("avatarInnerHtml — empty name falls back to '?'", () => {
  assertEquals(avatarInnerHtml(null, ""), "?");
});

Deno.test("profileUrl — encodes username", () => {
  assertEquals(profileUrl("a b"), "https://wrotate.com/profile/?u=a%20b");
});

Deno.test("profileUrl — null username goes to home", () => {
  assertEquals(profileUrl(null), "https://wrotate.com/");
  assertEquals(profileUrl(undefined), "https://wrotate.com/");
});

Deno.test("htmlPage — embeds escaped OG meta and body, article type", () => {
  const html = htmlPage("A & B", "desc", "https://img/x", "https://wrotate.com/", "<p>hi</p>");
  assertStringIncludes(html, `<meta property="og:title" content="A &amp; B">`);
  assertStringIncludes(html, `<meta property="og:type" content="article">`);
  assertStringIncludes(html, `<meta property="og:image" content="https://img/x">`);
  assertStringIncludes(html, "<p>hi</p>");
});

// ── Languages ────────────────────────────────────────────────────────────────
// The golden files are the page exactly as it was served before it learned any
// other language (captured from the pre-change function, 2026-11-14). English,
// and every request with no usable language, must still produce them byte for
// byte.
const golden = (name: string) => Deno.readTextFileSync(new URL(`./golden/${name}.html`, import.meta.url));
const API = "https://api.wrotate.com";
const PROFILE = { id: "u1", username: "alice", display_name: "Alice <B> & Co", bio: 'Collector of "things"', avatar_url: null, is_official: true };
import { postStatePage, renderPostPage } from "./lib.ts";
import { LANGS } from "../_shared/lang.ts";

const POST = {
  logId: "abc", supabaseUrl: API,
  log: { notes: "Desk <diving> & more", photo_url: "https://x/p.jpg", use_case: "special", date: "2026-06-01" },
  profile: PROFILE,
  watch: { brand: "Rolex", name: "Submariner", image: "https://x/sub.jpg" },
};
const POST_MINIMAL = { logId: "abc", supabaseUrl: API, log: { notes: null, photo_url: null, use_case: "gardening", date: "" }, profile: null, watch: null };

Deno.test("share-post — English pages are byte-identical to the pre-translation pages", () => {
  assertEquals(renderPostPage(POST), golden("post"));
  assertEquals(renderPostPage(POST, "en"), golden("post"));
  assertEquals(renderPostPage(POST_MINIMAL), golden("post-minimal"));
  assertEquals(postStatePage("missing"), golden("missing"));
  assertEquals(postStatePage("notFound"), golden("not-found"));
});

Deno.test("share-post — German page: German chrome, lang=de, the member's words untouched", () => {
  const html = renderPostPage(POST, "de");
  assertStringIncludes(html, '<html lang="de">');
  assertStringIncludes(html, "<title>Rolex Submariner von Alice &lt;B&gt; &amp; Co — WRotate</title>");
  assertStringIncludes(html, '<div class="post-meta">1. Juni 2026 · Besonderer Anlass</div>');
  assertStringIncludes(html, 'alt="Laden im App Store"');
  assertStringIncludes(html, '<div class="post-caption">Desk &lt;diving&gt; &amp; more</div>', "the caption is the member's");
  assertStringIncludes(html, "Rolex Submariner</div>");
  assertEquals(html.includes("Special Occasion"), false);
  assertEquals(html.includes("Download on the App Store"), false);
  // Only the text differs: same number of lines as the English page.
  assertEquals(html.split("\n").length, golden("post").split("\n").length);
});

Deno.test("share-post — state pages in German; a post with no author says Jemand", () => {
  const nf = postStatePage("notFound", "de");
  assertStringIncludes(nf, '<html lang="de">');
  assertStringIncludes(nf, "<title>Beitrag nicht gefunden — WRotate</title>");
  assertStringIncludes(nf, '<div class="state-title">Beitrag nicht gefunden</div>');
  assertStringIncludes(nf, ">WRotate öffnen</a>");
  assertStringIncludes(postStatePage("missing", "de"), "Kein Beitrag angegeben");
  const min = renderPostPage(POST_MINIMAL, "de");
  assertStringIncludes(min, "<title>Beitrag von Jemand — WRotate</title>");
  assertStringIncludes(min, 'content="Schau dir diesen Beitrag auf WRotate an"');
  assertStringIncludes(min, '<div class="post-meta">gardening</div>', "an unknown use case is shown as it is");
});

Deno.test("share-post — every language renders with its own lang attribute and no leftover hole", () => {
  for (const lang of LANGS) {
    for (const html of [renderPostPage(POST, lang), renderPostPage(POST_MINIMAL, lang), postStatePage("missing", lang), postStatePage("notFound", lang)]) {
      assertStringIncludes(html, `<html lang="${lang}">`);
      assertEquals(/\{[a-z]\}|undefined/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), false, lang);
    }
  }
});

Deno.test("formatPostDate / useCaseLabel / buildPostOg — follow the language", () => {
  assertEquals(formatPostDate("2026-06-01", "fr"), "1 juin 2026");
  assertEquals(formatPostDate("2026-06-01", "en"), "Jun 1, 2026");
  assertEquals(useCaseLabel("dive", "es"), "Buceo");
  assertEquals(useCaseLabel("unspecified", "es"), "unspecified");
  assertEquals(useCaseLabel("constructor", "es"), "constructor");
  const og = buildPostOg({ displayName: "Ana", watchName: "Tudor BB58", caption: "", photoUrl: "", fallbackImage: FALLBACK }, "es");
  assertEquals(og.ogTitle, "Tudor BB58 de Ana — WRotate");
  assertEquals(og.ogDescription, "Ana usó su Tudor BB58");
});
