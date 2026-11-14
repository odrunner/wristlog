import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildCollectionOg,
  computeWearCounts,
  esc,
  generateOgSvg,
  htmlPage,
  initials,
  isCollectionViewable,
  sortByWears,
} from "./lib.ts";

Deno.test("esc — escapes &, <, >, \"", () => {
  assertEquals(esc(`a & b < c > d "e"`), "a &amp; b &lt; c &gt; d &quot;e&quot;");
});

Deno.test("esc — leaves plain text unchanged", () => {
  assertEquals(esc("Rolex Submariner"), "Rolex Submariner");
});

Deno.test("initials — first letters of brand + name, upper, max 2", () => {
  assertEquals(initials("Rolex", "Submariner"), "RS");
});

Deno.test("initials — single word still works", () => {
  assertEquals(initials("Omega", ""), "O");
});

Deno.test("initials — empty inputs fall back to '?'", () => {
  assertEquals(initials("", ""), "?");
});

Deno.test("initials — collapses extra whitespace", () => {
  assertEquals(initials("  Grand   Seiko  ", ""), "GS");
});

Deno.test("isCollectionViewable — public profile + public collection is viewable", () => {
  assertEquals(isCollectionViewable({ profile_privacy: "public", collection_visibility: "public" }, null), true);
  assertEquals(isCollectionViewable({ collection_visibility: "public" }, null), true, "absent profile_privacy = public");
});

Deno.test("isCollectionViewable — missing/unknown collection visibility means followers (not public)", () => {
  assertEquals(isCollectionViewable({}, null), false);
  assertEquals(isCollectionViewable({ collection_visibility: "friends_only" }, null), false);
});

Deno.test("isCollectionViewable — null/missing profile or error is not viewable", () => {
  assertEquals(isCollectionViewable(null, null), false);
  assertEquals(isCollectionViewable(undefined, null), false);
  assertEquals(isCollectionViewable({}, new Error("boom")), false);
});

Deno.test("isCollectionViewable — non-public profile or private collection is not viewable", () => {
  assertEquals(isCollectionViewable({ profile_privacy: "private" }, null), false);
  assertEquals(isCollectionViewable({ collection_visibility: "private" }, null), false);
});

Deno.test("isCollectionViewable — followers / close-friends collections are not public (SEC-23-16)", () => {
  assertEquals(isCollectionViewable({ collection_visibility: "followers" }, null), false);
  assertEquals(isCollectionViewable({ collection_visibility: "friends" }, null), false);
});

Deno.test("computeWearCounts — counts unique (watch, date) pairs", () => {
  const logs = [
    { watch_id: "a", date: "2026-06-01" },
    { watch_id: "a", date: "2026-06-01" }, // duplicate, ignored
    { watch_id: "a", date: "2026-06-02" },
    { watch_id: "b", date: "2026-06-01" },
  ];
  assertEquals(computeWearCounts(logs), { a: 2, b: 1 });
});

Deno.test("computeWearCounts — null/empty input yields empty object", () => {
  assertEquals(computeWearCounts(null), {});
  assertEquals(computeWearCounts([]), {});
});

Deno.test("computeWearCounts — allowedIds drops logs of private/deleted watches", () => {
  // The logs query now fetches by user_id alone (so it can run in parallel with
  // the watches query); a private watch's logs must not leak into the counts —
  // they would inflate the OG description's total wears.
  const logs = [
    { watch_id: "pub", date: "2026-06-01" },
    { watch_id: "pub", date: "2026-06-01" }, // duplicate, still ignored
    { watch_id: "priv", date: "2026-06-01" },
    { watch_id: "deleted", date: "2026-06-02" },
  ];
  assertEquals(computeWearCounts(logs, new Set(["pub"])), { pub: 1 });
});

Deno.test("computeWearCounts — an empty allowedIds set counts nothing", () => {
  const logs = [{ watch_id: "a", date: "2026-06-01" }];
  assertEquals(computeWearCounts(logs, new Set()), {});
});

Deno.test("computeWearCounts — omitting allowedIds keeps the old count-everything behaviour", () => {
  const logs = [
    { watch_id: "a", date: "2026-06-01" },
    { watch_id: "b", date: "2026-06-01" },
  ];
  assertEquals(computeWearCounts(logs), { a: 1, b: 1 });
});

Deno.test("sortByWears — orders by descending wear count", () => {
  const watches = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = sortByWears(watches, { a: 1, b: 5, c: 3 });
  assertEquals(out.map((w) => w.id), ["b", "c", "a"]);
});

Deno.test("sortByWears — does not mutate input array", () => {
  const watches = [{ id: "a" }, { id: "b" }];
  const copy = [...watches];
  sortByWears(watches, { a: 1, b: 2 });
  assertEquals(watches, copy);
});

Deno.test("buildCollectionOg — includes most-worn watch when wears > 0", () => {
  const watches = [{ id: "a", brand: "Rolex", name: "Sub" }, { id: "b", brand: "Omega", name: "Speedy" }];
  const sorted = [{ id: "a", brand: "Rolex", name: "Sub" }, { id: "b", brand: "Omega", name: "Speedy" }];
  const out = buildCollectionOg("Alice", watches, sorted, { a: 3, b: 1 });
  assertEquals(out.ogTitle, "Alice's Watch Collection — WRotate");
  assertEquals(out.ogDescription, "2 watches · 4 total wears · Most worn: Rolex Sub");
});

Deno.test("buildCollectionOg — omits most-worn when top watch has 0 wears", () => {
  const watches = [{ id: "a", brand: "Rolex", name: "Sub" }];
  const out = buildCollectionOg("Bob", watches, watches, {});
  assertEquals(out.ogDescription, "1 watch · 0 total wears");
});

Deno.test("buildCollectionOg — singular vs plural agreement", () => {
  const watches = [{ id: "a", brand: "Rolex", name: "Sub" }];
  const out = buildCollectionOg("Bob", watches, watches, { a: 1 });
  assertEquals(out.ogDescription, "1 watch · 1 total wear · Most worn: Rolex Sub");
});

Deno.test("avatarInnerHtml — renders escaped img when url present", () => {
  assertEquals(
    avatarInnerHtml('https://x/a.png?a=1&b=2', "Alice"),
    `<img src="https://x/a.png?a=1&amp;b=2" alt="">`,
  );
});

Deno.test("avatarInnerHtml — renders initials when no url", () => {
  assertEquals(avatarInnerHtml(null, "Alice Smith"), "AS");
  assertEquals(avatarInnerHtml(undefined, "Cher"), "C");
});

Deno.test("generateOgSvg — empty collection shows fallback text", () => {
  const svg = generateOgSvg("Alice", [], {});
  assertStringIncludes(svg, "No public watches yet");
  assertStringIncludes(svg, `width="1200" height="630"`);
  assertStringIncludes(svg, "Alice's Collection"); // name label appends "'s Collection"
});

Deno.test("generateOgSvg — renders a tile per watch (capped at 6)", () => {
  const watches = Array.from({ length: 8 }, (_, i) => ({ id: String(i), brand: "B", name: "N" + i }));
  const svg = generateOgSvg("Alice", watches, {});
  // 6 clip paths for 6 displayed tiles
  const clipCount = (svg.match(/clipPath/g) || []).length / 2; // open+close tags
  assertEquals(clipCount, 6);
});

Deno.test("generateOgSvg — escapes a malicious watch name", () => {
  const watches = [{ id: "1", brand: "B", name: `<script>x</script>` }];
  const svg = generateOgSvg("Alice", watches, {});
  assertStringIncludes(svg, "&lt;script&gt;");
});

Deno.test("htmlPage — embeds escaped OG meta and body", () => {
  const html = htmlPage(`A & B`, "desc", "https://img/x", "https://wrotate.com/", "<p>hi</p>");
  assertStringIncludes(html, `<meta property="og:title" content="A &amp; B">`);
  assertStringIncludes(html, `<meta property="og:image" content="https://img/x">`);
  assertStringIncludes(html, "<p>hi</p>");
  assertStringIncludes(html, `<meta property="og:type" content="profile">`);
});

// ── Languages ────────────────────────────────────────────────────────────────
// The golden files are the page exactly as it was served before it learned any
// other language (captured from the pre-change function, 2026-11-14). English,
// and every request with no usable language, must still produce them byte for
// byte.
const golden = (name: string) => Deno.readTextFileSync(new URL(`./golden/${name}.html`, import.meta.url));
const API = "https://api.wrotate.com";
const PROFILE = { id: "u1", username: "alice", display_name: "Alice <B> & Co", bio: 'Collector of "things"', avatar_url: null, is_official: true };
const WATCHES = [
  { id: "w1", brand: "Rolex", name: "Submariner", ref: "124060", image: "https://x/sub.jpg", url: "https://www.chrono24.com/rolex/x" },
  { id: "w2", brand: "Omega", name: "Speedmaster", ref: null, image: null, url: null },
  { id: "w3", brand: "", name: "", ref: "", image: null, url: "javascript:alert(1)" },
];
import { collectionStatePage, renderCollectionPage } from "./lib.ts";
import { LANGS } from "../_shared/lang.ts";

// deno-lint-ignore no-explicit-any
const CW = WATCHES as any[];
const WEARS = computeWearCounts(
  [{ watch_id: "w1", date: "2026-01-01" }, { watch_id: "w1", date: "2026-01-02" }, { watch_id: "w2", date: "2026-01-02" }],
  new Set(["w1", "w2", "w3"]),
);
const COLLECTION = { supabaseUrl: API, username: "alice", profile: PROFILE, watches: CW, sorted: sortByWears(CW, WEARS), wearCounts: WEARS };
const COLLECTION_EMPTY = { supabaseUrl: API, username: "alice", profile: PROFILE, watches: [], sorted: [], wearCounts: {} };

Deno.test("share-collection — English pages are byte-identical to the pre-translation pages", () => {
  assertEquals(renderCollectionPage(COLLECTION), golden("collection"));
  assertEquals(renderCollectionPage(COLLECTION, "en"), golden("collection"));
  assertEquals(renderCollectionPage(COLLECTION_EMPTY), golden("collection-empty"));
  assertEquals(collectionStatePage("missing", API, null), golden("missing"));
  assertEquals(collectionStatePage("notFound", API, "bob"), golden("not-found"));
});

Deno.test("share-collection — German page: German chrome, lang=de, the member's words untouched", () => {
  const html = renderCollectionPage(COLLECTION, "de");
  assertStringIncludes(html, '<html lang="de">');
  assertStringIncludes(html, "<title>Uhrensammlung von Alice &lt;B&gt; &amp; Co — WRotate</title>");
  assertStringIncludes(html, 'content="3 Uhren · insgesamt 3× getragen · Meistgetragen: Rolex Submariner"');
  assertStringIncludes(html, '<div class="watch-card-wears">2× getragen</div>');
  assertStringIncludes(html, '<div class="col-bio">Collector of &quot;things&quot;</div>', "the bio is the member's");
  assertEquals(/\d wears?</.test(html), false);
  assertEquals(html.split("\n").length, golden("collection").split("\n").length);
  assertStringIncludes(renderCollectionPage(COLLECTION_EMPTY, "de"), "Noch keine öffentlichen Uhren");
  const nf = collectionStatePage("notFound", API, "bob", "de");
  assertStringIncludes(nf, "<title>Private Sammlung — WRotate</title>");
  assertStringIncludes(nf, '<div class="state-title">Sammlung nicht gefunden</div>');
  assertStringIncludes(collectionStatePage("missing", API, null, "de"), "Kein Nutzer angegeben");
});

Deno.test("share-collection — every language renders with its own lang attribute and no leftover hole", () => {
  for (const lang of LANGS) {
    for (const html of [renderCollectionPage(COLLECTION, lang), renderCollectionPage(COLLECTION_EMPTY, lang), collectionStatePage("missing", API, null, lang), collectionStatePage("notFound", API, "bob", lang)]) {
      assertStringIncludes(html, `<html lang="${lang}">`);
      assertEquals(/\{[a-z]\}|undefined/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), false, lang);
    }
  }
});

Deno.test("buildCollectionOg — plurals per language; the og:image SVG stays English", () => {
  const one = [{ id: "a", brand: "Tudor", name: "BB58" }];
  assertEquals(buildCollectionOg("Ana", one, one, { a: 1 }, "fr").ogDescription, "1 montre · 1 port au total · La plus portée : Tudor BB58");
  assertEquals(buildCollectionOg("Ana", [], [], {}, "fr").ogDescription, "0 montre · 0 port au total");
  assertEquals(buildCollectionOg("Ana", [], [], {}, "es").ogDescription, "0 relojes · 0 usos en total");
  assertEquals(buildCollectionOg("Ana", one, one, { a: 2 }, "tr").ogTitle, "Ana · Saat koleksiyonu — WRotate");
  assertStringIncludes(generateOgSvg("Alice", [], {}), "No public watches yet");
});
