# WRotate — Feature Backlog

## In Progress



## Up Next
**Profile privacy — stop anonymous scraping of the user table (audit S1). DEFERRED 2026-08-13, needs doing properly.**
Anyone logged-out can currently read all 517 profile rows: every column, including `is_admin` (which names the one account worth attacking) and 251 users' `timezone`. 128 users have set their profile to Followers-only or Private; that setting is honoured by the UI only, not by the database.

Attempted 2026-08-13 and REVERTED after it broke the logged-out landing page. Do not retry the naive version.

*Two wrong approaches, both ruled out with evidence:*
1. **Hide private users' rows via RLS** — breaks search, the Follow/Request button (`friendActionBtn` reads `profile_privacy`), and feed author names. Hiding the row removes the only route by which a stranger can *request* access. Never applied.
2. **Restrict anon to 9 of the 23 columns** — applied, broke the site, reverted in minutes. RLS policies are evaluated with the CALLER's column privileges, and `logs` has "Admin can read all logs" granted `TO public`, whose body reads `profiles.is_admin`. With that column revoked, policy evaluation raises 42501 and the whole logs query returns **401** — the public feed silently vanished (`loadPublicFeed` swallows the error). Measured: **21 policies across 15 tables read `profiles.is_admin`, 18 of them granted to `public`.**

*The prerequisite, and the actual order of work:*
1. `CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin) $$;` then `GRANT EXECUTE TO anon, authenticated`. SECURITY DEFINER means callers never need privileges on the column.
2. Rewrite all 21 policies to call `(SELECT is_admin())` instead of reading the column. Writing it as a sub-select also fixes audit P2 for those policies.
3. Verify anon can still read `logs`, `watches`, `comments`, `likes` **over the REST API with the anon key** — not just `SET LOCAL ROLE anon` in SQL. The failure only surfaces as a 401 at the API layer; SQL-level checks pass while the site is down.
4. Only then apply: `REVOKE SELECT ON profiles FROM anon;` + `GRANT SELECT (id, username, display_name, avatar_url, bio, is_official, profile_privacy, collection_visibility, wishlist_visibility) ON profiles TO anon;`
5. Re-verify with a real logged-out browser load of `/`, `/p/?id=…` and `/profile/?u=…`.

Rollback at any point: `GRANT SELECT ON public.profiles TO anon;` (`sql/2026-08-13-profiles-anon-revert.sql`).
Prep already shipped: the profile view no longer fetches other users' `email_prefs` (63acea2).
Still NOT covered by any of the above: logged-in users can read all 23 columns of anyone. Column privileges are per-role, not per-row, so that needs the private columns moved to a `profile_private` table keyed on user_id with own-row-only RLS — a schema migration plus client refactor, separate again.
Full write-up: `audit-results/2026-08-13-security-audit.md` S1.

In admin view, don't show the last 498, filter out users with no watch, wears, posts, etc to only have users with a record, so that i can hit columns to rank

tick-log archival Stage 2 (PAUSED 2026-06-22) — sustainable rolling retention for timegrapher_tick_logs. Stage 1 done (archived 37,564 pre-approval rows offline + pruned, 60MB→14MB). Stage 2 = make rollout-check.py track its cumulative count incrementally (persisted state file) instead of re-scanning the full table, then a weekly LaunchAgent archives+prunes a rolling 30-day tail. Needs sign-off: it changes how the rollout cumulative number is computed. Design: docs/superpowers/specs/2026-06-22-tick-log-archival-design.md



purge historical test traffic from page_visits (2026-08-14) — 23,718 of 32,013 rows (74%) are HeadlessChrome, written by the mocked Playwright suite between 2026-03-18 and 2026-08-14 at ~400 rows per run. The suite serves the real index.html with the production Supabase key baked in, so any spec that didn't intercept the route inserted for real. **Already stopped at the source**: trackVisit() bails on navigator.webdriver (index.html), verified by a full 409-test run adding zero rows. What's left is deleting the backlog. Nothing displayed is affected — admin_traffic_stats and admin_email_clickthrough both filter the user agent — so this is table hygiene, not a correctness fix. **Delete in batches, never one statement**: `DELETE FROM page_visits WHERE user_agent ~* 'HeadlessChrome|Playwright|Puppeteer|Electron'` in chunks of ~2k with a pause between, on an instance with 406 MB RAM. A single bulk operation against production is exactly what took the project down on 2026-08-13. Table is only 10 MB, so there is no urgency.



## To Explore
ability to edit comment

show microphone on measurement (pulsating) 

Measurement precision — increase repeatability (feedback: "measurements vary a lot"). Backed by analysis of 200 real-user sessions (June 3-7, 19 users / 30 watches). Findings: median repeat-spread 14.2 s/day, but the engine floor (controlled long repeats) is only ~1.5-4 s/day — e.g. qbb251's Grand Seiko 6145 measured 6× at 35-60 dots = ±1.4 s/day. The rest is run-length noise + real watch/position variation (dexter888's Submariner spanned ±41 across 20 runs incl. 60-92 dot ones = position changes, not engine). Precision curve: 15-25 dots → median dev 5.4 s/day; 26-40 → 3.5; 41-60 → 3.5 (saturates ~40 dots). DONE: raised JS convergence dot floor 20→30 (index.html `minDots`). Still to try:
  - **Standard-error convergence** (the real fix): converge on the rate's standard error / CI from the Theil-Sen regression residuals, target SE ≤ ~3 s/day, instead of a fixed dot count. Adapts — clean signals finish fast, noisy ones run longer. Cap at maxDuration so a low-grade SKX doesn't run forever (accept some watches can't go tighter).
  - **Tighten per-beat outlier rejection on short runs** — a single bad beat swings a ~20-30 pt regression a lot (fandom's SKX swings ±12 at 20 dots). More aggressive pair-deviation trimming helps the floor cases specifically.
  - **Show ± confidence interval on the reading** (e.g. `+2 ± 4 s/day`) so a short/noisy read self-identifies instead of looking authoritative.
  - **Position-consistency UX** — prompt "measure in the same position each time"; note dial-up vs crown-down genuinely differ 5-15 s/day by design. ~40% of the felt variance is physics, not the app — without this, users blame the engine for real watch behavior.

Piezo auto-BPH "reset to manual at lock" — attempted (commit 0aaaf77) then reverted (952f3d5) because auto seemed worse after (though that session also had weak signal / junk manual runs, so not conclusively the reset's fault). Idea: after the autocorr locks the BPH, rebase the wall clock + clear phase/regression state so it runs like a fresh manual start. Re-approach carefully — first confirm under GOOD signal whether auto truly regressed, isolate vs the EMA, and consider keeping the wall-clock rebase out of the rate path.

Bucket-rate convergence (mic + all sources): the JS `bucketMedian = (last.cd - start.cd)/dT` is a fragile two-point endpoint slope of the scatter dots (computed as a side effect of chart rendering) used for the convergence decision + the ± error bar + early prelim. It can disagree with the engine's robust Theil-Sen rate — wrong magnitude/sign on near-zero or noisy measurements (this is what bit the piezo: truth +4, bucket −8). The mic's *headline* rate is shielded (it shows engine `data.rate`), so the risk is limited to convergence timing + a misleading error bar on near-zero/noisy runs. Fix = replace the two-point bucket slope with the engine's Theil-Sen rate (as already done for piezo).

advance batch mode

show me a watch i might like based on my collection, and what i've been purchasing, also look at what style i am missing

## Done
Change default visibility to public
delete comment (per-comment kebab menu, double-tap confirm; commenter deletes own, post owner moderates any on their post)
Make notifications shown as closed by default, not expanded
When user hits get prices, and if they are within 7 days instead of immediately showing the same prices and not mention anything. mention that price is still valid and can be updated in x days.
Reorganize collection to have Brand then next to it model name second row paid purchase then reference and url. then also check if we can do better than fetch. not sure fetch is used much. 
When user hits enhance on existing collection, the enhanhcment shoudl show what they are so that user gets confidence that they won't have what they entered overriden. right now they have to trust it's a good thing. show me first how you'd do before doing it. 
Change the collection detail page bottom images to gold. we should use amber to highlight AI work, but save and delete should be back to how they are in other modals
Want to have user enter their user name before they add a watch. I suspect that would make it more ownership of the site and usage. right now we don't require at all. think and plan of how we do it. 
Have an option of unsubscribe directly from email
show facts about watches on the feed when user clicks on anyone watches they post
in the admin dashboard, i want to see if a user is an active and details. so when i click on the name instead of the profile, i want a modal that has info about the user, basics like watches, wears, wishlist, measurements (success rate including), enhancements, vlaue check. and also last login, repeat or not, feedbcak asked, given. by them? go build
multiple pictures in a post
if someone used advanced settings show that it's not default anymore
measurement advance settings
measurement v2

