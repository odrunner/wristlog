import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildWatchesOg, sortSharedWatches, WATCHES_SHARE_SELECT, watchesHeading } from "./lib.ts";

// The decisive privacy boundary: the columns the public page may read out of
// `watches`. Widening this ships price, market value, wears-adjacent data, notes
// or insurance without failing any other test in the repo.
Deno.test("WATCHES_SHARE_SELECT reads exactly the publishable columns", () => {
  const cols = WATCHES_SHARE_SELECT.split(",").map((s) => s.trim()).sort();
  // created_at + purchase_date are fetched for ORDERING only and stripped before render.
  assertEquals(cols, ["brand", "created_at", "id", "image", "name", "purchase_date", "ref", "url"]);
});

Deno.test("buildWatchesOg: title names the owner's watches, description lists count and first names", () => {
  const { ogTitle, ogDescription } = buildWatchesOg("Ozgur", null, [
    { id: "1", brand: "Rolex", name: "Daytona" },
    { id: "2", brand: "Omega", name: "Speedmaster" },
  ]);
  assertEquals(ogTitle, "Ozgur's watches — WRotate");
  assertEquals(ogDescription, "2 watches · Rolex Daytona, Omega Speedmaster");
});

Deno.test("buildWatchesOg: singular count, label between count and names, empty list", () => {
  assertEquals(buildWatchesOg("A", " for sale ", [{ id: "1", brand: "Tudor", name: "BB58" }]).ogDescription, "1 watch · for sale · Tudor BB58");
  assertEquals(buildWatchesOg("A", "", []).ogDescription, "0 watches");
});

Deno.test("buildWatchesOg: caps the name list at three", () => {
  const items = ["a", "b", "c", "d"].map((n) => ({ id: n, brand: "B", name: n }));
  const { ogDescription } = buildWatchesOg("A", null, items);
  assertStringIncludes(ogDescription, "B a, B b, B c");
  assertEquals(ogDescription.includes("B d"), false);
});

Deno.test("watchesHeading uses 'watches' rather than 'wishlist'", () => {
  assertEquals(watchesHeading("Ozgur"), "Ozgur's watches");
});

// The OG image is the wishlist one with a different heading; the default must
// stay "'s Wishlist" so share-wishlist previews are unchanged.
Deno.test("generateWishlistOgSvg: heading is swappable for the collection page", async () => {
  const { generateWishlistOgSvg } = await import("./lib.ts");
  const svg = generateWishlistOgSvg("Ozgur", [], watchesHeading);
  assertStringIncludes(svg, "Ozgur's watches");
  assertEquals(svg.includes("Wishlist"), false);
  assertStringIncludes(generateWishlistOgSvg("Ozgur", []), "Ozgur's Wishlist");
});

// The page lists watches the way the Collection tab does by default: purchase
// date, newest first; undated watches last; ties and undated ones by when they
// were added, newest first — so a link never reads as a random shuffle.
Deno.test("sortSharedWatches: purchase date desc, nulls last, then created_at desc", () => {
  const rows = [
    { id: "a", purchase_date: "2024-01-15", created_at: "2025-01-01T00:00:00Z" },
    { id: "b", purchase_date: null,         created_at: "2025-03-01T00:00:00Z" },
    { id: "c", purchase_date: "2026-05-27", created_at: "2025-02-01T00:00:00Z" },
    { id: "d", purchase_date: "2024-01-15", created_at: "2025-06-01T00:00:00Z" },
    { id: "e", purchase_date: null,         created_at: "2025-04-01T00:00:00Z" },
  ];
  assertEquals(sortSharedWatches(rows).map((r) => r.id), ["c", "d", "a", "e", "b"]);
});

Deno.test("sortSharedWatches: does not mutate its input and tolerates missing fields", () => {
  const rows = [{ id: "x" }, { id: "y", purchase_date: "2020-01-01" }];
  const out = sortSharedWatches(rows);
  assertEquals(out.map((r) => r.id), ["y", "x"]);
  assertEquals(rows.map((r) => r.id), ["x", "y"]);
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
const NOW = Date.parse("2026-11-14T12:00:00Z");
const COMMENTS = [
  { id: "c1", name: "Sarah", body: "Love the <Daytona>!", created_at: "2026-11-14T11:59:40Z" },
  { id: "c2", name: "Bob", body: "Nice", created_at: "2026-11-14T11:15:00Z" },
  { id: "c3", name: "Cy", body: "Old", created_at: "2026-11-14T02:00:00Z" },
  { id: "c4", name: "Di", body: "Older", created_at: "2026-11-01T02:00:00Z" },
  { id: "c5", name: "Ed", body: "Oldest", created_at: "2026-01-01T02:00:00Z" },
];
const LABEL = "For my <dealer>\nBudget 10k";
import { renderSharePage, shareStatePage } from "./lib.ts";
import { LANGS } from "../_shared/lang.ts";

const SHARED_WATCHES = { supabaseUrl: API, token: "tok", profile: PROFILE, items: WATCHES, label: LABEL, comments: COMMENTS, nowMs: NOW };

Deno.test("share-watches — English pages are byte-identical to the pre-translation pages", () => {
  assertEquals(renderSharePage("watches", SHARED_WATCHES), golden("watches"));
  assertEquals(renderSharePage("watches", SHARED_WATCHES, "en"), golden("watches"));
  assertEquals(shareStatePage("watches", "missing", API), golden("missing"));
  assertEquals(shareStatePage("watches", "dead", API), golden("dead"));
});

Deno.test("share-watches — German page: German chrome, lang=de, the member's words untouched", () => {
  const html = renderSharePage("watches", SHARED_WATCHES, "de");
  assertStringIncludes(html, '<html lang="de">');
  assertStringIncludes(html, "<title>Uhren von Alice &lt;B&gt; &amp; Co — WRotate</title>");
  assertStringIncludes(html, '<div class="col-name">Uhren von Alice &lt;B&gt; &amp; Co</div>');
  assertStringIncludes(html, '<div class="sc-title">Kommentare (5)</div>');
  assertStringIncludes(html, 'data-kind="collection"');
  assertStringIncludes(html, "Geteilt über WRotate · <a href=\"https://wrotate.com/open\">Erfasse deine eigene Sammlung</a>");
  assertStringIncludes(html, '<div class="col-label">For my &lt;dealer&gt;\nBudget 10k</div>');
  assertEquals(html.includes("Track your own collection"), false);
  assertEquals(html.split("\n").length, golden("watches").split("\n").length);
  const dead = shareStatePage("watches", "dead", API, "de");
  assertStringIncludes(dead, "<title>Sammlungs-Link — WRotate</title>");
  assertStringIncludes(dead, "Dieser Link ist nicht mehr verfügbar");
  assertStringIncludes(shareStatePage("watches", "missing", API, "de"), "Keine Uhren angegeben");
  assertStringIncludes(renderSharePage("watches", { ...SHARED_WATCHES, items: [] }, "de"), "Unter diesem Link ist nichts mehr");
});

Deno.test("share-watches — every language renders with its own lang attribute and no leftover hole", () => {
  for (const lang of LANGS) {
    for (const html of [renderSharePage("watches", SHARED_WATCHES, lang), renderSharePage("watches", { ...SHARED_WATCHES, items: [] }, lang), shareStatePage("watches", "missing", API, lang), shareStatePage("watches", "dead", API, lang)]) {
      assertStringIncludes(html, `<html lang="${lang}">`);
      assertEquals(/\{[a-z]\}|undefined/.test(html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script>[\s\S]*?<\/script>/g, "")), false, lang);
    }
  }
});

Deno.test("buildWatchesOg / watchesHeading — follow the language, English by default", () => {
  assertEquals(watchesHeading("Ana", "it"), "Orologi di Ana");
  assertEquals(watchesHeading("Ana"), "Ana's watches");
  const og = buildWatchesOg("Ana", null, [{ id: "1", brand: "Tudor", name: "BB58" }, { id: "2", brand: "Omega", name: "Speedmaster" }], "pt");
  assertEquals(og.ogTitle, "Relógios de Ana — WRotate");
  assertEquals(og.ogDescription, "2 relógios · Tudor BB58, Omega Speedmaster");
});
