# WRotate — Complete User-Facing Functionality

> A reference describing **everything a user can see and do** in WRotate, written for brainstorming. It covers the live, shipped feature set across the web app (PWA) and the iOS native app. It deliberately avoids backend/algorithm internals — the focus is the user experience.

---

## 1. What WRotate Is

WRotate is a free app for mechanical-watch enthusiasts. It combines three things most apps keep separate:

1. **A watch collection manager** — catalog your watches with rich detail, photos, specs, value, and documents.
2. **A wear-rotation tracker** — log which watch you wear each day, with stats, streaks, and insights.
3. **A social network** — a feed, profiles, following, comments, clubs, and a curated community of collectors.

Plus a standout hardware-ish feature:

4. **A phone-based timegrapher** — measure a mechanical watch's accuracy using the iPhone microphone (or a piezo contact sensor), like a $1,000 timing machine in your pocket.

Tagline used on the landing/login screen: **"100% free · No ads · No credit card."**

**Platforms:** Web app (works in any browser, installable as a PWA to the home screen) and a native **iOS app** on the App Store. The timegrapher's live mic measurement is iOS-app-only; everything else works on web.

---

## 1A. Usage Snapshot (as of today — 2026-06-28)

> Real numbers queried directly from the production database, **as of today, 2026-06-28**. Internal/test accounts (6 of them) are **excluded** from every figure, matching how external-facing metrics are reported. First real signup was **2026-02-27** → roughly the first ~4 months of life.
>
> **Where these come from:** §1A–1B are **database-derived** (the reliable source of truth for "who did what"). §1D adds **PostHog** click/funnel/friction data (now connected) — the layer the DB can't see.

### Audience & growth
| Metric | Value |
|---|---|
| Total users (excl. internal) | **364** |
| New signups, last 30 days | **92** |
| New signups, last 7 days | **21** |
| First signup | 2026-02-27 |

### Activity / retention (real — from `user_presence` app-open tracking)
| Metric | Value |
|---|---|
| Active last 30 days (opened app) | **98** (27% of all users) |
| Active last 7 days (opened app) | **48** |
| Logged a wear, last 30 days | **24** |
| Logged a wear, last 7 days | **12** |

### Collection & rotation
| Metric | Value |
|---|---|
| Watches cataloged | **756** |
| Users with ≥1 watch (collectors) | **285** (78% of users) |
| Avg watches per collector | **2.7** |
| Wear logs / posts total | **600** |
| Users who've ever logged a wear | **58** (16% of users; 20% of collectors) |
| Wear logs with a photo | **235** (39%) |
| Wishlist items | **39** (only **11** users — 3%) |

### Timegrapher (accuracy measurements)
| Metric | Value |
|---|---|
| Total measurements saved | **479** |
| Users who've measured | **109** (30% of users) |
| Measurements, last 30 days | **229** |
| Heaviest single user | 359 measurements |

### Social & engagement
| Metric | Value |
|---|---|
| Likes | **628** |
| Comments | **171** |
| Follows (relationships) | **53** |
| Clubs created | **8** |
| Club memberships | **14** |
| Posts shared *to* a club | **0** |
| Achievement badges earned | **516** |
| AI value estimates run (events) | **633** |

### Email (lifecycle/notification health)
| Metric | Value |
|---|---|
| Emails sent / delivered | **606 / 589** |
| Opened | **552** (~94% of delivered) |
| Clicked | **28** (~5%) |

---

## 1B. Feature Adoption — what's loved vs. underutilized

> The granular view: for each feature, **how many distinct users have ever used it** and the raw count, with adoption % against the relevant base. This is exactly what you asked for — beyond the big-ticket items, down to wishlist, Enhance, tags, straps, Ranking Game, etc. All DB-derived (a feature "counts as used" when it left a data footprint).
>
> Bases: **364** total users · **285** collectors (≥1 watch) · **756** watches · **600** wear logs.

### 🟢 Loved / core (high adoption, repeated use)
| Feature | Users | Reach | Notes |
|---|---|---|---|
| Add a watch to collection | 285 | **78% of users** | The front door — nearly everyone does it. |
| **Timegrapher measurement** | 109 | **30% of users** | 479 readings, 229 in last 30d. The standout magnet; one user at 359. |
| AI **Check Value** / market price | 94 | **33% of collectors** | 633 value events (379 explicit "check"). Heavily used. |
| Specs filled (movement/case) | 99 | 35% of collectors | 397 of 756 watches (53%) carry specs (Enhance + manual). |
| "The Story" (description/background) | 85 | 30% of collectors | 366 watches (48%) — people *narrate* their watches. |
| Watch photo on file | — | **64% of watches** | 484 of 756. |

### 🟡 Solid but not universal
| Feature | Users | Reach | Notes |
|---|---|---|---|
| Wear logging (rotation) | 58 | **20% of collectors** | 600 logs, but only a fifth of collectors ever log — the core funnel leak. |
| Likes | — | 628 total | Engagement exists where the feed is seen. |
| Comments | — | 171 total | |
| URL fetch (auto-fill from link) | — | 41% of watches | 313 of 756 have a source URL. |
| Price history tracking | — | 131 watches | Accrues automatically once value is checked. |
| Notes on a wear | 15 | 137 logs | Private note-taking is a niche-but-sticky behavior. |

### 🔴 Underutilized (low adoption — candidates to fix, promote, or cut)
| Feature | Users | Reach | Notes |
|---|---|---|---|
| **Wishlist** | **11** | **3% of users** | 39 items total. Almost nobody finds/uses it. |
| **Tags / classification** | 27 | 9% of collectors | Only 70 of 756 watches tagged — so tag-filtering is mostly moot. |
| **Straps / multi-strap** | 17 | 6% of collectors | 31 watches; strap-on-wear chosen on 48 logs. |
| **Ranking Game** | **6** | **2% of users** | 79 watches ranked, but by a tiny handful. |
| Docs & warranty (box/papers/warranty) | 34 | 12% of collectors | 98 watches. |
| Insurance fields | — | 53 watches | |
| **Receipts upload** | — | **2 watches** | Effectively dead. |
| **Clubs** | 14 members / 8 clubs | — | Created and joined, but **0 posts** ever shared to a club — the loop is broken. |
| Location on a wear | — | 19 logs (3%) | |
| BPH set on watch record | — | 12 watches | (Separate from measurement BPH.) |

### Behavior signals (how people use what they use)
- **Occasion/use-case on wears:** Unspecified **44%**, Work 31%, Leisure 19%, Dinner 5%, Travel <1%. → Nearly half skip the occasion picker.
- **Post visibility chosen:** Public **44%**, Close Friends 30%, Private 19%, Followers 6%. → People either go fully public or lock to close friends; the "Followers" tier is largely ignored.
- **Onboarding funnel (via first-X badges, lower bound — only counts users active since the badge system launched):** First Watch 166 → First Measurement 58 → First Wear 41 → First Post 26. The drop from "added a watch" to "logged a wear / posted" is steep.
- **Review prompt:** shown 88 → said yes 43 (~49%), dismissed 9. Healthy when it fires.
- **Post-CTA (share nudges):** shown 550 → clicked 30 (~5% CTR).

**Reading this for brainstorming:**
- **Two features carry the app: cataloging and the timegrapher.** Collecting is the on-ramp (78%); the timegrapher is the differentiated hook (30% adoption, very high repeat). Everything else trails far behind.
- **The core funnel leaks at "log a wear."** 78% catalog a watch; only 20% of those ever log a wear. WRotate's *name* is rotation tracking, yet rotation is the least-converted core loop. This is the #1 design problem.
- **Whole feature clusters are nearly dormant:** Wishlist (3%), Ranking Game (2%), Tags (9%), Straps (6%), Receipts (~0), and Clubs (created but **0 posts**). Each is a decision: make it discoverable, rework it, or drop it.
- **Value-checking punches above its weight** (33% of collectors) — collectors clearly care about what their watches are worth. Worth leaning into.
- **The social graph is too thin to self-sustain** (53 follows / 364 users; followers-visibility tier ignored). The feed can't yet deliver value from following alone.
- **Retention is the real story:** 98 monthly app-openers but only 24 log a wear monthly — people *come back and look*, but the return action isn't logging. Finding the right recurring action (measure? browse value? feed?) is the key question.

---

## 1C. Analytics sources (how to read §1A–1D)

- **Database (§1A–1B)** = source of truth for *outcomes*: who actually created a watch, logged a wear, saved a measurement, etc. Scoped to the **364 registered users** (internal excluded).
- **PostHog (§1D)** = *behavior*: which screens/buttons get clicked, where people retry/rage-click, and demo-mode activity. PostHog tracking began **2026-03-27** (a month after launch) and its "users" include **anonymous & demo visitors who never signed up**, so its reach counts are *larger* than 364 and shouldn't be compared 1:1 with the DB. Custom events tracked: `signup_clicked`, `landing_page_viewed`, `profile_viewed`, `post_created`, `watch_added` (`source`: manual/photo_v2/wishlist), `accuracy_reading_saved`, `snap_to_track_matched`, `streak_chip_clicked`, `appstore_clicked`, plus full **autocapture** (every click/pageview).

---

## 1D. PostHog — click, funnel & friction data (since 2026-03-27)

> What people actually *touch*. Reach = distinct PostHog users (incl. anonymous/demo, so totals exceed 364). 91.8k events captured over the window.

### Which screens people visit (tab nav clicks)
| Tab | Distinct users | Clicks |
|---|---|---|
| **Measure** | **384** | 2,625 |
| Track | 305 | 1,425 |
| Collection | 287 | 2,157 |
| Feed | 228 | 1,862 |
| Stats | 196 | 719 |
| Wishlist | 134 | 486 |

**→ Measure is the most-visited screen in the entire app** — more reach than Collection. The timegrapher isn't a side feature; it's the front door for the most people.

### Most-clicked actions (by distinct users)
| Action (button text) | Users | Clicks | Read |
|---|---|---|---|
| Measure | 384 | 6,147 | The magnet. |
| "Got it" (dismiss tips) | 382 | 652 | Onboarding tooltips seen widely. |
| + Add Your First Watch | 247 | 332 | Activation CTA works. |
| Save / Save Watch | 246 / 174 | — | Catalog saves. |
| **Retry** (measurement) | **205** | **1,500** | ⚠️ Heavy re-measuring — see friction below. |
| **Stop** (measurement) | **175** | 1,161 | Stopping mid-measure. |
| Add from Photo | 140 | 440 | AI add is popular. |
| Log This Wear | **61** | 543 | Confirms the wear-logging leak from the click side. |
| Fetch (URL auto-fill) | 52 | 139 | |
| People (find people) | 49 | 92 | Discovery barely touched. |
| Check price / Value | ~43 | 215 | Modest. |
| ⭐ Enhance with AI | ~42 | 175 | Modest. |
| Clubs | 36 | 72 | Low. |
| Upload wrist photo | 34 | 119 | |

### ⚠️ Friction: the measurement flow
- **"Retry" was clicked 1,500 times by 205 users**, and **"Stop" 1,161 times by 175 users** — relative to 114 users who ever *saved* a reading. People measure, it doesn't converge, and they retry repeatedly.
- **Rage-clicks cluster on "Measure"** (27 of 84 rage-clicking users) and "↻ Try another." This is the app's #1 usability pain point — the headline feature is also the most-retried and most-rage-clicked.
- Implication: the magnet works at pulling people in, but **convergence friction is actively frustrating them** at the exact moment they're most engaged. Reducing failed/slow measurements is likely the highest-leverage fix.

### Intent-vs-action gaps (PostHog reach vs DB outcome)
| Feature | Opened/clicked (PostHog) | Actually did it (DB) | Gap |
|---|---|---|---|
| **Wishlist** | 134 users opened the tab | **11** users added an item | Huge — people look, almost none use it. |
| **Wear logging** | 305 visited Track / 61 clicked "Log This Wear" | 58 users ever logged | Drop-off is at the Track screen itself. |
| **Measurement** | 384 visited Measure | 114 saved a reading (DB: 109) | ~30% convert visit→saved reading (friction + abandonment). |
| **Enhance / Value** | ~42 / ~43 users tried | reflected in 94 users w/ market price | Tried by few, but value data is broadly present (also auto/backfill). |

### Acquisition behavior
- **293 users "Explore Without an Account"** (demo-first) — demo is a major entry path, so first-run value must land *before* signup.
- Sign-in attempts: **Apple 305 users** vs **Google 188** — Apple is the dominant method (iOS-heavy audience).

**Reading §1D for brainstorming:**
- The click data *confirms and sharpens* the DB story: **the timegrapher is the product's center of gravity** (most-visited screen, the magnet), but it's **also the biggest source of friction** (retries, rage-clicks). Fixing measurement reliability/perceived-speed likely moves activation, retention, *and* satisfaction at once.
- **Wishlist's 134→11 collapse** says the problem isn't discovery (people find it) — it's that it doesn't deliver once opened. Rework or cut.
- **Wear-logging leaks at the Track screen**, not before it — 305 reach the tab but few complete a log. The log flow itself (or its perceived value) is the blocker.
- **Discovery/social is barely touched** (People 49, Clubs 36) — consistent with the thin social graph.

---

## 2. Accounts, Onboarding & Auth

- **Sign-in methods:** Google OAuth and Apple Sign-In only. No email/password, magic link, or OTP. No password to reset.
- **Demo mode:** "Explore Without an Account" lets a visitor browse the app and the public feed without signing up. Actions that write data are gated behind a sign-up prompt.
- **Onboarding:** A 6-step welcome flow (Welcome → Collection → Wear tracking → Stats → Social → Terms gate). The final step requires accepting Terms of Use & Privacy Policy via checkbox before entering the app.
- **EULA gate:** Pre-existing users are shown a one-time acceptance gate on next login; they can accept or decline (and sign out).
- **Account deletion:** Two-step confirmation ("Yes, Delete My Account" → "Absolutely sure?"). Permanently erases all watches, wear logs, wishlists, posts, comments, and social data. No recovery.
- **No paid tier.** Entirely free, no subscriptions or paywalls.

---

## 3. Watch Collection

The catalog at the heart of the app.

### Adding watches
Three ways to add:
- **Add from Photo (AI):** Upload/snap a single watch or a flat-lay of several. AI identifies brand, model, reference, and pre-fills specs (case size, material, movement, year range). Cropped thumbnails appear per detected watch; the user reviews/corrects before saving. Duplicates are flagged ("Already in collection"). Can batch-add many watches from one photo, then batch-**Enhance** (AI fills missing specs) and batch-**Value** (AI market price).
- **Manual "+ Add Watch":** Full form.
- **URL fetch:** Paste a brand/listing URL and the app auto-fills brand, model, reference, and photo (most accurate on official brand sites like rolex.com, omegawatches.com).

### Data captured per watch
- **Essentials:** Brand (autocomplete), Model/Name, Reference, Paid price, Purchase date, Product/listing URL, photo.
- **Docs & Warranty:** Warranty expiry, Box (yes/no), Papers (yes/no), Insurance status + insured value, uploaded receipt images.
- **Value:** Manual market price, or AI "Check Value" estimate; price history tracked over time.
- **Type tags:** Chronograph, Dress, Diver, etc. (used for filtering).
- **Specs:** Movement type (Automatic / Manual / Quartz / Digital / Solar / Spring Drive), caliber, BPH; case diameter, lug-to-lug, thickness, weight, material; crystal type, water resistance; origin, production years, gender.
- **Straps/bracelets:** Multiple entries (name + material), with a toggle for which is currently on the watch (the app asks which strap you wore when logging).
- **Accuracy readings:** Timegrapher history per watch (see §6).
- **The Story:** Free-text description, long-form background, and functions/features.

### Viewing & managing the collection
- **Grid view** (cards with photo, name, brand/ref, tags, and stat boxes: Purchased, Paid, Total Wears, Cost/Wear, Market Price) and a **List view** with sortable columns.
- **Sort:** by purchase date (default), by wears, or by Ranking (Elo — see below).
- **Filter:** tap any type tag to filter; tap again to clear.
- **Post Pics toggle:** swap official watch photos for the latest wrist shots pulled from your posts.
- **Per-watch privacy:** each watch cycles Default → Public → Followers → Close Friends → Private.
- **Edit/Delete:** full edit modal per watch; deleting warns that it also removes all wear logs (irreversible).
- **Ranking Game:** head-to-head matchups — pick the watch you prefer within ~3 seconds; an Elo score builds an ordered ranking, with #1/#2/#3 medals shown on the grid and drag-to-reorder in ranking mode.
- **Warranty banner:** auto-reminder at the top when a watch's warranty is nearing expiry (dismissible).

---

## 4. Wishlist

- Separate **Wishlist** tab; add via the same form or URL fetch.
- **Drag-to-reorder** by priority; the #1 spot is highlighted in gold.
- **Price tracking:** compare asking price vs. current market price.
- **Move to Collection:** graduate a wishlist item once purchased.
- **Visibility:** Public / Followers / Close Friends / Private (private by default). Followers can browse your wishlist — handy for gift ideas.
- **Share by link:** tap **Share** to enter selection mode — checkboxes appear in List, brand Folders, and Gallery views; a folder checkbox is tri-state and takes/drops every watch of that brand in one tap. **Create link** mints a public, revocable link to a WRotate-branded page listing only each selected watch's **photo, brand, model, reference and any link you saved number** — no account needed to view, and price/market value/notes/tags/saved URL are never fetched or sent. Item-level privacy doesn't restrict selection (ticking is explicit and overrides it); the create sheet just flags how many private items are included. Links are live for individually-picked watches (edits show up), but a folder selection freezes the watch list at creation time. **Shared links** lists every link sent with its label, item count, and view count, with one-tap **Revoke**.

---

## 5. Wear Logging & Rotation Tracking

### Logging a wear (Track tab)
- **Today's Pick:** a smart daily suggestion factoring in ranking, use-case patterns, purchase age, and recent wrist time — with a one-tap "Log This Wear."
- **Watch selector** sorted by most recently worn; warns if already logged that day.
- **Fields:** Date (defaults today, can backfill), Strap/bracelet (if the watch has 2+), Occasion/use case (Unspecified, Work, Leisure, Dinner, Travel), optional photo, public caption (with @mentions), private notes (only you see them), and post visibility (Public / Followers / Close Friends / Only me).
- **Post a photo, auto-log a wear:** posting a wrist shot lets AI recognize the watch and log the wear automatically (editable).
- **Edit/Delete** any log via a pencil icon on the feed card or in the wear-history table.

### Stats & insights (Stats tab)
- **Overview:** Total wears, days logged, watches worn, in-collection count, most worn, and collection value (Paid vs. Market with % delta).
- **Collection report:** per-watch table — purchase date, paid, wears, cost-per-wear, market price, price delta %.
- **Wears by use case:** doughnut chart (Work/Leisure/Dinner/Travel) with counts and percentages.
- **Collection value over time:** dual line chart of cumulative cost vs. cumulative market value.
- **Day-of-week report:** wear distribution across weekdays.
- **Year in Review:** per-year navigation — total wears, days logged, new watches, unworn count, most-worn, top use case, best month.
- **Monthly Review:** per-month navigation — totals, unique watches, most-worn, top use case, busiest weekday.
- **Period filter:** All time / 30 days / 90 days / Last year.
- Derived metrics include cost-per-wear, wear streaks, days since last worn, and most/least worn.

---

## 6. Timegrapher — Accuracy Measurement (iOS app)

The marquee feature: measure a mechanical watch's rate using the phone mic.

### How a measurement works
1. Open the **Measure** tab, pick a watch and a **BPH** (beat rate): 18,000 / 21,600 / 25,200 / 28,800 / 36,000, or **Auto** (the app detects the frequency).
2. Place the watch's caseback against the iPhone mic (bottom edge, by the charging port) and keep still.
3. Tap **Measure**. The app listens; a live scatter chart fills with dots as ticks are detected.
4. A **preliminary** rate shows within seconds (amber badge), then refines until it **converges** (green badge) — typically 30–60s. Auto-stops on convergence or at a max duration (default 45s).
5. **Save** the reading (optionally with notes), or **Share** it to the feed as a graphic card.

### What's measured & shown
- **Rate (s/day)** — the headline number, gain (+) or loss (−), one decimal, with a ± uncertainty band.
- **Beat error (ms)**, **amplitude (°)**, and detected/selected **BPH**.
- **Live HUD:** big live rate, beat error, detected BPH lock, four signal-strength bars, status phases (Acquiring → Detecting BPH → Calibrating → Measuring), and PRELIMINARY/CONVERGED badges.
- **Confidence messaging:** "Measurement complete" vs. "retry for better accuracy" vs. "retry recommended."

### Input source
- **iPhone mic** (default). Display/transparent casebacks give a stronger signal than solid steel.
- **Piezo (contact) sensor** — an alternate input, currently **admin-gated** behind a feature flag (not visible to general users yet).

### Advanced settings (gear icon)
- **Environment presets:** Default, Quiet Room, Noisy Environment, Weak Signal.
- **Manual sliders:** Sensitivity, Convergence Speed, Noise Tolerance, Outlier Strictness, Max Duration (30–120s), Recalibration Attempts. Saved per algorithm version (auto-reset when the engine updates).

### History, manual entry & sharing
- Per-watch **accuracy history** with each reading color-coded green/amber/red by how far off it is, plus inline beat error/amplitude/notes, and edit/delete.
- **Manual entry** for readings taken on an external timegrapher.
- **Share card:** a rendered graphic (watch name, scatter chart, big rate, BPH/beat error, WRotate wordmark) posted to the feed as a special "measurement" post type.
- **Troubleshooting & in-app guide** explaining placement, quiet environments, and when to switch to Auto BPH or a preset.

---

## 7. Social Feed & Posting

- **Feed:** reverse-chronological posts from people you follow; skeleton loaders, pull-to-refresh, and retry-on-error states.
- **Composer ("New Post"):** up to **6 photos/videos**, draggable to reorder (first is the hero), a caption (≤1000 chars, @mentions), location chips (Home/Work/Travel or custom), optional watch tag, optional club to share to, and a visibility selector. A measurement card can also be posted.
- **Visibility levels:** Public, Followers, Close Friends, Private (Only me). A per-user default exists in Privacy settings; each post can override it.
- **Post actions:** edit (three-dot menu, preserves visibility, can change the tagged watch), share (public posts share openly; followers/close-friends posts generate a private preview link), report, and delete (own posts).
- **Likes:** heart toggle with count; tap the count for a "Liked by" list.
- **Comments:** threaded, with @mention autocomplete, comment likes, most-liked pinned first, "view more" expansion, and delete (your comments anywhere, plus any comment on your own posts).
- **Multi-image viewing:** tap a thumbnail to preview; hero opens a fullscreen swipe gallery.

---

## 8. Profiles, Following & Privacy

- **Profile page:** avatar (photo or monogram), display name, @username, bio, official badge (for verified accounts), and stat boxes — Watches/Shared, Followers, Following, Close Friends (all tappable to lists).
- **Showcases:** a collection grid (with per-watch privacy badges), a public wishlist preview, and an Instagram-style 3×3 recent-posts grid that deep-links into the feed.
- **Editing:** display name, @username (with availability check), bio, avatar (upload/remove).
- **Public share pages (no login needed):**
  - `/profile/?u=username` — public collection page with stats and most-worn.
  - `/p/?id=...` — single-post preview with Open Graph link previews; private posts show "sign in to view" to outsiders.
- **Following:** Find People search (by name/@username), Follow/Unfollow (with confirm), follow-back from notifications. "Followers Only" profiles turn follows into **follow requests** (accept/decline).
- **Close Friends:** a mutual-follow inner circle (both must follow, then send/accept a request). Unlocks a Close-Friends visibility tier across posts, collection, and wishlist; access is mutual; removable anytime.
- **Privacy controls (independent settings):** Profile visibility (Public / Followers Only / Private), Collection visibility, Wishlist visibility, and Default post visibility — each with their own tiers.
- **Blocking:** block from a profile or post menu; hides their content both ways and removes follow relationships. A managed blocked-users list with unblock.

---

## 9. Clubs

- **Create a club:** name (≤60), description (≤300), Public or Private. Creator becomes owner.
- **Join:** public clubs join instantly; private clubs send a join **request** the owner accepts/declines.
- **Invite members** (owner): search by name/@username, send/rescind invites; invitees get a Join/Decline notification.
- **Club detail page:** avatar, name, privacy + member count, description, member chips (👑 for owners), and a club-only post feed (likes/comments included).
- **Manage (owner):** edit name/description/photo/privacy, promote a member to owner, remove members, or delete the club (warns members lose access; posts keep but lose the club tag).
- **Post to a club:** an optional "Share to Club" selector when logging a wear or posting; club posts are visible only to members.
- **Leave:** with a confirmation that you'll lose access to the club's posts.
- **Notifications:** join request, request accepted, invite, and promotion-to-owner.

---

## 10. Achievement Badges (Gamification)

24 badges across 6 categories, shown on a profile **Badge Wall** (category tabs, "X of Y earned," locked badges greyed out, tap for detail). Earning one fires a toast (with haptics) and marks it unseen until viewed. Categories and the full list:

- **Onboarding (5):** First Watch, First Measurement, First Wear, First Post, Profile Complete.
- **Collection tiers (4):** Five in the Box (5), Ten in the Box (10), Fifteen Deep (15), Twenty Strong (20).
- **Connoisseur (4):** Holy Trinity (own a Patek + AP + Vacheron), Vintage Piece (a watch from ≤1990), Brand Devotee (3+ from one brand), Complication Collector (4+ distinct complication types).
- **Timegrapher (4):** Chronometer Grade (−4 to +6 s/day, ≥60s), Ten Measurements, Full Audit (every watch measured, min 3), Caught a Drifter (a >±30 s/day reading then a <±15 follow-up within 90 days on the same watch).
- **Habit (3):** Seven-Day Streak, Thirty-Day Streak, Balanced Quarter (over 90 days no watch >40% of wear days, 4+ watches worn).
- **Hidden easter eggs (4, revealed only when earned):** High Noon (measure at 11:58–12:02), Full Moon (wear a moonphase watch on a real full moon), Birthday Boy (log a wear on your birthday), Leap Second (measure near midnight UTC on Jun 30 / Dec 31).

Badges are awarded automatically (including a retroactive scan on load), so they accrue from normal use.

---

## 11. Notifications

- **In-app bell** with unread badge; opens a panel, auto-marks read shortly after opening, "Mark all read."
- **Types:** follow request / accepted / new follower (with Follow Back), like, comment, "also commented," comment like, @mention, close-friend request/accepted, and the four club types — plus system messages.
- **Push (iOS):** via APNs for likes, comments, follows, and club invites (permission requested; device token cleared on sign-out).
- **Email:** per-category opt-ins (Comments, Mentions, Follows & friend requests, Club activity, WRotate updates). Comment emails include the actual comment text; mentions notify instantly.

---

## 12. Help, What's New & Feedback

- **Help & Guide tab:** structured how-to sections covering Collection, Wear logging, Collection features, Wishlist, Feed & community, Close Friends, Clubs, Safety & reporting, @Mentions, Profile & privacy, and Measure Accuracy.
- **What's New:** an in-app changelog (multiple months of shipped features).
- **Send Feedback:** in-app submission (routed to an admin queue).
- **Invite a Friend:** share/referral entry point.

---

## 13. Platform & Misc

- **PWA:** installable to home screen, standalone display, service worker with offline fallback and network-first HTML.
- **Dark/light theme** toggle, persisted.
- **Mobile UX:** swipe between tabs, pull-to-refresh, paste/drag-drop image upload, haptic feedback (iOS).
- **iOS extras:** Share Extension (send a photo from Photos straight into WRotate to identify/add a watch), quick actions, network monitoring, secure OAuth.
- **Safety/moderation (user-facing):** report posts/comments (reason + details), block users, immediate hiding of reported content pending admin review, zero-tolerance content policy, Terms & Privacy.
- **Admin tools** (staff only, not user-visible): usage/traffic analytics, feedback & report queues, official-account posting, broadcast email/campaigns, and feature-flag management.

---

## 14. Notable Gaps / Things Not (Yet) in the App

Useful for brainstorming — these are **not** currently present:

- No email/password or 2FA login (OAuth only).
- No paid/premium tier, no monetization.
- No localization (English only) and no metric/imperial or units toggle (rate is always s/day).
- No direct messaging / DMs between users.
- No formal referral rewards (just an "Invite a Friend" share).
- No self-serve data export UI.
- Piezo timegrapher input exists but is admin-gated, not generally available.
- Hashtags exist only implicitly via tags/use-cases, not as a first-class searchable feed concept.
- No web-based live mic measurement (timegrapher live capture is iOS-only; web supports manual entry and viewing).
