# Share-Link Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone opening a wishlist (`share-wishlist?t=`) or collection (`share-watches?t=`) share link can leave a name + comment; the thread is public on the page; the owner sees it in Shared links + the bell, gets an iOS push, and an email.

**Architecture:** One `share_comments` table (owner-only RLS; inserts only via service role). A shared Deno module `_shared/share-comments-lib.ts` (pure) + `_shared/share-comments.ts` (IO: POST handler, loader, email) used by both share functions. The notification row insert triggers the existing `send-push` webhook. The client enriches `share_comment` bell rows and shows threads inside the existing Shared-links modals.

**Tech Stack:** Postgres/Supabase (RLS, PostgREST), Deno edge functions, vanilla JS in `index.html` mirrored into `wrotate_test.js`, vitest, Playwright (mocked), Deno test.

**Spec:** `docs/superpowers/specs/2026-08-22-share-comments-design.md`

## Global Constraints

- Vanilla JS only; no frameworks. Replace `confirm()`/`alert()` with inline UI.
- Every `index.html` change bumps `sw.js` `CACHE` (`wristlog-vNN`).
- Functions mirrored in `index.html` and `wrotate_test.js` must be byte-identical and registered in `tests/mirror-drift.test.js` (`VERBATIM`).
- Email: `"we"` voice, never name the founder; every CTA links `https://wrotate.com/open`; send through `_shared/mailer.ts` only; default config set.
- Edge functions deploy with `--no-verify-jwt`; run `npm run test:smoke` after every deploy.
- Before push: `npm test && npm run test:coverage && npm run test:functions && npm run test:e2e`.
- Name ≤ 40 chars, body ≤ 500 chars; per IP 10/hour; per link 60/day; email ≤ 1 per link per 30 min.
- Test accounts only (`testuser` / `testuser2`); never post publicly.
- Deploys and the final `git push` need the owner's go-ahead (the email path is involved).

---

### Task 1: Database — `share_comments` table, RLS, unsubscribe category

**Files:**
- Create: `sql/2026-08-22-share-comments.sql`
- Modify: `supabase/functions/email-unsubscribe/lib.ts` (CATEGORY_LABELS, applyUnsubscribe)
- Test: `supabase/functions/email-unsubscribe/lib.test.ts`

**Interfaces:**
- Produces: table `public.share_comments(id uuid, kind text, token text, owner_id uuid, name text, body text, ip_hash text, created_at timestamptz, deleted_at timestamptz)`; email pref key `share_comments` (default true).

- [ ] **Step 1: Write the failing Deno test for the unsubscribe category**

Append to `supabase/functions/email-unsubscribe/lib.test.ts`:

```ts
Deno.test("share_comments is a labelled category and is included in 'all'", () => {
  assertEquals(categoryLabel("share_comments"), "Comments on your shared links");
  const prefs = applyUnsubscribe({}, "all");
  assertEquals(prefs.share_comments, false);
  assertEquals(applyUnsubscribe({}, "share_comments").share_comments, false);
});
```
(Ensure `categoryLabel` and `applyUnsubscribe` are in the file's import list.)

- [ ] **Step 2: Run it — expect FAIL** (`deno test --allow-read supabase/functions/email-unsubscribe/`): label falls back to the raw key, and `all` leaves `share_comments` undefined.

- [ ] **Step 3: Implement** in `supabase/functions/email-unsubscribe/lib.ts`:
  - `CATEGORY_LABELS`: add `share_comments: "Comments on your shared links",` before `all`.
  - `applyUnsubscribe`: in the `cat === "all"` branch add `prefs.share_comments = false;`.

- [ ] **Step 4: Run Deno tests for the function — expect PASS.**

- [ ] **Step 5: Write the SQL file** `sql/2026-08-22-share-comments.sql`:

```sql
-- Comments left by recipients of a wishlist/collection share link.
-- Recipients usually have no account, so `name` is typed. The thread is PUBLIC
-- to anyone holding the link (owner's decision, 2026-08-22); the owner alone can
-- read it through the API (RLS) and soft-delete. Inserts come only from the
-- share-wishlist / share-watches edge functions on the service role, after
-- validation + rate limiting — there is no insert policy on purpose.
create table if not exists public.share_comments (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('wishlist','collection')),
  token      text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  body       text not null check (char_length(body) between 1 and 500),
  ip_hash    text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists share_comments_thread_idx on public.share_comments (kind, token, created_at);
create index if not exists share_comments_owner_idx  on public.share_comments (owner_id, created_at desc);

alter table public.share_comments enable row level security;

drop policy if exists share_comments_select_own on public.share_comments;
create policy share_comments_select_own on public.share_comments
  for select to authenticated using (owner_id = auth.uid());

-- UPDATE exists so the owner can soft-delete (set deleted_at).
drop policy if exists share_comments_update_own on public.share_comments;
create policy share_comments_update_own on public.share_comments
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

notify pgrst, 'reload schema';
```

- [ ] **Step 6: Apply and verify**
  `npx supabase db query --linked --file sql/2026-08-22-share-comments.sql`, then
  `npx supabase db query --linked "SELECT count(*) FROM pg_policies WHERE tablename='share_comments';"` → 2.

- [ ] **Step 7: Commit** `sql/2026-08-22-share-comments.sql`, `email-unsubscribe/lib.ts`, `email-unsubscribe/lib.test.ts` — `share-comments: table + RLS; email-unsubscribe share_comments category`.

---

### Task 2: Pure library `_shared/share-comments-lib.ts`

**Files:**
- Create: `supabase/functions/_shared/share-comments-lib.ts`
- Test: `supabase/functions/_shared/share-comments-lib.test.ts`

**Interfaces (Produces):**
```ts
export type ShareKind = "wishlist" | "collection";
export type PublicComment = { id: string; name: string; body: string; created_at: string };
export const NAME_MAX = 40, BODY_MAX = 500;
export const IP_LIMIT = 10, IP_WINDOW_MS = 3_600_000;
export const TOKEN_LIMIT = 60, TOKEN_WINDOW_MS = 86_400_000;
export const EMAIL_WINDOW_MS = 1_800_000;
export function cleanText(raw: unknown): string;            // String(), strip control chars except \n, collapse >2 blank lines, trim
export function validateComment(input: { name?: unknown; body?: unknown }): { ok: true; name: string; body: string } | { ok: false; reason: string };
export function isHoneypotTripped(hp: unknown): boolean;    // non-empty string → true
export function resolveIp(headerGet: (n: string) => string | null): string;
export function hashIp(ip: string): Promise<string | null>;
export function rateKeys(token: string, ipHash: string | null): { ip: string; token: string; email: string };
export function windowStartIso(nowMs: number, windowMs: number): string;
export function isRateLimited(row: { request_count: number; window_start: string } | null | undefined, windowStartIso: string, limit: number): boolean;
export function relativeTime(iso: string, nowMs: number): string;   // "just now", "5 min ago", "3 h ago", "2 d ago", else YYYY-MM-DD
export function esc(s: string): string;
export function commentsSectionHtml(kind: ShareKind, token: string, comments: PublicComment[], nowMs: number): string; // thread + form + inline script + <style>
export function buildCommentEmail(kind: ShareKind, comment: { name: string; body: string }, label: string | null, unsubUrl: string): { subject: string; html: string };
```

- [ ] **Step 1: Write the failing tests** `supabase/functions/_shared/share-comments-lib.test.ts`:

```ts
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildCommentEmail, cleanText, commentsSectionHtml, hashIp, isHoneypotTripped, isRateLimited,
  rateKeys, relativeTime, resolveIp, validateComment, windowStartIso,
} from "./share-comments-lib.ts";

Deno.test("cleanText strips control chars, keeps newlines, trims", () => {
  assertEquals(cleanText("  hi there\n\nok  "), "hi there\n\nok");
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
});

Deno.test("honeypot: any non-empty value trips it", () => {
  assertEquals(isHoneypotTripped(""), false);
  assertEquals(isHoneypotTripped(undefined), false);
  assertEquals(isHoneypotTripped("http://spam"), true);
});

Deno.test("resolveIp prefers x-forwarded-for's first hop, then cf-connecting-ip, else unknown", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  assertEquals(resolveIp(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
  assertEquals(resolveIp(h({ "cf-connecting-ip": "9.9.9.9" })), "9.9.9.9");
  assertEquals(resolveIp(h({})), "unknown");
});

Deno.test("hashIp is stable, hex, and null for unknown", async () => {
  const a = await hashIp("1.2.3.4"), b = await hashIp("1.2.3.4");
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a!));
  assertEquals(await hashIp("unknown"), null);
});

Deno.test("rateKeys are namespaced per token and per ip hash", () => {
  assertEquals(rateKeys("tok1", "abc"), {
    ip: "share-comment:ip:abc", token: "share-comment:token:tok1", email: "share-comment-email:tok1",
  });
  assertEquals(rateKeys("tok1", null).ip, "share-comment:ip:unknown");
});

Deno.test("isRateLimited: in-window and at limit → limited; stale window → not", () => {
  const ws = windowStartIso(1_000_000_000_000, 3_600_000);
  assertEquals(isRateLimited({ request_count: 10, window_start: new Date(1_000_000_000_000).toISOString() }, ws, 10), true);
  assertEquals(isRateLimited({ request_count: 9, window_start: new Date(1_000_000_000_000).toISOString() }, ws, 10), false);
  assertEquals(isRateLimited({ request_count: 99, window_start: new Date(1_000_000_000_000 - 7_200_000).toISOString() }, ws, 10), false);
  assertEquals(isRateLimited(null, ws, 10), false);
});

Deno.test("relativeTime buckets", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  assertEquals(relativeTime("2026-08-22T11:59:40Z", now), "just now");
  assertEquals(relativeTime("2026-08-22T11:55:00Z", now), "5 min ago");
  assertEquals(relativeTime("2026-08-22T09:00:00Z", now), "3 h ago");
  assertEquals(relativeTime("2026-08-20T12:00:00Z", now), "2 d ago");
  assertEquals(relativeTime("2026-07-01T12:00:00Z", now), "2026-07-01");
});

Deno.test("commentsSectionHtml escapes comments, renders the form, and says the thread is public", () => {
  const now = Date.parse("2026-08-22T12:00:00Z");
  const html = commentsSectionHtml("wishlist", "tok<1>", [
    { id: "c1", name: "<b>Sarah</b>", body: "Love it & want it", created_at: "2026-08-22T11:55:00Z" },
  ], now);
  assertStringIncludes(html, "&lt;b&gt;Sarah&lt;/b&gt;");
  assertStringIncludes(html, "Love it &amp; want it");
  assertStringIncludes(html, "5 min ago");
  assertStringIncludes(html, 'name="hp"');                       // honeypot field
  assertStringIncludes(html, "Visible to everyone who has this link");
  assertStringIncludes(html, 'data-token="tok&lt;1&gt;"');
  assertEquals(html.includes("<b>Sarah</b>"), false);
});

Deno.test("commentsSectionHtml with no comments still renders the form and an empty-state line", () => {
  const html = commentsSectionHtml("collection", "t", [], 0);
  assertStringIncludes(html, "No comments yet");
  assertStringIncludes(html, 'id="sc-form"');
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
  assertEquals(/Ozgur|founder/i.test(html), false);
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found): `deno test --allow-read supabase/functions/_shared/share-comments-lib.test.ts`

- [ ] **Step 3: Implement** `supabase/functions/_shared/share-comments-lib.ts`:

```ts
// share-comments — pure logic shared by share-wishlist and share-watches.
// Comments are left by recipients of a share link (usually no account), so the
// name is typed. The thread is PUBLIC to anyone holding the link. Everything that
// touches the DB/network lives in share-comments.ts; this file is testable
// without permissions.

export type ShareKind = "wishlist" | "collection";
export type PublicComment = { id: string; name: string; body: string; created_at: string };

export const NAME_MAX = 40;
export const BODY_MAX = 500;
export const IP_LIMIT = 10;
export const IP_WINDOW_MS = 60 * 60 * 1000;          // 10 per hour per IP
export const TOKEN_LIMIT = 60;
export const TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000;  // 60 per day per link
export const EMAIL_WINDOW_MS = 30 * 60 * 1000;       // ≤1 email per link per 30 min

export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Control characters (except \n) are dropped, runs of blank lines capped at one,
// surrounding whitespace trimmed. Never truncates — over-length is a 400, so the
// poster knows rather than losing their tail silently.
export function cleanText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateComment(input: { name?: unknown; body?: unknown }):
  { ok: true; name: string; body: string } | { ok: false; reason: string } {
  const name = cleanText(input?.name);
  const body = cleanText(input?.body);
  if (!name) return { ok: false, reason: "Please add your name" };
  if (name.length > NAME_MAX) return { ok: false, reason: `Name is too long (${NAME_MAX} characters max)` };
  if (!body) return { ok: false, reason: "Please write a comment" };
  if (body.length > BODY_MAX) return { ok: false, reason: `Comment is too long (${BODY_MAX} characters max)` };
  return { ok: true, name, body };
}

// A hidden field humans never see. Bots that fill every input reveal themselves;
// the handler answers 200 and stores nothing, so they believe it worked.
export function isHoneypotTripped(hp: unknown): boolean {
  return typeof hp === "string" && hp.trim().length > 0;
}

export function resolveIp(headerGet: (name: string) => string | null): string {
  return headerGet("x-forwarded-for")?.split(",")[0]?.trim()
    || headerGet("cf-connecting-ip")
    || "unknown";
}

// Stable salted hash, never the raw IP (same scheme as demo-login).
const IP_HASH_SALT = "wrotate-share-comments-v1";
export async function hashIp(ip: string): Promise<string | null> {
  if (!ip || ip === "unknown") return null;
  const data = new TextEncoder().encode(`${IP_HASH_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// rate_limits rows are keyed (user_id, function_name); the handler uses the
// share OWNER as user_id (the FK needs a real user), so these keys only need to
// be unique per owner.
export function rateKeys(token: string, ipHash: string | null): { ip: string; token: string; email: string } {
  return {
    ip: `share-comment:ip:${ipHash || "unknown"}`,
    token: `share-comment:token:${token}`,
    email: `share-comment-email:${token}`,
  };
}

export function windowStartIso(nowMs: number, windowMs: number): string {
  return new Date(nowMs - windowMs).toISOString();
}

export function isRateLimited(
  row: { request_count: number; window_start: string } | null | undefined,
  windowStartIso: string,
  limit: number,
): boolean {
  return !!row && row.window_start > windowStartIso && row.request_count >= limit;
}

export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  return iso.slice(0, 10);
}

// The thread + form that both share pages append under the watch grid. Styles
// are inlined here so neither page's <style> needs to know about comments.
// The inline script POSTs JSON to the page's own path (same origin, no CORS)
// and appends the returned comment; the poster's name is remembered locally.
export function commentsSectionHtml(kind: ShareKind, token: string, comments: PublicComment[], nowMs: number): string {
  const items = (comments || []).map((c) => `
      <div class="sc-item">
        <div class="sc-meta"><span class="sc-name">${esc(c.name)}</span> · <span class="sc-time">${esc(relativeTime(c.created_at, nowMs))}</span></div>
        <div class="sc-body">${esc(c.body)}</div>
      </div>`).join("");
  const n = (comments || []).length;
  return `
    <style>
      .sc-wrap { margin-top: 1.5rem; }
      .sc-title { font-size: .95rem; font-weight: 800; margin-bottom: .6rem; }
      .sc-item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: .6rem .75rem; margin-bottom: .5rem; }
      .sc-meta { font-size: .72rem; color: var(--muted); margin-bottom: .2rem; }
      .sc-name { font-weight: 700; color: var(--text); }
      .sc-body { font-size: .88rem; white-space: pre-wrap; word-break: break-word; }
      .sc-empty { font-size: .85rem; color: var(--muted); margin-bottom: .75rem; }
      .sc-form { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem; margin-top: .75rem; }
      .sc-form label { display: block; font-size: .72rem; color: var(--muted); margin: .35rem 0 .2rem; }
      .sc-form input, .sc-form textarea { width: 100%; font: inherit; font-size: .9rem; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: .5rem .6rem; }
      .sc-form textarea { min-height: 84px; resize: vertical; }
      .sc-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
      .sc-note { font-size: .72rem; color: var(--muted); margin-top: .4rem; }
      .sc-btn { display: inline-block; margin-top: .6rem; background: var(--gold); color: #fff; border: none; border-radius: 8px; padding: .55rem 1.2rem; font: inherit; font-size: .9rem; font-weight: 600; cursor: pointer; }
      .sc-btn[disabled] { opacity: .6; cursor: default; }
      .sc-err { font-size: .8rem; color: #c0392b; margin-top: .4rem; min-height: 1em; }
    </style>
    <section class="sc-wrap" id="sc-wrap" data-kind="${esc(kind)}" data-token="${esc(token)}">
      <div class="sc-title">Comments${n ? ` (${n})` : ""}</div>
      <div id="sc-list">${items || `<div class="sc-empty" id="sc-empty">No comments yet — be the first.</div>`}</div>
      <form class="sc-form" id="sc-form" autocomplete="off">
        <label for="sc-name">Your name</label>
        <input id="sc-name" name="name" maxlength="${NAME_MAX}" placeholder="So they know who this is from" required>
        <label for="sc-body">Comment</label>
        <textarea id="sc-body" name="body" maxlength="${BODY_MAX}" placeholder="Say something about these watches…" required></textarea>
        <div class="sc-hp" aria-hidden="true"><label for="sc-hp">Website</label><input id="sc-hp" name="hp" tabindex="-1" autocomplete="off"></div>
        <div class="sc-note">Visible to everyone who has this link.</div>
        <div class="sc-err" id="sc-err"></div>
        <button type="submit" class="sc-btn" id="sc-submit">Post comment</button>
      </form>
    </section>
    <script>
    (function () {
      var wrap = document.getElementById('sc-wrap'); if (!wrap) return;
      var form = document.getElementById('sc-form'), list = document.getElementById('sc-list');
      var nameEl = document.getElementById('sc-name'), bodyEl = document.getElementById('sc-body');
      var err = document.getElementById('sc-err'), btn = document.getElementById('sc-submit');
      try { var saved = localStorage.getItem('wr_sc_name'); if (saved && !nameEl.value) nameEl.value = saved; } catch (e) {}
      function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault(); err.textContent = ''; btn.disabled = true;
        var payload = { t: wrap.getAttribute('data-token'), name: nameEl.value, body: bodyEl.value, hp: document.getElementById('sc-hp').value };
        fetch(location.pathname + '?t=' + encodeURIComponent(payload.t), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (res) {
            btn.disabled = false;
            if (!res.j || !res.j.ok) { err.textContent = (res.j && res.j.error) || 'Could not post your comment. Please try again.'; return; }
            var c = res.j.comment; try { localStorage.setItem('wr_sc_name', c.name); } catch (e) {}
            var empty = document.getElementById('sc-empty'); if (empty) empty.remove();
            var div = document.createElement('div'); div.className = 'sc-item';
            div.innerHTML = '<div class="sc-meta"><span class="sc-name">' + esc(c.name) + '</span> · <span class="sc-time">just now</span></div><div class="sc-body">' + esc(c.body) + '</div>';
            list.appendChild(div); bodyEl.value = '';
          })
          .catch(function () { btn.disabled = false; err.textContent = 'Could not post your comment. Please try again.'; });
      });
    })();
    </script>`;
}

// Owner email. Shell copied from run-campaign/send-wear-reminders (branded card,
// CTA to /open, unsubscribe line) — "we" voice, nothing personal.
export function buildCommentEmail(
  kind: ShareKind,
  comment: { name: string; body: string },
  label: string | null,
  unsubUrl: string,
): { subject: string; html: string } {
  const what = kind === "collection" ? "watches" : "wishlist";
  const subject = `New comment on your shared ${what}`;
  const linkLine = (label || "").trim()
    ? `<p style="margin:0 0 12px;">On your link <strong>“${esc(label!.trim())}”</strong>:</p>`
    : `<p style="margin:0 0 12px;">On a ${what} link you shared:</p>`;
  const body = `
    <p style="margin:0 0 12px;"><strong>${esc(comment.name)}</strong> left a comment.</p>
    ${linkLine}
    <blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #b8941f;background:#faf7ee;border-radius:6px;white-space:pre-wrap;">${esc(comment.body)}</blockquote>
    <p style="margin:0;">Open WRotate → Shared links to read the thread, reply by sending a new link, or remove the comment. We only email you about this at most every 30 minutes per link — the app always has everything.</p>`;
  const unsubLine = `<a href="${esc(unsubUrl)}" style="color:#b8941f;text-decoration:underline;">Unsubscribe</a> · <a href="https://wrotate.com/open" style="color:#999;text-decoration:underline;">Manage preferences</a>`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #eee;">
          <img src="https://wrotate.com/icon.svg" alt="WRotate" width="40" height="40" style="display:inline-block;border-radius:9px;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:700;color:#b8941f;letter-spacing:.03em;">WRotate</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <div style="font-size:14px;color:#555;line-height:1.6;">${body}</div>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <a href="https://wrotate.com/open?utm_source=email&utm_medium=transactional&utm_campaign=share-comment" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#999;line-height:1.5;">${unsubLine}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}
```

- [ ] **Step 4: Run — expect PASS** (`deno test --allow-read supabase/functions/_shared/share-comments-lib.test.ts`). Then `npm run test:functions` all green.

- [ ] **Step 5: Commit** — `share-comments: pure lib (validation, rate keys, thread/form html, email)`.

---

### Task 3: IO module `_shared/share-comments.ts` + wire into both share functions

**Files:**
- Create: `supabase/functions/_shared/share-comments.ts`
- Modify: `supabase/functions/share-wishlist/index.ts`, `supabase/functions/share-watches/index.ts`
- Modify: `scripts/smoke-test-functions.js`

**Interfaces:**
- Consumes: Task 2 exports; `sendEmail` from `_shared/mailer.ts`; `hmacSign`/`unsubUrl` from `../send-wear-reminders/lib.ts`.
- Produces:
```ts
export async function loadComments(db: any, kind: ShareKind, token: string): Promise<PublicComment[]>;
export async function handleCommentPost(req: Request, db: any, kind: ShareKind, opts: {
  supabaseUrl: string; corsHeaders: Record<string, string>;
  resolveShare: (token: string) => Promise<{ user_id: string; label: string | null } | null>;
}): Promise<Response>;
```

- [ ] **Step 1: Implement** `supabase/functions/_shared/share-comments.ts`:

```ts
// share-comments — the IO half (DB, email). Pure logic is in share-comments-lib.ts.
// Both share pages call handleCommentPost for POST and loadComments for GET.
import { sendEmail } from "./mailer.ts";
import { hmacSign, unsubUrl } from "../send-wear-reminders/lib.ts";
import {
  buildCommentEmail, EMAIL_WINDOW_MS, hashIp, IP_LIMIT, IP_WINDOW_MS, isHoneypotTripped, isRateLimited,
  type PublicComment, rateKeys, resolveIp, type ShareKind, TOKEN_LIMIT, TOKEN_WINDOW_MS, validateComment, windowStartIso,
} from "./share-comments-lib.ts";

const FROM_EMAIL = "WRotate <hello@wrotate.com>";

// deno-lint-ignore no-explicit-any
export async function loadComments(db: any, kind: ShareKind, token: string): Promise<PublicComment[]> {
  const { data } = await db.from("share_comments")
    .select("id, name, body, created_at")
    .eq("kind", kind).eq("token", token).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(200);
  return (data || []) as PublicComment[];
}

// One rate_limits row per (owner, key). Returns true when the caller must be
// refused; otherwise bumps the counter. Failing open on a DB error is deliberate:
// a rate-limit outage must not take the comment box down.
// deno-lint-ignore no-explicit-any
async function checkAndBump(db: any, ownerId: string, key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
  try {
    const ws = windowStartIso(nowMs, windowMs);
    const { data: rl } = await db.from("rate_limits").select("request_count, window_start")
      .eq("user_id", ownerId).eq("function_name", key).maybeSingle();
    if (isRateLimited(rl, ws, limit)) return true;
    if (rl && rl.window_start > ws) {
      await db.from("rate_limits").update({ request_count: rl.request_count + 1 }).eq("user_id", ownerId).eq("function_name", key);
    } else {
      await db.from("rate_limits").upsert({ user_id: ownerId, function_name: key, window_start: new Date(nowMs).toISOString(), request_count: 1 }, { onConflict: "user_id,function_name" });
    }
    return false;
  } catch (_e) { return false; }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
export async function handleCommentPost(req: Request, db: any, kind: ShareKind, opts: {
  supabaseUrl: string;
  corsHeaders: Record<string, string>;
  resolveShare: (token: string) => Promise<{ user_id: string; label: string | null } | null>;
}): Promise<Response> {
  const cors = opts.corsHeaders;
  let payload: { t?: string; name?: unknown; body?: unknown; hp?: unknown } = {};
  try { payload = await req.json(); } catch (_e) { return json({ ok: false, error: "Bad request" }, 400, cors); }
  const token = String(payload.t || new URL(req.url).searchParams.get("t") || "");
  if (!token) return json({ ok: false, error: "This link is no longer available" }, 404, cors);
  const share = await opts.resolveShare(token);
  if (!share) return json({ ok: false, error: "This link is no longer available" }, 404, cors);
  if (isHoneypotTripped(payload.hp)) return json({ ok: true, comment: { id: "0", name: "", body: "", created_at: new Date().toISOString() } }, 200, cors);
  const v = validateComment(payload);
  if (!v.ok) return json({ ok: false, error: v.reason }, 400, cors);

  const now = Date.now();
  const ipHash = await hashIp(resolveIp((n) => req.headers.get(n)));
  const keys = rateKeys(token, ipHash);
  if (await checkAndBump(db, share.user_id, keys.ip, IP_LIMIT, IP_WINDOW_MS, now)
   || await checkAndBump(db, share.user_id, keys.token, TOKEN_LIMIT, TOKEN_WINDOW_MS, now)) {
    return json({ ok: false, error: "Too many comments right now — please try again later" }, 429, cors);
  }

  const { data: inserted, error: insErr } = await db.from("share_comments")
    .insert({ kind, token, owner_id: share.user_id, name: v.name, body: v.body, ip_hash: ipHash })
    .select("id, name, body, created_at").single();
  if (insErr || !inserted) return json({ ok: false, error: "Could not save your comment" }, 500, cors);

  // Bell + push: the notifications INSERT webhook (send-push) does the rest.
  try {
    await db.from("notifications").insert({ user_id: share.user_id, type: "share_comment", actor_id: null, ref_id: inserted.id, is_read: false });
  } catch (e) { console.warn("[share-comments] notification insert failed:", (e as Error)?.message); }

  // Email — owner pref + per-link throttle. Never lets the poster see a failure.
  try {
    const { data: prof } = await db.from("profiles").select("email_prefs").eq("id", share.user_id).maybeSingle();
    const prefs = (prof?.email_prefs || {}) as Record<string, unknown>;
    if (prefs.share_comments !== false && !(await checkAndBump(db, share.user_id, keys.email, 1, EMAIL_WINDOW_MS, now))) {
      const { data: au } = await db.auth.admin.getUserById(share.user_id);
      const to = au?.user?.email;
      if (to) {
        const unsubKey = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const sig = await hmacSign(share.user_id, "share_comments", unsubKey);
        const { subject, html } = buildCommentEmail(kind, { name: v.name, body: v.body }, share.label, unsubUrl(opts.supabaseUrl, share.user_id, sig, "share_comments"));
        const r = await sendEmail({ from: FROM_EMAIL, to: [to], subject, html });
        if (!r.ok) console.warn("[share-comments] email failed:", r.error);
      }
    }
  } catch (e) { console.warn("[share-comments] email step failed:", (e as Error)?.message); }

  return json({ ok: true, comment: inserted }, 200, cors);
}
```

- [ ] **Step 2: Wire `share-wishlist/index.ts`**
  - Change `CORS_HEADERS` methods to `"GET, POST, OPTIONS"`.
  - Add import: `import { handleCommentPost, loadComments } from "../_shared/share-comments.ts";` and `import { commentsSectionHtml } from "../_shared/share-comments-lib.ts";`
  - Add a light resolver (above `serve`):
    ```ts
    // deno-lint-ignore no-explicit-any
    async function resolveShare(db: any, token: string) {
      const { data, error } = await db.from("wishlist_shares").select("user_id, label, revoked_at").eq("token", token).maybeSingle();
      return isShareUsable(data, error) ? { user_id: data.user_id as string, label: (data.label ?? null) as string | null } : null;
    }
    ```
  - In `serve`, after the OPTIONS branch and after `db` is created:
    ```ts
    if (req.method === "POST") {
      return handleCommentPost(req, db, "wishlist", { supabaseUrl, corsHeaders: CORS_HEADERS, resolveShare: (t) => resolveShare(db, t) });
    }
    ```
    (Move the `const db = createClient(...)` lines above this if needed.)
  - In the success page body, after the grid/empty-state and before `<div class="foot">`, insert:
    ```ts
    ${commentsSectionHtml("wishlist", token, await loadComments(db, "wishlist", token), Date.now())}
    ```
    (`body` becomes built after an `await`; convert to `const comments = await loadComments(...)` before the template if simpler.)

- [ ] **Step 3: Wire `share-watches/index.ts`** — identical changes with `"collection"`, table `collection_shares`, and `commentsSectionHtml("collection", …)`.

- [ ] **Step 4: Type-check both**: `deno check supabase/functions/share-wishlist/index.ts supabase/functions/share-watches/index.ts` → 0 errors.

- [ ] **Step 5: Smoke tests** — append to `scripts/smoke-test-functions.js` after the share-watches block:
```js
  // Comment POSTs: an unknown token must resolve to nothing; an empty body must
  // be refused with a reason, on both share pages.
  for (const fn of ['share-wishlist', 'share-watches']) {
    await check(`${fn} (comment POST bad token → 404)`, async () => {
      const r = await callFn(`${fn}?t=nope`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: 'nope', name: 'A', body: 'b' }) });
      return { ...r, ok: r.status === 404 };
    });
  }
```
(Confirm `callFn` accepts `{method, headers, body}` — it does for identify-watch.)

- [ ] **Step 6: Deploy (needs go-ahead)**: `npx supabase functions deploy share-wishlist --no-verify-jwt && npx supabase functions deploy share-watches --no-verify-jwt && npm run test:smoke`.

- [ ] **Step 7: Real-path check (test accounts only)**: insert a `collection_shares` row for `testuser` (as in the earlier UAT), `curl -X POST` a comment, then verify: `share_comments` row exists, `notifications` row type `share_comment` exists for testuser, page GET shows the comment, a second POST within 30 min sends no second email (rate_limits row `share-comment-email:<token>` = 1). Delete the rows afterwards (`share_comments`, `notifications`, `collection_shares`, the `rate_limits` keys).

- [ ] **Step 8: Commit** — `share-comments: POST + thread on both share pages; smoke checks`.

---

### Task 4: `send-push` — message + route for `share_comment`

**Files:**
- Modify: `supabase/functions/send-push/lib.ts` (`buildMessage`, `buildRoute`), `supabase/functions/send-push/index.ts`
- Test: `supabase/functions/send-push/lib.test.ts`, `tests/push-route.test.js`, `wrotate_test.js`

**Interfaces:**
- Produces: `notificationOpensShareLinks(type)` in `wrotate_test.js` (true only for `share_comment`).

- [ ] **Step 1: Failing Deno tests** — append to `supabase/functions/send-push/lib.test.ts`:
```ts
Deno.test("share_comment pushes the commenter's name and routes to the bell", () => {
  assertEquals(buildMessage("share_comment", "Sarah", "c1"), { title: "WRotate", body: "Sarah commented on a link you shared" });
  assertEquals(buildRoute("share_comment", "c1", null), { route: "bell", id: null });
});
```
- [ ] **Step 2: Failing vitest** — in `tests/push-route.test.js` add `'share_comment'` to `ALL_TYPES`, import `notificationOpensShareLinks` from `../wrotate_test.js`, and add:
```js
  it('share_comment opens the Shared-links modal in the panel and goes to the bell on push', () => {
    expect(notificationOpensShareLinks('share_comment')).toBe(true);
    expect(notificationOpensShareLinks('comment')).toBe(false);
    expect(buildRoute('share_comment', 'c1', null)).toEqual({ route: 'bell', id: null });
  });
```
- [ ] **Step 3: Run both — expect FAIL** (message is the generic fallback; helper missing).
- [ ] **Step 4: Implement**
  - `lib.ts` `buildMessage`: add `case "share_comment": return { title, body: \`${actorName} commented on a link you shared\` };`
  - `lib.ts` `buildRoute`: add `case "share_comment":` to the comment block above `default` (falls to bell; comment: the panel opens a modal, not a post/profile/club).
  - `index.ts`: after the `actor_id` lookup block add:
    ```ts
    // Share-link comments have no actor row — the typed name lives on the comment.
    if (type === "share_comment" && ref_id) {
      const { data: c } = await supabase.from("share_comments").select("name").eq("id", ref_id).maybeSingle();
      if (c?.name) actorName = c.name;
    }
    ```
  - `wrotate_test.js` next to `notificationOpensBadgeWall`:
    ```js
    /** Returns true for types that tap-open the Shared-links modal (share-link comments). */
    export function notificationOpensShareLinks(type) {
      return type === 'share_comment';
    }
    ```
- [ ] **Step 5: Run — expect PASS**: `deno test --allow-read supabase/functions/send-push/` and `npx vitest run tests/push-route.test.js`.
- [ ] **Step 6: Deploy `send-push` (go-ahead)** `npx supabase functions deploy send-push --no-verify-jwt && npm run test:smoke`.
- [ ] **Step 7: Commit** — `send-push: share_comment message/route`.

---

### Task 5: Client — bell rows for `share_comment`

**Files:**
- Modify: `index.html` (`loadNotifications` ~10733, `renderNotificationPanel` ~11134–11230), `wrotate_test.js` (`notificationBody`), `sw.js`
- Test: `tests/notifications.test.js`, `e2e/notifications-share-comment.mock.spec.js`

**Interfaces:**
- Consumes: `userNotifs[i].shareComment = { id, kind, token, name, body } | null`.
- Produces: `openShareCommentsFromNotif(refId)` (index.html) → opens the Wishlist or Collection Shared-links modal with that token's thread expanded (Task 6 implements the modal part; this task defines the function and a no-op-safe call).

- [ ] **Step 1: Failing unit test** — append to `tests/notifications.test.js`:
```js
describe('share_comment body', () => {
  it('names the commenter and the link kind', () => {
    expect(notificationBody('share_comment', 'Sarah', { shareKind: 'wishlist' })).toBe('Sarah commented on your shared wishlist link');
    expect(notificationBody('share_comment', 'Sarah', { shareKind: 'collection' })).toBe('Sarah commented on your shared collection link');
    expect(notificationBody('share_comment', '', {})).toBe('Someone commented on your shared wishlist link');
  });
});
```
- [ ] **Step 2: Run — FAIL** (`npx vitest run tests/notifications.test.js`, returns '').
- [ ] **Step 3: Implement in `wrotate_test.js` `notificationBody`** (before `default`):
```js
    case 'share_comment':
      return `${nm} commented on your shared ${opts.shareKind === 'collection' ? 'collection' : 'wishlist'} link`;
```
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Client wiring in `index.html`**
  - `loadNotifications`, inside the enrichment `try` after the clubs block:
    ```js
    const scIds = [...new Set(rows.filter(n => n.type === 'share_comment' && n.ref_id).map(n => n.ref_id))];
    var scMap = {};
    if (scIds.length) {
      const { data: scs } = await db.from('share_comments').select('id, kind, token, name, body').in('id', scIds);
      (scs || []).forEach(c => scMap[c.id] = c);
    }
    ```
    and change the map line to `userNotifs = rows.map(n => ({ ...n, actor: pMap[n.actor_id] || null, club: clubMap[n.ref_id] || null, shareComment: (typeof scMap !== 'undefined' && scMap[n.ref_id]) || null }));` (declare `let scMap = {};` next to `pMap` instead of `var` for clarity).
  - `renderNotificationPanel`: `const nm = escHtml(n.type === 'share_comment' ? (n.shareComment?.name || 'Someone') : (n.actor?.display_name || n.actor?.username || 'Someone'));`
    Body ternary: add `: n.type === 'share_comment' ? \`${nm} commented on your shared ${n.shareComment?.kind === 'collection' ? 'collection' : 'wishlist'} link\``.
    `notifClick`: add before the final fallback: `: n.type === 'share_comment' ? \`toggleNotifPanel();openShareCommentsFromNotif('${n.ref_id}')\``.
    Avatar: `const avatarHtml = n.type === 'badge_earned' ? … : n.type === 'share_comment' ? \`<div class="feed-user-avatar" style="width:36px;height:36px;font-size:1.1rem;flex-shrink:0;display:flex;align-items:center;justify-content:center;">💬</div>\` : …`
  - New function (near the share-links code):
    ```js
    // A bell row for a share-link comment opens the matching Shared-links modal
    // with that link's thread expanded. Kind/token come from the enriched row.
    function openShareCommentsFromNotif(refId) {
      const n = userNotifs.find(x => x.ref_id === refId && x.type === 'share_comment');
      const sc = n && n.shareComment;
      if (!sc) { toast('That comment is no longer available'); return; }
      _shareThreadOpen = sc.token;
      if (sc.kind === 'collection') openCollectionShareLinks(); else openWishlistShareLinks();
    }
    ```
    (`_shareThreadOpen` is defined in Task 6; add `let _shareThreadOpen = null;` in this task so the function is safe.)
- [ ] **Step 6: E2E** `e2e/notifications-share-comment.mock.spec.js`:
```js
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot, SAMPLE_WATCHES, SAMPLE_LOGS } from './helpers.js';

test('a share_comment notification names the commenter and opens Shared links', async ({ page }) => {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS });
  await page.route('**/rest/v1/notifications*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'n1', type: 'share_comment', actor_id: null, ref_id: 'c1', is_read: false, created_at: '2026-08-22T10:00:00Z' },
  ]) }));
  await page.route('**/rest/v1/share_comments*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'c1', kind: 'collection', token: 'tok1', name: 'Sarah', body: 'Is the GMT available?', created_at: '2026-08-22T10:00:00Z' },
  ]) }));
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(() => loadNotifications().then(() => toggleNotifPanel()));
  await expect(page.locator('#notif-n1')).toContainText('Sarah commented on your shared collection link');
  await page.click('#notif-n1');
  await expect(page.locator('#coll-share-modal')).toBeVisible();
});
```
  Check `helpers.js` for the notifications panel element ids (`toggleNotifPanel` exists at ~11115). Run: `npx playwright test e2e/notifications-share-comment.mock.spec.js` → PASS (the modal opens even before Task 6 renders threads).
- [ ] **Step 7: SW bump** (`wristlog-v1109`), `npm test`, commit — `bell: share_comment rows`.

---

### Task 6: Client — threads in both Shared-links modals (count, expand, delete)

**Files:**
- Modify: `index.html` (`renderWishlistShareLinks`, `renderCollectionShareLinks`, `loadWishlistShareLinks`, `loadCollectionShareLinks`, `_shareThreadOpen`), `wrotate_test.js`, `tests/mirror-drift.test.js`, `sw.js`
- Test: `tests/share-comments-client.test.js`, `e2e/collection-share.mock.spec.js`, `e2e/wishlist-share.mock.spec.js`, `e2e/helpers.js`

**Interfaces:**
- Produces (mirrored, VERBATIM): `groupCommentsByToken(rows)` → `Map<token, rows[]>` preserving input order; `shareThreadHtml(token, comments, kind)` → HTML string (index.html only, not mirrored — uses `escHtml`).
- State: `_shareComments = { wishlist: [], collection: [] }`, `_shareThreadOpen` (token|null).

- [ ] **Step 1: Failing unit test** `tests/share-comments-client.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { groupCommentsByToken } from '../wrotate_test.js';

describe('groupCommentsByToken', () => {
  it('groups by token preserving order and skips soft-deleted rows', () => {
    const rows = [
      { id: '1', token: 'a', name: 'X', body: 'b1', created_at: '2026-08-22T09:00:00Z' },
      { id: '2', token: 'b', name: 'Y', body: 'b2', created_at: '2026-08-22T09:01:00Z' },
      { id: '3', token: 'a', name: 'Z', body: 'b3', created_at: '2026-08-22T09:02:00Z', deleted_at: '2026-08-22T10:00:00Z' },
      { id: '4', token: 'a', name: 'W', body: 'b4', created_at: '2026-08-22T09:03:00Z' },
    ];
    const g = groupCommentsByToken(rows);
    expect([...g.keys()]).toEqual(['a', 'b']);
    expect(g.get('a').map(r => r.id)).toEqual(['1', '4']);
    expect(g.get('b').map(r => r.id)).toEqual(['2']);
  });
  it('returns an empty map for no rows', () => {
    expect(groupCommentsByToken(null).size).toBe(0);
  });
});
```
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement in `wrotate_test.js`** (after `collSharePrivateCount`) and byte-identically in `index.html` (after `collSharePrivateCount`), then register `'groupCommentsByToken'` in `tests/mirror-drift.test.js` VERBATIM:
```js
// Comments on share links, grouped per link for the Shared-links list. Soft-
// deleted rows are dropped here so every caller sees the same thread.
function groupCommentsByToken(rows) {
  const map = new Map();
  for (const r of (rows || [])) {
    if (!r || r.deleted_at) continue;
    if (!map.has(r.token)) map.set(r.token, []);
    map.get(r.token).push(r);
  }
  return map;
}
```
(`export` keyword in wrotate_test.js only — mirror-drift compares bodies.)
- [ ] **Step 4: Run — PASS** (`npx vitest run tests/share-comments-client.test.js tests/mirror-drift.test.js`).
- [ ] **Step 5: Client wiring in `index.html`**
  - State near `_collShareLinks`: `let _shareComments = { wishlist: [], collection: [] };` (and `_shareThreadOpen` from Task 5).
  - Loader (one function, both kinds):
    ```js
    async function loadShareComments(kind) {
      if (!currentUser) return;
      try {
        const { data, error } = await db.from('share_comments')
          .select('id, token, name, body, created_at, deleted_at')
          .eq('kind', kind).eq('owner_id', currentUser.id).is('deleted_at', null)
          .order('created_at', { ascending: true }).limit(500);
        if (error) throw error;
        _shareComments[kind] = data || [];
      } catch (e) {
        console.warn('[share] comments load failed:', e && e.message);
        _shareComments[kind] = [];
      }
    }
    ```
  - In `loadWishlistShareLinks` and `loadCollectionShareLinks`: call `await loadShareComments('wishlist' | 'collection')` before `render…ShareLinks()`.
  - Thread renderer:
    ```js
    function shareThreadHtml(kind, token, comments) {
      if (!comments.length) return '';
      return `<div class="share-thread" data-token="${escAttr(token)}">${comments.map(c => `
        <div style="display:flex;gap:.5rem;align-items:flex-start;padding:.4rem 0;border-top:1px dashed var(--border);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:.72rem;color:var(--muted);"><strong style="color:var(--text);">${escHtml(c.name)}</strong> · ${escHtml(formatFeedDate(c.created_at || ''))}</div>
            <div style="font-size:.82rem;white-space:pre-wrap;word-break:break-word;">${escHtml(c.body)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-delete-comment="${escAttr(c.id)}" onclick="deleteShareComment('${kind}','${escAttr(c.id)}')">Delete</button>
        </div>`).join('')}</div>`;
    }
    function toggleShareThread(kind, token) {
      _shareThreadOpen = _shareThreadOpen === token ? null : token;
      if (kind === 'collection') renderCollectionShareLinks(); else renderWishlistShareLinks();
    }
    async function deleteShareComment(kind, id) {
      try {
        const { error } = await db.from('share_comments').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('owner_id', currentUser.id);
        if (error) throw error;
      } catch (e) {
        console.warn('[share] comment delete failed:', e && e.message);
        toast('Could not delete that comment', 'error');
        return;
      }
      _shareComments[kind] = _shareComments[kind].filter(c => c.id !== id);
      if (kind === 'collection') renderCollectionShareLinks(); else renderWishlistShareLinks();
      toast('Comment removed');
    }
    ```
  - In both `render…ShareLinks`, inside the row template after the "N watches · N views" line, add the count chip and the thread:
    ```js
    ${(() => { const th = groupCommentsByToken(_shareComments[KIND]).get(s.token) || []; return th.length
      ? `<button class="btn btn-ghost btn-sm" style="padding:.1rem .45rem;font-size:.68rem;" data-thread="${escAttr(s.token)}" onclick="toggleShareThread('${KIND}','${escAttr(s.token)}')">${th.length} comment${th.length !== 1 ? 's' : ''}${_shareThreadOpen === s.token ? ' ▴' : ' ▾'}</button>`
      : ''; })()}
    ```
    and after the row's flex container: `${_shareThreadOpen === s.token ? shareThreadHtml(KIND, s.token, groupCommentsByToken(_shareComments[KIND]).get(s.token) || []) : ''}` — wrap each row + its thread in one `<div>` so the thread sits under its link. `KIND` = `'wishlist'` / `'collection'` literal in each function.
- [ ] **Step 6: E2E** — `e2e/helpers.js`: add a default route for `share_comments` returning `[]` (PATCH → `[]` too). Append to `e2e/collection-share.mock.spec.js`:
```js
test('Shared links shows comment counts, expands the thread, and deletes a comment', async ({ page }) => {
  await openCollection(page);
  await mockMint(page);
  await page.route('**/rest/v1/share_comments*', route => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'c1', token: 'existingtoken000000000000000002', name: 'Sarah', body: 'Is the GMT available?', created_at: '2026-08-22T10:00:00Z', deleted_at: null },
      { id: 'c2', token: 'existingtoken000000000000000002', name: 'Tom', body: 'Lovely set', created_at: '2026-08-22T11:00:00Z', deleted_at: null },
    ]) });
  });
  await page.click('#coll-share-btn');
  await page.click('#coll-share-links');
  await expect(page.locator('[data-thread="existingtoken000000000000000002"]')).toContainText('2 comments');
  await page.click('[data-thread="existingtoken000000000000000002"]');
  await expect(page.locator('.share-thread')).toContainText('Is the GMT available?');
  await page.click('[data-delete-comment="c1"]');
  await expect(page.locator('.share-thread')).not.toContainText('Is the GMT available?');
  await expect(page.locator('[data-thread="existingtoken000000000000000002"]')).toContainText('1 comment');
});
```
  Mirror the same test in `e2e/wishlist-share.mock.spec.js` with `#wl-share-btn`, `#wl-share-links`, token `existingtoken000000000000000001`.
- [ ] **Step 7: Run** both specs + `npm test` + `npm run test:coverage` → green. SW bump (`v1110` if Task 5 already bumped; else `v1109`). Commit — `shared links: comment counts, threads, delete`.

---

### Task 7: Settings toggle, Help, What's New, full verification, ship

**Files:**
- Modify: `index.html` (profile Notifications toggles ~9066; Help Wishlist step 6 + Collection step 6; What's New top entry), `sw.js`

- [ ] **Step 1: Email toggle** — in the profile Notifications section after `${tog('clubs','Club activity')}` add `${tog('share_comments','Comments on links I shared')}` — but `tog` reads `ep[key] ? 'checked' : ''`, which would render a missing key as OFF; use the reminders pattern instead:
```js
          <div class="toggle-row">
            <span class="toggle-label">Comments on links I shared</span>
            <label class="toggle-switch">
              <input type="checkbox" ${ep.share_comments !== false ? 'checked' : ''} onchange="saveEmailPref('share_comments',this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
```
  Also add `share_comments: true` to the two default-prefs object literals (`saveEmailPref` and the profile render).
- [ ] **Step 2: Help** — Wishlist step 6 and Collection step 6 descriptions: append `&nbsp;Anyone with the link can also leave a <strong>comment</strong> with their name &#8212; you&#8217;ll see it in <strong>Shared links</strong> and the bell (and by email, unless you turn that off under Notifications).`
- [ ] **Step 3: What's New** — new top entry:
```html
      <div style="margin-bottom:.75rem;">
        <div style="font-size:.85rem;font-weight:600;margin-bottom:.25rem;">Comments on Shared Links</div>
        <div style="font-size:.8rem;color:var(--muted);line-height:1.55;">People you send a wishlist or collection link to can now leave a comment with their name &#8212; no account needed. Comments show on the link page for everyone who has it, and you see them under <strong>Shared links</strong> on the Wishlist and Collection tabs, in the bell, as a push, and by email (one per link per half hour; switch the email off under Notifications). You can remove any comment, or revoke the link.</div>
      </div>
```
- [ ] **Step 4: SW bump**, then full gates: `npm test && npm run test:coverage && npm run test:functions && npm run test:e2e` → all green.
- [ ] **Step 5: Commit** — `share-comments: settings toggle, help, what's new`.
- [ ] **Step 6: Ship (go-ahead)** — `git push origin main`; wait for prod to serve the new SW version; final real-path check on prod with the test account (post one comment on a testuser link, confirm bell row + email to test@wrotate.com, delete the rows).
