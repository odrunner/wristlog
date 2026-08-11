# Wishlist Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user tick individual wishlist watches or whole brand folders and send them as a revocable public link — a page showing photo, brand, model and reference only.

**Architecture:** A `wishlist_shares` table stores one row per minted link (token, owner, frozen item id list, label, view counters). A `share-wishlist` Deno edge function renders the public page and its og:image on the service-role key. `index.html` gains a selection mode on the Wishlist page plus a share sheet and a shared-links manager. An `admin_wishlist_share_stats()` RPC feeds new rows in the admin Totals card.

**Tech Stack:** Vanilla JS (no frameworks), Supabase Postgres + RLS, Deno edge functions, vitest (unit), deno test (edge function libs), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-08-11-wishlist-sharing-design.md`

## Global Constraints

- **Vanilla JS only.** No frameworks, no build step. `index.html` is a single file.
- **No `confirm()` / `alert()`.** Use the existing `toast()` and inline modal patterns.
- **Pure logic is duplicated on purpose.** Testable functions live in `wrotate_test.js` (imported by vitest) *and* are mirrored verbatim into `index.html`. `groupWishlistByBrand` is the existing example of this pattern. Both copies must stay identical.
- **Coverage gate:** vitest enforces 99% statements/functions/lines and 94% branches on `wrotate_test.js` only. Every branch of a new function there needs a test.
- **`wishlist.id` is TEXT, not uuid.** `logs.id` is TEXT too. Only `user_id` columns are uuid.
- **Edge functions deploy with `--no-verify-jwt`** and `npm run test:smoke` runs after every deploy.
- **Email/CTA links use `https://wrotate.com/open`,** never the bare root — `apple-app-site-association` excludes `/`.
- **Migrations do not push.** Apply SQL with `npx supabase db query --linked --file -` and keep the file in `sql/`.
- **New RPCs need `NOTIFY pgrst, 'reload schema';`** or PostgREST 404s them.
- **Admin RPCs gate on `is_admin` and exclude `internal_accounts`** — never hardcode UUIDs.
- **Pre-commit hook runs `git add index.html` unconditionally.** Before each commit, run `git diff HEAD -- index.html` and confirm every hunk is yours; unfamiliar hunks are the user's own edits and must not be swept in.
- **Do not run `git push`.** Commit only; the user decides when to deploy.

---

### Task 1: `wishlist_shares` table

**Files:**
- Create: `sql/2026-08-11-wishlist-shares.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.wishlist_shares` with columns `token text pk`, `user_id uuid`, `label text`, `item_ids text[]`, `views int default 0`, `last_viewed_at timestamptz`, `created_at timestamptz default now()`, `revoked_at timestamptz`. Owner-scoped RLS for select/insert/update/delete.

- [ ] **Step 1: Write the SQL file**

Create `sql/2026-08-11-wishlist-shares.sql`:

```sql
-- Wishlist sharing: one row per minted link.
--
-- Possession of the token IS the authorisation, exactly as in recap_shares
-- (sql/2026-08-08-recap-shares-and-feedback.sql). A wishlist share is often sent
-- by someone whose wishlist is Followers-only or Private, to a recipient with no
-- WRotate account at all — a guessable ?u=<username> URL cannot carry that.
--
-- item_ids is FROZEN at mint time. The item CONTENTS are read live by the edge
-- function, so a corrected reference reaches a link already sent, but a watch
-- added to that brand tomorrow does not.
--
-- wishlist.id is TEXT (app-generated ids), so item_ids is text[], not uuid[].

create table if not exists public.wishlist_shares (
  token          text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,
  item_ids       text[] not null,
  views          integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

create index if not exists wishlist_shares_user_idx
  on public.wishlist_shares (user_id, created_at desc);
create index if not exists wishlist_shares_created_idx
  on public.wishlist_shares (created_at);

alter table public.wishlist_shares enable row level security;

-- Owner-scoped only. The public page is served by the edge function on the
-- service-role key, which bypasses RLS, so there is no anon policy here.
drop policy if exists wishlist_shares_insert_own on public.wishlist_shares;
create policy wishlist_shares_insert_own on public.wishlist_shares
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists wishlist_shares_select_own on public.wishlist_shares;
create policy wishlist_shares_select_own on public.wishlist_shares
  for select to authenticated using (user_id = auth.uid());

-- UPDATE exists so the owner can revoke.
drop policy if exists wishlist_shares_update_own on public.wishlist_shares;
create policy wishlist_shares_update_own on public.wishlist_shares
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists wishlist_shares_delete_own on public.wishlist_shares;
create policy wishlist_shares_delete_own on public.wishlist_shares
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it to the remote database**

```bash
cd "/Users/ozgurdogan/Documents/Claude project/watch tracker"
npx supabase db query --linked --file sql/2026-08-11-wishlist-shares.sql
```

Expected: no error. (Migration push does not work on this project — remote-only migrations.)

- [ ] **Step 3: Verify the table and its policies exist**

```bash
npx supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='wishlist_shares' ORDER BY ordinal_position;"
npx supabase db query --linked "SELECT policyname, cmd FROM pg_policies WHERE tablename='wishlist_shares';"
```

Expected: 8 columns, `item_ids` reported as `ARRAY`; four policies (`wishlist_shares_insert_own`, `_select_own`, `_update_own`, `_delete_own`).

- [ ] **Step 4: Verify RLS actually isolates owners**

```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}', true);
set local role authenticated;
select count(*) as visible_rows from public.wishlist_shares;"
```

Expected: `0` — a signed-in user with no shares sees nothing, proving the select policy is scoped rather than open.

- [ ] **Step 5: Commit**

```bash
git add sql/2026-08-11-wishlist-shares.sql
git commit -m "db: wishlist_shares table for revocable wishlist share links"
```

---

### Task 2: `share-wishlist` edge function library

**Files:**
- Create: `supabase/functions/share-wishlist/lib.ts`
- Create: `supabase/functions/share-wishlist/lib.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no Deno IO).
- Produces, all exported from `lib.ts`:
  - `type ShareWatch = { id: string; brand?: string | null; name?: string | null; ref?: string | null; image?: string | null }`
  - `esc(s: string): string`
  - `initials(brand: string, name: string): string`
  - `avatarInnerHtml(avatarUrl: string | null | undefined, displayName: string): string`
  - `isShareUsable(row: { revoked_at?: string | null } | null | undefined, err: unknown): boolean`
  - `wishlistCardsHtml(items: ShareWatch[]): string`
  - `buildWishlistOg(displayName: string, label: string | null | undefined, items: ShareWatch[]): { ogTitle: string; ogDescription: string }`
  - `generateWishlistOgSvg(displayName: string, items: ShareWatch[]): string`
  - `htmlPage(title: string, description: string, imageUrl: string, canonicalUrl: string, bodyHtml: string): string`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/share-wishlist/lib.test.ts`:

```ts
import { assertEquals, assertMatch, assertNotMatch, assertStringIncludes } from "jsr:@std/assert";
import {
  avatarInnerHtml,
  buildWishlistOg,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  initials,
  isShareUsable,
  wishlistCardsHtml,
} from "./lib.ts";

const W = (id: string, brand: string, name: string, ref = "", image: string | null = null) =>
  ({ id, brand, name, ref, image });

Deno.test("isShareUsable accepts a live row", () => {
  assertEquals(isShareUsable({ revoked_at: null }, null), true);
});

Deno.test("isShareUsable refuses a revoked, missing or errored row", () => {
  assertEquals(isShareUsable({ revoked_at: "2026-08-11T10:00:00Z" }, null), false);
  assertEquals(isShareUsable(null, null), false);
  assertEquals(isShareUsable(undefined, null), false);
  assertEquals(isShareUsable({ revoked_at: null }, new Error("boom")), false);
});

Deno.test("wishlistCardsHtml renders brand, model and reference", () => {
  const html = wishlistCardsHtml([W("1", "Rolex", "Cosmograph Daytona", "126519LN")]);
  assertStringIncludes(html, "Rolex");
  assertStringIncludes(html, "Cosmograph Daytona");
  assertStringIncludes(html, "126519LN");
});

// The whole point of the feature's privacy promise: a dealer link must never
// carry what the owner is willing to pay, what the market says, or their notes.
// The function takes only the four whitelisted fields, so extra keys on the
// input object can never reach the markup.
Deno.test("wishlistCardsHtml never emits price, market value, notes, tags or the saved URL", () => {
  const html = wishlistCardsHtml([
    // deno-lint-ignore no-explicit-any
    ({
      id: "1", brand: "Rolex", name: "Daytona", ref: "126519LN", image: null,
      price: 42700, market_price: 51000, notes: "birthday present",
      tags: ["grail"], url: "https://chrono24.com/x", wish_privacy: "private",
    } as any),
  ]);
  assertNotMatch(html, /42700/);
  assertNotMatch(html, /51000/);
  assertNotMatch(html, /birthday present/);
  assertNotMatch(html, /grail/);
  assertNotMatch(html, /chrono24/);
  assertNotMatch(html, /private/);
});

Deno.test("wishlistCardsHtml escapes every field it renders", () => {
  const html = wishlistCardsHtml([W("1", '<script>x</script>', '"quoted"', "<b>ref</b>")]);
  assertNotMatch(html, /<script>/);
  assertNotMatch(html, /<b>ref<\/b>/);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("wishlistCardsHtml falls back to initials when a watch has no photo", () => {
  const html = wishlistCardsHtml([W("1", "Grand Seiko", "Snowflake")]);
  assertStringIncludes(html, "GS");
  assertNotMatch(html, /<img/);
});

Deno.test("wishlistCardsHtml handles an empty list", () => {
  assertEquals(wishlistCardsHtml([]), "");
});

Deno.test("buildWishlistOg names the owner and counts the watches", () => {
  const { ogTitle, ogDescription } = buildWishlistOg("Ozgur", null, [
    W("1", "Rolex", "Daytona"), W("2", "Omega", "Speedmaster"),
  ]);
  assertEquals(ogTitle, "Ozgur's wishlist — WRotate");
  assertStringIncludes(ogDescription, "2 watches");
  assertStringIncludes(ogDescription, "Rolex Daytona");
});

Deno.test("buildWishlistOg singularises a one-watch share", () => {
  const { ogDescription } = buildWishlistOg("Ozgur", null, [W("1", "Rolex", "Daytona")]);
  assertStringIncludes(ogDescription, "1 watch");
  assertNotMatch(ogDescription, /1 watches/);
});

Deno.test("buildWishlistOg puts the label in the description when set", () => {
  const { ogDescription } = buildWishlistOg("Ozgur", "Watches of Switzerland", [W("1", "Rolex", "Daytona")]);
  assertStringIncludes(ogDescription, "Watches of Switzerland");
});

Deno.test("buildWishlistOg survives an empty share", () => {
  const { ogTitle, ogDescription } = buildWishlistOg("Ozgur", null, []);
  assertEquals(ogTitle, "Ozgur's wishlist — WRotate");
  assertStringIncludes(ogDescription, "0 watches");
});

Deno.test("generateWishlistOgSvg returns a 1200x630 SVG", () => {
  const svg = generateWishlistOgSvg("Ozgur", [W("1", "Rolex", "Daytona")]);
  assertMatch(svg, /^<svg/);
  assertStringIncludes(svg, 'width="1200"');
  assertStringIncludes(svg, 'height="630"');
});

Deno.test("generateWishlistOgSvg still renders with no watches", () => {
  const svg = generateWishlistOgSvg("Ozgur", []);
  assertMatch(svg, /^<svg/);
  assertStringIncludes(svg, "No watches");
});

// A dealer link in a search result would be a privacy failure, so every page
// this function serves carries the robots directive.
Deno.test("htmlPage tells crawlers not to index", () => {
  const html = htmlPage("t", "d", "i", "c", "<p>body</p>");
  assertStringIncludes(html, '<meta name="robots" content="noindex,nofollow">');
});

Deno.test("htmlPage escapes the metadata it interpolates", () => {
  const html = htmlPage('a"b', "d", "i", "c", "<p>body</p>");
  assertStringIncludes(html, "a&quot;b");
});

Deno.test("esc escapes the five HTML-significant characters", () => {
  assertEquals(esc('<&>"'), "&lt;&amp;&gt;&quot;");
});

Deno.test("initials takes two letters and copes with blanks", () => {
  assertEquals(initials("Grand", "Seiko"), "GS");
  assertEquals(initials("", ""), "?");
});

Deno.test("avatarInnerHtml uses the photo when present, initials otherwise", () => {
  assertStringIncludes(avatarInnerHtml("https://x/a.jpg", "Ozgur Dogan"), "<img");
  assertEquals(avatarInnerHtml(null, "Ozgur Dogan"), "OD");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:functions
```

Expected: FAIL — `Module not found ... share-wishlist/lib.ts`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/share-wishlist/lib.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:functions
```

Expected: PASS, all share-wishlist tests green, and the other functions' tests still green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/share-wishlist/lib.ts supabase/functions/share-wishlist/lib.test.ts
git commit -m "share-wishlist: page + og:image builders, with price kept out of the markup"
```

---

### Task 3: `share-wishlist` edge function endpoint

**Files:**
- Create: `supabase/functions/share-wishlist/index.ts`
- Modify: `scripts/smoke-test-functions.js` (add cases beside the existing `share-recap` ones, around line 88-111)

**Interfaces:**
- Consumes: everything exported by `share-wishlist/lib.ts` (Task 2); the `wishlist_shares` table (Task 1).
- Produces: `GET https://api.wrotate.com/functions/v1/share-wishlist?t=<token>` → HTML; `&img=1` → SVG. This URL shape is what Task 6 builds client-side.

- [ ] **Step 1: Write the endpoint**

Create `supabase/functions/share-wishlist/index.ts`:

```ts
// Supabase Edge Function: share-wishlist
// GET /share-wishlist?t=<token>        → HTML page listing the shared watches
// GET /share-wishlist?t=<token>&img=1  → SVG og:image
//
// The recipient is typically NOT a WRotate user — an authorised dealer, or
// someone shopping for a gift. Possession of the token IS the authorisation:
// the owner minted it and sent it, so unlike share-collection this path applies
// no profile-privacy gate. Guessing a token is the only way in, and that is a
// UUID's worth of entropy.
//
// What the page may show is deliberately narrow: photo, brand, model, reference.
// Price, market value, notes, tags and the saved URL are not even selected.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  avatarInnerHtml,
  buildWishlistOg,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  isShareUsable,
  type ShareWatch,
  wishlistCardsHtml,
} from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type ShareRow = {
  user_id: string;
  label: string | null;
  item_ids: string[];
  revoked_at: string | null;
};

// deno-lint-ignore no-explicit-any
async function fetchShareData(db: any, token: string) {
  const { data: share, error: shareErr } = await db
    .from("wishlist_shares")
    .select("user_id, label, item_ids, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!isShareUsable(share, shareErr)) return null;
  const row = share as ShareRow;

  const { data: profile, error: profErr } = await db
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", row.user_id)
    .maybeSingle();
  if (profErr || !profile) return null;

  // user_id is not redundant next to the id filter: it guarantees a token can
  // never surface a row belonging to anyone but its owner, whatever ids the
  // array happens to contain.
  const { data: itemRows } = await db
    .from("wishlist")
    .select("id, brand, name, ref, image, sort_order")
    .eq("user_id", row.user_id)
    .in("id", row.item_ids.length ? row.item_ids : ["__none__"])
    .order("sort_order", { ascending: true });

  const items = (itemRows || []).map((w: ShareWatch & { sort_order?: number }) => ({
    id: w.id, brand: w.brand, name: w.name, ref: w.ref, image: w.image,
  })) as ShareWatch[];

  return { profile, items, label: row.label };
}

// Fire-and-forget. A counter that fails must never cost the recipient the page.
// deno-lint-ignore no-explicit-any
async function bumpViews(db: any, token: string) {
  try {
    await db.rpc("bump_wishlist_share_view", { p_token: token });
  } catch (_e) { /* ignore */ }
}

function statePage(supabaseUrl: string, title: string, icon: string, heading: string, sub: string) {
  return htmlPage(
    title,
    sub,
    `${supabaseUrl}/functions/v1/share-wishlist?img=1`,
    "https://wrotate.com/",
    `<div class="state-wrap"><div class="state-icon">${icon}</div><div class="state-title">${esc(heading)}</div>
     <div class="state-sub">${esc(sub)}</div>
     <div><a href="https://wrotate.com/open" class="btn-cta">Open WRotate</a></div></div>`,
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const imgMode = url.searchParams.get("img") === "1";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, supabaseKey);

  // Image mode answers with an SVG even when there is nothing behind the token:
  // a preview whose image 404s renders as a grey box in the thread.
  if (imgMode) {
    const data = token ? await fetchShareData(db, token) : null;
    const displayName = data?.profile?.display_name || data?.profile?.username || "WRotate";
    const svg = generateWishlistOgSvg(displayName, data?.items || []);
    return new Response(svg, {
      headers: { ...CORS_HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }

  if (!token) {
    return new Response(
      statePage(supabaseUrl, "WRotate", "⌚", "No wishlist specified", "This link is incomplete. Visit WRotate to explore watch collections."),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const data = await fetchShareData(db, token);

  if (!data) {
    return new Response(
      statePage(supabaseUrl, "Wishlist link — WRotate", "🔒", "This wishlist link is no longer available", "The owner may have revoked it, or it never existed."),
      { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const { profile, items, label } = data;
  const displayName = profile.display_name || profile.username || "Someone";
  const { ogTitle, ogDescription } = buildWishlistOg(displayName, label, items);
  const ogImage = `${supabaseUrl}/functions/v1/share-wishlist?img=1&t=${encodeURIComponent(token)}`;
  const canonicalUrl = `${supabaseUrl}/functions/v1/share-wishlist?t=${encodeURIComponent(token)}`;

  const n = items.length;
  const body = `
    <div class="col-hero">
      <div class="col-avatar">${avatarInnerHtml(profile.avatar_url, displayName)}</div>
      <div class="col-name">${esc(displayName)}'s wishlist</div>
      <div class="col-uname">${n} watch${n !== 1 ? "es" : ""}</div>
      ${label ? `<div class="col-label">${esc(label)}</div>` : ""}
    </div>
    ${n === 0
      ? `<div class="state-wrap"><div class="state-icon">⌚</div><div class="state-title">Nothing left in this list</div>
         <div class="state-sub">The watches on this link are no longer on the owner's wishlist.</div></div>`
      : `<div class="wl-grid">${wishlistCardsHtml(items)}</div>`}
    <div class="foot">Shared from WRotate · <a href="https://wrotate.com/open">Start your own wishlist</a></div>`;

  bumpViews(db, token);

  return new Response(htmlPage(ogTitle, ogDescription, ogImage, canonicalUrl, body), {
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
});
```

- [ ] **Step 2: Add the view-counter RPC**

The counter is a read-modify-write, so it runs as one atomic statement in the
database rather than a select-then-update from the function. Append to
`sql/2026-08-11-wishlist-shares.sql`:

```sql
-- Atomic view counter, called by the share-wishlist edge function on the
-- service-role key. SECURITY DEFINER so the increment does not depend on RLS,
-- and granted only to service_role — nobody else may inflate a counter.
create or replace function public.bump_wishlist_share_view(p_token text)
returns void
language sql security definer set search_path = 'pg_catalog','public'
as $function$
  update public.wishlist_shares
     set views = views + 1, last_viewed_at = now()
   where token = p_token and revoked_at is null;
$function$;

revoke execute on function public.bump_wishlist_share_view(text) from public, anon, authenticated;
grant execute on function public.bump_wishlist_share_view(text) to service_role;

notify pgrst, 'reload schema';
```

Apply it:

```bash
npx supabase db query --linked --file sql/2026-08-11-wishlist-shares.sql
```

Expected: no error (the file is idempotent — `create table if not exists`, `create or replace function`).

- [ ] **Step 3: Deploy the function**

```bash
npx supabase functions deploy share-wishlist --no-verify-jwt
```

Expected: "Deployed Functions on project ...".

- [ ] **Step 4: Add smoke-test cases**

In `scripts/smoke-test-functions.js`, immediately after the existing
`share-recap (og image is always an SVG)` block, insert:

```js
  // A wishlist link is the capability itself, so an unknown or revoked token
  // must resolve to nothing rather than to somebody's list.
  await check('share-wishlist (bad token → 404)', async () => {
    const r = await callFn('share-wishlist?t=definitely-not-a-real-token');
    return { ...r, ok: r.status === 404 };
  });

  await check('share-wishlist (no token → 400)', async () => {
    const r = await callFn('share-wishlist?t=');
    return { ...r, ok: r.status === 400 };
  });

  // A link preview whose image 404s renders as a grey box, so image mode
  // answers with an SVG even for a token with nothing behind it.
  await check('share-wishlist (og image is always an SVG)', async () => {
    const r = await callFn('share-wishlist?t=nope&img=1');
    return { ...r, ok: r.status === 200 && r.body.trimStart().startsWith('<svg') };
  });
```

- [ ] **Step 5: Run the smoke test**

```bash
npm run test:smoke
```

Expected: PASS, including the three new `share-wishlist` checks.

- [ ] **Step 6: Verify a real token end to end**

Mint a row directly for the test account and fetch the page:

```bash
npx supabase db query --linked "
insert into public.wishlist_shares (token, user_id, label, item_ids)
select 'smoketest0000000000000000000001', p.id, 'Smoke test',
       coalesce(array(select w.id from public.wishlist w where w.user_id = p.id limit 2), '{}')
from public.profiles p where p.username = 'testuser'
on conflict (token) do nothing;"

curl -s "https://api.wrotate.com/functions/v1/share-wishlist?t=smoketest0000000000000000000001" | head -40
```

Expected: HTML containing `noindex,nofollow`, the test user's display name, and no price figures.

Then confirm the counter moved and clean up:

```bash
npx supabase db query --linked "select views, last_viewed_at from public.wishlist_shares where token = 'smoketest0000000000000000000001';"
npx supabase db query --linked "delete from public.wishlist_shares where token = 'smoketest0000000000000000000001';"
```

Expected: `views` is 1 before the delete.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/share-wishlist/index.ts sql/2026-08-11-wishlist-shares.sql scripts/smoke-test-functions.js
git commit -m "share-wishlist: serve the public page and og:image for a share token"
```

---

### Task 4: Selection model (pure logic)

**Files:**
- Modify: `wrotate_test.js` (append after `groupWishlistByBrand`, around line 430)
- Create: `tests/wishlist-share.test.js`

**Interfaces:**
- Consumes: `fmtDate(d)`, already exported from `wrotate_test.js`.
- Produces, all exported from `wrotate_test.js` and mirrored into `index.html` in Task 5:
  - `toggleWishSelection(selected: Set<string>, id: string): Set<string>`
  - `folderSelectionState(selected: Set<string>, items: {id}[]): 'none' | 'some' | 'all'`
  - `toggleWishFolderSelection(selected: Set<string>, items: {id}[]): Set<string>`
  - `wishShareItems(wishlist: object[], selected: Set<string>): {id, brand, name, ref, image}[]`
  - `wishSharePrivateCount(wishlist: object[], selected: Set<string>): number`
  - `wishShareLinkLabel(share: {label, created_at}): string`

- [ ] **Step 1: Write the failing test**

Create `tests/wishlist-share.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  folderSelectionState,
  toggleWishFolderSelection,
  toggleWishSelection,
  wishShareItems,
  wishShareLinkLabel,
  wishSharePrivateCount,
} from '../wrotate_test.js';

const w = (id, brand, name, extra = {}) => ({ id, brand, name, ...extra });

describe('toggleWishSelection', () => {
  it('adds an unselected id and removes a selected one', () => {
    const a = toggleWishSelection(new Set(), 'wl1');
    expect([...a]).toEqual(['wl1']);
    const b = toggleWishSelection(a, 'wl1');
    expect([...b]).toEqual([]);
  });

  // Renders compare identities to decide whether to redraw, so every helper
  // returns a NEW Set rather than mutating the one it was handed.
  it('never mutates the Set it is given', () => {
    const before = new Set(['wl1']);
    const after = toggleWishSelection(before, 'wl2');
    expect([...before]).toEqual(['wl1']);
    expect(after).not.toBe(before);
  });
});

describe('folderSelectionState', () => {
  const items = [w('a', 'Rolex', 'Daytona'), w('b', 'Rolex', 'Submariner')];

  it('reports none, some and all', () => {
    expect(folderSelectionState(new Set(), items)).toBe('none');
    expect(folderSelectionState(new Set(['a']), items)).toBe('some');
    expect(folderSelectionState(new Set(['a', 'b']), items)).toBe('all');
  });

  it('treats an empty or missing folder as none', () => {
    expect(folderSelectionState(new Set(['a']), [])).toBe('none');
    expect(folderSelectionState(new Set(['a']), null)).toBe('none');
  });

  it('ignores selected ids that are not in the folder', () => {
    expect(folderSelectionState(new Set(['zzz']), items)).toBe('none');
  });
});

describe('toggleWishFolderSelection', () => {
  const items = [w('a', 'Rolex', 'Daytona'), w('b', 'Rolex', 'Submariner')];

  it('takes the whole folder when none is selected', () => {
    expect([...toggleWishFolderSelection(new Set(), items)].sort()).toEqual(['a', 'b']);
  });

  it('completes the folder when only some is selected', () => {
    expect([...toggleWishFolderSelection(new Set(['a']), items)].sort()).toEqual(['a', 'b']);
  });

  it('drops the whole folder when all of it is selected', () => {
    expect([...toggleWishFolderSelection(new Set(['a', 'b']), items)]).toEqual([]);
  });

  it('leaves selections outside the folder alone', () => {
    const out = toggleWishFolderSelection(new Set(['a', 'b', 'other']), items);
    expect([...out]).toEqual(['other']);
  });

  it('is a no-op for an empty folder', () => {
    expect([...toggleWishFolderSelection(new Set(['x']), [])]).toEqual(['x']);
    expect([...toggleWishFolderSelection(new Set(['x']), null)]).toEqual(['x']);
  });
});

describe('wishShareItems', () => {
  const list = [
    w('a', 'Rolex', 'Daytona', { ref: '126519LN', image: 'https://x/a.jpg', price: 42700 }),
    w('b', 'Omega', 'Speedmaster'),
    w('c', 'Tudor', 'Black Bay'),
  ];

  it('keeps only the selected items, in wishlist order', () => {
    expect(wishShareItems(list, new Set(['c', 'a'])).map(i => i.id)).toEqual(['a', 'c']);
  });

  // The privacy promise, guarded here as well as in the edge function: a dealer
  // link must never carry what the owner is willing to pay.
  it('emits only id, brand, name, ref and image', () => {
    const [item] = wishShareItems(list, new Set(['a']));
    expect(Object.keys(item).sort()).toEqual(['brand', 'id', 'image', 'name', 'ref']);
    expect(JSON.stringify(item)).not.toContain('42700');
  });

  it('normalises missing fields rather than emitting undefined', () => {
    const [item] = wishShareItems(list, new Set(['b']));
    expect(item).toEqual({ id: 'b', brand: 'Omega', name: 'Speedmaster', ref: '', image: null });
  });

  it('returns an empty array for an empty selection or a missing list', () => {
    expect(wishShareItems(list, new Set())).toEqual([]);
    expect(wishShareItems(null, new Set(['a']))).toEqual([]);
  });
});

describe('wishSharePrivateCount', () => {
  const list = [
    w('a', 'Rolex', 'Daytona', { wishPrivacy: 'private' }),
    w('b', 'Omega', 'Speedmaster', { wishPrivacy: 'friends' }),
    w('c', 'Tudor', 'Black Bay', { wishPrivacy: 'public' }),
    w('d', 'Seiko', 'SPB143', { wishPrivacy: null }),
  ];

  it('counts selected items that are not public', () => {
    expect(wishSharePrivateCount(list, new Set(['a', 'b', 'c', 'd']))).toBe(2);
  });

  it('ignores unselected items', () => {
    expect(wishSharePrivateCount(list, new Set(['c', 'd']))).toBe(0);
  });

  it('copes with a missing list', () => {
    expect(wishSharePrivateCount(null, new Set(['a']))).toBe(0);
  });
});

describe('wishShareLinkLabel', () => {
  it('uses the label when one was given', () => {
    expect(wishShareLinkLabel({ label: 'Watches of Switzerland', created_at: '2026-08-11T09:00:00Z' }))
      .toBe('Watches of Switzerland');
  });

  it('falls back to the creation date when the label is blank', () => {
    expect(wishShareLinkLabel({ label: '   ', created_at: '2026-08-11T09:00:00Z' }))
      .toBe('Link from Aug 11, 2026');
  });

  it('falls back again when there is no date either', () => {
    expect(wishShareLinkLabel({})).toBe('Untitled link');
    expect(wishShareLinkLabel(null)).toBe('Untitled link');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/wishlist-share.test.js
```

Expected: FAIL — the imports are undefined.

- [ ] **Step 3: Write the implementation**

Append to `wrotate_test.js`, directly after `groupWishlistByBrand`:

```js
// ══════════════════════════════════════════
//  WISHLIST SHARING — selection model
// ══════════════════════════════════════════
// Selection is a Set of wishlist ids. Every helper returns a NEW Set: renders
// compare identities to decide whether to redraw, and a mutated Set would look
// unchanged.

export function toggleWishSelection(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

// A brand folder's checkbox is tri-state, so it needs the whole folder's answer
// rather than any one item's.
export function folderSelectionState(selected, items) {
  const list = items || [];
  if (!list.length) return 'none';
  const n = list.filter(i => selected.has(i.id)).length;
  if (n === 0) return 'none';
  return n === list.length ? 'all' : 'some';
}

// Half-selected means "the user wants this folder" — completing it is the
// useful move, so only a fully-selected folder empties.
export function toggleWishFolderSelection(selected, items) {
  const list = items || [];
  const next = new Set(selected);
  const state = folderSelectionState(selected, list);
  for (const it of list) {
    if (state === 'all') next.delete(it.id); else next.add(it.id);
  }
  return next;
}

// THE PRIVACY BOUNDARY on the client. Five fields go into a share link and
// nothing else — price, market value, notes, tags and the saved URL never
// leave the device. Never widen this to spread the source object.
export function wishShareItems(wishlist, selected) {
  return (wishlist || [])
    .filter(w => selected.has(w.id))
    .map(w => ({
      id: w.id,
      brand: w.brand || '',
      name: w.name || '',
      ref: w.ref || '',
      image: w.image || null,
    }));
}

// Informational only: the share sheet says how many non-public items are in the
// selection. It never blocks — an explicit tick outranks a passive setting.
export function wishSharePrivateCount(wishlist, selected) {
  return (wishlist || []).filter(w =>
    selected.has(w.id) && w.wishPrivacy && w.wishPrivacy !== 'public'
  ).length;
}

// How a minted link is named in the shared-links list.
export function wishShareLinkLabel(share) {
  const raw = ((share && share.label) || '').trim();
  if (raw) return raw;
  const d = share && share.created_at ? String(share.created_at).slice(0, 10) : '';
  return d ? `Link from ${fmtDate(d)}` : 'Untitled link';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/wishlist-share.test.js
npm test
npm run test:coverage
```

Expected: the new file passes; the full unit suite passes; coverage still clears the 99/99/99/94 gate.

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/wishlist-share.test.js
git commit -m "wishlist: selection model for share links, with the field whitelist under test"
```

---

### Task 5: Selection mode UI on the Wishlist page

**Files:**
- Modify: `index.html` — page markup at `4694-4713`, `wlCardHtml()` at ~26638, `renderWishlist()` at ~26690, CSS near the `.wl-card` rules at ~1282
- Create: `e2e/wishlist-share.mock.spec.js`
- Modify: `e2e/helpers.js` (add `wishlist_shares` to the mocked-table list at line ~131)
- Modify: `sw.js` (cache version bump)

**Interfaces:**
- Consumes: the six functions from Task 4, mirrored verbatim into `index.html`.
- Produces:
  - `let _wlSelect = null` — `null` when selection mode is off, a `Set` of ids when on.
  - `enterWishlistSelect()`, `exitWishlistSelect()`, `toggleWlSelect(id)`, `toggleWlFolderSelect(brandKey)`, `wlSelectAll()`, `wlSelectNone()` — all global, all call `renderWishlist(true)`.
  - `openWishlistShareSheet()` — defined in Task 6; wire the button to it here and stub it as `function openWishlistShareSheet() { toast('Coming soon'); }` so this task is testable alone.
  - DOM contract the E2E relies on: `#wl-share-btn`, `#wl-select-bar`, `#wl-select-count`, `.wl-select-box` on each card/tile, `.wl-folder-select` on each folder header, `#wl-share-go`.

- [ ] **Step 1: Write the failing E2E test**

Create `e2e/wishlist-share.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';
import {
  mockSupabase, injectSession, waitForAppBoot, navigateTo,
  SAMPLE_WATCHES, SAMPLE_LOGS,
} from './helpers.js';

// Two Rolexes (so there is a real folder to take in one tap) and one Omega.
const WL = [
  { id: 'wl1', brand: 'Rolex', name: 'Cosmograph Daytona', ref: '126519LN', price: 42700, wish_privacy: 'public', sort_order: 0 },
  { id: 'wl2', brand: 'Rolex', name: 'Submariner', ref: '124060', price: 10200, wish_privacy: 'private', sort_order: 1 },
  { id: 'wl3', brand: 'Omega', name: 'Speedmaster', ref: '310.30', wish_privacy: 'public', sort_order: 2 },
];

async function openWishlist(page) {
  await mockSupabase(page, { watches: SAMPLE_WATCHES, logs: SAMPLE_LOGS, wishlist: WL });
  await injectSession(page);
  await page.goto('/');
  await waitForAppBoot(page);
  await navigateTo(page, 'wishlist');
  await expect(page.locator('#page-wishlist')).toBeVisible();
}

test('Share button turns the wishlist into a selection surface', async ({ page }) => {
  await openWishlist(page);
  await expect(page.locator('#wl-select-bar')).toBeHidden();
  await page.click('#wl-share-btn');
  await expect(page.locator('#wl-select-bar')).toBeVisible();
  await expect(page.locator('.wl-select-box')).toHaveCount(3);
  await expect(page.locator('#wl-select-count')).toHaveText('0 selected');
  await expect(page.locator('#wl-share-go')).toBeDisabled();
});

test('ticking an item enables Share and counts it', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
  await expect(page.locator('#wl-share-go')).toBeEnabled();
});

test('a folder checkbox takes every watch of that brand', async ({ page }) => {
  await openWishlist(page);
  await page.click('.wl-view-btn[data-view="folders"]');
  await page.click('#wl-share-btn');
  await page.locator('.wl-folder-select').first().click();   // Omega folder — 1 watch
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
  await page.locator('.wl-folder-select').nth(1).click();    // Rolex folder — 2 watches
  await expect(page.locator('#wl-select-count')).toHaveText('3 selected');
  await page.locator('.wl-folder-select').nth(1).click();    // untick Rolex
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
});

test('the selection survives a view switch', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await page.click('.wl-view-btn[data-view="gallery"]');
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
  await expect(page.locator('.wl-select-box')).toHaveCount(3);
});

test('Select all and Clear move the whole list', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.click('#wl-select-all');
  await expect(page.locator('#wl-select-count')).toHaveText('3 selected');
  await page.click('#wl-select-none');
  await expect(page.locator('#wl-select-count')).toHaveText('0 selected');
});

// In selection mode a tap must toggle, not open the editor — otherwise every
// attempt to pick a watch drops the user into a modal.
test('tapping a card toggles instead of opening the editor', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-card .wl-info').first().click();
  await expect(page.locator('#wishlist-modal')).toHaveClass(/hidden/);
  await expect(page.locator('#wl-select-count')).toHaveText('1 selected');
});

test('Cancel leaves selection mode and restores the header', async ({ page }) => {
  await openWishlist(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await page.click('#wl-select-cancel');
  await expect(page.locator('#wl-select-bar')).toBeHidden();
  await expect(page.locator('.wl-select-box')).toHaveCount(0);
  await expect(page.locator('#wl-share-btn')).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx playwright test --project=mocked e2e/wishlist-share.mock.spec.js
```

Expected: FAIL — `#wl-share-btn` does not exist.

- [ ] **Step 3: Mirror the selection model into `index.html`**

Paste the six functions from Task 4 Step 3 into `index.html` immediately after
the existing `groupWishlistByBrand` (around line 26617), **without** the `export`
keywords. Add this comment above them:

```js
// Mirrored from wrotate_test.js (see tests/wishlist-share.test.js). Both copies
// must stay identical — the tests only see the module copy.
```

- [ ] **Step 4: Add the selection state and its actions**

Immediately after the mirrored functions in `index.html`:

```js
// null = selection mode off. A Set = on, holding the ticked wishlist ids.
// Deliberately in-memory only: a stale selection restored days later would be
// a trap, and a share is a single deliberate act.
let _wlSelect = null;

function enterWishlistSelect() {
  _wlSelect = new Set();
  renderWishlist(true);
}
function exitWishlistSelect() {
  _wlSelect = null;
  renderWishlist(true);
}
function toggleWlSelect(id) {
  if (!_wlSelect) return;
  _wlSelect = toggleWishSelection(_wlSelect, id);
  renderWishlist(true);
}
function toggleWlFolderSelect(brandKey) {
  if (!_wlSelect) return;
  const { folders } = groupWishlistByBrand(wishlist);
  const folder = folders.find(f => f.key === brandKey);
  if (!folder) return;
  _wlSelect = toggleWishFolderSelection(_wlSelect, folder.items);
  renderWishlist(true);
}
function wlSelectAll() {
  if (!_wlSelect) return;
  _wlSelect = new Set(wishlist.map(w => w.id));
  renderWishlist(true);
}
function wlSelectNone() {
  if (!_wlSelect) return;
  _wlSelect = new Set();
  renderWishlist(true);
}

// Replaced in full by the real share sheet in the next task.
function openWishlistShareSheet() { toast('Coming soon'); }
```

- [ ] **Step 5: Add the Share button and the selection bar to the page markup**

In `index.html`, inside `#page-wishlist .page-header` (line ~4696), add the Share
button as the first child of `.wl-actions`, before `#wishlist-view-toggle`:

```html
        <button id="wl-share-btn" class="btn btn-ghost btn-sm" onclick="enterWishlistSelect()" style="display:none;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Share</button>
```

Then, directly after the closing `</div>` of `.page-header` and before
`<div id="wishlist-grid">`, add the selection bar:

```html
    <div id="wl-select-bar" style="display:none;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.5rem .75rem;margin-bottom:.75rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);">
      <span id="wl-select-count" style="font-size:.82rem;font-weight:600;">0 selected</span>
      <button id="wl-select-all" class="btn btn-ghost btn-sm" onclick="wlSelectAll()">Select all</button>
      <button id="wl-select-none" class="btn btn-ghost btn-sm" onclick="wlSelectNone()">Clear</button>
      <span style="flex:1;"></span>
      <button id="wl-select-cancel" class="btn btn-ghost btn-sm" onclick="exitWishlistSelect()">Cancel</button>
      <button id="wl-share-go" class="btn btn-primary btn-sm" onclick="openWishlistShareSheet()" disabled>Share</button>
    </div>
```

- [ ] **Step 6: Add the checkbox CSS**

Next to the `.wl-card` rules in `index.html` (around line 1282):

```css
    .wl-select-box { appearance:none; -webkit-appearance:none; width:20px; height:20px; flex-shrink:0; border:2px solid var(--border); border-radius:5px; background:var(--surface); cursor:pointer; position:relative; }
    .wl-select-box:checked { background:var(--gold); border-color:var(--gold); }
    .wl-select-box:checked::after { content:''; position:absolute; left:6px; top:2px; width:5px; height:10px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }
    .wl-select-box.partial { background:color-mix(in srgb, var(--gold) 30%, transparent); border-color:var(--gold); }
    .wl-select-box.partial::after { content:''; position:absolute; left:3px; top:7px; width:10px; height:2px; background:var(--gold); }
    .wl-tile .wl-select-box { position:absolute; top:.4rem; left:.4rem; z-index:2; box-shadow:0 1px 4px rgba(0,0,0,.3); }
    .wl-tile { position:relative; }
```

- [ ] **Step 7: Render the checkboxes**

In `wlCardHtml(w, draggable)`, add a `selecting` branch. Replace the function's
return with:

```js
function wlCardHtml(w, draggable) {
  const selecting = !!_wlSelect;
  const checked = selecting && _wlSelect.has(w.id);
  const thumb = w.image
    ? `<img loading="lazy" src="${escHtml(w.image)}" class="wl-card-img" alt="" onerror="this.style.display='none'">`
    : `<div class="wl-card-avatar" style="background:${escHtml(w.color||"#c9a84c")};color:${initialsTextColor(w.color||"#c9a84c")}">${initials(w.brand,w.name)}</div>`;
  const meta = [
    w.price != null ? fmtMoney(w.price) : '',
    w.ref   ? w.ref : '',
    w.addedDate ? fmtDate(w.addedDate) : ''
  ].filter(Boolean).join(' · ');
  // Dragging and selecting are different gestures on the same card, so
  // reordering is suspended while a share selection is in progress.
  const dragAttrs = (draggable && !selecting) ? ` draggable="true"
    ondragstart="wlDragStart(event,'${w.id}')"
    ondragover="wlDragOver(event)"
    ondrop="wlDrop(event,'${w.id}')"
    ondragend="wlDragEnd(event)"` : '';
  const handle = (draggable && !selecting) ? `<span class="drag-handle" title="Drag to reorder" ontouchstart="wlTouchStart(event,'${w.id}')">⠿</span>` : '';
  const box = selecting
    ? `<input type="checkbox" class="wl-select-box" ${checked ? 'checked' : ''} onclick="event.stopPropagation();toggleWlSelect('${w.id}')" aria-label="Select ${escAttr(w.brand + ' ' + w.name)}">`
    : '';
  // In selection mode the whole card is a toggle: a tap that opened the editor
  // would make picking watches impossible.
  const infoClick = selecting ? `toggleWlSelect('${w.id}')` : `openEditWishlist('${w.id}')`;
  return `<div class="wl-card" data-id="${w.id}"${dragAttrs}>
    ${box}
    ${handle}
    ${thumb}
    <div class="wl-info" onclick="${infoClick}" style="cursor:pointer">
      <div class="wl-name"><span class="inline-val"><span>${escHtml(w.name)}</span></span></div>
      <div class="wl-brand">${escHtml(w.brand)}</div>
      ${meta ? `<div class="wl-meta">${meta}</div>` : ''}
    </div>
  </div>`;
}
```

In `renderWishlist()`'s **gallery** branch, add the box to each tile and route
the taps. Replace `const imgLink = ...` and the returned tile with:

```js
      const selecting = !!_wlSelect;
      const checked = selecting && _wlSelect.has(w.id);
      const tileClick = selecting ? `toggleWlSelect('${w.id}')` : `openEditWishlist('${w.id}')`;
      const box = selecting
        ? `<input type="checkbox" class="wl-select-box" ${checked ? 'checked' : ''} onclick="event.stopPropagation();toggleWlSelect('${w.id}')" aria-label="Select ${escAttr((w.brand||'') + ' ' + (w.name||''))}">`
        : '';
      const imgLink = `<div class="wl-tile-imglink" onclick="${tileClick}">${imgInner}</div>`;
      const urlLine = w.url
        ? `<a href="${escHtml(w.url)}" target="_blank" rel="noopener noreferrer" class="wl-tile-url">${escHtml(urlDomain(w.url))} ↗</a>`
        : '';
      return `<div class="wl-tile" data-priv="${escHtml(w.wishPrivacy||'')}">
        ${box}
        ${imgLink}
        <div class="wl-tile-name" onclick="${tileClick}">${escHtml(w.name)}</div>
        ${urlLine}
      </div>`;
```

In `renderWishlist()`'s **folders** branch, add the tri-state box to the folder
header. Insert it as the first child of `.wl-folder-header`, before
`.wl-folder-icon`:

```js
        ${_wlSelect ? `<input type="checkbox" class="wl-select-box wl-folder-select${folderSelectionState(_wlSelect, f.items) === 'some' ? ' partial' : ''}" ${folderSelectionState(_wlSelect, f.items) === 'all' ? 'checked' : ''} onclick="event.stopPropagation();toggleWlFolderSelect('${escAttr(f.key)}')" aria-label="Select all ${escAttr(f.brand)}">` : ''}
```

- [ ] **Step 8: Drive the bar from `renderWishlist()`**

At the top of `renderWishlist()`, just after the `toggle` block, add:

```js
  const shareBtn = document.getElementById('wl-share-btn');
  const bar = document.getElementById('wl-select-bar');
  if (shareBtn) shareBtn.style.display = (visible.length && !_wlSelect) ? '' : 'none';
  if (bar) {
    bar.style.display = _wlSelect ? 'flex' : 'none';
    if (_wlSelect) {
      const n = _wlSelect.size;
      document.getElementById('wl-select-count').textContent = `${n} selected`;
      document.getElementById('wl-share-go').disabled = n === 0;
    }
  }
```

Note the existing early return for an empty wishlist sits *below* this, so an
empty list still hides the button correctly.

- [ ] **Step 9: Add `wishlist_shares` to the E2E mocks**

In `e2e/helpers.js`, add `'wishlist_shares'` to the table list at line ~131:

```js
  for (const table of ['friend_requests', 'follows', 'likes', 'comments', 'notifications', 'clubs', 'club_members', 'page_visits', 'feed_posts', 'earned_badges', 'review_prompt_events', 'internal_accounts', 'rate_limits', 'promo_config', 'promo_slots', 'promo_events', 'wishlist_shares']) {
```

- [ ] **Step 10: Bump the service-worker cache**

In `sw.js`, increment the cache name (`wristlog-vNN` → `wristlog-vNN+1`).

- [ ] **Step 11: Run the tests**

```bash
npx playwright test --project=mocked e2e/wishlist-share.mock.spec.js
npm test && npm run test:e2e
```

Expected: the new spec passes and the full mocked suite stays green — in
particular `e2e/wishlist-layout.mock.spec.js`, which asserts the wishlist
toolbar fits on one line at 375px. If the extra Share button breaks that,
shrink the button's padding in the existing `@media` block at line ~1604 rather
than letting the toolbar wrap.

- [ ] **Step 12: Commit**

```bash
git diff HEAD -- index.html   # confirm every hunk is yours before staging
git add index.html sw.js e2e/wishlist-share.mock.spec.js e2e/helpers.js
git commit -m "wishlist: selection mode for sharing, across list, folders and gallery"
```

---

### Task 6: Share sheet, minting, and the shared-links manager

**Files:**
- Modify: `index.html` — add a modal near `#wishlist-modal` (line ~5275), replace the `openWishlistShareSheet()` stub from Task 5
- Modify: `e2e/wishlist-share.mock.spec.js` (append tests)
- Modify: `e2e/helpers.js` (give `wishlist_shares` a POST handler)
- Modify: `sw.js` (cache version bump)

**Interfaces:**
- Consumes: `_wlSelect`, `wishShareItems`, `wishSharePrivateCount`, `wishShareLinkLabel` (Tasks 4-5); the `wishlist_shares` table (Task 1); the `share-wishlist` URL shape (Task 3).
- Produces:
  - `openWishlistShareSheet()` — opens the modal in "compose" mode.
  - `openWishlistShareLinks()` — opens it in "manage" mode.
  - `mintWishlistShare()` — inserts the row, returns nothing, swaps the modal into "done" mode.
  - `wlShareUrl(token)` → `https://api.wrotate.com/functions/v1/share-wishlist?t=<token>`
  - `revokeWishlistShare(token)`, `copyWishlistShareUrl(token)`, `shareWishlistUrl(token)`
  - DOM contract: `#wl-share-modal`, `#wl-share-compose`, `#wl-share-done`, `#wl-share-label`, `#wl-share-create`, `#wl-share-url`, `#wl-share-links`, `#wl-share-private-note`

- [ ] **Step 1: Write the failing E2E tests**

Append to `e2e/wishlist-share.mock.spec.js`:

```js
// The mocked POST echoes the inserted row back, as PostgREST does.
async function mockMint(page) {
  await page.route('**/rest/v1/wishlist_shares*', route => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify([{ ...body, views: 0, created_at: '2026-08-11T09:00:00Z', revoked_at: null }]),
      });
    }
    if (method === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          token: 'existingtoken000000000000000001', label: 'Watches of Switzerland',
          item_ids: ['wl1'], views: 4, created_at: '2026-08-10T09:00:00Z', revoked_at: null,
        }]),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('the share sheet reports the count and flags private items', async ({ page }) => {
  await openWishlist(page);
  await mockMint(page);
  await page.click('#wl-share-btn');
  await page.click('#wl-select-all');
  await page.click('#wl-share-go');
  await expect(page.locator('#wl-share-modal')).toBeVisible();
  await expect(page.locator('#wl-share-compose')).toContainText('3 watches');
  await expect(page.locator('#wl-share-private-note')).toContainText('1 private item');
});

test('creating a link shows a copyable URL rather than sharing straight away', async ({ page }) => {
  await openWishlist(page);
  await mockMint(page);
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').first().click();
  await page.click('#wl-share-go');
  await page.fill('#wl-share-label', 'Watches of Switzerland');
  await page.click('#wl-share-create');
  await expect(page.locator('#wl-share-done')).toBeVisible();
  const url = await page.locator('#wl-share-url').textContent();
  expect(url).toContain('/functions/v1/share-wishlist?t=');
});

test('the minted row carries only the ticked ids and the label', async ({ page }) => {
  await openWishlist(page);
  let posted = null;
  await page.route('**/rest/v1/wishlist_shares*', route => {
    if (route.request().method() === 'POST') {
      posted = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([posted]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.click('#wl-share-btn');
  await page.locator('.wl-select-box').nth(2).click();   // Omega only
  await page.click('#wl-share-go');
  await page.fill('#wl-share-label', 'Dealer');
  await page.click('#wl-share-create');
  await expect(page.locator('#wl-share-done')).toBeVisible();
  expect(posted.item_ids).toEqual(['wl3']);
  expect(posted.label).toBe('Dealer');
  expect(posted.token).toMatch(/^[0-9a-f]{32}$/);
});

test('existing links are listed and can be revoked', async ({ page }) => {
  await openWishlist(page);
  await mockMint(page);
  await page.click('#wl-share-btn');
  await page.click('#wl-share-links');
  await expect(page.locator('#wl-share-modal')).toContainText('Watches of Switzerland');
  await expect(page.locator('#wl-share-modal')).toContainText('4 views');
  await page.click('[data-revoke="existingtoken000000000000000001"]');
  await expect(page.locator('#wl-share-modal')).not.toContainText('Watches of Switzerland');
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx playwright test --project=mocked e2e/wishlist-share.mock.spec.js
```

Expected: the four new tests FAIL (`#wl-share-modal` does not exist); the seven from Task 5 still pass.

- [ ] **Step 3: Add the modal markup**

In `index.html`, directly after the `#wishlist-modal` overlay closes (~line 5370), add:

```html
<div id="wl-share-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="wl-share-modal-title">
  <div class="modal">
    <div class="modal-title" id="wl-share-modal-title">Share wishlist</div>
    <div id="wl-share-compose"></div>
    <div id="wl-share-done" style="display:none;"></div>
    <div id="wl-share-manage" style="margin-top:1rem;"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeWishlistShareSheet()">Close</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Implement the sheet**

Replace the `openWishlistShareSheet()` stub from Task 5 with:

```js
function wlShareUrl(token) {
  return `https://api.wrotate.com/functions/v1/share-wishlist?t=${encodeURIComponent(token)}`;
}

let _wlShareLinks = [];      // rows from wishlist_shares, newest first

function closeWishlistShareSheet() {
  document.getElementById('wl-share-modal').classList.add('hidden');
}

function openWishlistShareSheet() {
  if (!_wlSelect || _wlSelect.size === 0) return;
  const items = wishShareItems(wishlist, _wlSelect);
  const priv = wishSharePrivateCount(wishlist, _wlSelect);
  const n = items.length;
  document.getElementById('wl-share-done').style.display = 'none';
  const compose = document.getElementById('wl-share-compose');
  compose.style.display = '';
  compose.innerHTML = `
    <div style="font-size:.86rem;margin-bottom:.75rem;">Sharing <strong>${n} watch${n !== 1 ? 'es' : ''}</strong>. The page shows the photo, brand, model and reference — never your price, notes or tags.</div>
    ${priv ? `<div id="wl-share-private-note" style="font-size:.76rem;color:var(--muted);margin-bottom:.75rem;">${priv} private item${priv !== 1 ? 's' : ''} included.</div>` : ''}
    <label style="display:block;font-size:.76rem;color:var(--muted);margin-bottom:.25rem;">Who's this for? (optional)</label>
    <input type="text" id="wl-share-label" maxlength="60" placeholder="e.g. Watches of Switzerland">
    <button class="btn btn-primary" id="wl-share-create" style="margin-top:.75rem;width:100%;" onclick="mintWishlistShare()">Create link</button>`;
  document.getElementById('wl-share-modal').classList.remove('hidden');
  loadWishlistShareLinks();
}

function openWishlistShareLinks() {
  document.getElementById('wl-share-compose').style.display = 'none';
  document.getElementById('wl-share-done').style.display = 'none';
  document.getElementById('wl-share-modal').classList.remove('hidden');
  loadWishlistShareLinks();
}

async function loadWishlistShareLinks() {
  if (!currentUser) return;
  try {
    const { data, error } = await db.from('wishlist_shares')
      .select('token, label, item_ids, views, created_at, revoked_at')
      .eq('user_id', currentUser.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    _wlShareLinks = data || [];
  } catch (e) {
    console.warn('[wishlist] share links load failed:', e && e.message);
    _wlShareLinks = [];
  }
  renderWishlistShareLinks();
}

function renderWishlistShareLinks() {
  const el = document.getElementById('wl-share-manage');
  if (!el) return;
  if (!_wlShareLinks.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="eyebrow" style="margin-bottom:.4rem;">Your shared links</div>
    ${_wlShareLinks.map(s => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(wishShareLinkLabel(s))}</div>
          <div style="font-size:.68rem;color:var(--muted);">${(s.item_ids || []).length} watch${(s.item_ids || []).length !== 1 ? 'es' : ''} · ${s.views || 0} view${(s.views || 0) !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="copyWishlistShareUrl('${escAttr(s.token)}')">Copy</button>
        <button class="btn btn-ghost btn-sm" data-revoke="${escAttr(s.token)}" onclick="revokeWishlistShare('${escAttr(s.token)}')">Revoke</button>
      </div>`).join('')}`;
}

async function mintWishlistShare() {
  if (!currentUser || !_wlSelect || _wlSelect.size === 0) return;
  const btn = document.getElementById('wl-share-create');
  if (btn) btn.disabled = true;
  const label = (document.getElementById('wl-share-label')?.value || '').trim();
  const ids = wishShareItems(wishlist, _wlSelect).map(i => i.id);
  const token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, '');
  try {
    const { error } = await db.from('wishlist_shares')
      .insert({ token, user_id: currentUser.id, label: label || null, item_ids: ids });
    if (error) throw error;
  } catch (e) {
    console.warn('[wishlist] mint failed:', e && e.message);
    if (btn) btn.disabled = false;
    toast('Could not create link', 'error');
    return;                                  // selection and modal stay put, so retry is one tap
  }
  const url = wlShareUrl(token);
  document.getElementById('wl-share-compose').style.display = 'none';
  const done = document.getElementById('wl-share-done');
  done.style.display = '';
  // navigator.share() must be called from a user gesture, and the insert above
  // is an await — the gesture is gone by here. So the URL is presented and the
  // NEXT tap does the sharing. Do not try to share directly from Create link.
  done.innerHTML = `
    <div style="font-size:.86rem;margin-bottom:.5rem;">Your link is ready.</div>
    <div id="wl-share-url" style="font-size:.72rem;color:var(--muted);word-break:break-all;background:var(--surface2);border-radius:8px;padding:.5rem;margin-bottom:.75rem;">${escHtml(url)}</div>
    <div style="display:flex;gap:.5rem;">
      <button class="btn btn-primary" style="flex:1;" onclick="shareWishlistUrl('${escAttr(token)}')">Share</button>
      <button class="btn btn-ghost" style="flex:1;" onclick="copyWishlistShareUrl('${escAttr(token)}')">Copy</button>
    </div>`;
  exitWishlistSelect();
  loadWishlistShareLinks();
}

async function shareWishlistUrl(token) {
  const url = wlShareUrl(token);
  const title = `${myProfile?.display_name || myProfile?.username || 'My'} wishlist — WRotate`;
  if (navigator.share) {
    try { await navigator.share({ title, url }); }
    catch (e) { if (e.name !== 'AbortError') toast('Could not open share sheet', 'error'); }
  } else {
    copyWishlistShareUrl(token);
  }
}

function copyWishlistShareUrl(token) {
  const url = wlShareUrl(token);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => toast('Wishlist link copied!'))
      .catch(() => _fallbackCopyText(url, 'Wishlist link copied!'));
  } else {
    _fallbackCopyText(url, 'Wishlist link copied!');
  }
}

async function revokeWishlistShare(token) {
  try {
    const { error } = await db.from('wishlist_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', token).eq('user_id', currentUser.id);
    if (error) throw error;
  } catch (e) {
    console.warn('[wishlist] revoke failed:', e && e.message);
    toast('Could not revoke that link', 'error');
    return;                                  // row stays listed, so the user knows it is still live
  }
  _wlShareLinks = _wlShareLinks.filter(s => s.token !== token);
  renderWishlistShareLinks();
  toast('Link revoked');
}
```

- [ ] **Step 5: Add the "Shared links" entry point to the selection bar**

In the `#wl-select-bar` markup from Task 5, insert before `#wl-select-cancel`:

```html
      <button id="wl-share-links" class="btn btn-ghost btn-sm" onclick="openWishlistShareLinks()">Shared links</button>
```

- [ ] **Step 6: Bump the service-worker cache**

In `sw.js`, increment the cache name again.

- [ ] **Step 7: Run the tests**

```bash
npx playwright test --project=mocked e2e/wishlist-share.mock.spec.js
npm test && npm run test:e2e
```

Expected: all eleven specs in the file pass; full suite green.

- [ ] **Step 8: Manual UAT on the dev server**

Sign in as `test@wrotate.com` at `http://ozgurs-mac-mini-2.local:3000` (a bare IP
is rejected by GoTrue's allowlist). Tick two wishlist items, create a link, open
it in a private window, and confirm: no prices anywhere, the page has
`noindex`, and Revoke makes it 404.

Use test-account data only — never touch another user's records.

- [ ] **Step 9: Commit**

```bash
git diff HEAD -- index.html
git add index.html sw.js e2e/wishlist-share.mock.spec.js
git commit -m "wishlist: share sheet, link minting and the shared-links manager"
```

---

### Task 7: Admin metrics

**Files:**
- Create: `sql/2026-08-11-wishlist-share-admin.sql`
- Modify: `index.html` — `loadAdminStats()` at ~17504 (the RPC batch) and the Totals card at ~17785

**Interfaces:**
- Consumes: `wishlist_shares` (Task 1); the existing `statRow(label, value, delta, sub, invert)` helper.
- Produces: RPC `public.admin_wishlist_share_stats()` returning json with keys `links_total`, `links_24h`, `sharers_total`, `sharers_24h`, `items_total`, `opens_total`, `links_opened`, `links_active`, `links_revoked`.

- [ ] **Step 1: Write the RPC**

Create `sql/2026-08-11-wishlist-share-admin.sql`:

```sql
-- Admin metrics for wishlist sharing. Mirrors admin_fact_counts()
-- (sql/2026-07-22-fact-clicks-admin.sql): admin-only, internal accounts
-- excluded, totals plus a last-24h window.

create or replace function public.admin_wishlist_share_stats()
returns json
language plpgsql security definer set search_path = 'pg_catalog','public'
as $function$
declare
  d24h timestamptz := now() - interval '24 hours';
  internal_ids uuid[] := array(select user_id from internal_accounts);
  result json;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;

  select json_build_object(
    'links_total',   (select count(*) from wishlist_shares where user_id <> all(internal_ids)),
    'links_24h',     (select count(*) from wishlist_shares where created_at >= d24h and user_id <> all(internal_ids)),
    'sharers_total', (select count(distinct user_id) from wishlist_shares where user_id <> all(internal_ids)),
    'sharers_24h',   (select count(distinct user_id) from wishlist_shares where created_at >= d24h and user_id <> all(internal_ids)),
    'items_total',   (select coalesce(sum(cardinality(item_ids)), 0) from wishlist_shares where user_id <> all(internal_ids)),
    'opens_total',   (select coalesce(sum(views), 0) from wishlist_shares where user_id <> all(internal_ids)),
    'links_opened',  (select count(*) from wishlist_shares where views > 0 and user_id <> all(internal_ids)),
    'links_active',  (select count(*) from wishlist_shares where revoked_at is null and user_id <> all(internal_ids)),
    'links_revoked', (select count(*) from wishlist_shares where revoked_at is not null and user_id <> all(internal_ids))
  ) into result;

  return result;
end;
$function$;

revoke execute on function public.admin_wishlist_share_stats() from public, anon;
grant execute on function public.admin_wishlist_share_stats() to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply and verify it**

```bash
npx supabase db query --linked --file sql/2026-08-11-wishlist-share-admin.sql
```

Then check it refuses a non-admin and answers for the admin:

```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}', true);
select public.admin_wishlist_share_stats();"
```

Expected: `ERROR: Not authorized`.

```bash
npx supabase db query --linked "
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where is_admin = true limit 1), 'role', 'authenticated')::text, true);
select public.admin_wishlist_share_stats();"
```

Expected: a json object with all nine keys, zeros on a fresh table.

- [ ] **Step 3: Call it from `loadAdminStats()`**

In `index.html`, add the RPC to the existing batch that fetches `unsub`, `eng`
and `push` (around line 17549):

```js
    const [unsubRes, engineRes, pushRes, wlShareRes] = await withTimeout(Promise.all([
      db.rpc('admin_unsub_stats'), db.rpc('admin_engine_stats'), db.rpc('admin_push_stats'),
      db.rpc('admin_wishlist_share_stats'),
    ]), 10000);
    const unsub = unsubRes.data || {};
    const eng = engineRes.data || {};
    const push = pushRes.data || {};
    const wls = wlShareRes.data || {};
```

- [ ] **Step 4: Render the rows**

In the Totals card (after the `Fun facts generated` row, ~line 17800), add:

```js
        ${statRow('Wishlist links', Number(wls.links_total) || 0, Number(wls.links_24h) || 0)}
        ${statRow('Wishlist sharers', Number(wls.sharers_total) || 0, Number(wls.sharers_24h) || 0)}
        ${statRow('Watches shared', Number(wls.items_total) || 0, null,
          (Number(wls.links_total) > 0 ? (Number(wls.items_total) / Number(wls.links_total)).toFixed(1) : '0') + ' per link')}
        ${statRow('Wishlist link opens', Number(wls.opens_total) || 0, null,
          (Number(wls.links_total) > 0 ? Math.round(Number(wls.links_opened) / Number(wls.links_total) * 100) : 0) + '% of links opened')}
        ${statRow('Active links', Number(wls.links_active) || 0, null, (Number(wls.links_revoked) || 0) + ' revoked')}
```

- [ ] **Step 5: Verify in the browser**

Open the admin tab at `http://ozgurs-mac-mini-2.local:3000` signed in as the
admin account and confirm the five rows render with numbers, not `NaN` or
`undefined`.

- [ ] **Step 6: Run the suite**

```bash
npm test && npm run test:e2e
```

Expected: green. (The mocked E2E stubs unknown RPCs; confirm no console error
about `admin_wishlist_share_stats` appears in the admin spec if one exists.)

- [ ] **Step 7: Commit**

```bash
git diff HEAD -- index.html
git add sql/2026-08-11-wishlist-share-admin.sql index.html
git commit -m "admin: wishlist share link, sharer, open and revoke counts"
```

---

### Task 8: Help page, What's New, and the audit trail

**Files:**
- Modify: `index.html` — Help page steps (~line 4037), What's New section (~line 2799)
- Modify: `sw.js` (final cache bump)
- Modify: `WROTATE-FEATURES.md`

**Interfaces:**
- Consumes: the shipped feature.
- Produces: user-facing documentation. No code contract.

- [ ] **Step 1: Add the What's New entry**

Above the existing newest entry in the What's New list (~line 2799), following
the surrounding markup exactly:

```html
        <div style="font-size:.8rem;color:var(--muted);line-height:1.55;">Share part of your wishlist by link. Tap <strong>Share</strong> on the Wishlist tab, tick the watches you want &#8212; or a whole brand folder in one tap &#8212; and send a link that shows the photo, brand, model and reference. Your prices, notes and tags stay private, the recipient needs no account, and you can revoke any link you've sent.</div>
```

This is a feature, so it belongs here. Bug fixes and polish never go in
What's New.

- [ ] **Step 2: Add the Help step**

Next to the existing "Share your wishlist with friends" step (~line 4037), add a
sibling step:

```html
            <div class="help-step">
              <div class="help-step-title">Send part of your wishlist to a dealer</div>
              <div class="help-step-desc">On the Wishlist tab, tap <strong>Share</strong>. Tick individual watches, or a brand folder to take all of them at once, then <strong>Create link</strong>. The page you send shows each watch's photo, brand, model and reference number — never your price, notes or tags — and works for anyone, with or without a WRotate account. Tap <strong>Shared links</strong> any time to see what you've sent, how many times it was opened, and to revoke a link.</div>
            </div>
```

- [ ] **Step 3: Update the feature catalogue**

Add a wishlist-sharing entry to `WROTATE-FEATURES.md` alongside the other
wishlist features, describing the selection flow, the four published fields, and
revocation.

- [ ] **Step 4: Bump the service-worker cache**

Increment the cache name in `sw.js` one final time.

- [ ] **Step 5: Run the full suite**

```bash
npm test && npm run test:e2e && npm run test:functions
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git diff HEAD -- index.html
git add index.html sw.js WROTATE-FEATURES.md
git commit -m "help: document wishlist share links in Help and What's New"
```

- [ ] **Step 7: Hand back for deployment**

Do not push. Report to the user: what shipped, the test results, and that
`git push origin main` is theirs to run.
