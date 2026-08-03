# Merchandising Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an in-feed merchandising card — targeted by client-evaluated audience rules, authored and scheduled from a new admin tab — and retire the new-features modal.

**Architecture:** Three new Postgres tables (`promo_slots`, `promo_events`, `promo_config`) drive a card injected into the home feed. Targeting is a registry of pure predicate functions evaluated client-side against counts already in memory after `loadUserData()`. Card body accepts HTML, sanitized at render time by an allowlist DOM walker. Pure logic is mirrored into `wrotate_test.js` for unit tests; DOM-dependent logic is tested in real Chromium via Playwright.

**Tech Stack:** Vanilla JS in a single `index.html`, Supabase (Postgres + RLS), vitest (unit), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-08-02-merchandising-slots-design.md` — read it before Task 1.

## Global Constraints

- **Vanilla JS, no frameworks.** No new runtime *or* devDependencies. `package.json` gains nothing.
- **No jsdom.** vitest runs in Node with no DOM. Anything touching `DOMParser`/`document` is tested in Playwright, never vitest.
- **Mirror-drift guard.** Any function defined in *both* `index.html` and `wrotate_test.js` MUST be registered in `VERBATIM` or `ADAPTED` in `tests/mirror-drift.test.js`, or `npm test` fails. VERBATIM mirrors must be byte-identical ignoring whitespace/comments.
- **Coverage gate.** `vitest.config.js` gates `wrotate_test.js` at statements 99 / functions 99 / lines 99 / branches 94. Every function added there needs near-total test coverage or CI fails.
- **Top-level `let`/`const` in `index.html` are NOT on `window`.** In Playwright, reference them as bare identifiers inside `page.evaluate`, never `window.x`. Top-level `function` declarations ARE on `window`.
- **Bump `sw.js` cache version** (`wristlog-vNN`, currently `v989`) on any HTML/JS change — CLAUDE.md.
- **Run `npm test && npm run test:e2e` before every commit.** All must pass.
- **Admin gate:** `ADMIN_USER_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'` (`index.html:5425`) for client-side gating; `profiles.is_admin` for RLS.
- **Exclude `internal_accounts`** from every admin metric (CLAUDE.md).
- **Deploy SQL** via `npx supabase db query --linked --file -`; migration push does not work on this project.
- **Do not activate a slot.** Seeding `status='draft'` is in scope; flipping to `'active'` is the user's call.

---

### Task 1: Database schema, RLS, and stats RPC

**Files:**
- Create: `sql/2026-08-02-promo-slots.sql`

**Interfaces:**
- Produces: tables `promo_slots`, `promo_events`, `promo_config`; RPC `promo_slot_stats()` returning `(slot_id uuid, impressions bigint, clicks bigint, dismissals bigint, distinct_users bigint)`.

- [ ] **Step 1: Read the spec's Data model section**

Read `docs/superpowers/specs/2026-08-02-merchandising-slots-design.md`, section "Data model". The column list below must match it exactly.

- [ ] **Step 2: Write the SQL file**

Create `sql/2026-08-02-promo-slots.sql`:

```sql
-- In-feed merchandising slots.
-- Spec: docs/superpowers/specs/2026-08-02-merchandising-slots-design.md

create table if not exists public.promo_slots (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  kind             text not null default 'authored',
  eyebrow          text,
  heading          text not null,
  body             text,
  image_url        text,
  images           jsonb not null default '[]'::jsonb,
  cta_label        text,
  cta_action       text,
  audience         text not null default 'all',
  segment          text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  priority         int  not null default 0,
  max_impressions  int,
  status           text not null default 'draft'
                   check (status in ('draft','active','archived'))
);

create table if not exists public.promo_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  slot_id    uuid not null references public.promo_slots(id) on delete cascade,
  event      text not null check (event in ('impression','click','dismiss')),
  created_at timestamptz not null default now()
);
create index if not exists promo_events_user_slot_idx on public.promo_events (user_id, slot_id);

-- Exactly one row, enforced by a boolean PK that can only be true.
create table if not exists public.promo_config (
  id                       boolean primary key default true check (id),
  enabled                  boolean not null default true,
  first_position           int     not null default 2,
  repeat_every             int     not null default 0,
  max_per_session          int     not null default 1,
  default_max_impressions  int     not null default 3,
  suppress_after_modal     boolean not null default true
);
insert into public.promo_config (id) values (true) on conflict (id) do nothing;

alter table public.promo_slots  enable row level security;
alter table public.promo_events enable row level security;
alter table public.promo_config enable row level security;

-- Normal users see only live slots. Drafts and archived rows stay invisible.
drop policy if exists promo_slots_select_live on public.promo_slots;
create policy promo_slots_select_live on public.promo_slots
  for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  );

drop policy if exists promo_slots_admin_all on public.promo_slots;
create policy promo_slots_admin_all on public.promo_slots
  for all to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

drop policy if exists promo_events_insert_own on public.promo_events;
create policy promo_events_insert_own on public.promo_events
  for insert to authenticated with check (user_id = auth.uid());

-- Unlike fact_impressions, the client must read its own rows back so dismissals
-- and impression caps follow the user across devices.
drop policy if exists promo_events_select_own on public.promo_events;
create policy promo_events_select_own on public.promo_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists promo_config_select_all on public.promo_config;
create policy promo_config_select_all on public.promo_config
  for select to authenticated using (true);

drop policy if exists promo_config_admin_update on public.promo_config;
create policy promo_config_admin_update on public.promo_config
  for update to authenticated
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

revoke all on public.promo_slots  from anon;
revoke all on public.promo_events from anon;
revoke all on public.promo_config from anon;

-- Admin stats. SECURITY DEFINER so it can aggregate across all users' events,
-- with an explicit is_admin guard inside. internal_accounts excluded per CLAUDE.md.
create or replace function public.promo_slot_stats()
returns table (slot_id uuid, impressions bigint, clicks bigint, dismissals bigint, distinct_users bigint)
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  return query
    select e.slot_id,
           count(*) filter (where e.event = 'impression'),
           count(*) filter (where e.event = 'click'),
           count(*) filter (where e.event = 'dismiss'),
           count(distinct e.user_id)
    from public.promo_events e
    where not exists (select 1 from public.internal_accounts i where i.user_id = e.user_id)
    group by e.slot_id;
end;
$function$;

revoke all on function public.promo_slot_stats() from public, anon;
grant execute on function public.promo_slot_stats() to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 3: Verify `profiles.is_admin` and `internal_accounts.user_id` exist before applying**

Run:
```bash
npx supabase db query --linked "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='profiles' AND column_name='is_admin') OR (table_name='internal_accounts' AND column_name='user_id'));"
```
Expected: both rows returned. If either is missing, STOP — the SQL references a column that does not exist.

- [ ] **Step 4: Apply the SQL**

Run:
```bash
npx supabase db query --linked --file sql/2026-08-02-promo-slots.sql
```
Expected: no error.

- [ ] **Step 5: Verify RLS behaves — a non-admin cannot see a draft**

Run:
```bash
npx supabase db query --linked "
insert into promo_slots (heading, status) values ('DRAFT PROBE', 'draft');
insert into promo_slots (heading, status) values ('LIVE PROBE', 'active');
set local role authenticated;
select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000001\"}', true);
select heading from promo_slots;
"
```
Expected: `LIVE PROBE` only. `DRAFT PROBE` must NOT appear. If the draft appears, the select policy is wrong — fix before continuing.

- [ ] **Step 6: Clean up the probe rows**

Run:
```bash
npx supabase db query --linked "delete from promo_slots where heading in ('DRAFT PROBE','LIVE PROBE');"
```
Expected: no error.

- [ ] **Step 7: Commit**

```bash
git add sql/2026-08-02-promo-slots.sql
git commit -m "promo: tables, RLS and stats RPC for merchandising slots"
```

---

### Task 2: `sanitizePromoHtml` — the allowlist DOM walker

The highest-risk code in this feature. A bug here is stored XSS in every user's feed. It needs `DOMParser`, so it is tested in real Chromium via Playwright, **not** vitest, and it is **not** mirrored into `wrotate_test.js`.

**Files:**
- Modify: `index.html` — add near `sanitizeImageUrl` (~line 21250)
- Test: `e2e/promo-sanitize.mock.spec.js` (create)

**Interfaces:**
- Consumes: `sanitizeImageUrl(url, baseUrl)` — existing, `index.html:21250`.
- Produces: `function sanitizePromoHtml(html) -> string`. Global function declaration, so it is reachable as `window.sanitizePromoHtml` from Playwright.

- [ ] **Step 1: Write the failing test**

Create `e2e/promo-sanitize.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

// sanitizePromoHtml needs a real DOMParser, so it is tested in Chromium rather
// than vitest (the unit suite runs in Node with no DOM). One page load, many
// table-driven cases — and the real browser parser is the one that actually
// decides whether a bypass works.
const CASES = [
  // [name, input, expected substrings present, expected substrings absent]
  ['strips script with its contents',
    '<p>hi</p><script>alert(1)</script>', ['<p>hi</p>'], ['alert', 'script']],
  ['strips inline event handlers',
    '<img src="https://x.test/a.jpg" onerror="alert(1)">', ['<img'], ['onerror', 'alert']],
  ['drops javascript: hrefs but keeps the text',
    '<a href="javascript:alert(1)">click</a>', ['click'], ['javascript:', 'href']],
  ['drops data: hrefs',
    '<a href="data:text/html,<b>x</b>">click</a>', ['click'], ['data:']],
  ['strips the style attribute',
    '<p style="position:fixed;inset:0">x</p>', ['<p>', 'x'], ['style', 'fixed']],
  ['keeps allowed formatting tags',
    '<b>bold</b> <em>em</em><ul><li>one</li></ul>',
    ['<b>bold</b>', '<em>em</em>', '<li>one</li>'], []],
  ['unwraps unknown tags but keeps their text',
    '<marquee>keep me</marquee>', ['keep me'], ['marquee']],
  ['unwraps unknown nested inside allowed',
    '<p>a <blink>b</blink> c</p>', ['a ', 'b', ' c'], ['blink']],
  ['adds rel and target to external links',
    '<a href="https://example.test/x">go</a>',
    ['rel="noopener noreferrer"', 'target="_blank"', 'https://example.test/x'], []],
  ['survives malformed markup',
    '<p>unclosed <b>bold', ['unclosed', 'bold'], []],
  ['strips svg with its contents',
    '<svg><script>alert(1)</script></svg>ok', ['ok'], ['svg', 'alert']],
  ['strips iframes with their contents',
    '<iframe src="https://evil.test"></iframe>safe', ['safe'], ['iframe', 'evil.test']],
  ['keeps a valid https image',
    '<img src="https://x.test/a.jpg" alt="a">', ['<img', 'https://x.test/a.jpg', 'alt="a"'], []],
  ['drops an image whose src fails sanitizeImageUrl',
    '<img src="javascript:alert(1)">', [], ['javascript:', '<img']],
  ['drops srcset',
    '<img src="https://x.test/a.jpg" srcset="https://evil.test/x 2x">', ['<img'], ['srcset', 'evil.test']],
];

test('sanitizePromoHtml — allowlist walker', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate((cases) =>
    cases.map(([name, input]) => [name, window.sanitizePromoHtml(input)]), CASES);

  const failures = [];
  results.forEach(([name, out], i) => {
    const [, , present, absent] = CASES[i];
    for (const s of present) if (!out.includes(s)) failures.push(`${name}: missing ${JSON.stringify(s)} in ${JSON.stringify(out)}`);
    for (const s of absent)  if (out.includes(s))  failures.push(`${name}: leaked ${JSON.stringify(s)} in ${JSON.stringify(out)}`);
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('sanitizePromoHtml — a sanitized payload cannot execute', async ({ page }) => {
  await page.goto('/');
  const fired = await page.evaluate(() => {
    window.__xss = false;
    const host = document.createElement('div');
    host.innerHTML = window.sanitizePromoHtml(
      '<img src=x onerror="window.__xss=true"><script>window.__xss=true<\/script>');
    document.body.appendChild(host);
    return new Promise((r) => setTimeout(() => r(window.__xss), 100));
  });
  expect(fired).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=mocked e2e/promo-sanitize.mock.spec.js`
Expected: FAIL — `window.sanitizePromoHtml is not a function`.

- [ ] **Step 3: Implement the sanitizer**

In `index.html`, immediately after the `sanitizeImageUrl` function (~line 21250), add:

```js
// ── Promo HTML sanitizer ─────────────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-08-02-merchandising-slots-design.md
// promo_slots.body is admin-authored HTML rendered into every user's feed.
// Allowlist, never blocklist. Sanitize at RENDER, not at save: rows already in
// the table get cleaned on the way out, so a bad row can never become a stored
// payload that outlives a fix here.
const PROMO_TAGS_OK   = new Set(['B','STRONG','I','EM','U','BR','P','UL','OL','LI','A','IMG','SPAN']);
// Removed WITH their contents. Unwrapping these would dump script source into
// the page as visible text, or re-parse in a foreign content mode.
const PROMO_TAGS_KILL = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','TEMPLATE','SVG','MATH','NOSCRIPT']);
const PROMO_ATTRS_OK  = { A: new Set(['href']), IMG: new Set(['src','alt']) };

function sanitizePromoHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const walk = (node) => {
    // Snapshot children first — the loop mutates the live child list.
    for (const child of [...node.children]) {
      const tag = child.tagName.toUpperCase();
      if (PROMO_TAGS_KILL.has(tag)) { child.remove(); continue; }
      if (!PROMO_TAGS_OK.has(tag)) {
        walk(child);                                  // clean before unwrapping
        child.replaceWith(...child.childNodes);
        continue;
      }
      const allowed = PROMO_ATTRS_OK[tag] || new Set();
      for (const attr of [...child.attributes]) {
        if (!allowed.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
      }
      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        const ok = /^https:\/\//i.test(href) || /^\/[^/]/.test(href);
        if (!ok) child.removeAttribute('href');
        else if (/^https:\/\//i.test(href)) {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if (tag === 'IMG') {
        const src = sanitizeImageUrl(child.getAttribute('src') || '', location.origin);
        if (!src) { child.remove(); continue; }
        child.setAttribute('src', src);
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
```

- [ ] **Step 4: Verify `sanitizeImageUrl` returns falsy for a bad URL**

Read `index.html:21250` and confirm `sanitizeImageUrl` returns `''`/`null` (not the input) for a `javascript:` URL. If it returns the input unchanged, the `IMG` branch above is wrong — adjust it to test the scheme explicitly with `/^https:\/\//i.test(src)` before accepting.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test --project=mocked e2e/promo-sanitize.mock.spec.js`
Expected: PASS, both tests.

- [ ] **Step 6: Confirm the mirror guard is satisfied**

`sanitizePromoHtml` is defined only in `index.html`, never in `wrotate_test.js`, so the guard's "no unclassified mirrored function" check does not apply.

Run: `npm test -- mirror-drift`
Expected: PASS.

- [ ] **Step 7: Bump the SW cache and commit**

In `sw.js` line 4, change `wristlog-v989` to `wristlog-v990`.

```bash
git add index.html sw.js e2e/promo-sanitize.mock.spec.js
git commit -m "promo: allowlist HTML sanitizer for slot bodies"
```

---

### Task 3: Audience rule registry

**Files:**
- Modify: `index.html` — add a new section after the fun-fact block (~line 11200)
- Modify: `wrotate_test.js` — append the mirror
- Modify: `tests/mirror-drift.test.js` — register the new names
- Test: `tests/promo-audience.test.js` (create)

**Interfaces:**
- Produces:
  - `const PROMO_AUDIENCES` — object mapping key → `(ctx) => boolean`
  - `function promoAudienceMatches(key, ctx) -> boolean` — returns `false` for an unknown key
  - `ctx` shape: `{ watchCount, wearCount, wishlistCount, followingCount, measureCount, clubCount, rankedEver, daysSinceSignup, isIos }`

- [ ] **Step 1: Write the failing test**

Create `tests/promo-audience.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { PROMO_AUDIENCES, promoAudienceMatches } from '../wrotate_test.js';

// A fully-engaged user: every audience below should reject them except `all`.
const FULL = {
  watchCount: 5, wearCount: 40, wishlistCount: 3, followingCount: 9,
  measureCount: 7, clubCount: 2, rankedEver: true, daysSinceSignup: 90, isIos: true,
};

describe('promoAudienceMatches', () => {
  it('matches everyone for `all`', () => {
    expect(promoAudienceMatches('all', FULL)).toBe(true);
    expect(promoAudienceMatches('all', { ...FULL, watchCount: 0 })).toBe(true);
  });

  it('returns false for an unknown key — a typo hides the card, never shows it to everyone', () => {
    expect(promoAudienceMatches('nope', FULL)).toBe(false);
    expect(promoAudienceMatches('', FULL)).toBe(false);
    expect(promoAudienceMatches(undefined, FULL)).toBe(false);
  });

  it('rejects a fully-engaged user for every targeted audience', () => {
    for (const key of Object.keys(PROMO_AUDIENCES)) {
      if (key === 'all') continue;
      expect(promoAudienceMatches(key, FULL), `${key} should not match a fully-engaged user`).toBe(false);
    }
  });

  it('never_logged targets people with no wears', () => {
    expect(promoAudienceMatches('never_logged', { ...FULL, wearCount: 0 })).toBe(true);
    expect(promoAudienceMatches('never_logged', { ...FULL, wearCount: 1 })).toBe(false);
  });

  it('no_wishlist targets an empty wishlist', () => {
    expect(promoAudienceMatches('no_wishlist', { ...FULL, wishlistCount: 0 })).toBe(true);
  });

  it('never_measured only targets iOS — Measure is hidden on web, so the CTA would be dead', () => {
    expect(promoAudienceMatches('never_measured', { ...FULL, measureCount: 0, isIos: true })).toBe(true);
    expect(promoAudienceMatches('never_measured', { ...FULL, measureCount: 0, isIos: false })).toBe(false);
  });

  it('no_clubs targets people in no club', () => {
    expect(promoAudienceMatches('no_clubs', { ...FULL, clubCount: 0 })).toBe(true);
  });

  it('follows_few targets fewer than 3 follows, at the boundary', () => {
    expect(promoAudienceMatches('follows_few', { ...FULL, followingCount: 2 })).toBe(true);
    expect(promoAudienceMatches('follows_few', { ...FULL, followingCount: 3 })).toBe(false);
  });

  it('never_ranked targets people who never played the ranking game', () => {
    expect(promoAudienceMatches('never_ranked', { ...FULL, rankedEver: false })).toBe(true);
  });

  it('treats missing ctx fields as zero rather than throwing', () => {
    expect(promoAudienceMatches('never_logged', {})).toBe(true);
    expect(promoAudienceMatches('no_wishlist', {})).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- promo-audience`
Expected: FAIL — no export named `PROMO_AUDIENCES`.

- [ ] **Step 3: Implement in `index.html`**

Add a new section in `index.html` after the fun-fact block (after `maybeShowFactModal`, ~line 11200):

```js
// ══════════════════════════════════════════
//  MERCHANDISING SLOTS
//  Spec: docs/superpowers/specs/2026-08-02-merchandising-slots-design.md
// ══════════════════════════════════════════

// Audience rules. Each is a pure predicate over counts already in memory after
// loadUserData(), so targeting needs no server round-trip and no per-user
// fan-out table. Adding an audience = one entry here; the admin dropdown is
// generated from this object so the two can never drift.
const PROMO_AUDIENCES = {
  all:             ()    => true,
  never_logged:    (c)   => (c.wearCount || 0) === 0,
  no_wishlist:     (c)   => (c.wishlistCount || 0) === 0,
  // iOS-only: #nav-measure-btn is hidden on web, so this CTA would go nowhere.
  never_measured:  (c)   => !!c.isIos && (c.measureCount || 0) === 0,
  no_clubs:        (c)   => (c.clubCount || 0) === 0,
  follows_few:     (c)   => (c.followingCount || 0) < 3,
  never_ranked:    (c)   => !c.rankedEver,
};

// An unknown key is FALSE, never true: a typo in the admin form hides the card
// rather than blasting it to everyone.
function promoAudienceMatches(key, ctx) {
  const fn = PROMO_AUDIENCES[key];
  return typeof fn === 'function' ? !!fn(ctx || {}) : false;
}
```

- [ ] **Step 4: Mirror into `wrotate_test.js`**

Append to `wrotate_test.js` the byte-identical copy, with `export` added to both declarations:

```js
export const PROMO_AUDIENCES = {
  all:             ()    => true,
  never_logged:    (c)   => (c.wearCount || 0) === 0,
  no_wishlist:     (c)   => (c.wishlistCount || 0) === 0,
  never_measured:  (c)   => !!c.isIos && (c.measureCount || 0) === 0,
  no_clubs:        (c)   => (c.clubCount || 0) === 0,
  follows_few:     (c)   => (c.followingCount || 0) < 3,
  never_ranked:    (c)   => !c.rankedEver,
};

export function promoAudienceMatches(key, ctx) {
  const fn = PROMO_AUDIENCES[key];
  return typeof fn === 'function' ? !!fn(ctx || {}) : false;
}
```

- [ ] **Step 5: Register both names in the mirror-drift guard**

In `tests/mirror-drift.test.js`, add `'promoAudienceMatches'` to the `VERBATIM` array and `'PROMO_AUDIENCES'` to the `ADAPTED` array.

`PROMO_AUDIENCES` goes in ADAPTED, not VERBATIM: `extractBody` finds the first `{` after the declaration and requires it within 140 characters — an object literal of arrow functions is extracted as a block, but the guard's existing precedent for non-function consts (`CAMPAIGN_GROUP_LABELS`, `MSR_CARD_MIN_DOTS`) is ADAPTED. `tests/promo-audience.test.js` covers the behavior of both copies through `promoAudienceMatches`, which IS byte-compared.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- promo-audience mirror-drift`
Expected: PASS, all tests in both files.

- [ ] **Step 7: Verify the coverage gate still holds**

Run: `npm run test:coverage`
Expected: PASS — statements ≥99, functions ≥99, lines ≥99, branches ≥94. Every arrow in `PROMO_AUDIENCES` is exercised by the "rejects a fully-engaged user for every targeted audience" loop plus the per-audience tests. If branches dropped below 94, add the missing case to the test file rather than lowering the threshold.

- [ ] **Step 8: Commit**

```bash
git add index.html wrotate_test.js tests/promo-audience.test.js tests/mirror-drift.test.js
git commit -m "promo: audience rule registry"
```

---

### Task 4: Slot eligibility and ordering

**Files:**
- Modify: `index.html` — after `promoAudienceMatches`
- Modify: `wrotate_test.js`, `tests/mirror-drift.test.js`
- Test: `tests/promo-eligible.test.js` (create)

**Interfaces:**
- Consumes: `promoAudienceMatches(key, ctx)` from Task 3.
- Produces: `function eligiblePromoSlots({ slots, config, ctx, events, now, modalShown }) -> slot[]` — filtered and sorted, highest priority first.
  - `slots`: rows from `promo_slots`
  - `config`: the `promo_config` row
  - `events`: `[{ slot_id, event }]` — the current user's own rows
  - `now`: epoch ms (injected, never `Date.now()` inside, so tests are deterministic)
  - `modalShown`: boolean

- [ ] **Step 1: Write the failing test**

Create `tests/promo-eligible.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { eligiblePromoSlots } from '../wrotate_test.js';

const NOW = Date.parse('2026-08-02T12:00:00Z');
const CFG = {
  enabled: true, first_position: 2, repeat_every: 0, max_per_session: 1,
  default_max_impressions: 3, suppress_after_modal: true,
};
const CTX = { wearCount: 0, wishlistCount: 0, followingCount: 0, clubCount: 0, measureCount: 0, rankedEver: false, isIos: true };
const slot = (o = {}) => ({
  id: 's1', heading: 'H', audience: 'all', priority: 0, status: 'active',
  starts_at: null, ends_at: null, max_impressions: null,
  created_at: '2026-01-01T00:00:00Z', ...o,
});
const run = (o = {}) => eligiblePromoSlots({
  slots: [slot()], config: CFG, ctx: CTX, events: [], now: NOW, modalShown: false, ...o,
});

describe('eligiblePromoSlots', () => {
  it('returns an eligible slot', () => {
    expect(run().map((s) => s.id)).toEqual(['s1']);
  });

  it('returns nothing when the feature is disabled', () => {
    expect(run({ config: { ...CFG, enabled: false } })).toEqual([]);
  });

  it('returns nothing when a modal already fired and suppression is on', () => {
    expect(run({ modalShown: true })).toEqual([]);
  });

  it('still returns a slot after a modal when suppression is off', () => {
    expect(run({ modalShown: true, config: { ...CFG, suppress_after_modal: false } })).toHaveLength(1);
  });

  it('excludes a slot whose window has not opened', () => {
    expect(run({ slots: [slot({ starts_at: '2026-09-01T00:00:00Z' })] })).toEqual([]);
  });

  it('excludes a slot whose window has closed', () => {
    expect(run({ slots: [slot({ ends_at: '2026-07-01T00:00:00Z' })] })).toEqual([]);
  });

  it('includes a slot inside its window', () => {
    expect(run({ slots: [slot({ starts_at: '2026-08-01T00:00:00Z', ends_at: '2026-08-03T00:00:00Z' })] })).toHaveLength(1);
  });

  it('excludes a slot whose audience does not match', () => {
    expect(run({ slots: [slot({ audience: 'never_logged' })], ctx: { ...CTX, wearCount: 5 } })).toEqual([]);
  });

  it('excludes a slot with an unknown audience key', () => {
    expect(run({ slots: [slot({ audience: 'typo' })] })).toEqual([]);
  });

  it('excludes a dismissed slot', () => {
    expect(run({ events: [{ slot_id: 's1', event: 'dismiss' }] })).toEqual([]);
  });

  it('excludes a slot at the default impression cap', () => {
    const seen = [1, 2, 3].map(() => ({ slot_id: 's1', event: 'impression' }));
    expect(run({ events: seen })).toEqual([]);
  });

  it('still includes a slot one impression below the cap', () => {
    const seen = [1, 2].map(() => ({ slot_id: 's1', event: 'impression' }));
    expect(run({ events: seen })).toHaveLength(1);
  });

  it('honours a per-slot cap over the config default', () => {
    expect(run({ slots: [slot({ max_impressions: 1 })], events: [{ slot_id: 's1', event: 'impression' }] })).toEqual([]);
  });

  it('ignores clicks and dismissals of OTHER slots when counting impressions', () => {
    expect(run({ events: [{ slot_id: 'other', event: 'impression' }, { slot_id: 's1', event: 'click' }] })).toHaveLength(1);
  });

  it('sorts by priority descending', () => {
    const out = run({ slots: [slot({ id: 'lo', priority: 1 }), slot({ id: 'hi', priority: 9 })] });
    expect(out.map((s) => s.id)).toEqual(['hi', 'lo']);
  });

  it('breaks a priority tie with the newer slot first', () => {
    const out = run({ slots: [
      slot({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      slot({ id: 'new', created_at: '2026-06-01T00:00:00Z' }),
    ] });
    expect(out.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('tolerates missing slots, events and config without throwing', () => {
    expect(eligiblePromoSlots({ slots: null, config: null, ctx: CTX, events: null, now: NOW, modalShown: false })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- promo-eligible`
Expected: FAIL — no export named `eligiblePromoSlots`.

- [ ] **Step 3: Implement in `index.html`**

Add after `promoAudienceMatches`:

```js
// Pure: `now` is injected rather than read from Date.now() so the tests are
// deterministic and the caller controls the clock.
function eligiblePromoSlots({ slots, config, ctx, events, now, modalShown }) {
  const cfg = config || {};
  if (!cfg.enabled) return [];
  if (cfg.suppress_after_modal && modalShown) return [];

  const dismissed = new Set();
  const seen = {};
  for (const e of (events || [])) {
    if (e.event === 'dismiss') dismissed.add(e.slot_id);
    else if (e.event === 'impression') seen[e.slot_id] = (seen[e.slot_id] || 0) + 1;
  }

  return (slots || []).filter((s) => {
    if (!s || dismissed.has(s.id)) return false;
    if (s.starts_at && Date.parse(s.starts_at) > now) return false;
    if (s.ends_at   && Date.parse(s.ends_at)  <= now) return false;
    if (!promoAudienceMatches(s.audience, ctx)) return false;
    const cap = s.max_impressions != null ? s.max_impressions : cfg.default_max_impressions;
    return (seen[s.id] || 0) < cap;
  }).sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) ||
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
}
```

- [ ] **Step 4: Mirror into `wrotate_test.js` and register**

Append the same function to `wrotate_test.js` with `export` prefixed. Add `'eligiblePromoSlots'` to the `VERBATIM` array in `tests/mirror-drift.test.js`.

Note: the mirror calls `promoAudienceMatches`, which is already exported from `wrotate_test.js` by Task 3, so the reference resolves in both files.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- promo-eligible mirror-drift`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html wrotate_test.js tests/promo-eligible.test.js tests/mirror-drift.test.js
git commit -m "promo: slot eligibility filtering and ordering"
```

---

### Task 5: Injection position math

**Files:**
- Modify: `index.html`, `wrotate_test.js`, `tests/mirror-drift.test.js`
- Test: `tests/promo-positions.test.js` (create)

**Interfaces:**
- Produces: `function promoInjectPositions({ postCount, config, placedCount }) -> number[]` — sorted ascending list of post indices to insert *before*.

- [ ] **Step 1: Write the failing test**

Create `tests/promo-positions.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { promoInjectPositions } from '../wrotate_test.js';

const CFG = { first_position: 2, repeat_every: 0, max_per_session: 1 };
const at = (o = {}, postCount = 10, placedCount = 0) =>
  promoInjectPositions({ postCount, config: { ...CFG, ...o }, placedCount });

describe('promoInjectPositions', () => {
  it('puts a single card after the configured number of posts', () => {
    expect(at()).toEqual([2]);
  });

  it('clamps to the top when the feed is shorter than first_position', () => {
    expect(at({}, 1)).toEqual([0]);
  });

  it('returns position 0 for an empty feed so the empty state still gets a card', () => {
    expect(at({}, 0)).toEqual([0]);
  });

  it('emits one position when repeat_every is 0, however long the feed', () => {
    expect(at({}, 100)).toEqual([2]);
  });

  it('repeats every N posts when repeat_every is set', () => {
    expect(at({ repeat_every: 4, max_per_session: 3 }, 20)).toEqual([2, 6, 10]);
  });

  it('stops at max_per_session', () => {
    expect(at({ repeat_every: 4, max_per_session: 2 }, 20)).toEqual([2, 6]);
  });

  it('never emits a position past the end of the feed', () => {
    expect(at({ repeat_every: 4, max_per_session: 5 }, 9)).toEqual([2, 6]);
  });

  it('accounts for cards already placed this session', () => {
    expect(at({ repeat_every: 4, max_per_session: 3 }, 20, 1)).toEqual([6, 10]);
  });

  it('returns nothing once the session ceiling is already met', () => {
    expect(at({ repeat_every: 4, max_per_session: 2 }, 20, 2)).toEqual([]);
  });

  it('returns nothing when max_per_session is 0', () => {
    expect(at({ max_per_session: 0 })).toEqual([]);
  });

  it('tolerates a missing config without throwing', () => {
    expect(promoInjectPositions({ postCount: 5, config: null, placedCount: 0 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- promo-positions`
Expected: FAIL — no export named `promoInjectPositions`.

- [ ] **Step 3: Implement in `index.html`**

Add after `eligiblePromoSlots`:

```js
// Post indices to insert a card BEFORE. Positions are absolute over the whole
// feed, so an appended page continues the sequence rather than restarting it.
// placedCount is how many cards this session has already shown.
function promoInjectPositions({ postCount, config, placedCount }) {
  const cfg = config || {};
  const max = cfg.max_per_session || 0;
  const already = placedCount || 0;
  if (max <= 0 || already >= max) return [];
  if (!postCount) return [0];                       // empty feed: below the empty state

  // A feed shorter than first_position puts the card at the top rather than
  // trailing off the end — that short feed is exactly where it earns most.
  const want = cfg.first_position || 0;
  const first = want > postCount ? 0 : want;
  const step = cfg.repeat_every || 0;

  // `i` counts cards from the START of the session, not from this call, so
  // positions consumed on an earlier page are skipped instead of re-emitted.
  const out = [];
  for (let i = already; i < max; i++) {
    const pos = step > 0 ? first + step * i : first;
    if (pos > postCount) break;
    out.push(pos);
    if (step <= 0) break;                           // no repeat: exactly one card
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- promo-positions`
Expected: PASS, all eleven tests.

- [ ] **Step 5: Mirror into `wrotate_test.js` and register**

Append the same function with `export` prefixed. Add `'promoInjectPositions'` to `VERBATIM` in `tests/mirror-drift.test.js`.

- [ ] **Step 6: Run the full unit suite and the coverage gate**

Run: `npm test && npm run test:coverage`
Expected: all 1571+ tests PASS, coverage thresholds met.

- [ ] **Step 7: Commit**

```bash
git add index.html wrotate_test.js tests/promo-positions.test.js tests/mirror-drift.test.js
git commit -m "promo: feed injection position math"
```

---

### Task 6: Card CSS, action registry, and renderer

**Files:**
- Modify: `index.html` — CSS after the `.funfact-row` block (~line 1878); JS after `promoInjectPositions`
- Test: `e2e/promo-card.mock.spec.js` (create)

**Interfaces:**
- Consumes: `sanitizePromoHtml`, `escHtml`, `escAttr`.
- Produces:
  - `const PROMO_ACTIONS` — key → function
  - `function promoActionFor(key) -> function|null`
  - `function renderPromoCard(slot) -> string` (HTML)
  - `function runPromoAction(slotId)` — global, called from the CTA's `onclick`

- [ ] **Step 1: Write the failing test**

Create `e2e/promo-card.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

const SLOT = {
  id: 'p1', kind: 'authored', eyebrow: 'New', heading: 'Rank your collection',
  body: 'Head-to-head matchups <b>sort</b> your watches.',
  image_url: 'https://x.test/hero.jpg', images: [],
  cta_label: 'Start ranking', cta_action: 'open_ranking_game',
};

async function html(page, slot) {
  await page.goto('/');
  return page.evaluate((s) => window.renderPromoCard(s), slot);
}

test.describe('renderPromoCard', () => {
  test('renders the identity block, eyebrow and heading', async ({ page }) => {
    const out = await html(page, SLOT);
    expect(out).toContain('WRotate');
    expect(out).toContain('New');
    expect(out).toContain('Rank your collection');
  });

  test('keeps allowed HTML in the body and drops the rest', async ({ page }) => {
    const out = await html(page, { ...SLOT, body: '<b>keep</b><script>alert(1)<\/script>' });
    expect(out).toContain('<b>keep</b>');
    expect(out).not.toContain('alert(1)');
  });

  test('escapes the heading rather than rendering it as HTML', async ({ page }) => {
    const out = await html(page, { ...SLOT, heading: '<img src=x onerror=alert(1)>' });
    expect(out).not.toContain('onerror=alert');
    expect(out).toContain('&lt;img');
  });

  test('has no like, comment or share controls — the strongest not-a-post signal', async ({ page }) => {
    const out = (await html(page, SLOT)).toLowerCase();
    for (const s of ['togglelike', 'comment-input', 'sharepost', 'feed-card-actions']) {
      expect(out, `promo card must not contain ${s}`).not.toContain(s);
    }
  });

  test('renders the hero 16:9, never the post 4:5', async ({ page }) => {
    const out = await html(page, SLOT);
    expect(out).toContain('promo-card-hero');
    const ratio = await page.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'promo-card-hero';
      document.body.appendChild(d);
      return getComputedStyle(d).aspectRatio;
    });
    expect(ratio.replace(/\s/g, '')).toBe('16/9');
  });

  test('omits the button when the action key is unknown', async ({ page }) => {
    const out = await html(page, { ...SLOT, cta_action: 'not_a_real_action' });
    expect(out).not.toContain('Start ranking');
  });

  test('omits the button when there is no label', async ({ page }) => {
    const out = await html(page, { ...SLOT, cta_label: '' });
    expect(out).not.toContain('runPromoAction');
  });

  test('rejects a non-https url: action', async ({ page }) => {
    const bad = await html(page, { ...SLOT, cta_action: 'url:javascript:alert(1)' });
    expect(bad).not.toContain('Start ranking');
    const good = await html(page, { ...SLOT, cta_action: 'url:https://wrotate.com/open' });
    expect(good).toContain('Start ranking');
  });

  test('expands [img1] tokens from the images array', async ({ page }) => {
    const out = await html(page, {
      ...SLOT, body: 'before [img1] after', images: ['https://x.test/one.jpg'],
    });
    expect(out).toContain('https://x.test/one.jpg');
    expect(out).not.toContain('[img1]');
  });

  test('leaves a token with no matching image as nothing, not literal text', async ({ page }) => {
    const out = await html(page, { ...SLOT, body: 'a [img3] b', images: [] });
    expect(out).not.toContain('[img3]');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=mocked e2e/promo-card.mock.spec.js`
Expected: FAIL — `window.renderPromoCard is not a function`.

- [ ] **Step 3: Add the CSS**

In `index.html`, after the `.funfact-row` block (~line 1878), add:

```css
    /* ── Merchandising slot card ──────────────────────────────────────────
       Spec: docs/superpowers/specs/2026-08-02-merchandising-slots-design.md
       Deliberately shares .feed-card's geometry (16px radius, 1.25rem gap,
       shadow, surface) so it sits in the feed's rhythm. Only identity and
       structure differ. */
    .promo-card {
      background: var(--surface); border-radius: 16px;
      margin-bottom: 1.25rem; overflow: hidden;
      border: 1px solid var(--gold-dim);          /* a tint, not an outline */
      box-shadow: 0 2px 12px rgba(0,0,0,.18);
      position: relative;
    }
    .promo-card-header { display: flex; align-items: center; gap: .75rem; padding: .85rem 1rem .6rem; }
    /* Same 38px slot as .feed-user-avatar so header height is unchanged, but a
       rounded rect rather than a circle — the fastest "not a person" cue. */
    .promo-mark {
      width: 38px; height: 38px; border-radius: var(--radius-sm);
      background: var(--gold-dim); color: var(--gold);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .promo-name { font-weight: 700; font-size: .9rem; line-height: 1.2; }
    /* --badge-accent, NOT --gold: gold measures 2.64:1 on the light card
       surface and fails AA for small text. Same reason .funfact-label uses it
       (see the note at .funfact-row). */
    .promo-eyebrow {
      font-size: var(--fs-sm); font-weight: 700;
      letter-spacing: var(--ls-eyebrow); text-transform: uppercase;
      color: var(--badge-accent);
    }
    /* 16:9, never the post's 4:5 — that portrait crop is a wrist shot's signature. */
    .promo-card-hero { width: 100%; aspect-ratio: 16/9; overflow: hidden; background: var(--surface2); }
    .promo-card-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .promo-card-body { padding: .85rem 1rem 1rem; }
    .promo-heading { font-size: var(--fs-md); font-weight: var(--fw-bold); margin-bottom: .35rem; }
    .promo-body { font-size: var(--fs-base); line-height: var(--lh-body); color: var(--muted); }
    .promo-body img { max-width: 100%; height: auto; border-radius: var(--radius-sm); margin: .5rem 0; }
    .promo-body a { color: var(--badge-accent); }
    .promo-cta { width: 100%; margin-top: .85rem; }
    /* Sits where a post's ⋯ menu sits, so the affordance is where the thumb expects it. */
    .promo-dismiss {
      position: absolute; top: .7rem; right: .7rem;
      background: none; border: 0; color: var(--muted);
      font-size: 1rem; line-height: 1; padding: .25rem .4rem; cursor: pointer;
    }
    .promo-dismiss:hover { color: var(--text); }
```

- [ ] **Step 4: Implement the action registry and renderer**

In `index.html`, after `promoInjectPositions`:

```js
// CTA actions. A key here, never raw JS from the database — an admin-entered
// string can only ever select one of these, or a validated https URL.
const PROMO_ACTIONS = {
  open_wishlist:      () => nav(document.querySelector('nav button[data-page="wishlist"]')),
  open_collection:    () => nav(document.querySelector('nav button[data-page="collection"]')),
  open_track:         () => nav(document.querySelector('nav button[data-page="track"]')),
  open_measure:       () => nav(document.getElementById('nav-measure-btn')),
  open_clubs:         () => showClubsPage(),
  open_discover:      () => openDiscover(),
  open_ranking_game:  () => beginRankingGame(),
};

// Returns a callable for a slot's cta_action, or null. Null means "render no
// button" — an unknown key must never throw and never fall through to a default.
function promoActionFor(key) {
  if (!key) return null;
  if (PROMO_ACTIONS[key]) return PROMO_ACTIONS[key];
  if (key.startsWith('url:')) {
    const url = key.slice(4);
    if (/^https:\/\//i.test(url)) return () => window.open(url, '_blank', 'noopener');
  }
  return null;
}

function runPromoAction(slotId) {
  const slot = (_promoSlots || []).find((s) => s.id === slotId);
  if (!slot) return;
  logPromoEvent(slotId, 'click');
  const fn = promoActionFor(slot.cta_action);
  if (fn) fn();
}

// Mirrors the Broadcast composer's [imgN] convention so the authoring muscle
// memory carries over. Expanded BEFORE sanitizing, so the generated tags go
// through the same allowlist as everything else.
function expandPromoImages(body, images) {
  return String(body || '').replace(/\[img(\d)\]/g, (_, n) => {
    const url = (images || [])[Number(n) - 1];
    return url ? `<img src="${escAttr(url)}" alt="">` : '';
  });
}

function renderPromoCard(slot) {
  const action = promoActionFor(slot.cta_action);
  const cta = (action && slot.cta_label)
    ? `<button type="button" class="btn btn-primary promo-cta"
         onclick="runPromoAction('${escAttr(slot.id)}')">${escHtml(slot.cta_label)}</button>`
    : '';
  const hero = slot.image_url
    ? `<div class="promo-card-hero"><img src="${escAttr(slot.image_url)}" alt=""></div>`
    : '';
  const eyebrow = slot.eyebrow
    ? `<div class="promo-eyebrow">${escHtml(slot.eyebrow)}</div>` : '';
  const body = slot.body
    ? `<div class="promo-body">${sanitizePromoHtml(expandPromoImages(slot.body, slot.images))}</div>` : '';

  return `<div class="promo-card" id="promocard-${escAttr(slot.id)}" data-promo-id="${escAttr(slot.id)}">
    <button type="button" class="promo-dismiss" aria-label="Dismiss"
      onclick="dismissPromo('${escAttr(slot.id)}')">✕</button>
    <div class="promo-card-header">
      <div class="promo-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
          <path d="M 21 7.3 A 10 10 0 1 1 11 7.3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <polygon points="11,7.3 8.5,9.5 7.7,6.6" fill="currentColor"/>
          <circle cx="16" cy="16" r="2.5" fill="currentColor"/>
        </svg>
      </div>
      <div><div class="promo-name">WRotate</div>${eyebrow}</div>
    </div>
    ${hero}
    <div class="promo-card-body">
      <div class="promo-heading">${escHtml(slot.heading || '')}</div>
      ${body}
      ${cta}
    </div>
  </div>`;
}
```

- [ ] **Step 5: Verify the referenced globals exist**

`renderPromoCard` and `PROMO_ACTIONS` reference `nav`, `showClubsPage`, `openDiscover`, `beginRankingGame`, `escHtml`, `escAttr`, `_promoSlots`, `logPromoEvent`, `dismissPromo`.

Run:
```bash
grep -n "function nav(\|function showClubsPage\|function openDiscover\|function beginRankingGame" index.html
```
Expected: all four found. If `showClubsPage` has a different name, use the real one — check `grep -n "page-clubs" index.html` and follow the nav call. `_promoSlots`, `logPromoEvent` and `dismissPromo` are created in Task 7; until then the card renders but the CTA and dismiss throw on click, which is why Step 6 only asserts on markup.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test --project=mocked e2e/promo-card.mock.spec.js`
Expected: PASS, all ten tests.

- [ ] **Step 7: Check contrast in both themes**

Load `http://localhost:3000` on the Mac Mini, open devtools, and render a card via `document.body.insertAdjacentHTML('afterbegin', renderPromoCard({id:'x',eyebrow:'New',heading:'Test',body:'Body copy',cta_label:'Go',cta_action:'open_wishlist'}))`. Confirm in **both** light and dark that the eyebrow passes 4.5:1 against `--surface` using the devtools contrast checker. If light mode fails, `--badge-accent` is wrong for this surface — report it rather than lowering the requirement.

- [ ] **Step 8: Bump the SW cache and commit**

`sw.js` → `wristlog-v991`.

```bash
git add index.html sw.js e2e/promo-card.mock.spec.js
git commit -m "promo: card styles, action registry and renderer"
```

---

### Task 7: Loading, injection, and event tracking

**Files:**
- Modify: `index.html` — JS after `renderPromoCard`; call sites in `renderFeed` (~line 11472) and `loadMoreFeed` (~line 10998)
- Test: `e2e/promo-feed.mock.spec.js` (create)

**Interfaces:**
- Consumes: `eligiblePromoSlots`, `promoInjectPositions`, `renderPromoCard`.
- Produces: `_promoSlots`, `_promoConfig`, `_promoEvents`, `_promoPlaced` (Set); `async function loadPromoSlots()`; `function injectPromoCards()`; `function logPromoEvent(slotId, event)`; `function dismissPromo(slotId)`; `function promoCtx()`.

- [ ] **Step 1: Write the failing test**

Create `e2e/promo-feed.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

// Drives injection directly against a stubbed feed. Top-level let/const in
// index.html are NOT window properties, so these are set as bare identifiers.
async function setup(page, { postCount = 6, config = {}, slots = null } = {}) {
  await page.goto('/');
  await page.evaluate(({ postCount, config, slots }) => {
    currentUser = { id: 'u1' };
    document.getElementById('auth-screen').style.display = 'none';
    _promoConfig = { enabled: true, first_position: 2, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true, ...config };
    _promoSlots = slots || [{
      id: 'p1', heading: 'Promo one', body: 'b', audience: 'all',
      priority: 0, starts_at: null, ends_at: null, max_impressions: null,
      cta_label: 'Go', cta_action: 'open_wishlist', images: [],
      created_at: '2026-01-01T00:00:00Z',
    }];
    _promoEvents = [];
    _promoPlaced = new Set();
    _modalShownThisSession = false;

    window.__events = [];
    db.from = (t) => ({ insert: async (row) => { window.__events.push({ t, row }); return { error: null }; } });

    const el = document.getElementById('feed-list');
    el.innerHTML = Array.from({ length: postCount },
      (_, i) => `<div class="feed-card" id="feedcard-${i}">post ${i}</div>`).join('');
    window.injectPromoCards();
  }, { postCount, config, slots });
}

const order = (page) => page.evaluate(() =>
  [...document.getElementById('feed-list').children].map((n) =>
    n.classList.contains('promo-card') ? 'PROMO' : 'post'));

test.describe('promo feed injection (mocked)', () => {
  test('places the card after the configured number of posts', async ({ page }) => {
    await setup(page);
    expect(await order(page)).toEqual(['post', 'post', 'PROMO', 'post', 'post', 'post', 'post']);
  });

  test('places at the top when the feed is shorter than first_position', async ({ page }) => {
    await setup(page, { postCount: 1 });
    expect(await order(page)).toEqual(['PROMO', 'post']);
  });

  test('is idempotent — a second call does not duplicate the card', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.injectPromoCards());
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(1);
  });

  test('respects max_per_session with repeat_every', async ({ page }) => {
    await setup(page, {
      postCount: 12,
      config: { repeat_every: 4, max_per_session: 2 },
      slots: [1, 2, 3].map((n) => ({
        id: `p${n}`, heading: `Promo ${n}`, audience: 'all', priority: 0,
        starts_at: null, ends_at: null, max_impressions: null, images: [],
        created_at: '2026-01-01T00:00:00Z',
      })),
    });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(2);
  });

  test('injects nothing when disabled', async ({ page }) => {
    await setup(page, { config: { enabled: false } });
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
  });

  test('dismiss removes the card and writes a dismiss event', async ({ page }) => {
    await setup(page);
    await page.click('.promo-dismiss');
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
    const evs = await page.evaluate(() => window.__events);
    expect(evs.some((e) => e.t === 'promo_events' && e.row.event === 'dismiss')).toBe(true);
  });

  test('a dismissed card does not come back on the next injection', async ({ page }) => {
    await setup(page);
    await page.click('.promo-dismiss');
    await page.evaluate(() => window.injectPromoCards());
    expect((await order(page)).filter((x) => x === 'PROMO')).toHaveLength(0);
  });

  test('a failed slot fetch leaves the feed intact', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      currentUser = { id: 'u1' };
      db.from = () => ({ select: () => ({ eq: () => Promise.reject(new Error('boom')) }) });
      await window.loadPromoSlots();          // must not throw
      document.getElementById('feed-list').innerHTML = '<div class="feed-card">p</div>';
      window.injectPromoCards();
    });
    expect(await order(page)).toEqual(['post']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=mocked e2e/promo-feed.mock.spec.js`
Expected: FAIL — `injectPromoCards is not a function`.

- [ ] **Step 3: Implement state, loading and tracking**

In `index.html`, after `renderPromoCard`:

```js
let _promoSlots  = [];
let _promoConfig = null;
let _promoEvents = [];
let _promoPlaced = new Set();          // slot ids already placed this session
let _promoObserver = null;
let _promoImpressed = new Set();       // impressions already logged this session

// Counts the audience predicates run against. Everything here is already in
// memory after loadUserData(), so targeting costs no round-trip.
function promoCtx() {
  return {
    watchCount:     (watches || []).length,
    // The authoritative wear rule, matching isWearEntry() and
    // one_and_done_winback_users(): a watch_id AND not a measurement.
    wearCount:      (logs || []).filter((l) => l && l.watchId && l.useCase !== 'measurement').length,
    wishlistCount:  (wishlist || []).length,
    followingCount: following ? following.size : 0,
    measureCount:   parseInt(localStorage.getItem('wristlog_msr_count') || '0'),
    clubCount:      (myClubs || []).length,
    rankedEver:     Object.keys(eloRatings || {}).length > 0,
    daysSinceSignup: myProfile?.created_at
      ? Math.floor((Date.now() - Date.parse(myProfile.created_at)) / 86400000) : 0,
    isIos:          !!window._iosAppVersion,
  };
}

// Non-fatal by design: a broken promo fetch must never degrade the feed.
async function loadPromoSlots() {
  if (!currentUser) return;
  try {
    const [cfgRes, slotRes, evRes] = await Promise.all([
      db.from('promo_config').select('*').limit(1).maybeSingle(),
      db.from('promo_slots').select('*'),
      db.from('promo_events').select('slot_id,event').eq('user_id', currentUser.id),
    ]);
    _promoConfig = cfgRes?.data || null;
    _promoSlots  = slotRes?.data || [];
    _promoEvents = evRes?.data || [];
  } catch (e) {
    console.warn('[promo] load failed:', e.message);
    _promoConfig = null; _promoSlots = []; _promoEvents = [];
  }
}

function logPromoEvent(slotId, event) {
  if (!currentUser) return;
  db.from('promo_events')
    .insert({ user_id: currentUser.id, slot_id: slotId, event })
    .then(() => {}).catch(() => {});
  _promoEvents.push({ slot_id: slotId, event });
}

function dismissPromo(slotId) {
  document.getElementById('promocard-' + slotId)?.remove();
  _promoPlaced.add(slotId);              // keeps it out of this session's re-renders
  logPromoEvent(slotId, 'dismiss');
}
```

- [ ] **Step 4: Implement injection**

Add after `dismissPromo`:

```js
// Idempotent. Runs after renderFeed() and after loadMoreFeed()'s append; a slot
// already placed is never placed twice, so re-renders and appended pages are safe.
function injectPromoCards() {
  const el = document.getElementById('feed-list');
  if (!el || !currentUser) return;

  const eligible = eligiblePromoSlots({
    slots: _promoSlots, config: _promoConfig, ctx: promoCtx(),
    events: _promoEvents, now: Date.now(),
    modalShown: !!window._modalShownThisSession,
  }).filter((s) => !_promoPlaced.has(s.id));
  if (!eligible.length) return;

  const posts = [...el.querySelectorAll(':scope > .feed-card')];
  const positions = promoInjectPositions({
    postCount: posts.length, config: _promoConfig, placedCount: _promoPlaced.size,
  });

  positions.forEach((pos, i) => {
    const slot = eligible[i];
    if (!slot) return;
    const html = renderPromoCard(slot);
    if (pos >= posts.length) el.insertAdjacentHTML('beforeend', html);
    else posts[pos].insertAdjacentHTML('beforebegin', html);
    _promoPlaced.add(slot.id);
  });

  observePromoImpressions();
}

function observePromoImpressions() {
  if (!_promoObserver) {
    _promoObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.dataset.promoId;
        if (id && !_promoImpressed.has(id)) {
          _promoImpressed.add(id);
          logPromoEvent(id, 'impression');
        }
        _promoObserver.unobserve(e.target);
      }
    }, { threshold: 0.5 });
  }
  document.querySelectorAll('.promo-card[data-promo-id]').forEach((c) => _promoObserver.observe(c));
}
```

- [ ] **Step 5: Wire the call sites**

In `renderFeed()` (`index.html:11472`), after `mountFeedLoadMoreSentinel();`, add:
```js
  injectPromoCards();
```

In `loadMoreFeed()` (`index.html:~10998`), after the appended cards are inserted, add the same line.

In `bootApp()` (`index.html:~28757`), after `await loadUserData();` and before `checkReminderNow();`, add:
```js
  await loadPromoSlots();   // audience predicates need the counts loadUserData() fills
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test --project=mocked e2e/promo-feed.mock.spec.js`
Expected: PASS, all eight tests.

- [ ] **Step 7: Run the full E2E suite to check for feed regressions**

Run: `npm run test:e2e`
Expected: all 179+ tests PASS. The feed specs (`feed-load-more`, `feed-scroll-restore`, `app.mock`) exercise the paths just modified — if any fail, the injection is interfering with post ordering or the load-more sentinel. Fix before committing.

- [ ] **Step 8: Bump the SW cache and commit**

`sw.js` → `wristlog-v992`.

```bash
git add index.html sw.js e2e/promo-feed.mock.spec.js
git commit -m "promo: load, inject and track merchandising slots in the feed"
```

---

### Task 8: `_modalShownThisSession` flag

**Files:**
- Modify: `index.html` — declare near `_promoSlots`; set in four modal openers
- Test: `e2e/promo-modal-suppress.mock.spec.js` (create)

**Interfaces:**
- Produces: `window._modalShownThisSession` (boolean), consumed by `injectPromoCards` from Task 7.

- [ ] **Step 1: Write the failing test**

Create `e2e/promo-modal-suppress.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('a modal that fired this session suppresses the slot', async ({ page }) => {
  await page.goto('/');
  const injected = await page.evaluate(() => {
    currentUser = { id: 'u1' };
    _promoConfig = { enabled: true, first_position: 0, repeat_every: 0,
                     max_per_session: 1, default_max_impressions: 3,
                     suppress_after_modal: true };
    _promoSlots = [{ id: 'p1', heading: 'H', audience: 'all', priority: 0,
                     starts_at: null, ends_at: null, max_impressions: null,
                     images: [], created_at: '2026-01-01T00:00:00Z' }];
    _promoEvents = []; _promoPlaced = new Set();

    window._modalShownThisSession = true;
    document.getElementById('feed-list').innerHTML = '<div class="feed-card">p</div>';
    window.injectPromoCards();
    return document.querySelectorAll('.promo-card').length;
  });
  expect(injected).toBe(0);
});

test('openFactModal marks the session as having shown a modal', async ({ page }) => {
  await page.goto('/');
  const flagged = await page.evaluate(() => {
    window._modalShownThisSession = false;
    window.openFactModal({ id: 'w1', brand: 'Seiko', name: 'SKX' }, 'A fact.');
    return window._modalShownThisSession;
  });
  expect(flagged).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=mocked e2e/promo-modal-suppress.mock.spec.js`
Expected: the second test FAILS — nothing sets the flag.

- [ ] **Step 3: Declare the flag**

In `index.html`, next to `let _promoSlots = [];` add:

```js
// Set by any modal that takes over the screen. injectPromoCards() reads it so a
// user never gets a modal AND a slot in the same session (promo_config
// .suppress_after_modal). On window so E2E can drive it.
window._modalShownThisSession = false;
```

- [ ] **Step 4: Set the flag in each modal opener**

Add `window._modalShownThisSession = true;` as the first statement inside each of:
- `openFactModal(watch, factText)` (~line 11153) — after the early-return guard, so a modal that bails does not set it
- `showNextAnniversary()` (~line 14669)
- the badge reveal opener — find it with `grep -n "function .*[Bb]adgeReveal" index.html`
- the push primer opener — find it with `grep -n "function maybeShowPushPrimer" index.html`

For each, place the assignment at the point where the modal is actually shown (after every guard), not at the top of the function.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test --project=mocked e2e/promo-modal-suppress.mock.spec.js`
Expected: PASS, both tests.

- [ ] **Step 6: Run the modal regression specs**

Run: `npx playwright test --project=mocked e2e/fact-modal.mock.spec.js`
Expected: PASS — the flag must not change fact-modal gating.

- [ ] **Step 7: Bump the SW cache and commit**

`sw.js` → `wristlog-v993`.

```bash
git add index.html sw.js e2e/promo-modal-suppress.mock.spec.js
git commit -m "promo: suppress a slot when a modal already fired this session"
```

---

### Task 9: Admin "Promos" tab

**Files:**
- Modify: `index.html` — tab chip (~line 3043), tab panel (after the campaigns panel ~line 3258), JS with the other admin functions (~line 16400)
- Test: `e2e/promo-admin.mock.spec.js` (create)

**Interfaces:**
- Consumes: `PROMO_AUDIENCES`, `PROMO_ACTIONS`, `renderPromoCard`, `switchAdminTab`.
- Produces: `loadPromoAdmin()`, `updatePromoPreview()`, `savePromoSlot()`, `setPromoStatus(id, status)`, `savePromoConfig()`.

- [ ] **Step 1: Write the failing test**

Create `e2e/promo-admin.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.describe('admin Promos tab (mocked)', () => {
  test('audience and action dropdowns are generated from the registries', async ({ page }) => {
    await page.goto('/');
    const { audiences, actions } = await page.evaluate(() => {
      window.renderPromoAdminOptions();
      const opts = (id) => [...document.getElementById(id).options].map((o) => o.value);
      return { audiences: opts('promo-audience'), actions: opts('promo-cta-action') };
    });
    await page.evaluate(() => { window.__keys = Object.keys(PROMO_AUDIENCES); });
    const registryAudiences = await page.evaluate(() => window.__keys);
    // Generated, not hand-maintained — the two can never drift.
    expect(audiences).toEqual(registryAudiences);
    expect(actions).toContain('open_ranking_game');
  });

  test('the preview renders the real card, not a second renderer', async ({ page }) => {
    await page.goto('/');
    const same = await page.evaluate(() => {
      document.getElementById('promo-heading').value = 'Preview me';
      document.getElementById('promo-body').value = '<b>bold</b>';
      window.updatePromoPreview();
      const preview = document.getElementById('promo-preview').innerHTML;
      return preview.includes('Preview me') && preview.includes('<b>bold</b>');
    });
    expect(same).toBe(true);
  });

  test('the preview sanitizes exactly like the feed does', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(() => {
      document.getElementById('promo-heading').value = 'H';
      document.getElementById('promo-body').value = '<script>alert(1)<\/script>ok';
      window.updatePromoPreview();
      return document.getElementById('promo-preview').innerHTML;
    });
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('ok');
  });

  test('a new slot is saved as a draft, never active', async ({ page }) => {
    await page.goto('/');
    const row = await page.evaluate(async () => {
      currentUser = { id: 'd70b1a85-4f31-4431-b3b7-db76543daaf5' };
      let captured = null;
      db.from = () => ({ insert: async (r) => { captured = r; return { data: [r], error: null }; } });
      document.getElementById('promo-heading').value = 'Draft slot';
      await window.savePromoSlot();
      return captured;
    });
    expect(row.status).toBe('draft');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=mocked e2e/promo-admin.mock.spec.js`
Expected: FAIL — the elements do not exist.

- [ ] **Step 3: Add the tab chip**

In `index.html:3043`, before the `dev` chip, add:

```html
        <button type="button" class="chip" data-tab="promos" role="tab" aria-selected="false" aria-controls="admin-tab-promos" onclick="switchAdminTab('promos')">Promos</button>
```

- [ ] **Step 4: Add the tab panel**

After the campaigns panel (`index.html:3258`), add:

```html
    <!-- Tab: Promos -->
    <div id="admin-tab-promos" class="admin-tab" role="tabpanel" style="display:none;">
      <div style="margin-bottom:.75rem;"><div class="eyebrow">Merchandising Slots</div></div>

      <div style="background:var(--surface2);border-radius:var(--radius);padding:.85rem;margin-bottom:1rem;">
        <div class="draft-form-row">
          <label for="promo-eyebrow">Eyebrow</label>
          <input type="text" id="promo-eyebrow" placeholder="New" oninput="updatePromoPreview()">
        </div>
        <div class="draft-form-row">
          <label for="promo-heading">Heading</label>
          <input type="text" id="promo-heading" placeholder="Rank your collection" oninput="updatePromoPreview()">
        </div>
        <div class="draft-form-row">
          <label for="promo-body">Body (HTML: &lt;b&gt;, &lt;a&gt;, &lt;ul&gt;/&lt;li&gt;, &lt;img&gt;. Use [img1] [img2] [img3] for uploads)</label>
          <textarea id="promo-body" rows="6" oninput="updatePromoPreview()"></textarea>
        </div>
        <div class="draft-form-row">
          <label for="promo-image-url">Hero image URL (16:9)</label>
          <input type="text" id="promo-image-url" oninput="updatePromoPreview()">
        </div>
        <div class="draft-form-row">
          <label for="promo-images">Inline image URLs, one per line (referenced as [img1]…[img3])</label>
          <textarea id="promo-images" rows="3" oninput="updatePromoPreview()"></textarea>
        </div>
        <div class="draft-form-row">
          <label for="promo-cta-label">CTA label</label>
          <input type="text" id="promo-cta-label" placeholder="Start ranking" oninput="updatePromoPreview()">
        </div>
        <div class="draft-form-row">
          <label for="promo-cta-action">CTA action</label>
          <select id="promo-cta-action" onchange="updatePromoPreview()"></select>
        </div>
        <div class="draft-form-row">
          <label for="promo-cta-url">…or an https URL (used when action is "Custom URL")</label>
          <input type="text" id="promo-cta-url" placeholder="https://wrotate.com/open" oninput="updatePromoPreview()">
        </div>
        <div class="draft-form-row">
          <label for="promo-audience">Audience</label>
          <select id="promo-audience"></select>
        </div>
        <div class="draft-form-row">
          <label for="promo-starts">Starts</label>
          <input type="datetime-local" id="promo-starts">
        </div>
        <div class="draft-form-row">
          <label for="promo-ends">Ends</label>
          <input type="datetime-local" id="promo-ends">
        </div>
        <div class="draft-form-row">
          <label for="promo-priority">Priority (higher wins)</label>
          <input type="number" id="promo-priority" value="0">
        </div>
        <div class="draft-form-row">
          <label for="promo-max-impressions">Max impressions per user (blank = config default)</label>
          <input type="number" id="promo-max-impressions" placeholder="3">
        </div>

        <div class="draft-form-row">
          <label id="promo-preview-label">Card preview</label>
          <div id="promo-preview" aria-labelledby="promo-preview-label" style="max-width:470px;"></div>
        </div>

        <button class="btn btn-primary" onclick="savePromoSlot()" style="width:100%;">Save as Draft</button>
        <div id="promo-status" aria-live="polite" style="font-size:.82rem;margin-top:.5rem;"></div>
      </div>

      <div class="eyebrow" style="margin-bottom:.5rem;">Slots</div>
      <div id="promo-list" style="margin-bottom:1rem;">Loading…</div>

      <div class="eyebrow" style="margin-bottom:.5rem;">Delivery</div>
      <div style="background:var(--surface2);border-radius:var(--radius);padding:.85rem;">
        <div class="draft-form-row"><label for="promo-cfg-enabled">Enabled</label>
          <input type="checkbox" id="promo-cfg-enabled"></div>
        <div class="draft-form-row"><label for="promo-cfg-first">First position (posts before the first card)</label>
          <input type="number" id="promo-cfg-first"></div>
        <div class="draft-form-row"><label for="promo-cfg-repeat">Repeat every N posts (0 = no repeat)</label>
          <input type="number" id="promo-cfg-repeat"></div>
        <div class="draft-form-row"><label for="promo-cfg-max">Max cards per session</label>
          <input type="number" id="promo-cfg-max"></div>
        <div class="draft-form-row"><label for="promo-cfg-imp">Default max impressions per user</label>
          <input type="number" id="promo-cfg-imp"></div>
        <div class="draft-form-row"><label for="promo-cfg-suppress">Suppress when a modal already fired</label>
          <input type="checkbox" id="promo-cfg-suppress"></div>
        <button class="btn btn-ghost" onclick="savePromoConfig()" style="width:100%;">Save delivery settings</button>
        <div id="promo-cfg-status" aria-live="polite" style="font-size:.82rem;margin-top:.5rem;"></div>
      </div>
    </div>
```

- [ ] **Step 5: Implement the admin JS**

Add near the other admin functions (~line 16400):

```js
// Dropdowns are GENERATED from the registries, so a new audience or action
// appears in the admin UI automatically and the two can never drift.
const PROMO_AUDIENCE_LABELS = {
  all: 'All users', never_logged: 'Never logged a wear', no_wishlist: 'Empty wishlist',
  never_measured: 'Never measured (iOS only)', no_clubs: 'In no club',
  follows_few: 'Follows fewer than 3 people', never_ranked: 'Never played the ranking game',
};
const PROMO_ACTION_LABELS = {
  '': 'No button', open_wishlist: 'Open Wishlist', open_collection: 'Open Collection',
  open_track: 'Open Track', open_measure: 'Open Measure', open_clubs: 'Open Clubs',
  open_discover: 'Open Discover', open_ranking_game: 'Start the ranking game',
  'url:': 'Custom URL (https only)',
};

function renderPromoAdminOptions() {
  const aud = document.getElementById('promo-audience');
  const act = document.getElementById('promo-cta-action');
  if (!aud || !act) return;
  aud.innerHTML = Object.keys(PROMO_AUDIENCES)
    .map((k) => `<option value="${escAttr(k)}">${escHtml(PROMO_AUDIENCE_LABELS[k] || k)}</option>`).join('');
  act.innerHTML = ['', ...Object.keys(PROMO_ACTIONS), 'url:']
    .map((k) => `<option value="${escAttr(k)}">${escHtml(PROMO_ACTION_LABELS[k] || k)}</option>`).join('');
}

function promoFormSlot() {
  const val = (id) => document.getElementById(id)?.value?.trim() || '';
  const action = val('promo-cta-action');
  return {
    id: 'preview',
    eyebrow: val('promo-eyebrow'),
    heading: val('promo-heading'),
    body: val('promo-body'),
    image_url: val('promo-image-url'),
    images: val('promo-images').split('\n').map((s) => s.trim()).filter(Boolean),
    cta_label: val('promo-cta-label'),
    cta_action: action === 'url:' ? 'url:' + val('promo-cta-url') : action,
    audience: val('promo-audience') || 'all',
    priority: parseInt(val('promo-priority') || '0'),
    max_impressions: val('promo-max-impressions') ? parseInt(val('promo-max-impressions')) : null,
    starts_at: val('promo-starts') ? new Date(val('promo-starts')).toISOString() : null,
    ends_at:   val('promo-ends')   ? new Date(val('promo-ends')).toISOString()   : null,
  };
}

// Calls the REAL renderer — the preview is the shipped output, not a second
// implementation that can drift from it.
function updatePromoPreview() {
  const el = document.getElementById('promo-preview');
  if (el) el.innerHTML = renderPromoCard(promoFormSlot());
}

// Always saves as a draft. Activating a slot puts content in real users' feeds
// and is a deliberate second step (setPromoStatus), never a side effect of saving.
async function savePromoSlot() {
  const st = document.getElementById('promo-status');
  const slot = promoFormSlot();
  if (!slot.heading) { if (st) st.textContent = 'A heading is required.'; return; }
  delete slot.id;
  slot.status = 'draft';
  slot.created_by = currentUser?.id || null;
  const { error } = await db.from('promo_slots').insert(slot);
  if (st) st.textContent = error ? ('Error: ' + error.message) : 'Saved as draft.';
  if (!error) loadPromoAdmin();
}

async function setPromoStatus(id, status) {
  const { error } = await db.from('promo_slots').update({ status }).eq('id', id);
  if (error) { toast('Could not update slot: ' + error.message, 'error'); return; }
  loadPromoAdmin();
}

async function loadPromoAdmin() {
  if (currentUser?.id !== ADMIN_USER_ID) return;
  renderPromoAdminOptions();
  const listEl = document.getElementById('promo-list');

  const [{ data: cfg }, { data: slots }, { data: stats }] = await Promise.all([
    db.from('promo_config').select('*').limit(1).maybeSingle(),
    db.from('promo_slots').select('*').order('created_at', { ascending: false }),
    db.rpc('promo_slot_stats'),
  ]);

  if (cfg) {
    document.getElementById('promo-cfg-enabled').checked = !!cfg.enabled;
    document.getElementById('promo-cfg-first').value    = cfg.first_position;
    document.getElementById('promo-cfg-repeat').value   = cfg.repeat_every;
    document.getElementById('promo-cfg-max').value      = cfg.max_per_session;
    document.getElementById('promo-cfg-imp').value      = cfg.default_max_impressions;
    document.getElementById('promo-cfg-suppress').checked = !!cfg.suppress_after_modal;
  }

  const byId = {};
  (stats || []).forEach((s) => { byId[s.slot_id] = s; });
  if (!listEl) return;
  listEl.innerHTML = (slots || []).length === 0
    ? '<div style="color:var(--muted);font-size:.82rem;">No slots yet.</div>'
    : slots.map((s) => {
        const st = byId[s.id] || {};
        const next = s.status === 'active' ? 'archived' : 'active';
        return `<div class="admin-card">
          <div style="font-weight:600;">${escHtml(s.heading)}</div>
          <div style="font-size:.78rem;color:var(--muted);">
            ${escHtml(s.status)} · ${escHtml(PROMO_AUDIENCE_LABELS[s.audience] || s.audience)} ·
            ${st.impressions || 0} impressions · ${st.clicks || 0} clicks ·
            ${st.dismissals || 0} dismissed · ${st.distinct_users || 0} users
          </div>
          <button class="btn btn-ghost" style="font-size:.78rem;margin-top:.4rem;"
            onclick="setPromoStatus('${escAttr(s.id)}','${escAttr(next)}')">
            ${next === 'active' ? 'Activate' : 'Archive'}</button>
        </div>`;
      }).join('');
}

async function savePromoConfig() {
  const st = document.getElementById('promo-cfg-status');
  const { error } = await db.from('promo_config').update({
    enabled:                 document.getElementById('promo-cfg-enabled').checked,
    first_position:          parseInt(document.getElementById('promo-cfg-first').value || '0'),
    repeat_every:            parseInt(document.getElementById('promo-cfg-repeat').value || '0'),
    max_per_session:         parseInt(document.getElementById('promo-cfg-max').value || '0'),
    default_max_impressions: parseInt(document.getElementById('promo-cfg-imp').value || '0'),
    suppress_after_modal:    document.getElementById('promo-cfg-suppress').checked,
  }).eq('id', true);
  if (st) st.textContent = error ? ('Error: ' + error.message) : 'Saved.';
}
```

- [ ] **Step 6: Wire the tab into `switchAdminTab`**

In `switchAdminTab` (`index.html:~15157`), after `if (tab === 'featured') loadAdminFeatured();`, add:
```js
  if (tab === 'promos') loadPromoAdmin();
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx playwright test --project=mocked e2e/promo-admin.mock.spec.js`
Expected: PASS, all four tests.

- [ ] **Step 8: Verify the RPC is reachable from the client**

Run:
```bash
npx supabase db query --linked "select proname from pg_proc where proname = 'promo_slot_stats';"
```
Expected: one row. If PostgREST returns a 404 for `promo_slot_stats` in the browser, run `npx supabase db query --linked "notify pgrst, 'reload schema';"` — new RPCs need a schema reload before the client can call them.

- [ ] **Step 9: Bump the SW cache and commit**

`sw.js` → `wristlog-v994`.

```bash
git add index.html sw.js e2e/promo-admin.mock.spec.js
git commit -m "promo: admin Promos tab with composer, preview, stats and delivery settings"
```

---

### Task 10: Retire the new-features modal

**Files:**
- Modify: `index.html` — remove `maybeShowNewFeatures` (~14638), `closeNewFeatures` (~14645), the `#new-features-modal` markup, the overlay-close map entry (~25304), the `bootApp` call (~28761)
- Create: `sql/2026-08-02-promo-seed-whats-new.sql`
- Test: `e2e/promo-no-newfeatures.mock.spec.js` (create)

- [ ] **Step 1: Find every reference**

Run:
```bash
grep -n "new-features-modal\|maybeShowNewFeatures\|closeNewFeatures" index.html
```
Record every line. All must be gone by Step 4.

- [ ] **Step 2: Write the failing test**

Create `e2e/promo-no-newfeatures.mock.spec.js`:

```js
import { test, expect } from '@playwright/test';

test('the new-features modal is gone — slots replace it', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => ({
    el: !!document.getElementById('new-features-modal'),
    opener: typeof window.maybeShowNewFeatures,
    closer: typeof window.closeNewFeatures,
  }));
  expect(state.el).toBe(false);
  expect(state.opener).toBe('undefined');
  expect(state.closer).toBe('undefined');
});

test('the user-initiated What\'s New modal still works', async ({ page }) => {
  await page.goto('/');
  const shown = await page.evaluate(() => {
    window.openWhatsNew();
    return !document.getElementById('whats-new-modal').classList.contains('hidden');
  });
  expect(shown).toBe(true);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx playwright test --project=mocked e2e/promo-no-newfeatures.mock.spec.js`
Expected: the first test FAILS — the modal still exists.

- [ ] **Step 4: Remove the modal**

Delete, at every line found in Step 1:
- the `#new-features-modal` markup block
- `function maybeShowNewFeatures() { … }` and `function closeNewFeatures() { … }`
- the `'new-features-modal': closeNewFeatures,` entry in the overlay-close map (~25304)
- the `maybeShowNewFeatures();` call in `bootApp()` (~28761)

Leave `openWhatsNew` / `closeWhatsNew` and `#whats-new-modal` alone — that one is user-initiated from Help, not an interrupt.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test --project=mocked e2e/promo-no-newfeatures.mock.spec.js`
Expected: PASS, both tests.

- [ ] **Step 6: Seed the first slot as a DRAFT**

Read the `#whats-new-modal` markup for the current copy, then create `sql/2026-08-02-promo-seed-whats-new.sql` with that copy:

```sql
-- Seeds the retired new-features modal's copy as the first slot.
-- DRAFT, not active: activating it puts content in real users' feeds and is
-- the user's call, not the implementer's.
insert into public.promo_slots (eyebrow, heading, body, cta_label, cta_action, audience, status, priority)
values ('New', '<HEADING FROM #whats-new-modal>', '<BODY FROM #whats-new-modal>',
        'See what''s new', 'open_collection', 'all', 'draft', 0);
```

Replace both placeholders with the real copy read from the markup before applying. Do not invent copy.

Run: `npx supabase db query --linked --file sql/2026-08-02-promo-seed-whats-new.sql`
Expected: no error.

- [ ] **Step 7: Confirm the seeded row is a draft**

Run:
```bash
npx supabase db query --linked "select heading, status from promo_slots order by created_at desc limit 1;"
```
Expected: `status` is `draft`. If it is `active`, fix it immediately — no slot ships live in this task.

- [ ] **Step 8: Bump the SW cache and commit**

`sw.js` → `wristlog-v995`.

```bash
git add index.html sw.js sql/2026-08-02-promo-seed-whats-new.sql e2e/promo-no-newfeatures.mock.spec.js
git commit -m "promo: retire the new-features modal, seed its copy as a draft slot"
```

---

### Task 11: Full verification and docs

**Files:**
- Modify: `index.html` — Help page and "What's New" section

- [ ] **Step 1: Run the entire suite**

Run: `npm test && npm run test:e2e`
Expected: all 1571+ unit and 179+ E2E tests PASS. Do not proceed on a single failure.

- [ ] **Step 2: Run the coverage gate**

Run: `npm run test:coverage`
Expected: statements ≥99, functions ≥99, lines ≥99, branches ≥94 on `wrotate_test.js`.

- [ ] **Step 3: Confirm no secrets or hardcoded UUIDs were introduced**

Run:
```bash
git diff main --stat
grep -n "internal_accounts" sql/2026-08-02-promo-slots.sql
```
Expected: the stats RPC excludes `internal_accounts`; no UUID literals in the new JS beyond the existing `ADMIN_USER_ID`.

- [ ] **Step 4: Manual check on the real dev server, both themes**

Open `http://localhost:3000` on the Mac Mini signed in as a test account (`test@wrotate.com` — never James Collins/watchdemo). In devtools:
```js
_promoConfig = { enabled:true, first_position:2, repeat_every:0, max_per_session:1, default_max_impressions:3, suppress_after_modal:false };
_promoSlots = [{ id:'demo', eyebrow:'New', heading:'Rank your collection', body:'Head-to-head matchups <b>sort</b> your watches.', audience:'all', priority:0, starts_at:null, ends_at:null, max_impressions:null, images:[], cta_label:'Start ranking', cta_action:'open_ranking_game', created_at:'2026-01-01T00:00:00Z' }];
_promoEvents = []; _promoPlaced = new Set();
injectPromoCards();
```
Confirm: the card sits after post 2; reads as WRotate, not a user; the CTA opens the ranking game; ✕ removes it. Repeat in light and dark. Screenshot both.

- [ ] **Step 5: Update the Help page and "What's New"**

Per CLAUDE.md ("After Each Working Day"), add a "What's New" entry describing the change in user-facing terms. Do NOT modify the landing page.

- [ ] **Step 6: Final commit**

```bash
git add index.html
git commit -m "promo: document merchandising slots in Help and What's New"
```

- [ ] **Step 7: Report, do not push**

Summarize for the user: what shipped, the seeded draft slot awaiting their decision, and that `promo_config` defaults are quiet (1 card/session, cap 3). **Do not `git push`** and **do not activate the seeded slot** — both are the user's call.

---

## Self-Review

**Spec coverage:** Card design → Task 6. `promo_slots`/`promo_events`/`promo_config` + RLS + stats RPC → Task 1. `PROMO_AUDIENCES` → Task 3. `PROMO_ACTIONS` → Task 6. `sanitizePromoHtml` → Task 2. Selection → Task 4. Injection → Tasks 5 and 7. Impressions/dismiss → Task 7. `_modalShownThisSession` → Task 8. Admin tab → Task 9. Retire new-features modal → Task 10. Testing + SW bump → every task, consolidated in Task 11.

**Deviation from the spec, flagged:** the spec's Testing section calls for a vitest file `tests/promo-sanitize.test.js`. That is not possible — vitest runs in Node with no `DOMParser`, and adding jsdom would mean a new devDependency. The sanitizer is tested in real Chromium via `e2e/promo-sanitize.mock.spec.js` instead, which is also the stronger test: the browser parser is the one that actually decides whether a bypass works. The spec's `tests/promo-slots.test.js` is split into three focused vitest files (`promo-audience`, `promo-eligible`, `promo-positions`) so each carries its own test cycle.

**Also deferred from the spec:** the admin composer uses image URL fields rather than reusing `handleBroadcastPhotoDrop` drop zones. Reusing the broadcast upload handler requires it to be parameterized away from `broadcast-*` element IDs — a refactor of working code that the spec's goal does not need. URLs are functionally complete; drop zones can follow.

**Type consistency:** `eligiblePromoSlots({slots, config, ctx, events, now, modalShown})` — same names in Tasks 4 and 7. `promoInjectPositions({postCount, config, placedCount})` — same in Tasks 5 and 7. `_promoSlots`/`_promoConfig`/`_promoEvents`/`_promoPlaced` declared in Task 7, referenced in Tasks 6 (`runPromoAction`), 8 and 9. `logPromoEvent(slotId, event)` and `dismissPromo(slotId)` referenced by `renderPromoCard` in Task 6, defined in Task 7 — Task 6 Step 5 states this explicitly so the implementer is not surprised.
