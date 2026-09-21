# Design-system tooling

Used for the 2026-09-20 decoupling work (`audit-results/2026-09-20-design-system-audit.md`).
The permanent guard is `scripts/ds-count.mjs` + `tests/design-system-ratchet.test.js`; these are the
tools for *making* a change and proving what it did.

- `snap.py <scope> [--apply]` — snap off-scale values to the nearest token inside one screen's scope,
  only when the move is tiny. Prints every move. Scopes live in `scope.py`.
- `snap2.py [--apply]` — the wider, user-approved decisions pass (headings, tracking, tiny text).
- `compare.sh` — before/after harness (see its header). Always run `compare.sh landing` — it must say 0.

Fences that every pass must keep (each one was learned the hard way):
1. **Email HTML** (`EMAIL_RANGES` in `scripts/ds-count.mjs`): mail clients have no CSS variables.
2. **The landing screen**: not to be modified; verify 0 computed differences.
3. **`body { font-size }`**: the root everything inherits from. It is `--fs-body`; never snap it.
4. **Coupled numbers**: `.funfact-row` is 13px x 1.5 x 2 lines = `max-height: 39px` = `FUNFACT_CLAMP_PX`
   in JS. Fence any rule with a line clamp.
5. **Inputs**: 16px text is the iOS no-zoom floor (`--fs-input`).
6. **Canvas code** cannot read CSS variables.
7. **`wrotate_test.js`** mirrors some index.html functions verbatim — sync it after style edits.
8. **Never move rules between `index.html` and `design-system.css` in one deploy without cache-busting the
   stylesheet.** `sw.js` serves the page network-first but `design-system.css` cache-first (stale-while-revalidate),
   so a returning visitor's first load pairs the NEW page with the OLD stylesheet. On 2026-09-20 the component
   move shipped `.hidden { display: none }` out of the page and into the stylesheet: for that one load every
   hidden modal would have been visible. Live ~3 minutes, reverted (`ad33037`); 1 signed-in load in the window,
   an internal account. The same pairing makes any NEW token undefined for one load — additive changes degrade
   mildly, moves break. **Fixed 2026-09-21:** the stylesheet is loaded as `/design-system.css?v=<content hash>`
   (pages + `sw.js` PRECACHE), so the old cache entry can never match the new page's request.
   **After every edit to `design-system.css` run `node scripts/ds-stamp.mjs`** — a unit test fails on a stale
   stamp. `compare.sh skew [ref]` replays the returning-visitor case in a real browser (control + fix + offline).
9. **Nothing may find an element by its inline style** (`[style*="…"]`, in app code or tests). Styles keep becoming
   classes; such a selector silently stops matching. `name_styles.py` refuses to run and a unit test fails if one exists.

## Naming inline styles (phase 4 step 3)

`name_styles.py [--lines a-b] [--apply]` replaces a `style="…"` that EXACTLY equals a named decision (the `NAMED`
table) with its class, and appends the class to `design-system.css`. It converts only when no rule that could apply
to the element — any state, any ancestor written in the same region — touches those properties. Then run
`node scripts/ds-stamp.mjs`, `compare.sh static`, `live`, `modals ALL-EXCEPT:none`, `force`, and sync `wrotate_test.js`.
The diffs compare computed VALUES only, so a new class name is not a difference.
