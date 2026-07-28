# Feed Fun-Fact Footnote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tappable "💡 Fun fact" pill in the feed post card with an always-visible footnote line clamped to 3 lines, keeping tap-to-expand and adding an impression event so expand rate becomes computable.

**Architecture:** A new pure `funFactRowHTML()` builder emits a single `<button>` whose text content is the whole footnote, so the accessible name comes out as "Fun fact — …" with no `aria-label`. Collapsed state is `-webkit-line-clamp: 3`; because `line-clamp` can't be transitioned, expand/collapse animates `max-height` with the clamp class removed for the duration. Impressions go to a new `fact_impressions` Postgres table shaped exactly like `fact_clicks`, so the existing admin RPC can compute a ratio from two comparable counts.

**Tech Stack:** Vanilla JS in `index.html` (no frameworks), Vitest unit tests against mirrored pure functions in `wrotate_test.js`, Playwright for E2E, Supabase Postgres + SECURITY DEFINER RPCs.

**Spec:** `docs/superpowers/specs/2026-07-27-feed-fun-fact-footnote-design.md`

## Global Constraints

- Vanilla JS only — no frameworks, no new dependencies, no webfonts.
- Label and bulb colour is `var(--badge-accent)`. Do **not** use `#B8952A` / `var(--badge-tier)` — it measures 2.64:1 on the light card surface and fails AA.
- Body text colour is `var(--muted)`. `--text-secondary` does not exist in this codebase.
- Footnote type is 13px / `line-height: 1.5`. Collapsed height is exactly `58.5px` (3 × 13 × 1.5).
- `funFactCardHTML()` and `.funfact-card` CSS must not change — the login modal (index.html:11042) and `previewWatch` (index.html:23784) still render the amber card.
- Every pure function defined in both `index.html` and `wrotate_test.js` must be registered in `tests/mirror-drift.test.js` (VERBATIM or ADAPTED) or that test fails.
- Do NOT modify `supabase/functions/identify-watch/lib.ts` — the Gemini prompt change is out of scope.
- Run `npm test` before every commit.
- The pre-commit hook runs an unconditional `git add index.html`. Before each commit run `git diff HEAD -- index.html` and confirm every hunk is yours.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `index.html` | The whole app: CSS, feed render, toggle/observer JS, admin panel, help copy | Modify |
| `wrotate_test.js` | Pure-logic mirror of `index.html` functions for unit testing | Modify |
| `tests/watch-fun-fact.test.js` | Fun-fact unit tests | Modify |
| `tests/mirror-drift.test.js` | Guard that the two copies don't diverge | Modify (registry only) |
| `sw.js` | Service worker cache version | Modify |
| `docs/superpowers/specs/2026-07-27-feed-fun-fact-footnote-design.md` | The approved spec | Modify (one correction) |
| `sql/2026-07-27-fact-impressions.sql` | Table + RLS + RPC, applied via `supabase db query` | Create |

---

## Task 1: The `funFactRowHTML` builder

Pure function first, so it's unit-testable before any DOM wiring exists.

**Files:**
- Modify: `index.html` (add function beside `funFactCardHTML` at ~20127)
- Modify: `wrotate_test.js` (add mirror beside `funFactCardHTML` at ~2538)
- Modify: `tests/mirror-drift.test.js:52-62` (ADAPTED registry)
- Modify: `docs/superpowers/specs/2026-07-27-feed-fun-fact-footnote-design.md`
- Test: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `escHtml(s)` (global in `index.html`)
- Produces: `funFactRowHTML({ fact, logId })` → `string`. Returns `''` when `fact` is falsy or whitespace-only. Emits a `<button class="funfact-row is-clamped">` with `aria-expanded="false"`, `data-log-id`, an inner `<span class="funfact-clamp">`, and a trailing `<span class="funfact-more">`. Task 2 calls it; Tasks 3 and 4 depend on those exact class names and attributes.

- [ ] **Step 1: Write the failing tests**

Add to `tests/watch-fun-fact.test.js`. Change the existing import line at the top of the file from `import { funFactCardHTML } from '../wrotate_test.js';` to:

```js
import { funFactCardHTML, funFactRowHTML } from '../wrotate_test.js';
```

Then append these describe blocks to the end of the file:

```js
describe('funFactRowHTML', () => {
  it('returns empty string when there is no fact', () => {
    expect(funFactRowHTML({ fact: '', logId: 'log1' })).toBe('');
    expect(funFactRowHTML({ fact: null, logId: 'log1' })).toBe('');
    expect(funFactRowHTML({ fact: '   ', logId: 'log1' })).toBe('');
  });

  it('escapes the fact text', () => {
    const out = funFactRowHTML({ fact: 'Made in 1953 <b>x</b>', logId: 'log1' });
    expect(out).toContain('Made in 1953');
    expect(out).toContain('&lt;b&gt;');
    expect(out).not.toContain('<b>x</b>');
  });

  it('escapes the log id into the data attribute', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'a"b' });
    expect(out).toContain('data-log-id="a&quot;b"');
  });

  it('keeps the visible label inside the button so it lands in the accessible name', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'log1' });
    expect(out).toContain('>Fun fact</span>');
    expect(out).not.toContain('aria-label');
  });

  it('renders collapsed, expandable and tagged with the log id', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'log1' });
    expect(out).toContain('class="funfact-row is-clamped"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('data-log-id="log1"');
    expect(out).toContain('funfact-clamp');
    expect(out).toContain('funfact-more');
  });

  it('hides the bulb and the more affordance from assistive tech', () => {
    const out = funFactRowHTML({ fact: 'A fact', logId: 'log1' });
    expect(out.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL — `funFactRowHTML is not a function` (the import resolves to `undefined`).

- [ ] **Step 3: Add the function to `index.html`**

Insert immediately after the closing brace of `funFactCardHTML` (index.html:20130), before `function recCardHTML(rec) {`:

```js
// Fun-fact footnote row for the feed card — always visible, clamped to 3 lines,
// tap to expand. The label is inside the button's text content on purpose: it
// becomes part of the accessible name, so screen-reader users get the same
// "Fun fact" framing that marks the text as app-generated rather than caption.
// The amber card (funFactCardHTML) is untouched — it still backs the login
// modal and the watch preview. Mirrored in wrotate_test.js.
function funFactRowHTML({ fact, logId }) {
  if (!fact || !String(fact).trim()) return '';
  return `<button type="button" class="funfact-row is-clamped" onclick="toggleFunFact(this)" aria-expanded="false" data-log-id="${escHtml(logId || '')}"><span class="funfact-clamp"><svg class="funfact-bulb" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg><span class="funfact-label">Fun fact</span> — ${escHtml(fact)}</span><span class="funfact-more" aria-hidden="true">more</span></button>`;
}
```

- [ ] **Step 4: Add the mirror to `wrotate_test.js`**

Insert at the end of `wrotate_test.js`, after `funFactCardHTML`. It uses a local `esc` because the test module has no global `escHtml` — the same divergence `funFactCardHTML` already has, which is why both live in ADAPTED:

```js
// Fun-fact footnote row for the feed card (mirrored in index.html; ADAPTED —
// uses a local esc where index.html uses the global escHtml).
export function funFactRowHTML({ fact, logId }) {
  if (!fact || !String(fact).trim()) return '';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<button type="button" class="funfact-row is-clamped" onclick="toggleFunFact(this)" aria-expanded="false" data-log-id="${esc(logId || '')}"><span class="funfact-clamp"><svg class="funfact-bulb" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg><span class="funfact-label">Fun fact</span> — ${esc(fact)}</span><span class="funfact-more" aria-hidden="true">more</span></button>`;
}
```

- [ ] **Step 5: Register it in the mirror-drift ADAPTED registry**

In `tests/mirror-drift.test.js`, change the last entry of the `ADAPTED` array (line 61) from:

```js
  'funFactCardHTML',
```

to:

```js
  'funFactCardHTML', 'funFactRowHTML',
```

- [ ] **Step 6: Correct the spec**

The spec says the row builder goes in the VERBATIM list. It can't — the mirror uses a local `esc`. In `docs/superpowers/specs/2026-07-27-feed-fun-fact-footnote-design.md`, replace:

```
2. **Mirror** — the row builder is extracted into `wrotate_test.js` and
   registered in the `mirror-drift` guard's `VERBATIM` list
   (`tests/mirror-drift.test.js`).
```

with:

```
2. **Mirror** — the row builder is extracted into `wrotate_test.js` and
   registered in the `mirror-drift` guard's `ADAPTED` list
   (`tests/mirror-drift.test.js`). It cannot be VERBATIM: the mirror uses a
   local `esc` where index.html uses the global `escHtml`, exactly as
   `funFactCardHTML` already does.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/watch-fun-fact.test.js tests/mirror-drift.test.js`
Expected: PASS, all tests in both files.

- [ ] **Step 8: Run the full unit suite**

Run: `npm test`
Expected: PASS. The suite was 970 tests before this change; it should now be 976.

- [ ] **Step 9: Commit**

Check the hook's staged `index.html` first:

```bash
git diff HEAD -- index.html
```

Confirm the only hunk is the new `funFactRowHTML`. Then:

```bash
git add index.html wrotate_test.js tests/watch-fun-fact.test.js tests/mirror-drift.test.js docs/superpowers/specs/2026-07-27-feed-fun-fact-footnote-design.md
git commit -m "feat: add funFactRowHTML builder for the feed footnote"
```

---

## Task 2: Swap the row into the feed card and restyle

Replaces the pill and amber body in the card, and swaps the CSS block.

**Files:**
- Modify: `index.html:1844-1855` (CSS), `index.html:11520-11526` (builders), `index.html:11719-11720` (card template)
- Test: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `funFactRowHTML({ fact, logId })` from Task 1
- Produces: DOM contract for Tasks 3 and 4 — `.funfact-row` (carries `is-clamped`, `is-truncated`, `aria-expanded`, `data-log-id`), `.funfact-clamp` (the height-animated element), `.funfact-more`. Collapsed height constant is `58.5px`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/watch-fun-fact.test.js`:

```js
describe('feed card uses the footnote row, not the pill', () => {
  it('has removed every trace of the pill and the amber feed body', () => {
    expect(html).not.toContain('funfact-pill');
    expect(html).not.toContain('funfact-body');
  });

  it('renders the row from the feed card template', () => {
    expect(html).toMatch(/\$\{funFactRow\}/);
  });

  it('keeps the amber card for the login modal and watch preview', () => {
    expect(html).toContain('.funfact-card{');
    expect(html).toContain('function funFactCardHTML');
  });

  it('styles the label with the AA-compliant accent, not the tier gold', () => {
    const css = html.slice(html.indexOf('.funfact-row {'), html.indexOf('.feed-chip-row {'));
    expect(css).toContain('var(--badge-accent)');
    expect(css).not.toContain('--badge-tier');
    expect(css).not.toContain('#B8952A');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL — `funfact-pill` is still present in `index.html`.

- [ ] **Step 3: Replace the CSS block**

In `index.html`, replace lines 1844-1855 in full — that is, everything from the comment `/* Fun-fact pill — same base shape as the watch chip, tappable to expand */` through the line `.feed-chip-row .feed-watch-chip, .feed-chip-row .funfact-pill { margin: 0; }` — with:

```css
    /* Fun-fact footnote — always visible below the chip row, clamped to 3 lines.
       Deliberately no container, background or border: it reads as a footnote to
       the caption, not a module. 3 lines = 58.5px (13px x 1.5), already above the
       44px tap-target floor, so no padding hack is needed. */
    .funfact-row {
      display: block; position: relative; width: calc(100% - 2rem);
      margin: 0 1rem .75rem; padding: 0; text-align: left;
      background: none; border: 0; font-family: inherit;
      font-size: 13px; line-height: 1.5; color: var(--muted); cursor: pointer;
    }
    .funfact-clamp { display: block; overflow: hidden; transition: max-height .2s ease; }
    .funfact-row.is-clamped .funfact-clamp {
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
      max-height: 58.5px;
    }
    .funfact-bulb { color: var(--badge-accent); vertical-align: -2px; margin-right: .3rem; }
    /* --badge-accent, not --badge-tier (#B8952A): the tier gold measures 2.64:1
       on the light card surface and fails AA for 13px text. */
    .funfact-label { color: var(--badge-accent); font-weight: 500; }
    .funfact-more {
      display: none; position: absolute; right: 0; bottom: 0; color: var(--muted);
      padding-left: 1.6rem;
      background: linear-gradient(90deg, transparent, var(--surface) 1.2rem);
    }
    .funfact-row.is-clamped.is-truncated .funfact-more { display: inline; }
    @media (prefers-reduced-motion: reduce) { .funfact-clamp { transition: none; } }

    /* The watch chip sits on its own row; the fun-fact footnote drops below it. */
    .feed-chip-row { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin: 0 1rem .75rem; }
    .feed-chip-row .feed-watch-chip { margin: 0; }
```

- [ ] **Step 4: Replace the card builders**

In `index.html`, replace lines 11520-11526 — the `// Fun-fact pill …` comment plus both the `funFactPill` and `funFactBody` const declarations — with:

```js
  // Fun-fact footnote — wear posts only, and only when a fact was frozen onto
  // the post. Always visible, clamped to 3 lines, tap to expand.
  const funFactRow = (w && item.fact)
    ? funFactRowHTML({ fact: item.fact, logId: item.id })
    : '';
```

- [ ] **Step 5: Update the card template**

In `index.html`, replace lines 11719-11720:

```js
      ${(watchChip || funFactPill) ? `<div class="feed-chip-row">${watchChip}${funFactPill}</div>` : ''}
      ${funFactBody}
```

with:

```js
      ${watchChip ? `<div class="feed-chip-row">${watchChip}</div>` : ''}
      ${funFactRow}
```

The chip row now renders only when there is a chip. That matters: the watch chip only appears on wear logs that also have a photo (index.html:11505), while the fact appears on any wear post with a frozen fact — so an empty `.feed-chip-row` would otherwise add stray margin above the footnote.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git diff HEAD -- index.html
git add index.html tests/watch-fun-fact.test.js
git commit -m "feat: render the fun fact as a clamped footnote in the feed card"
```

---

## Task 3: Expand / collapse with animated height

`-webkit-line-clamp` is not animatable, so the clamp class is removed for the duration of the animation and `max-height` carries the transition. No animation fires on initial render because the collapsed state *is* the initial computed style — CSS transitions don't run on first paint, so no guard class is needed.

**Files:**
- Modify: `index.html:11749-11775` (the `toggleFunFact` block)
- Test: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `.funfact-row` / `.funfact-clamp` / `is-clamped` from Task 2; `recordFactClick(logId)` (existing, index.html:11753)
- Produces: `toggleFunFact(row)` — the `onclick` target emitted by `funFactRowHTML`. `FUNFACT_CLAMP_PX = 58.5`.

- [ ] **Step 1: Write the failing tests**

These assert source structure, because the animation itself needs a real browser and is covered by UAT in Task 6. Append to `tests/watch-fun-fact.test.js`:

```js
describe('toggleFunFact', () => {
  const fn = html.slice(html.indexOf('function toggleFunFact('), html.indexOf('// ── Feed three-dot menu'));

  it('drives the row, not a separate hidden body', () => {
    expect(fn).not.toContain('funfact-body');
    expect(fn).toContain("querySelector('.funfact-clamp')");
  });

  it('toggles aria-expanded in both directions', () => {
    expect(fn).toContain("aria-expanded', expanding ? 'true' : 'false'");
  });

  it('still records the expand exactly once, on expand only', () => {
    expect(fn.match(/recordFactClick\(/g)).toHaveLength(1);
  });

  it('honours prefers-reduced-motion', () => {
    expect(fn).toContain('prefers-reduced-motion: reduce');
  });

  it('uses the shared 3-line constant rather than a magic number', () => {
    expect(html).toContain('const FUNFACT_CLAMP_PX = 58.5');
    expect(fn).toContain('FUNFACT_CLAMP_PX');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL — the current `toggleFunFact` still references `funfact-body`.

- [ ] **Step 3: Replace `toggleFunFact`**

In `index.html`, replace the whole of `function toggleFunFact(btn) { … }` (lines 11760-11775) with:

```js
// 3 lines of 13px text at line-height 1.5. Must match the max-height in the
// .funfact-row.is-clamped .funfact-clamp rule.
const FUNFACT_CLAMP_PX = 58.5;

// Expand/collapse the footnote in place. line-clamp can't be transitioned, so
// the clamp class comes off for the duration and max-height carries the
// animation; it goes back on at transitionend to restore the ellipsis.
function toggleFunFact(row) {
  const clamp = row.querySelector('.funfact-clamp');
  if (!clamp) return;
  const expanding = row.getAttribute('aria-expanded') !== 'true';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.setAttribute('aria-expanded', expanding ? 'true' : 'false');

  if (expanding) {
    row.classList.remove('is-clamped');
    clamp.style.maxHeight = '';
    if (!reduce) {
      clamp.style.maxHeight = FUNFACT_CLAMP_PX + 'px';
      const full = clamp.scrollHeight;
      requestAnimationFrame(() => { clamp.style.maxHeight = full + 'px'; });
      clamp.addEventListener('transitionend', () => { clamp.style.maxHeight = ''; }, { once: true });
    }
    recordFactClick(row.getAttribute('data-log-id'));
  } else if (reduce) {
    row.classList.add('is-clamped');
    clamp.style.maxHeight = '';
  } else {
    clamp.style.maxHeight = clamp.scrollHeight + 'px';
    void clamp.offsetHeight;  // force reflow so the next value animates
    clamp.style.maxHeight = FUNFACT_CLAMP_PX + 'px';
    clamp.addEventListener('transitionend', () => {
      row.classList.add('is-clamped');
      clamp.style.maxHeight = '';
    }, { once: true });
  }
}
```

Leave `recordFactClick` (lines 11749-11758) exactly as it is, and update the section comment above it from `// ── Fun-fact pill: expand/collapse the frozen fact inline on the card ────` to `// ── Fun-fact footnote: expand/collapse the frozen fact in place ─────────`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git diff HEAD -- index.html
git add index.html tests/watch-fun-fact.test.js
git commit -m "feat: animate fun-fact footnote expand/collapse by height"
```

---

## Task 4: Impression tracking

New table, then the client observer. Both in one task because the insert can't be verified without the table.

**Files:**
- Create: `sql/2026-07-27-fact-impressions.sql`
- Modify: `index.html` (add `recordFactImpression` + `initFactRows` after `toggleFunFact`; call `initFactRows()` in `renderFeed` at ~11347)
- Test: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `.funfact-row` + `data-log-id` from Task 2; `currentUser`, `db` (globals)
- Produces: `recordFactImpression(logId)`, `initFactRows()`. Task 5 reads the `fact_impressions` table.

- [ ] **Step 1: Write the SQL**

Create `sql/2026-07-27-fact-impressions.sql`:

```sql
-- Fun-fact impressions: the denominator for expand rate, now that the footnote
-- is visible without a tap. Shaped exactly like fact_clicks so the two counts
-- are comparable — composite PK dedups server-side to one row per user per
-- post, insert-only policy, reads go through admin_fact_counts().
-- log_id is text (not uuid) to match fact_clicks.
create table if not exists public.fact_impressions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_id     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, log_id)
);

alter table public.fact_impressions enable row level security;

drop policy if exists fact_impressions_insert_own on public.fact_impressions;
create policy fact_impressions_insert_own on public.fact_impressions
  for insert to authenticated with check (user_id = auth.uid());

create index if not exists fact_impressions_created_at_idx
  on public.fact_impressions (created_at);

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it to the remote database**

Migration push doesn't work on this project (remote-only migrations), so apply directly:

```bash
npx supabase db query --linked --file sql/2026-07-27-fact-impressions.sql
```

- [ ] **Step 3: Verify the table and policy landed**

```bash
npx supabase db query --linked "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.fact_impressions'::regclass;"
npx supabase db query --linked "SELECT polname, polcmd::text, pg_get_expr(polwithcheck,polrelid) AS wc FROM pg_policy WHERE polrelid='public.fact_impressions'::regclass;"
```

Expected: a `PRIMARY KEY (user_id, log_id)` plus the FK to `auth.users`, and one policy `fact_impressions_insert_own` with `polcmd` `a` (INSERT) and check `(user_id = auth.uid())`. This mirrors `fact_clicks` exactly.

- [ ] **Step 4: Write the failing tests**

Append to `tests/watch-fun-fact.test.js`:

```js
describe('fun-fact impression tracking', () => {
  it('inserts impressions into their own table', () => {
    expect(html).toContain("db.from('fact_impressions').insert(");
  });

  it('dedups within the page view before hitting the network', () => {
    const fn = html.slice(html.indexOf('function recordFactImpression('), html.indexOf('function initFactRows('));
    expect(fn).toContain('_factImpSeen.has(logId)');
    expect(fn).toContain('_factImpSeen.add(logId)');
  });

  it('marks truncated rows so the more affordance only shows when it is true', () => {
    const fn = html.slice(html.indexOf('function initFactRows('), html.indexOf('// ── Feed three-dot menu'));
    expect(fn).toContain('scrollHeight > clamp.clientHeight');
    expect(fn).toContain("classList.add('is-truncated')");
  });

  it('re-attaches after every feed render', () => {
    const fn = html.slice(html.indexOf('function renderFeed()'), html.indexOf('function mountFeedLoadMoreSentinel'));
    expect(fn).toContain('initFactRows()');
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL — `recordFactImpression` doesn't exist yet.

- [ ] **Step 6: Add the client code**

In `index.html`, insert immediately after the closing brace of `toggleFunFact`, before `// ── Feed three-dot menu`:

```js
// Fun-fact impressions — the denominator for expand rate. Fired once per post
// per user: a session Set suppresses repeats within a page view, the table's
// composite PK handles the rest. Fire-and-forget; never blocks the UI.
let _factImpObserver = null;
const _factImpSeen = new Set();

function recordFactImpression(logId) {
  if (!logId || !currentUser || _factImpSeen.has(logId)) return;
  _factImpSeen.add(logId);
  try {
    db.from('fact_impressions').insert({ user_id: currentUser.id, log_id: logId }).then(() => {}).catch(() => {});
  } catch (e) {}
}

// Called after every feed render. Flags which rows actually overflow (so `more`
// isn't advertised on a fact that fits) and wires the impression observer.
function initFactRows() {
  const rows = document.querySelectorAll('.funfact-row:not([data-fact-init])');
  if (!rows.length) return;
  if (!_factImpObserver && 'IntersectionObserver' in window) {
    _factImpObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        recordFactImpression(e.target.getAttribute('data-log-id'));
        _factImpObserver.unobserve(e.target);
      });
    }, { threshold: 0.5 });
  }
  rows.forEach(row => {
    row.setAttribute('data-fact-init', '1');
    const clamp = row.querySelector('.funfact-clamp');
    if (clamp && clamp.scrollHeight > clamp.clientHeight + 1) row.classList.add('is-truncated');
    if (_factImpObserver) _factImpObserver.observe(row);
    else recordFactImpression(row.getAttribute('data-log-id'));
  });
}
```

- [ ] **Step 7: Call it after the feed renders**

In `renderFeed`, after the comment-draft restore loop that ends at index.html:11347 and before `mountFeedLoadMoreSentinel();`, insert:

```js
  // Flag truncated fun-fact rows and start counting impressions.
  initFactRows();
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: PASS.

- [ ] **Step 9: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Verify a real impression lands**

Unit tests prove the code shape, not that RLS lets the insert through. Note the current row count:

```bash
npx supabase db query --linked "SELECT count(*) FROM fact_impressions;"
```

Then in the browser at `http://192.168.1.246:3000`, sign in as **testuser** (`test@wrotate.com`), open the feed, and scroll a wear post carrying a fun fact into view. Re-run the count — it must have increased. The table has no SELECT policy, so a client-side read returns empty by design; check via `db query` only.

- [ ] **Step 11: Commit**

```bash
git diff HEAD -- index.html
git add index.html sql/2026-07-27-fact-impressions.sql tests/watch-fun-fact.test.js
git commit -m "feat: count fun-fact impressions so expand rate is computable"
```

---

## Task 5: Admin expand rate

**Files:**
- Create: append to `sql/2026-07-27-fact-impressions.sql`
- Modify: `index.html:15253-15256` (admin stat rows)
- Test: `tests/watch-fun-fact.test.js`

**Interfaces:**
- Consumes: `fact_impressions` from Task 4; `admin_fact_counts()` (existing RPC); `statRow(label, value, delta, sub, invert)` (index.html:15144)
- Produces: `fc.impressions_total`, `fc.impressions_24h` on the RPC's JSON payload

- [ ] **Step 1: Extend the RPC**

Append to `sql/2026-07-27-fact-impressions.sql`. This is the existing `admin_fact_counts()` body with two counters added — everything else is unchanged, including the admin gate and the `internal_accounts` exclusion:

```sql
create or replace function public.admin_fact_counts()
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
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
    'clicks_total',      (select count(*) from fact_clicks where user_id <> all(internal_ids)),
    'clicks_24h',        (select count(*) from fact_clicks where created_at >= d24h and user_id <> all(internal_ids)),
    'viewers_total',     (select count(distinct user_id) from fact_clicks where user_id <> all(internal_ids)),
    'viewers_24h',       (select count(distinct user_id) from fact_clicks where created_at >= d24h and user_id <> all(internal_ids)),
    'impressions_total', (select count(*) from fact_impressions where user_id <> all(internal_ids)),
    'impressions_24h',   (select count(*) from fact_impressions where created_at >= d24h and user_id <> all(internal_ids)),
    'generated_total',   (select count(*) from watch_facts),
    'generated_24h',     (select count(*) from watch_facts where created_at >= d24h),
    'watches_total',     (select count(distinct model_key) from watch_facts),
    'watches_24h',       (select count(distinct wf.model_key) from watch_facts wf
                           where not exists (
                             select 1 from watch_facts wf2
                             where wf2.model_key = wf.model_key and wf2.created_at < d24h))
  ) into result;

  return result;
end;
$function$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Deploy and verify the RPC**

```bash
npx supabase db query --linked --file sql/2026-07-27-fact-impressions.sql
npx supabase db query --linked "SELECT pg_get_functiondef('public.admin_fact_counts'::regproc) LIKE '%impressions_total%' AS has_impressions;"
```

Expected: `has_impressions` is `true`. Re-running the whole file is safe — the table DDL is `if not exists` and the policy is dropped before create.

- [ ] **Step 3: Write the failing test**

Append to `tests/watch-fun-fact.test.js`:

```js
describe('admin fun-fact stats', () => {
  it('shows impressions and an expand rate beside the click counts', () => {
    expect(html).toContain("statRow('Fun fact impressions'");
    expect(html).toContain("statRow('Fun fact expand rate'");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: FAIL — neither string is in `index.html`.

- [ ] **Step 5: Add the admin rows**

In `index.html`, immediately after the `Fun fact viewers` row (line 15254), insert:

```js
        ${statRow('Fun fact impressions', Number(fc.impressions_total) || 0, Number(fc.impressions_24h) || 0)}
        ${statRow('Fun fact expand rate', (Number(fc.impressions_total) > 0 ? Math.round(Number(fc.clicks_total) / Number(fc.impressions_total) * 100) : 0) + '%', null, 'clicks / impressions')}
```

`statRow`'s third argument is a numeric day-over-day delta; a rate has no meaningful delta here, so pass `null` and use the fourth `sub` argument to label the ratio.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/watch-fun-fact.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Verify the panel renders**

Sign in as the admin account, open the admin panel, and confirm the two new rows appear with plausible values — impressions should already be non-zero from Task 4's verification, and expand rate should be between 0% and 100%.

- [ ] **Step 9: Commit**

```bash
git diff HEAD -- index.html
git add index.html sql/2026-07-27-fact-impressions.sql tests/watch-fun-fact.test.js
git commit -m "feat: surface fun-fact impressions and expand rate in admin"
```

---

## Task 6: Stale copy, cache bump, full verification

The Help page and What's New both describe the fact as a tappable pill. Both go wrong the moment this ships.

**Files:**
- Modify: `index.html:2326` (What's New), `index.html:3377` (Help tip)
- Modify: `sw.js:4`

- [ ] **Step 1: Fix the What's New copy**

At index.html:2326, replace:

```
it rides along on your post as a tappable <strong>&#128161; Fun fact</strong> pill, so anyone viewing can learn something too.
```

with:

```
it rides along on your post, so anyone viewing can learn something too &#8212; tap it to read the whole thing.
```

- [ ] **Step 2: Fix the Help tip copy**

At index.html:3377, replace:

```
It shows when you log, and appears as a tappable <strong>&#128161; Fun fact</strong> pill on your post so others can read it too.
```

with:

```
It shows when you log, and rides along on your post so others can read it too &#8212; tap it to read the whole thing.
```

- [ ] **Step 3: Verify no stale pill copy survives**

Run: `grep -n "Fun fact</strong> pill\|funfact-pill" index.html`
Expected: no output.

- [ ] **Step 4: Bump the service worker cache**

In `sw.js:4`, change `const CACHE = 'wristlog-v962';` to `const CACHE = 'wristlog-v963';`

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Run the mocked E2E suite**

Run: `npm run test:e2e`
Expected: PASS, 89 tests. If a feed test asserts on the old pill markup, update that assertion to the footnote row — do not weaken it to a no-op.

- [ ] **Step 7: UAT**

At `http://192.168.1.246:3000`, signed in as **testuser** and **testuser2** only (never James Collins/watchdemo), on a wear post with a fact. Check at both 320px and 380px widths, in light **and** dark theme:

- The fact is readable without tapping, at 3 lines.
- `more` appears at the truncation point and doesn't collide with the text behind it.
- Tapping expands to the full fact in place, animated — no container or background appears.
- Tapping again collapses, animated.
- Nothing animates on first paint or on feed re-render.
- The label reads in `--badge-accent` and is legible in light theme.
- A post whose watch chip is absent (wear log with no photo) still shows the footnote, with no stray gap above it.
- The amber card still renders in the login fun-fact modal and in the watch preview's Description / Background box.

- [ ] **Step 8: Screen-reader check**

With VoiceOver on macOS (Cmd+F5), tab to the row. It must announce the fact text prefixed by "Fun fact", as a button, with collapsed/expanded state. The bulb and the word "more" must not be announced.

- [ ] **Step 9: Commit and deploy**

```bash
git diff HEAD -- index.html
git add index.html sw.js
git commit -m "docs: retire the fun-fact pill wording, bump SW cache"
git push origin main
```

---

## Self-Review

**Spec coverage.** Removal of pill + amber body (Task 2); row placement below the chip (Task 2 step 5); markup and accessible name (Task 1); no-container styling (Task 2 step 3); the `--badge-accent` AA decision (Task 2, enforced by test); 3-line clamp at 58.5px (Task 2 step 3); 44px tap target (satisfied by 58.5px, noted in CSS comment); height animation with no first-paint animation (Task 3); reduced-motion (Task 3); `more` affordance shown only when truncated (Tasks 2 + 4); existing expand event preserved (Task 3, asserted exactly once); new impression event (Task 4); `fact_impressions` schema, RLS and PK (Task 4); admin RPC + expand rate (Task 5); `funFactCardHTML` untouched (Task 2, asserted); Gemini prompt untouched (Global Constraints); unit tests + mirror registry (Task 1); RLS verification (Task 4 step 10); SW bump (Task 6); UAT (Task 6); Help / What's New copy (Task 6). No gaps.

**Placeholder scan.** No TBD/TODO, no "handle edge cases", no "similar to Task N". Every code step carries the literal code.

**Type consistency.** `funFactRowHTML({ fact, logId })` is called with exactly that shape in Task 2. `FUNFACT_CLAMP_PX` is defined in Task 3 and matches the `58.5px` CSS from Task 2. `.funfact-row` / `.funfact-clamp` / `.funfact-more` / `is-clamped` / `is-truncated` are used identically across Tasks 1-4. `impressions_total` / `impressions_24h` are produced in Task 5's RPC and read under those names in the same task's admin rows. `toggleFunFact` takes the row element in both the emitted `onclick` (Task 1) and the definition (Task 3) — the old parameter name `btn` is gone.

**One correction to the spec** is folded into Task 1 step 6: the mirror registry entry is ADAPTED, not VERBATIM, because the mirror uses a local `esc` where `index.html` uses global `escHtml` — the same divergence `funFactCardHTML` already has.
