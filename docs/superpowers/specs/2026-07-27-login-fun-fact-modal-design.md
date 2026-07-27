# Login Fun-Fact Modal — Design

**Date:** 2026-07-27
**Status:** Approved (design); implementation plan pending
**Scope:** Client change (one modal + a pure gate + a watch picker) + one new SECURITY DEFINER RPC + a new segment on the existing `prewarm_facts` action. No new tables, no new edge functions.

## Background

Fun facts shipped 2026-07-20 (`sql/2026-07-20-watch-fun-facts.sql`): every wear log surfaces a fact about the watch on the wrist, fresh each day you wear it. It is the strongest hook we have — strong enough that the "Start your streak" onboarding email and the one-off broadcast were both rebuilt to lead with it.

But the fact is only reachable *after* you log a wear, so the people who most need the nudge never see it. Measured 2026-07-27 over the last 30 days, excluding internal accounts:

| | Count |
|---|---|
| Signed in | 91 |
| Logged a wear | 23 |
| Has a watch, but logged nothing | **56** |
| Has a watch (any) | 79 |

Two thirds of people who open the app own a watch and never log it. They have never seen a fun fact.

## Goal

Show a returning user one real fact about their own watch, once, at a moment when they have not logged — and make the next fact conditional on logging.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Audience | Anyone signed in, not demo, **≥1 watch**, who **has not logged a wear today**. "Wear" means an `isWearEntry` log (`watch_id` set, `use_case <> 'measurement'`) — sharing a measurement today does not suppress the modal, matching `hasWornToday`. |
| Frequency | **Once ever, per user.** Not daily. |
| Fact source | A real fact about **a watch in their own collection**. |
| Cursor semantics | Seeing it **counts as seen** — the cursor advances, so the next wear log yields a *different* fact. |
| Latency | **Never show a spinner.** If the fact would need live generation the modal is skipped entirely. |
| No watches | **Skipped.** The onboarding checklist and the day-1 drip already own "add a watch". |
| Surface | Modal on app open, deferred, never stacked on another overlay. |

## Non-Goals

- No daily "fact of the day" loop. Once ever.
- No new posting flow — the CTA reuses `openTrackModal()`.
- No cron for prewarming in v1; it is a manual action, run when coverage drops.
- No general/non-personal fallback fact. If we cannot show a fact about *their* watch, we show nothing.

## Trigger & eligibility

A pure gate, mirrored into `wrotate_test.js` and registered in `tests/mirror-drift.test.js` (VERBATIM), matching how `shouldPromptFirstWear` and `shouldShowPushPrimer` are structured:

```js
function shouldShowFactModal({ loggedIn, isDemo, watchCount, loggedToday, alreadyShown, factReady }) {
  return !!loggedIn && !isDemo && watchCount >= 1 && !loggedToday && !alreadyShown && !!factReady;
}
```

`maybeShowFactModal()` is called from the same render points as `maybePromptFirstWear()` and copies its deferral pattern:

1. Return early if a check is already pending.
2. `setTimeout(..., 500)`, then **re-check** eligibility.
3. Bail if `document.querySelector('.overlay:not(.hidden)')` matches. This already covers the `af2-sheet` add-watch sheet, which carries the same `overlay` class; `maybePromptFirstWear` checks it separately as belt-and-braces and we mirror that rather than diverge.
4. Yield to the first-wear prompt and the push primer — a brand-new user should get those first.
5. Only then resolve the fact, render, and set the once-ever key.

Because the key is written **when the modal actually renders**, being bumped by another overlay is harmless: the user simply becomes eligible again next session.

Once-ever key: `wr_fact_modal_<uid>`, following the `_firstWearKey()` convention (per-user, so a shared device does not suppress it for a second account).

## Which watch

Most-worn by wear count, tie-broken by most recently added; falls back to most recently added when the user has no wears at all — which is the lapsed and never-logged case, and the majority of the audience. This matches how `pickFeaturedWatch` chooses for the emails, so the same person sees a consistent "their watch" across channels.

Only watches with both a brand and a name qualify (a fact is keyed on `lower(brand)|lower(name)`).

## Content

Reuses the existing `.funfact-card` styling, so the modal is visually identical to the fact shown on a wear log and in the email:

```
💡 FUN FACT · Seiko SKX007
The applied hour markers and hands are crafted from 18k white gold.

You get a new one every day you wear it.

[ Log this watch ]   [ Maybe later ]
```

- **Log this watch** → `openTrackModal(watchId)`, the existing prefilled compose path.
- **Maybe later** → close. Either way it never returns.

## Data flow

The modal **cannot** reuse `pick_watch_fact`. That RPC stamps `last_wear_date = today` and has a same-day branch that returns the already-chosen fact without advancing — so calling it on app open would make a wear log later that same day replay the identical fact, breaking the promise the modal just made.

New RPC, `peek_watch_fact(p_brand text, p_name text)`:

- Serves the next unseen fact for `auth.uid()` — `last_position + 1`, same pool and wrap rules as `pick_watch_fact`.
- Advances `last_position` and sets `current_fact_id`.
- Deliberately leaves **`last_wear_date` NULL**, so the next wear log advances again and yields a genuinely new fact.
- Returns `{ fact_id, fact, needs_generation }`.

When the pool holds nothing new for that model it returns `needs_generation: true` and **writes nothing** — no cursor advance, no partial state. The client maps that to `factReady = false`, skips the modal, and does **not** set the once-ever key.

`watch_fact_progress` already has an own-row RLS policy, but the RPC is SECURITY DEFINER so the pick-and-advance is atomic and the client cannot set an arbitrary cursor position.

## Keeping facts instantly available

Measured 2026-07-27: of the 79 active users with a watch, only **20** have a complete pool fact ready; **59** would need a ~10-15s grounded generation.

Adds an `active_users` segment to the existing `prewarm_facts` action on `run-campaign` (signed in within 30 days, has a watch, featured model has no complete fact). One manual run covers the current gap for roughly a dollar of Gemini. It largely self-maintains afterwards, because every wear log already generates a fact for any uncovered model. Re-run when coverage drops.

## Error handling

| Case | Behavior |
|---|---|
| RPC errors or times out | Skip the modal. Do not set the once-ever key. No toast — this is a nudge, not an action the user asked for. |
| `needs_generation: true` | Skip silently, write nothing, remain eligible next session. |
| Watch has no brand/name | Excluded by the picker; if no watch qualifies, skip. |
| Another overlay open | Skip this session, remain eligible. |
| Demo mode | Never shown. |

Every failure path is "show nothing and stay eligible". The modal is never allowed to degrade into a spinner, an error, or a fact-less shell.

## Testing

**Unit** (mirrored into `wrotate_test.js`, registered VERBATIM in `tests/mirror-drift.test.js`):
- `shouldShowFactModal` — one case per gate: demo, no watches, already logged today, already shown, fact not ready, and the all-clear.
- The watch picker — most-worn wins; tie-break by newest added; no-wears falls back to newest added; watches missing brand or name are excluded.

**RPC** (`supabase db query` with `set_config('request.jwt.claims', ...)`):
- Advances `last_position` by one and leaves `last_wear_date` NULL.
- A following `pick_watch_fact` returns a **different** fact than the one peeked.
- An exhausted pool returns `needs_generation: true` and leaves `watch_fact_progress` unchanged.
- Unauthenticated calls raise.

**Mocked E2E:**
- Modal appears for an eligible user and shows the right watch.
- Does not appear when another overlay is open.
- Does not reappear once shown.
- "Log this watch" opens the track modal with that watch.

The cursor interaction is the riskiest part, so it is covered by a dedicated RPC test rather than inferred from the UI test.

## Rollout

1. Deploy `peek_watch_fact`.
2. Add the `active_users` prewarm segment; run it once and confirm coverage.
3. Ship the client behind no flag — the once-ever cap and the `factReady` gate already bound the blast radius.
4. Measure: share of the 56 no-log users who log a wear within 7 days of first seeing the modal.

## Open questions

None. All decisions above are locked.
