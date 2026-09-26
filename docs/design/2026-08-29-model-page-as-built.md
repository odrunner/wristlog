# WRotate — Model (reference) page, as built · updated 2026-09-26

Ground truth of what the app renders today. The 2026-09-26 cut-down replaced
the tabbed "2a" page (stat grid, Data / Specs / Owners tabs). Design:
claude.ai/artifact/GedNSuaJLHR5tprMPYFdGC. Everything in-app is behind the
`watch_db` dev flag until launch; the public `/w/?m=<slug>` twin uses the same
renderer (`model-page.js`) in `publicMode`.

## Why it was cut
74% of models have one owner; 63% of active users' watches sit on a model
nobody else owns. Value median, cost per wear, Wear Index, wear strip/weeks,
ownership by era and tenure were empty or n=1 on almost every page. What stays
is what a member can use: how their watch runs against others, the story,
real wrist shots, people to follow, references by era.

## Where it lives / how you reach it
- In-app `#page-model` (max 480px). Entry points: Feed → **Watches** (Explore);
  Collection → watch → "Also owned by" row; feed watch preview → "See this model".
- Public `wrotate.com/w/?m=<slug>` (logged out; not linked from anywhere but Share).

## Data (one `model_stats` call + the model row + `model_owners` + facts)
`model_stats` (sql/2026-09-26-model-page-cutdown.sql) returns: owners,
wishlisted, wishlisted_by_me, top_ref, **accuracy** {n_members, n_sessions, med,
members[]} — one value per member (median of their converged sessions), shown
only with ≥3 members; **caliber** {key, n_members, n_models, med, members[]} —
only when the model has <3, pooling every watch whose `caliber_key()` matches
(the viewer's own watch's calibre, else the model's most common), same ≥3 floor;
specs_gen, specs_agg, photos (hero fallback), **shots** [{id, url}] (public,
unmoderated post photos from public collections, max 9) + shots_total, related,
brand_models, **mine** [{id, ref, caliber, last_rate, last_amp, last_at}].

## Vertical order (single scroll)
1. **Hero** 180px — hero image (else newest public photo), Back / Share,
   `BRAND · ref. X`, name, caption (type · size · WR · movement · era span).
2. **Description** (only when a separate history exists).
3. **"You're the only member with one"** pill — owner and sole owner.
4. **Your watch / How they run** card:
   - owner: last rate (`+1.4 s/day`), "Measured N days ago · amplitude", or "Not measured yet";
   - not owner: members' median + "N members measured theirs · k of N within ±5 s/d";
   - strip: one grey dot per member, dashed median line, gold marker for your last reading;
     domain ±5 grown to fit, capped ±30 (outliers pin to the edge); `rateStrip()` in
     wrotate_test.js;
   - calibre fallback says so: "Not enough members have measured a X yet, so this
     compares the movement inside — N models on WRotate";
   - owner with no pool: "Once 3 members have measured one, you'll see how yours compares."
   - hidden for a non-owner when there is no pool.
5. **The story** — history clamped to 4 lines + "Read the full history"; fun fact
   card with ‹ › (rotates daily; teaser + " …" on the public page).
6. **On members' wrists** — up to 6 public wrist shots; tap opens the post
   (in-app `scrollToFeedPost`, public `/p/?id=`).
7. **N members own one** — owners the viewer may see (`model_owners`, privacy-gated
   server-side), with Follow (in-app, `followByPrivacy`); public page links to
   `/profile/?u=`. Hidden when nobody is visible and there's ≤1 owner.
8. **References by era** (yours highlighted) + calibre chips.
9. **Reference spec** (curated) or **From members' watches** (specs_agg) for auto models.
10. **More from <brand>** — 4 cards + "All N models" (in-app → Explore by brand).
11. **Request an edit** (in-app).
12. **Action bar**: owner → Measure again / Measure it (native only) + Open your
    watch; non-owner → I own one + ♡ Want one; public → Track yours on WRotate.

## Not built (decided 2026-09-26)
- Maker's calibre spec band (COSC −4/+6, Rolex ±2, Seiko 4R36 −35/+45…) — punted;
  would need a hand-maintained table, a wrong spec gives a false "within spec".
- New entry points (accuracy history, add-watch modal, collection name tap) and
  the launch experiment — next step.

## Analytics (PostHog)
`model_page_viewed`, `model_fact_next`, `model_history_expand`, `model_shot_open`,
`model_owner_follow`. `model_page_tab` is gone with the tabs.
