# WRotate Usability Audit — 2026-07-25

**Scope:** the user-facing surfaces added since 2026-07-19 — daily fun facts (pill +
reveal + toast), the badge reveal modal and profile dot, the push-permission primer
and settings row, the post-measurement "log a wear" CTA, the first-wear onboarding
nudge, and feed infinite scroll.

**Method:** code read of each new render path and its state machine, plus a check of
the in-app Help and What's New against what actually shipped.

---

## U1 — What's New and Help do not cover anything shipped in the last five days — **Low-Medium** — **FIXED 2026-07-26** (Help only — What's New skipped by request: these are plumbing, not announcements)

`index.html:2321-2339`

What's New's newest section is still headed **July 2026** with *Daily Fun Facts* at
the top — the Jul 20-22 work. Nothing shipped since is mentioned:

| shipped | commit | in What's New? |
|---|---|---|
| Feed infinite scroll | `ba744fd` (Jul 20) | ✗ |
| Badge reveal modal + profile dot | `c7adaa0` (Jul 25) | ✗ |
| Push notifications primer + settings row | `c50d128` (Jul 25) | ✗ |
| "Log a wear" CTA after measuring | `b7acc05` (Jul 25) | ✗ |
| First-wear onboarding nudge | `97c931c`/`e152e5c` (Jul 25) | ✗ |

The project rule is explicit: *"After each working day — update the Help page
(in-app guide) and 'What's New' section to reflect changes shipped that day."*

Two of these need Help coverage rather than just a changelog line, because they
introduce controls a user has to find: the **Push notifications** row is a brand-new
settings toggle on the profile page with no Help entry explaining what it controls or
what to do if the OS permission was already denied (the "Turn on" button then has to
route to `openAppSettings`, which is not self-evident). The badge **dot** on the
profile button is a new persistent affordance with no explanation of what clears it.

**Fix:** add a What's New block for the Jul 20-25 set, and Help entries for the push
setting and the badge dot.

---

## U2 — The badge reveal shows 8 medallions but every name — **Low** — **FIXED 2026-07-26**

`index.html` (`openBadgeRevealModal`, commit `c7adaa0`)

```js
if (medEl) medEl.innerHTML = badges.slice(0, 8).map(b => badgeMedallionSvg(b, 52, true)).join('');
if (namesEl) namesEl.textContent = badges.map(b => b.name).join(' · ');
```

The medallion row is capped at 8; the names line is not. The header count is also
uncapped (`${badges.length} badges unlocked`).

This matters specifically because of *why* the feature exists — the commit message
says ~73% of earned badges never registered as seen, so the **first** reveal for an
existing user is a retroactive batch, not a single badge. For a user with 15 unseen
badges the modal reads "15 badges unlocked", shows 8 medallions, and then prints all
15 names as a single ` · `-joined run of text inside a 340 px-wide dialog. The mismatch
between "15", eight visible medallions, and a wall of names undercuts the celebratory
moment the modal is for.

**Fix:** cap the names to the same 8 and append "+N more", or drop the medallion cap
and let the flex row wrap (it already has `flex-wrap: wrap`).

---

## U3 — A reveal can be permanently consumed without ever being shown — **Low** — **FIXED 2026-07-26**

`index.html` (`maybeRevealBadges`, commit `c7adaa0`)

```js
try { localStorage.setItem(BADGE_REVEAL_KEY, String((_earnedBadges || []).length)); } catch (_) {}
openBadgeRevealModal();
```

The key is advanced *before* the modal opens, but `openBadgeRevealModal()` has its own
early return:

```js
const badges = unseen.map(e => BADGE_BY_REF[e.badge_ref]).filter(Boolean);
if (!badges.length) return;
```

If a user holds an unseen badge whose `badge_ref` is not in `BADGE_BY_REF` — a badge
awarded server-side by a newer build, or one later renamed — `unseenBadgeCount()` is
non-zero (so the guard passes and the key advances) but `badges` is empty (so nothing
renders). The reveal is then suppressed until some *further* badge is earned, and the
profile dot sits there with nothing behind it.

The ordering is otherwise careful — the "another overlay is open" check correctly
comes *before* the key write, so a busy app retries next open. This is the one path
that leaks.

**Fix:** move the `setItem` to after a successful open, or have
`openBadgeRevealModal()` return a boolean the caller checks.

---

## Verified sound (checked, not assumed)

- **Fun-fact pill.** Correctly gated on `w && item.fact`, so it never appears on
  watch-less or fact-less posts. `toggleFunFact` maintains `aria-expanded` on both
  branches and the body uses the `hidden` attribute, so collapsed content is hidden
  from assistive tech, not just visually.
- **Fun-fact click tracking is genuinely non-blocking** — `recordFactClick` is
  fire-and-forget inside a `try`, and the expected PK conflict on a re-open is
  swallowed rather than surfaced as an error toast.
- **The push primer is correctly gated and capped.** `shouldShowPushPrimer` requires
  `notDetermined` (so it never re-asks a user who already decided), enforces a 7-day
  cooldown and a cap of 3, and `maybeShowPushPrimer` is overlay-guarded so it cannot
  stack on another modal. It fires at genuine engagement moments (first wear log,
  first measurement) rather than at sign-in. This is a well-built primer — the only
  issue is the version gate, covered as **R4** in the reliability report, which will
  silently disable it at app version 2.10.
- **The badge dot is honest.** `renderProfileBadgeDot` reads live from `_earnedBadges`
  and is re-rendered on profile load, so dismissing the modal correctly leaves the dot
  standing — the "you still have something to look at" signal survives the dismissal.
  Caps at "9+".
- **Badge reveal is once-per-batch, not once ever.** `shouldRevealBadges` compares
  `earnedCount > lastRevealedCount`, so a new badge earned later re-triggers it. The
  800 ms delay keeps it from colliding with app-boot rendering.
- **Both reveal and primer modals are accessible** — `role="dialog"`,
  `aria-modal="true"`, and `aria-labelledby` pointing at a real title element.
- **Infinite scroll preserves state.** `loadMoreFeed` appends via
  `insertAdjacentHTML` before the sentinel rather than re-rendering the list, so
  scroll position, playing videos and open comment drafts survive a page load — and
  newly inserted videos are explicitly re-observed. The load-more failure path falls
  back to a visible button (`showFeedLoadMoreButton`) instead of dead-ending silently.

## Status

| Severity | Count |
|---|---|
| Low-Medium | 1 (U1) |
| Low | 2 (U2, U3) |

No high-severity usability defects in this cycle. The new UI is in noticeably better
shape than the last cycle's (which produced four High UX findings) — the reveal and
primer both ship with cooldowns, overlay guards, ARIA and pure testable predicates.
The gap is documentation: three new user-facing affordances shipped with no Help or
What's New entry.
