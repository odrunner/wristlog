import { assertEquals } from "jsr:@std/assert";
import {
  buildHtmlEmail,
  dropDone,
  escapeHtml,
  FALLBACK_FACT,
  filterEligible,
  looksCompleteFact,
  looksLikeName,
  looksLikeRealWatchLabel,
  modelKey,
  needsFactVars,
  personalizeBody,
  personalizeName,
  personalizeSubject,
  pickBackfill,
  pickFeaturedWatch,
  pickPoolFact,
  signupWindow,
  skipTable,
  splitAlreadySent,
  unsubUrl,
  watchLabel,
  watchPhrase,
} from "./lib.ts";

const DAY = 24 * 60 * 60 * 1000;

// ---- signupWindow ----
Deno.test("signupWindow — delay 2 days yields a 24h slice ending 2 days before now", () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  const { windowStart, windowEnd } = signupWindow(now, 2);
  assertEquals(windowEnd, "2026-06-08T00:00:00.000Z");
  assertEquals(windowStart, "2026-06-07T00:00:00.000Z");
});

Deno.test("signupWindow — window is always exactly 24h wide", () => {
  const now = Date.parse("2026-06-10T12:34:56Z");
  const { windowStart, windowEnd } = signupWindow(now, 5);
  assertEquals(Date.parse(windowEnd) - Date.parse(windowStart), DAY);
});

Deno.test("signupWindow — delay 0 ends at now", () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  const { windowStart, windowEnd } = signupWindow(now, 0);
  assertEquals(windowEnd, "2026-06-10T00:00:00.000Z");
  assertEquals(windowStart, "2026-06-09T00:00:00.000Z");
});

// ---- filterEligible ----
Deno.test("filterEligible — excludes internal accounts", () => {
  const out = filterEligible([{ id: "a" }, { id: "b" }], ["b"]);
  assertEquals(out.map((p) => p.id), ["a"]);
});

Deno.test("filterEligible — excludes updates:false, keeps default + true", () => {
  const out = filterEligible(
    [
      { id: "a" },
      { id: "b", email_prefs: { updates: true } },
      { id: "c", email_prefs: { updates: false } },
    ],
    [],
  );
  assertEquals(out.map((p) => p.id), ["a", "b"]);
});

Deno.test("filterEligible — internal exclusion takes precedence over opted-in", () => {
  const out = filterEligible([{ id: "a", email_prefs: { updates: true } }], new Set(["a"]));
  assertEquals(out.length, 0);
});

Deno.test("filterEligible — null email_prefs is opted in", () => {
  const out = filterEligible([{ id: "a", email_prefs: null }], []);
  assertEquals(out.map((p) => p.id), ["a"]);
});

// ---- splitAlreadySent ----
Deno.test("splitAlreadySent — partitions sent vs pending", () => {
  const { pending, skipped } = splitAlreadySent(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    ["b"],
  );
  assertEquals(pending.map((u) => u.id), ["a", "c"]);
  assertEquals(skipped, 1);
});

Deno.test("splitAlreadySent — none sent", () => {
  const { pending, skipped } = splitAlreadySent([{ id: "a" }, { id: "b" }], []);
  assertEquals(pending.map((u) => u.id), ["a", "b"]);
  assertEquals(skipped, 0);
});

Deno.test("splitAlreadySent — all sent", () => {
  const { pending, skipped } = splitAlreadySent([{ id: "a" }, { id: "b" }], ["a", "b"]);
  assertEquals(pending.length, 0);
  assertEquals(skipped, 2);
});

// ---- personalizeBody ----
Deno.test("personalizeBody — replaces all {{name}} occurrences", () => {
  assertEquals(personalizeBody("Hi {{name}}, welcome {{name}}", "Sam"), "Hi Sam, welcome Sam");
});

Deno.test("personalizeBody — falls back to 'there' on empty/null", () => {
  assertEquals(personalizeBody("Hi {{name}}", ""), "Hi there");
  assertEquals(personalizeBody("Hi {{name}}", null), "Hi there");
  assertEquals(personalizeBody("Hi {{name}}", undefined), "Hi there");
});

// ---- name heuristic ----
Deno.test("personalizeName — keeps names that read like real names", () => {
  assertEquals(personalizeName("Robert"), "Robert");
  assertEquals(personalizeName("Dan"), "Dan");
  assertEquals(personalizeName("Javier"), "Javier");
  assertEquals(personalizeName("  Anne-Marie  "), "Anne-Marie"); // trims; hyphen ok
  assertEquals(personalizeName("José"), "José"); // accented letters ok
  assertEquals(personalizeName("O'Brien"), "O'Brien"); // apostrophe ok
});

Deno.test("personalizeName — falls back to 'there' for handles/initials/junk", () => {
  assertEquals(personalizeName("X"), "there"); // too short
  assertEquals(personalizeName("CN"), "there"); // initials, no vowel
  assertEquals(personalizeName("jvph4nmd8c"), "there"); // contains digits
  assertEquals(personalizeName("a".repeat(25)), "there"); // too long
  assertEquals(personalizeName(""), "there");
  assertEquals(personalizeName("   "), "there");
  assertEquals(personalizeName(null), "there");
  assertEquals(personalizeName(undefined), "there");
});

Deno.test("looksLikeName — boolean predicate", () => {
  assertEquals(looksLikeName("Robert"), true);
  assertEquals(looksLikeName("CN"), false);
  assertEquals(looksLikeName("jvph4nmd8c"), false);
});

Deno.test("personalizeBody — applies the name heuristic", () => {
  assertEquals(personalizeBody("Hi {{name}}!", "Robert"), "Hi Robert!");
  assertEquals(personalizeBody("Hi {{name}}!", "jvph4nmd8c"), "Hi there!");
});

Deno.test("personalizeBody — no placeholder leaves body unchanged", () => {
  assertEquals(personalizeBody("Hello world", "Sam"), "Hello world");
});

// ---- buildHtmlEmail ----
Deno.test("buildHtmlEmail — embeds body and unsubscribe URL", () => {
  const out = buildHtmlEmail("Subj", "<p>my body</p>", "https://u/x");
  assertEquals(out.includes("<p>my body</p>"), true);
  assertEquals(out.includes('href="https://u/x"'), true);
  assertEquals(out.includes("Unsubscribe"), true);
  assertEquals(out.startsWith("<!DOCTYPE html>"), true);
});

Deno.test("buildHtmlEmail — standard 'Unsubscribe · Manage preferences' footer", () => {
  const out = buildHtmlEmail("Subj", "<p>b</p>", "https://u/x");
  assertEquals(out.includes("Manage preferences"), true);
  assertEquals(out.includes('href="https://wrotate.com/open"'), true);
  assertEquals(out.includes("recently joined WRotate"), false); // old reason line removed
});

// ---- unsubUrl ----
Deno.test("unsubUrl — builds the expected URL", () => {
  assertEquals(
    unsubUrl("https://x.supabase.co", "uid-1", "sig-1"),
    "https://x.supabase.co/functions/v1/email-unsubscribe?uid=uid-1&cat=updates&sig=sig-1",
  );
});

// ---- skipTable ----
Deno.test("skipTable maps known keys to tables", () => {
  assertEquals(skipTable("has_watch"), "watches");
  assertEquals(skipTable("has_log"), "logs");
  assertEquals(skipTable("has_measurement"), "timegrapher_results");
});

Deno.test("skipTable returns null for null/empty/unknown (never drops everyone)", () => {
  assertEquals(skipTable(null), null);
  assertEquals(skipTable(undefined), null);
  assertEquals(skipTable(""), null);
  assertEquals(skipTable("has_bogus"), null);
});

// ---- dropDone ----
Deno.test("dropDone removes users whose id is in doneIds, keeps the rest", () => {
  const users = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assertEquals(dropDone(users, ["b"]), [{ id: "a" }, { id: "c" }]);
  assertEquals(dropDone(users, new Set(["a", "c"])), [{ id: "b" }]);
  assertEquals(dropDone(users, []), users);
  assertEquals(dropDone(users, ["a", "b", "c"]), []);
});

// ---- pickBackfill ----
Deno.test("pickBackfill — newest first, capped at limit", () => {
  const out = pickBackfill(
    [
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", created_at: "2026-03-01T00:00:00Z" },
      { id: "c", created_at: "2026-02-01T00:00:00Z" },
    ],
    [],
    [],
    2,
  );
  assertEquals(out.map((p) => p.id), ["b", "c"]);
});

Deno.test("pickBackfill — excludes already-sent and emailed-this-run", () => {
  const out = pickBackfill(
    [
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", created_at: "2026-03-01T00:00:00Z" },
      { id: "c", created_at: "2026-02-01T00:00:00Z" },
    ],
    ["b"],
    ["c"],
    10,
  );
  assertEquals(out.map((p) => p.id), ["a"]);
});

Deno.test("pickBackfill — accepts Sets directly", () => {
  const out = pickBackfill(
    [
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", created_at: "2026-03-01T00:00:00Z" },
    ],
    new Set(["a"]),
    new Set<string>(),
    10,
  );
  assertEquals(out.map((p) => p.id), ["b"]);
});

Deno.test("pickBackfill — limit 0 or negative yields empty", () => {
  const profiles = [{ id: "a", created_at: "2026-01-01T00:00:00Z" }];
  assertEquals(pickBackfill(profiles, [], [], 0), []);
  assertEquals(pickBackfill(profiles, [], [], -5), []);
});

// ---- fun-fact personalization ----
Deno.test("modelKey — matches the SQL: lower(trim(brand))|lower(trim(name))", () => {
  assertEquals(modelKey("  Rolex ", "Explorer"), "rolex|explorer");
  assertEquals(modelKey("Axios Watches", "Tribune 38 Teal"), "axios watches|tribune 38 teal");
});

Deno.test("pickFeaturedWatch — newest watch with both brand and name", () => {
  const out = pickFeaturedWatch([
    { brand: "Seiko", name: "SKX007", created_at: "2026-01-01T00:00:00Z" },
    { brand: "Rolex", name: "Explorer", created_at: "2026-03-01T00:00:00Z" },
  ]);
  assertEquals(out?.name, "Explorer");
});

Deno.test("pickFeaturedWatch — skips rows missing brand or name", () => {
  const out = pickFeaturedWatch([
    { brand: "Tudor", name: "", created_at: "2026-05-01T00:00:00Z" },
    { brand: "  ", name: "Black Bay", created_at: "2026-04-01T00:00:00Z" },
    { brand: "Seiko", name: "SKX007", created_at: "2026-01-01T00:00:00Z" },
  ]);
  assertEquals(out?.name, "SKX007");
});

Deno.test("pickFeaturedWatch — no usable watch yields null", () => {
  assertEquals(pickFeaturedWatch([]), null);
  assertEquals(pickFeaturedWatch([{ brand: "Omega", name: null }]), null);
});

Deno.test("watchLabel — joins brand and name, collapsing a repeated brand", () => {
  assertEquals(watchLabel("Seiko", "SKX007"), "Seiko SKX007");
  assertEquals(watchLabel("Rolex", "Rolex Submariner"), "Rolex Submariner");
  assertEquals(watchLabel("omega", "Omega Speedmaster"), "Omega Speedmaster");
});

Deno.test("looksCompleteFact — rejects truncated pool rows", () => {
  // Real shape of the early-bug rows: cut mid-sentence, no terminal punctuation.
  assertEquals(
    looksCompleteFact("The GA-2100RGB achieves its aesthetic through brightly colored accents "),
    false,
  );
  assertEquals(
    looksCompleteFact("Rolex's first serially produced model with a rotating bezel was the Turn-O-Graph."),
    true,
  );
  assertEquals(looksCompleteFact("Too short."), false);
  assertEquals(looksCompleteFact(""), false);
  assertEquals(looksCompleteFact(null), false);
});

Deno.test("pickPoolFact — lowest position wins, truncated rows skipped", () => {
  const rows = [
    { position: 2, fact: "A perfectly complete second fact about this watch model here." },
    { position: 0, fact: "This one was cut off mid sentence and never finished properly " },
    { position: 1, fact: "The earliest complete fact in the pool for this particular model." },
  ];
  assertEquals(pickPoolFact(rows)?.position, 1);
});

Deno.test("pickPoolFact — empty or all-truncated pool yields null", () => {
  assertEquals(pickPoolFact([]), null);
  assertEquals(pickPoolFact([{ position: 0, fact: "cut off " }]), null);
});

Deno.test("watchPhrase — possessive form for a watch they own", () => {
  assertEquals(watchPhrase("Seiko SKX007"), "your Seiko SKX007");
});

Deno.test("FALLBACK_FACT — phrase never claims ownership", () => {
  // "A fun fact about your Omega Speedmaster" would be a lie for the ~16% of
  // recipients with no watch yet, so the fallback carries its own article.
  assertEquals(FALLBACK_FACT.watchPhrase, "the Omega Speedmaster");
  assertEquals(FALLBACK_FACT.watchPhrase.startsWith("your"), false);
});

Deno.test("needsFactVars — only campaigns using the tokens opt in", () => {
  assertEquals(needsFactVars({ subject: "A fun fact about {{watchPhrase}}", body_html: "x" }), true);
  assertEquals(needsFactVars({ subject: "A fun fact about your {{watch}}", body_html: "x" }), true);
  assertEquals(needsFactVars({ subject: "Hi", body_html: "<i>{{fact}}</i>" }), true);
  assertEquals(needsFactVars({ subject: "Add your first watch", body_html: "Hi {{name}}" }), false);
  assertEquals(needsFactVars({}), false);
});

Deno.test("personalizeBody — substitutes fact vars and escapes them for HTML", () => {
  const out = personalizeBody("<b>{{watch}}</b>: {{fact}}", "Sam", {
    watch: "A. Lange & Söhne 1815",
    fact: 'It was <the> "first".',
  });
  assertEquals(out, "<b>A. Lange &amp; Söhne 1815</b>: It was &lt;the&gt; &quot;first&quot;.");
});

Deno.test("personalizeSubject — substitutes raw so headers read correctly", () => {
  assertEquals(
    personalizeSubject("A fun fact about your {{watch}}", "Sam", { watch: "A. Lange & Söhne 1815" }),
    "A fun fact about your A. Lange & Söhne 1815",
  );
});

Deno.test("personalizeBody — unresolved fact tokens stay put when no vars given", () => {
  // Guards the non-fact campaigns: they must be byte-identical to before.
  assertEquals(personalizeBody("Hi {{name}}, add a watch", "Sam"), "Hi Sam, add a watch");
});

Deno.test("escapeHtml — escapes the five HTML-significant characters", () => {
  assertEquals(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

Deno.test("FALLBACK_FACT — is a shippable pair", () => {
  assertEquals(looksCompleteFact(FALLBACK_FACT.fact), true);
  assertEquals(FALLBACK_FACT.watch.length > 0, true);
});

Deno.test("buildHtmlEmail — empty unsubUrl omits the footer row", () => {
  // broadcast_queue rows are stored footer-less; send-broadcast's drain appends
  // unsubFooter() with a freshly signed URL. Two footers would ship otherwise.
  const out = buildHtmlEmail("Subj", "<p>b</p>", "");
  assertEquals(out.includes("Unsubscribe"), false);
  assertEquals(out.includes("Manage preferences"), false);
  assertEquals(out.includes("<p>b</p>"), true);
  assertEquals(out.trimEnd().endsWith("</html>"), true);
});

Deno.test("buildHtmlEmail — a real unsubUrl still renders the footer", () => {
  const out = buildHtmlEmail("Subj", "<p>b</p>", "https://u/x");
  assertEquals(out.includes('href="https://u/x"'), true);
  assertEquals(out.includes("Manage preferences"), true);
});

// ---- subject-line safety for free-text watch names ----
Deno.test("looksLikeRealWatchLabel — keeps legitimate names, including long and odd ones", () => {
  assertEquals(looksLikeRealWatchLabel("Seiko SKX007"), true);
  assertEquals(looksLikeRealWatchLabel("Omega Seamaster Diver 300M Co-Axial Master Chronometer 42mm"), true);
  assertEquals(looksLikeRealWatchLabel("Mr Jones Watches A Perfectly Useless Afternoon"), true);
  assertEquals(looksLikeRealWatchLabel("Studio Underd0g 02SERIES Collection"), true);
  assertEquals(looksLikeRealWatchLabel("A. Lange & Söhne 1815"), true);
  // "Homage" is how microbrands describe themselves — not an insult.
  assertEquals(looksLikeRealWatchLabel("Baltany 9039 Automatic 1921 Homage Driver Watch"), true);
});

Deno.test("looksLikeRealWatchLabel — rejects names that would embarrass in a subject line", () => {
  // Real row from the audience; the subject read "A fun fact about your Omega
  // Fake Omega - Likely ETA 2824-2".
  assertEquals(looksLikeRealWatchLabel("Omega Fake Omega - Likely ETA 2824-2"), false);
  assertEquals(looksLikeRealWatchLabel("TestBrand Test"), false);
  assertEquals(looksLikeRealWatchLabel("Unknown Unknown"), false);
  assertEquals(looksLikeRealWatchLabel("Rolex Submariner?"), false);
  assertEquals(looksLikeRealWatchLabel("x"), false);
  assertEquals(looksLikeRealWatchLabel(""), false);
  assertEquals(looksLikeRealWatchLabel(null), false);
  assertEquals(looksLikeRealWatchLabel("12345"), false); // bare reference number
});

Deno.test("looksLikeRealWatchLabel — 'test' matches as a word, not inside another", () => {
  assertEquals(looksLikeRealWatchLabel("Protest Diver"), true);
  assertEquals(looksLikeRealWatchLabel("Seiko Test"), false);
});
