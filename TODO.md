# WRotate — Feature Backlog

## In Progress

## Up Next
if someone used advanced settings show that it's not default anymore
ability to edit comment
show microphone on measurement (pulsating) 
7-second cap + in-composer trim slider — if the user picks an 8-30 sec video, show a trim UI to pick the 7-sec segment they want. Much more user-friendly but adds significant scope (trim UI + actual video clipping, which is hard in-browser).
measurement advance settings

## To Explore
Measurement precision — increase repeatability (feedback: "measurements vary a lot"). Backed by analysis of 200 real-user sessions (June 3-7, 19 users / 30 watches). Findings: median repeat-spread 14.2 s/day, but the engine floor (controlled long repeats) is only ~1.5-4 s/day — e.g. qbb251's Grand Seiko 6145 measured 6× at 35-60 dots = ±1.4 s/day. The rest is run-length noise + real watch/position variation (dexter888's Submariner spanned ±41 across 20 runs incl. 60-92 dot ones = position changes, not engine). Precision curve: 15-25 dots → median dev 5.4 s/day; 26-40 → 3.5; 41-60 → 3.5 (saturates ~40 dots). DONE: raised JS convergence dot floor 20→30 (index.html `minDots`). Still to try:
  - **Standard-error convergence** (the real fix): converge on the rate's standard error / CI from the Theil-Sen regression residuals, target SE ≤ ~3 s/day, instead of a fixed dot count. Adapts — clean signals finish fast, noisy ones run longer. Cap at maxDuration so a low-grade SKX doesn't run forever (accept some watches can't go tighter).
  - **Tighten per-beat outlier rejection on short runs** — a single bad beat swings a ~20-30 pt regression a lot (fandom's SKX swings ±12 at 20 dots). More aggressive pair-deviation trimming helps the floor cases specifically.
  - **Show ± confidence interval on the reading** (e.g. `+2 ± 4 s/day`) so a short/noisy read self-identifies instead of looking authoritative.
  - **Position-consistency UX** — prompt "measure in the same position each time"; note dial-up vs crown-down genuinely differ 5-15 s/day by design. ~40% of the felt variance is physics, not the app — without this, users blame the engine for real watch behavior.

Piezo auto-BPH "reset to manual at lock" — attempted (commit 0aaaf77) then reverted (952f3d5) because auto seemed worse after (though that session also had weak signal / junk manual runs, so not conclusively the reset's fault). Idea: after the autocorr locks the BPH, rebase the wall clock + clear phase/regression state so it runs like a fresh manual start. Re-approach carefully — first confirm under GOOD signal whether auto truly regressed, isolate vs the EMA, and consider keeping the wall-clock rebase out of the rate path.

Bucket-rate convergence (mic + all sources): the JS `bucketMedian = (last.cd - start.cd)/dT` is a fragile two-point endpoint slope of the scatter dots (computed as a side effect of chart rendering) used for the convergence decision + the ± error bar + early prelim. It can disagree with the engine's robust Theil-Sen rate — wrong magnitude/sign on near-zero or noisy measurements (this is what bit the piezo: truth +4, bucket −8). The mic's *headline* rate is shielded (it shows engine `data.rate`), so the risk is limited to convergence timing + a misleading error bar on near-zero/noisy runs. Fix = replace the two-point bucket slope with the engine's Theil-Sen rate (as already done for piezo).

## Ideas / Someday
show me a watch i might like based on my collection, and what i've been purchasing, also look at what style i am missing

## Done
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

