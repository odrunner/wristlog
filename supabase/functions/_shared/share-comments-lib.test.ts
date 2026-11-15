import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildCommentEmail, cleanText, commentsSectionHtml, hashIp, isHoneypotTripped, isRateLimited,
  rateKeys, relativeTime, resolveIp, validateComment, windowStartIso,
} from "./share-comments-lib.ts";

Deno.test("cleanText strips control chars, keeps newlines, trims", () => {
  assertEquals(cleanText("  hi there\n\nok  "), "hi there\n\nok");
  const ctl = "a" + String.fromCharCode(1) + "b" + String.fromCharCode(7) + "c";
  assertEquals(cleanText(ctl), "a b c");
  assertEquals(cleanText("x\n\n\n\n\ny"), "x\n\ny");
  assertEquals(cleanText(null), "");
  assertEquals(cleanText(42), "42");
});

Deno.test("validateComment accepts a normal comment and returns cleaned fields", () => {
  const r = validateComment({ name: "  Sarah ", body: " Love the Daytona!\n" });
  assertEquals(r, { ok: true, name: "Sarah", body: "Love the Daytona!" });
});

Deno.test("validateComment rejects empty name/body and over-long fields with a reason", () => {
  assertEquals(validateComment({ name: "", body: "x" }), { ok: false, reason: "Please add your name" });
  assertEquals(validateComment({ name: "A", body: "   " }), { ok: false, reason: "Please write a comment" });
  assertEquals(validateComment({ name: "a".repeat(41), body: "x" }), { ok: false, reason: "Name is too long (40 characters max)" });
  assertEquals(validateComment({ name: "A", body: "x".repeat(501) }), { ok: false, reason: "Comment is too long (500 characters max)" });
  assertEquals(validateComment({}), { ok: false, reason: "Please add your name" });
});

Deno.test("honeypot: any non-empty value trips it", () => {
  assertEquals(isHoneypotTripped(""), false);
  assertEquals(isHoneypotTripped(undefined), false);
  assertEquals(isHoneypotTripped("   "), false);
  assertEquals(isHoneypotTripped("http://spam"), true);
});

Deno.test("resolveIp trusts cf-connecting-ip, then the LAST x-forwarded-for hop, never the first", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  // A caller-supplied first hop is ignored whenever Cloudflare's header is there.
  assertEquals(resolveIp(h({ "x-forwarded-for": "6.6.6.6, 5.6.7.8", "cf-connecting-ip": "5.6.7.8" })), "5.6.7.8");
  assertEquals(resolveIp(h({ "cf-connecting-ip": "9.9.9.9" })), "9.9.9.9");
  // Without it, the appended (last) hop is the one a proxy wrote.
  assertEquals(resolveIp(h({ "x-forwarded-for": "6.6.6.6, 5.6.7.8" })), "5.6.7.8");
  assertEquals(resolveIp(h({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
  assertEquals(resolveIp(h({})), "unknown");
});

Deno.test("hashIp is keyed, stable, hex, and null for unknown or no key", async () => {
  const a = await hashIp("1.2.3.4", "k1"), b = await hashIp("1.2.3.4", "k1");
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a!));
  // The key decides the result: without it the hash cannot be recomputed.
  assert(a !== await hashIp("1.2.3.4", "k2"));
  assert(a !== await hashIp("1.2.3.5", "k1"));
  assertEquals(await hashIp("unknown", "k1"), null);
  assertEquals(await hashIp("", "k1"), null);
  // No key: nothing is produced, never an unkeyed hash.
  assertEquals(await hashIp("1.2.3.4", ""), null);
  assertEquals(await hashIp("1.2.3.4", undefined), null);
});

Deno.test("rateKeys are namespaced per token and per ip hash", () => {
  assertEquals(rateKeys("tok1", "abc"), {
    ip: "share-comment:ip:abc", token: "share-comment:token:tok1", email: "share-comment-email:tok1",
  });
  assertEquals(rateKeys("tok1", null).ip, "share-comment:ip:unknown");
});

Deno.test("isRateLimited: in-window and at limit is limited; stale window is not", () => {
  const now = 1_000_000_000_000;
  const ws = windowStartIso(now, 3_600_000);
  assertEquals(isRateLimited({ request_count: 10, window_start: new Date(now).toISOString() }, ws, 10), true);
  assertEquals(isRateLimited({ request_count: 9, window_start: new Date(now).toISOString() }, ws, 10), false);
  assertEquals(isRateLimited({ request_count: 99, window_start: new Date(now - 7_200_000).toISOString() }, ws, 10), false);
  assertEquals(isRateLimited(null, ws, 10), false);
});

Deno.test("relativeTime buckets", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  assertEquals(relativeTime("2026-08-22T11:59:40Z", now), "just now");
  assertEquals(relativeTime("2026-08-22T11:55:00Z", now), "5 min ago");
  assertEquals(relativeTime("2026-08-22T09:00:00Z", now), "3 h ago");
  assertEquals(relativeTime("2026-08-20T12:00:00Z", now), "2 d ago");
  assertEquals(relativeTime("2026-07-01T12:00:00Z", now), "2026-07-01");
  assertEquals(relativeTime("garbage", now), "");
});

Deno.test("commentsSectionHtml escapes comments, renders the form, and says the thread is public", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  const html = commentsSectionHtml("wishlist", "tok<1>", [
    { id: "c1", name: "<b>Sarah</b>", body: "Love it & want it", created_at: "2026-08-22T11:55:00Z" },
  ], now);
  assertStringIncludes(html, "&lt;b&gt;Sarah&lt;/b&gt;");
  assertStringIncludes(html, "Love it &amp; want it");
  assertStringIncludes(html, "5 min ago");
  assertStringIncludes(html, 'name="hp"');
  assertStringIncludes(html, "Visible to everyone who has this link");
  assertStringIncludes(html, 'data-token="tok&lt;1&gt;"');
  assertStringIncludes(html, "Comments (1)");
  assertEquals(html.includes("<b>Sarah</b>"), false);
});

Deno.test("commentsSectionHtml with no comments still renders the form and an empty-state line", () => {
  const html = commentsSectionHtml("collection", "t", [], 0);
  assertStringIncludes(html, "No comments yet");
  assertStringIncludes(html, 'id="sc-form"');
  assertEquals(html.includes("Comments ("), false);
});

Deno.test("buildCommentEmail: we-voice, escaped content, CTA to /open, unsubscribe link, kind-specific subject", () => {
  const { subject, html } = buildCommentEmail("collection", { name: "Sa<ra>h", body: "Is the GMT available?" }, "For the insurer", "https://u/unsub");
  assertEquals(subject, "New comment on your shared watches");
  assertStringIncludes(html, "Sa&lt;ra&gt;h");
  assertStringIncludes(html, "Is the GMT available?");
  assertStringIncludes(html, "For the insurer");
  assertStringIncludes(html, 'href="https://wrotate.com/open');
  assertStringIncludes(html, 'href="https://u/unsub"');
  assertEquals(buildCommentEmail("wishlist", { name: "A", body: "b" }, null, "u").subject, "New comment on your shared wishlist");
  assertStringIncludes(buildCommentEmail("wishlist", { name: "A", body: "b" }, null, "u").html, "a wishlist link you shared");
  assertEquals(/Ozgur|founder/i.test(html), false);
});

// ---- languages ----
import { LANGS } from "./lang.ts";

Deno.test("buildCommentEmail: every language has both kinds, escapes content, leaves no hole", () => {
  for (const lang of LANGS) {
    for (const kind of ["collection", "wishlist"] as const) {
      for (const label of ["For <the> insurer", null]) {
        const { subject, html } = buildCommentEmail(kind, { name: "Sa<ra>h", body: "Is it available?" }, label, "https://u/unsub", lang);
        assertEquals(/[{}]/.test(subject), false);
        assertEquals(html.includes("{n}") || html.includes("{l}"), false, `${lang}/${kind}: leftover hole`);
        assertEquals(html.includes("Sa&lt;ra&gt;h"), true);
        assertEquals(html.includes("<ra>"), false);
        if (label) assertEquals(html.includes("For &lt;the&gt; insurer"), true);
        assertEquals(html.includes('href="https://wrotate.com/open?'), true);
        if (lang !== "en") assertEquals(subject === buildCommentEmail(kind, { name: "a", body: "b" }, label, "https://u").subject, false);
      }
    }
  }
  assertEquals(buildCommentEmail("wishlist", { name: "a", body: "b" }, null, "https://u", "de").subject, "Neuer Kommentar zu deiner geteilten Wunschliste");
  assertEquals(buildCommentEmail("collection", { name: "a", body: "b" }, null, "https://u"),
    buildCommentEmail("collection", { name: "a", body: "b" }, null, "https://u", "en"));
});

// ---- languages: the comment box follows the page, not the link's owner ----
import { jsStr } from "./share-comments-lib.ts";

Deno.test("relativeTime in another language; English unchanged", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  assertEquals(relativeTime("2026-08-22T11:59:40Z", now, "fr"), "à l'instant");
  assertEquals(relativeTime("2026-08-22T11:55:00Z", now, "de"), "vor 5 Min.");
  assertEquals(relativeTime("2026-08-22T09:00:00Z", now, "tr"), "3 sa önce");
  assertEquals(relativeTime("2026-08-20T12:00:00Z", now, "it"), "2 g fa");
  assertEquals(relativeTime("2026-07-01T12:00:00Z", now, "de"), "1. Juli 2026", "an old comment gets the locale's date");
  assertEquals(relativeTime("2026-07-01T12:00:00Z", now, "en"), "2026-07-01");
  assertEquals(relativeTime("garbage", now, "es"), "");
});

Deno.test("validateComment gives its reason in the commenter's language", () => {
  assertEquals(validateComment({ name: "", body: "x" }, "de"), { ok: false, reason: "Bitte gib deinen Namen an" });
  assertEquals(validateComment({ name: "A", body: " " }, "es"), { ok: false, reason: "Escribe un comentario" });
  assertEquals(validateComment({ name: "a".repeat(41), body: "x" }, "fr"), { ok: false, reason: "Le nom est trop long (40 caractères maximum)" });
  assertEquals(validateComment({ name: "A", body: "x".repeat(501) }, "pt"), { ok: false, reason: "O comentário é demasiado longo (máximo de 500 caracteres)" });
  assertEquals(validateComment({ name: " Sarah ", body: "Hi" }, "tr"), { ok: true, name: "Sarah", body: "Hi" });
});

Deno.test("jsStr writes a safe single-quoted literal", () => {
  assertEquals(jsStr("just now"), "'just now'");
  assertEquals(jsStr("à l'instant"), "'à l\\'instant'");
  assertEquals(jsStr("a\\b</script>\n"), "'a\\\\b<\\/script>\\n'");
});

Deno.test("commentsSectionHtml in German: form, thread and the script's own strings", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  const html = commentsSectionHtml("wishlist", "tok", [{ id: "1", name: "Sarah", body: "Nice <b>", created_at: "2026-08-22T11:00:00Z" }], now, "de");
  assertStringIncludes(html, '<div class="sc-title">Kommentare (1)</div>');
  assertStringIncludes(html, '<label for="sc-name">Dein Name</label>');
  assertStringIncludes(html, 'placeholder="Schreib etwas zu diesen Uhren…"');
  assertStringIncludes(html, "Sichtbar für alle, die diesen Link haben.");
  assertStringIncludes(html, '<span class="sc-time">vor 1 Std.</span>');
  assertStringIncludes(html, "|| 'Dein Kommentar konnte nicht gepostet werden. Bitte versuch es noch einmal.'; return;");
  assertStringIncludes(html, "+ '&lang=de', {");
  assertStringIncludes(html, "Nice &lt;b&gt;", "the comment itself is left as written");
  assertStringIncludes(commentsSectionHtml("collection", "tok", [], now, "de"), "Noch keine Kommentare — schreib den ersten.");
});

Deno.test("commentsSectionHtml: English is untouched and posts no lang; every language's script parses", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  const c = [{ id: "1", name: "S", body: "b", created_at: "2026-08-22T11:59:59Z" }];
  assertEquals(commentsSectionHtml("wishlist", "tok", c, now, "en"), commentsSectionHtml("wishlist", "tok", c, now));
  const en = commentsSectionHtml("wishlist", "tok", c, now);
  assertEquals(en.includes("&lang="), false);
  assertStringIncludes(en, "fetch(location.pathname + '?t=' + encodeURIComponent(payload.t), {");
  assertStringIncludes(en, '<span class="sc-time">just now</span></div><div class="sc-body">\' + esc(c.body)');
  for (const lang of LANGS) {
    const html = commentsSectionHtml("wishlist", "tok", c, now, lang);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html);
    assert(script, lang);
    new Function(script![1]);
    assertEquals(/\{[a-z]\}|undefined/.test(html.replace(/<script>[\s\S]*?<\/script>/, "")), false, lang);
  }
});
