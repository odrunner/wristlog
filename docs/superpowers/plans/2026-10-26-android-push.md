# Android Push (FCM) — Android Port Plan 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android users receive the four push surfaces (notification pushes, badge pushes, wear reminders, measure/day-7 reminders) via FCM, alongside untouched iOS APNs — with the email click-tracking gate fixed BEFORE the first Android token row exists.

**Architecture:** Server first, client last. A shared FCM v1 sender (`_shared/fcm.ts` IO over `fcm-lib.ts` pure) joins the existing per-function APNs code; the four senders select tokens of BOTH platforms and route per row. `push_auth_status` gains a platform dimension (PK `(user_id, platform)`); the three reminder RPCs' channel rule becomes per-platform ("push if any platform authorized"; Android needs an explicit `authorized` row — no legacy no-row grant, no provisional). The Android client initializes Firebase from checked-in public constants (no gradle plugin — `google-services.json` is gitignored), asks POST_NOTIFICATIONS at sign-in (spec: Android has no provisional state), registers tokens as `platform='android'`, `app_version=versionName`, and routes notification taps through the same JS entry points as iOS.

**Tech Stack:** Deno edge functions (WebCrypto RS256 for the FCM OAuth JWT), Postgres RPCs, Kotlin + `com.google.firebase:firebase-messaging` (initialized manually via `FirebaseOptions.Builder`), vanilla JS web.

**Spec:** `docs/superpowers/specs/2026-10-22-android-port-design.md` §3 (lines ~156-183) + anti-goals (lines ~44-67). The push-stack map informing this plan was verified against source 2026-10-26.

## Global Constraints

- **Ordering is a correctness rule:** Tasks 1–6 (server+web) land and deploy before Task 7+ (client) ships — an Android token row must never exist while `tracked.ts` lacks the platform veto (spec anti-goal: broken email app-opens).
- **Zero iOS behavior change:** APNs paths, iOS token selection semantics, iOS channel rules, `record_push_auth_status` existing call shape (platform defaults to `'ios'`), and every `iosAtLeast` gate keep their exact meaning.
- Android token rows: `platform='android'`, `app_version=<Play versionName>` (e.g. `'1.2'`) — NEVER the iOS-line capability version (`2.10`), which would wrongly clear the ≥2.6 tracked/route gates.
- `w` route payloads attach to ALL android tokens (no version gate — no pre-push Android build ever registered a token).
- Edge functions deploy `--no-verify-jwt`; `npm run test:smoke` after deploy; RPCs applied via `npx supabase db query --linked` + `NOTIFY pgrst, 'reload schema'`; new-table GRANT rules n/a (no new tables). **Every deploy/SQL-apply step in Task 10 requires the user's explicit go-ahead** (production send path).
- DROP+CREATE RPC files must re-REVOKE/GRANT exactly as the current files do.
- index.html edits: SW bump, ratchet untouched, `wrotate_test.js` mirror + coverage gate (new exports need branch-covering tests), `tests/mirror-drift.test.js` and the regex tests (`push-provisional-native`, `push-auth-status-sql`, `remeasure-d7-sql`, `measure-reminders-sql`) must stay green or be repointed deliberately.
- No emoji. Commits end with the repo trailer.

## Review Focus

1. **Android `denied` row must not strip iOS push** (new PK makes two rows per user possible): a user with iOS `authorized` + Android `denied` keeps iOS push in all three reminder RPCs. → Tasks 4's regex/SQL tests assert per-platform scoping (`s.platform = d.platform`).
2. **FCM data map values must be strings** (FCM v1 rejects non-string data): `n` (uuid/null) and numeric ids stringified, nulls omitted. → Task 1 `buildFcmMessage` tests pin string-only data and null omission.
3. **UNREGISTERED token pruning must be user-scoped** (the APNs send-push pattern): FCM 404/UNREGISTERED deletes only `(user_id, token)`, mirroring send-push, not the badge-push global delete. → Task 5 tests `isDeadFcmResult`.
4. **The old `app_version`-not-null filter would hide vetoing Android rows** in tracked.ts (an Android row with null version must still veto). → Task 2 test: android row with `app_version: null` vetoes.
5. **POST_NOTIFICATIONS below API 33 is auto-granted** (no runtime dialog exists): statusString must report `authorized` on 26–32 once a token exists, or Android users on older devices silently report `notDetermined` forever and reminder RPCs email them despite working push. → Task 8 pure test on the status mapping with sdk<33.

---

### Task 1: `_shared/fcm-lib.ts` + `_shared/fcm.ts` — the FCM v1 sender

**Files:**
- Create: `supabase/functions/_shared/fcm-lib.ts` (pure), `supabase/functions/_shared/fcm.ts` (IO), `supabase/functions/_shared/fcm-lib.test.ts`

**Interfaces (Produces):**
- `fcm-lib.ts`: `buildFcmMessage(token: string, msg: {title: string; body: string}, w?: {route: string; id: string | null; uid: string; n?: string | null; t?: string}): object` — `{message: {token, notification: {title, body}, data: {route, id?, uid, n?, t?} (strings only, nulls omitted), android: {priority: 'high'}}}`; `buildOauthClaims(clientEmail: string, nowSecs: number): object` (`iss`, `scope: 'https://www.googleapis.com/auth/firebase.messaging'`, `aud: 'https://oauth2.googleapis.com/token'`, `iat`, `exp: iat+3600`); `fcmSendUrl(projectId: string): string`; `isDeadFcmResult(status: number, errorStatus?: string): boolean` (404, or 400/`UNREGISTERED`/`INVALID_ARGUMENT` on the registration token error code).
- `fcm.ts`: `sendFcm(token, msg, w) => Promise<{success: boolean; status: number; dead: boolean}>` — reads secret `FCM_SERVICE_ACCOUNT` (full service-account JSON), signs the OAuth JWT RS256 via WebCrypto (`importKey('pkcs8', …RSASSA-PKCS1-v1_5/SHA-256)` — reuse the APNs `stripPemArmor`/`base64UrlEncode` shapes from `send-push/lib.ts`), exchanges at `https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`), caches the access token module-level until 5 min before expiry, POSTs the message. All failures return `success:false` — senders treat FCM exactly like APNs failures.

- [ ] **Step 1:** Write failing `fcm-lib.test.ts`: `buildFcmMessage` (string-only data incl. stringified `n`, null `id` omitted, priority high, no `w` → no data key); `buildOauthClaims` exact fields; `fcmSendUrl('wrotate')`; `isDeadFcmResult` table (404→true, 400+UNREGISTERED→true, 500→false, 400 other→false).
- [ ] **Step 2:** `npm run test:functions` → new tests fail (module missing).
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** `npm run test:functions` → green.
- [ ] **Step 5:** Commit `feat(push): shared FCM v1 sender (pure lib + IO)`.

### Task 2: tracked.ts — Android rows veto click tracking

**Files:**
- Modify: `supabase/functions/_shared/tracked.ts` (select adds `platform`, drops the `.not("app_version","is",null)` filter), `supabase/functions/_shared/tracked-lib.ts` (`trackedUidSet`), tests `tracked.test.ts` + `tracked-lib.test.ts`

**Interfaces:** `trackedUidSet(rows: {user_id, app_version, platform}[])` — tracked = at least one `platform==='ios'` row at ≥2.6 AND zero `platform==='android'` rows. Rows with missing platform count as ios (legacy).

- [ ] **Step 1:** Failing tests: ios 2.6 alone → tracked; ios 2.6 + android (any/null version) → NOT tracked; android only → not; missing-platform 2.6 row → tracked (legacy).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement (lib rule + select/stub-chain change). **Step 4:** Green. **Step 5:** Commit `fix(email): Android token vetoes per-recipient click tracking (spec anti-goal)`.

### Task 3: push_auth_status gains a platform dimension

**Files:**
- Create: `sql/2026-10-26-push-auth-platform.sql` — `ALTER TABLE push_auth_status ADD COLUMN platform text NOT NULL DEFAULT 'ios'`; drop PK, `ADD PRIMARY KEY (user_id, platform)`; `CREATE OR REPLACE FUNCTION record_push_auth_status(p_status text, p_app_version text DEFAULT NULL, p_platform text DEFAULT 'ios') … ON CONFLICT (user_id, platform) DO UPDATE …` validating `p_platform IN ('ios','android')`, same status whitelist + auth.uid() guard, SECURITY DEFINER, same grants.
- Create: `tests/push-auth-platform-sql.test.js` (regex: `(user_id, platform)` conflict target, platform whitelist, default `'ios'`); repoint `tests/push-auth-status-sql.test.js` to the new file for the conflict-target assertion (it currently reads the 2026-08-16 file).

- [ ] Steps: failing test → implement SQL file → `npm test` green → commit `feat(push): platform dimension on push_auth_status (+RPC)`. (Applying to prod is Task 10.)

### Task 4: Reminder RPC channel rules — per-platform

**Files:**
- Create: `sql/2026-10-26-reminder-channels-android.sql` re-defining `wear_reminder_targets()`, `measure_reminder_targets()`, `remeasure_d7_targets(p_dry)` (DROP+CREATE, re-REVOKE/GRANT service_role as today).
- Modify tests: `tests/measure-reminders-sql.test.js`, `tests/remeasure-d7-sql.test.js` (repoint to the new file), new assertions in a `tests/reminder-channels-android-sql.test.js`.

**Channel rule (all three):** `push_ok(user) = ios_push_ok OR android_push_ok` where `ios_push_ok` = ios token AND NOT EXISTS ios-platform row with `status <> 'authorized'` (legacy no-row grant, unchanged in effect), `android_push_ok` = android token AND EXISTS android-platform row `status = 'authorized'` (explicit grant only). `push_quiet` stays ios-only. Every `push_auth_status` predicate adds `AND s.platform = '<platform>'`. Returned columns unchanged.

- [ ] Steps: failing regex tests (per-platform scoping present in each function; android requires explicit authorized) → write SQL → `npm test` green → commit `feat(push): reminder channel rules cover android (per-platform auth)`.

### Task 5: The four senders route per platform

**Files:**
- Modify: `supabase/functions/send-push/{index,lib}.ts`, `send-badge-push/{index,lib}.ts`, `send-wear-reminders/{index,lib}.ts`, `send-measure-reminders/{index,lib}.ts` + each `lib.test.ts`

**Changes (same pattern everywhere):** token select drops `.eq("platform","ios")` → `.select("token, app_version, platform")`; per row: ios → existing APNs path untouched; android → `sendFcm(token, msg, w)` from `_shared/fcm.ts`. `w` for android attaches ALWAYS (`routeFor` gains a platform arg: android → route regardless of version; ios → unchanged ≥2.6 rule). Dead-token pruning: FCM dead results delete scoped `(user_id, token)` in ALL four (fixing badge-push's global delete for the new path only; its APNs path stays as-is). Response counts unchanged in shape.

- [ ] Steps per function: failing lib tests (`routeFor('1.2','android',…)` attaches, `routeFor('2.4','ios',…)` doesn't; platform split helper) → implement → `npm run test:functions` green → one commit `feat(push): all four senders send FCM to android tokens`.

### Task 6: Web — push UI + status recording for Android

**Files:**
- Modify: `index.html` (`_pushBridgeAvailable` adds `|| (nativePlatform()==='android' && nativeAtLeast('2.10') && typeof window._pushAuthStatus === 'string')`; `onPushAuthStatus` RPC call gains `p_platform: nativePlatform() === 'android' ? 'android' : 'ios'` and `p_app_version: window._iosAppVersion || window._nativeAppVersion || null`; `renderPushSettingRow` unchanged — Android never reports `provisional`), `sw.js` bump, `wrotate_test.js` mirrors where drift-tested.
- Modify: `sql/2026-10-26-admin-push-stats-platform.sql` — `admin_push_stats()` splits counts by platform (iOS numbers keep their meaning; android reported separately).
- Tests: extend `tests/deferred-push-ask.test.js`/`push-provisional-native.test.js` only if their regexes break (they must keep passing unchanged — Android deliberately never enters the deferred-ask path), new unit tests for any new `wrotate_test.js` export (coverage gate).

- [ ] Steps: failing unit tests → implement → `npm test && npm run test:coverage` green → commit `feat(push): web push row + status recording on android`.

### Task 7: Android — Firebase init + FirebaseMessagingService

**Files:**
- Modify: `android/app/build.gradle.kts` (+`com.google.firebase:firebase-messaging:24.1.0`; `buildConfigField`s `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID` — values read from the local `google-services.json` once and checked in; they are public client identifiers, same class as the Supabase publishable key; NO google-services gradle plugin, so builds never need the gitignored file), `AndroidManifest.xml` (`POST_NOTIFICATIONS` permission, the service, default notification channel meta-data)
- Create: `android/app/src/main/kotlin/com/wrotate/app/PushService.kt` (FirebaseMessagingService: `onNewToken` → `PushRegistrar.store`; `onMessageReceived` → tray notification on the `reminders` channel carrying the `data` map into the ShellActivity launch intent), `PushChannels.kt` (channel create, idempotent)
- Create: `android/app/src/main/kotlin/com/wrotate/app/PushPayload.kt` (pure): `fun tapExtras(data: Map<String,String>): Map<String,String>` (passes route/id/uid/n/t through) — JVM-tested.
- Test: `PushPayloadTest.kt`

- [ ] Steps: failing PushPayloadTest → implement → full android suite + assembleDebug green → commit `feat(android): Firebase messaging service + notification channel`.

### Task 8: Android — auth watcher, token registration, permission + status bridge

**Files:**
- Modify: `android/app/src/main/kotlin/com/wrotate/app/BridgeScript.kt` (add the iOS-parity auth watcher: `db.auth.onAuthStateChange` posting `{event, userId, accessToken}` to the `auth` handler — mirror `WebView.swift:160-195`), `ShellActivity.kt` (`"auth"` case: SIGNED_IN → ask POST_NOTIFICATIONS (API 33+; `registerForActivityResult(RequestPermission())` like `micPermission`) then `PushRegistrar.register`; SIGNED_OUT → `PushRegistrar.delete`; after any status change inject `window._pushAuthStatus='<s>'; onPushAuthStatus('<s>')`; `appAction` `requestPushPermission` → full ask, `openAppSettings` → `ACTION_APP_NOTIFICATION_SETTINGS`)
- Create: `PushRegistrar.kt` — stores `{user_id, token, platform:'android', app_version: BuildConfig.VERSION_NAME, updated_at}` to `/rest/v1/device_tokens` with `Prefer: resolution=merge-duplicates` + user bearer (PushManager.swift parity; publishable key as apikey); `delete` on sign-out; pure `statusString(granted: Boolean?, sdkInt: Int, hasToken: Boolean): String` — sdk<33 → `authorized`; granted true → `authorized`; false → `denied`; null (never asked) → `notDetermined`. NEVER `provisional`.
- Tests: `PushRegistrarTest.kt` (statusString table incl. Review Focus 5 sdk<33 case; request-body builder shape), `BridgeScriptTest.kt` (auth watcher present, posts userId+accessToken).

- [ ] Steps: failing tests → implement → suite green → commit `feat(android): sign-in push ask + token registration + status reporting`.

### Task 9: Android — notification tap routing

**Files:**
- Modify: `ShellActivity.kt` — launch intent extras `route/id/uid/n/t` (from Task 7's tray intent): drop if `uid` ≠ signed-in user is NOT knowable natively (no session store) — instead pass `uid` through and let the page's existing uid checks apply where they exist; set `window._openedFromPush=true` then dispatch the iOS ContentView switch via `drainPending()`: post→`scrollToFeedPost`, profile→`viewUserProfile`, club→`openClubDetail`, badges→`openBadgeWall`, else→`openPushRoute(route,id)`.
- Create: `PushTapJs.kt` (pure): `fun dispatchJs(route: String?, id: String?): String?` with the same typeof-guards as QuickActions. Test: `PushTapJsTest.kt` (each route mapping; unsafe id charset → null — ids are uuids, guard `[A-Za-z0-9-]`).

- [ ] Steps: failing PushTapJsTest → implement → suite green → commit `feat(android): push tap routing into the page`.

### Task 10: Ship — secrets, SQL, deploys, client release (EVERY sub-step needs the user's go-ahead where marked)

- [ ] **Step 1:** `npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat ~/.config/wrotate/firebase-service-account.json)"` (no send; safe).
- [ ] **Step 2 [USER GO-AHEAD]:** apply Task 3+4+6 SQL via `db query --linked` + `NOTIFY pgrst, 'reload schema'`; verify with `set_config('request.jwt.claims',…)` test calls per CLAUDE.md.
- [ ] **Step 3 [USER GO-AHEAD]:** deploy ALL tracked.ts/fcm importers (`send-push`, `send-badge-push`, `send-wear-reminders`, `send-measure-reminders`, `send-broadcast`, `run-campaign`, `send-email`, **`share-wishlist`, `share-watches`** — the last two import tracked.ts via `_shared/share-comments.ts`; review finding I4) `--no-verify-jwt`; `npm run test:smoke`; dry-run checks: wear/measure `{"dry_run": true}` and broadcast `{"drain":true,"quota_only":true}`.
- [ ] **Step 4:** bump `versionCode 7 / versionName "1.2"`, bundle, full suites, commit, push. User uploads to the test track.
- [ ] **Step 5:** On-device UAT (test accounts where content is involved): sign in on the Pixel → permission dialog → accept → `device_tokens` row `platform='android', app_version='1.2'` and `push_auth_status (user, android, authorized)`; send a like from test2 → push arrives, tap lands on the post; verify an iOS device still receives pushes unchanged; confirm `fetchTrackedUids` now excludes the Android-token user (query), and admin push stats show the platform split.
