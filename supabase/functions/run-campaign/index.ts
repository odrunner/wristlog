// Supabase Edge Function: run-campaign
// Invoked daily (via cron or manual trigger) to send drip campaign emails.
// For each active campaign, finds users who signed up `delay_days` ago
// and haven't been sent yet. Sends via the Resend batch API.
// Campaigns with backfill_daily > 0 also drain existing members (older than
// the signup window) at that rate per run, newest first, until exhausted.
//
// Required Supabase secrets:
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { excludeBounced, fetchBouncedEmails } from "../_shared/bounced.ts";
import {
  buildHtmlEmail,
  dropDone,
  FALLBACK_FACT,
  filterEligible,
  looksCompleteFact,
  looksLikeRealWatchLabel,
  modelKey,
  needsFactVars,
  personalizeBody,
  personalizeSubject,
  pickBackfill,
  pickFeaturedWatch,
  pickPoolFact,
  signupWindow,
  skipTable,
  splitAlreadySent,
  unsubUrl,
  watchLabel,
  watchPhrase,
} from "./lib.ts";
// Same grounded-search prompt + JSON extractor the in-app fun-fact path uses, so
// a fact minted for the email is indistinguishable from one minted on a wear log.
import { buildFactsPrompt, extractJson } from "../identify-watch/lib.ts";
// Transport: ../_shared/mailer.ts — provider chosen at runtime by the
// EMAIL_PROVIDER secret (defaults to Resend).
import { sendBatch } from "../_shared/mailer.ts";
import type { MailMessage } from "../_shared/mailer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Unsubscribe links are signed with a dedicated secret when one is set, falling
// back to the service-role key so nothing changes until it is. The verifier
// (email-unsubscribe) accepts both, so rotating the service-role key no longer
// invalidates links already sitting in inboxes. See audit S4.
const UNSUB_KEY = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const FROM_EMAIL = "WRotate <hello@wrotate.com>";
const ADMIN_USER_ID = "d70b1a85-4f31-4431-b3b7-db76543daaf5";
// Ceiling on live fact generations per invocation. Each is a grounded Gemini
// search taking seconds; the drip window is a handful of users a day, but a
// campaign switched to backfill must not stall the run or spike spend. Past the
// cap recipients get the curated fallback fact — never a broken email.
const MAX_FACT_GENERATIONS = 10;

// Constant-time compare for the shared trigger secret.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type PassResult = { sent: number; skipped: number; failed: number; trackingFailed: boolean };
type Recipient = { uid: string; email: string; displayName: string };
type ProfileRow = {
  id: string;
  display_name: string | null;
  email_prefs: { updates?: boolean } | null;
  created_at?: string;
};
// deno-lint-ignore no-explicit-any
type Campaign = any; // row from email_campaigns (select *)
// deno-lint-ignore no-explicit-any
type Db = any; // supabase service-role client

// Page through a range-capable query 1000 rows at a time (mirrors send-broadcast).
async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const PAGE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: all, error: null };
}

// Resolve profile rows to email recipients via auth.users, minus any address
// that has permanently bounced (SES suppresses those account-wide; re-sending
// only mints another bounce against the sending reputation).
async function resolveRecipients(supabase: Db, users: ProfileRow[]): Promise<Recipient[]> {
  const recipients: Recipient[] = [];
  for (const u of users) {
    const { data: authUser } = await supabase.auth.admin.getUserById(u.id);
    if (authUser?.user?.email) {
      recipients.push({ uid: u.id, email: authUser.user.email, displayName: u.display_name || "" });
    }
  }
  return excludeBounced(recipients, await fetchBouncedEmails(supabase));
}

// A fact to headline the email, plus the pool coordinates needed to advance the
// recipient's cursor once the send succeeds. key/factId are null for the
// curated fallback (no watch, or nothing generatable) — nothing to advance.
type ResolvedFact = {
  watch: string;
  watchPhrase: string;
  fact: string;
  key: string | null;
  factId: string | null;
  position: number | null;
};

// One grounded Gemini fact for a model, same call the in-app path makes.
// Returns null on any failure — the caller falls back rather than failing send.
async function generateFact(
  brand: string,
  name: string,
  reference: string | null,
  existingFacts: string[],
): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  const prompt = buildFactsPrompt({ brand, model: name, reference: reference ?? "" }, existingFacts);
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 45000);
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
        }),
      },
    );
    clearTimeout(timer);
    if (!resp.ok) {
      console.error(`[run-campaign] fact generation HTTP ${resp.status} for ${brand} ${name}`);
      return null;
    }
    const result = await resp.json();
    const candidate = result.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((p: any) => p.text).map((p: any) => p.text).join("");
    const parsed = extractJson(text);
    const fact = typeof parsed?.fact === "string" ? parsed.fact.trim() : "";
    return fact || null;
  } catch (e) {
    console.error(`[run-campaign] fact generation failed for ${brand} ${name}:`, (e as Error).message);
    return null;
  }
}

// Resolve the {{watch}}/{{fact}} pair for one recipient: their newest watch,
// then a complete fact from the shared pool, then a freshly generated one
// (which is written back to the pool so every future wearer of that model gets
// it too), then the curated fallback.
async function resolveFact(
  supabase: Db,
  uid: string,
  budget: { left: number },
): Promise<ResolvedFact> {
  const fallback: ResolvedFact = { ...FALLBACK_FACT, key: null, factId: null, position: null };

  type WatchRow = { brand: string | null; name: string | null; ref: string | null; created_at: string | null };
  const { data: watches, error: wErr } = await supabase
    .from("watches").select("brand, name, ref, created_at").eq("user_id", uid);
  if (wErr) {
    console.error(`[run-campaign] watches fetch failed for ${uid}:`, wErr);
    return fallback;
  }
  const watch = pickFeaturedWatch<WatchRow>((watches ?? []) as WatchRow[]);
  if (!watch) return fallback;

  const brand = (watch.brand as string).trim();
  const name = (watch.name as string).trim();
  const key = modelKey(brand, name);
  const label = watchLabel(brand, name);
  // Free text headed for the subject line — fall back rather than mail someone
  // "A fun fact about your Omega Fake Omega - Likely ETA 2824-2".
  if (!looksLikeRealWatchLabel(label)) return fallback;
  const phrase = watchPhrase(label);

  type PoolRow = { id: string; position: number; fact: string };
  const { data: poolRows, error: pErr } = await supabase
    .from("watch_facts").select("id, position, fact").eq("model_key", key);
  if (pErr) {
    console.error(`[run-campaign] fact pool fetch failed for ${key}:`, pErr);
    return fallback;
  }
  const pool = (poolRows ?? []) as PoolRow[];
  const hit = pickPoolFact(pool);
  if (hit) {
    return { watch: label, watchPhrase: phrase, fact: hit.fact, key, factId: hit.id, position: hit.position };
  }

  // Nothing usable in the pool. Generate — but only while budget remains, and
  // never past the shared 10-fact-per-model cap the RPCs enforce.
  if (budget.left <= 0 || pool.length >= 10) return { ...fallback, watch: label, watchPhrase: phrase };
  budget.left--;
  const generated = await generateFact(brand, name, watch.ref ?? null, pool.map((r) => r.fact));
  if (!generated) return { ...fallback, watch: label, watchPhrase: phrase };

  const position = pool.length;
  const { error: insErr } = await supabase
    .from("watch_facts").insert({ model_key: key, position, fact: generated.slice(0, 500) });
  if (insErr) {
    // Lost a race with a concurrent wearer for this slot — still email the fact
    // we generated, just don't claim a pool position for the cursor advance.
    console.error(`[run-campaign] fact pool insert failed for ${key}@${position}:`, insErr);
    return { watch: label, watchPhrase: phrase, fact: generated, key: null, factId: null, position: null };
  }
  const { data: inserted } = await supabase
    .from("watch_facts").select("id").eq("model_key", key).eq("position", position).maybeSingle();
  return { watch: label, watchPhrase: phrase, fact: generated, key, factId: inserted?.id ?? null, position };
}

// After a successful send, park the recipient's cursor on the fact they just
// read so their first in-app wear log serves the NEXT one — the email promises
// a new fact every day they wear it, and repeating it on log one would break
// that. last_wear_date stays null so even a same-day log advances.
async function advanceFactCursors(
  supabase: Db,
  facts: Array<{ uid: string; f: ResolvedFact }>,
): Promise<void> {
  const candidates = facts.filter(({ f }) => f.key && f.factId && f.position !== null);
  if (!candidates.length) return;

  // Never rewind. A recipient can already have a cursor for this model (e.g.
  // they logged a wear and later deleted it), and moving it backwards would
  // replay a fact they've already read in the app.
  const { data: existing, error: readErr } = await supabase
    .from("watch_fact_progress")
    .select("user_id, model_key, last_position")
    .in("user_id", candidates.map(({ uid }) => uid));
  if (readErr) {
    console.error(`[run-campaign] fact cursor read failed:`, readErr);
    return;
  }
  const at = new Map<string, number>(
    ((existing ?? []) as Array<{ user_id: string; model_key: string; last_position: number }>)
      .map((r) => [`${r.user_id}|${r.model_key}`, r.last_position]),
  );

  const rows = candidates
    .filter(({ uid, f }) => (at.get(`${uid}|${f.key}`) ?? -1) < (f.position as number))
    .map(({ uid, f }) => ({
      user_id: uid,
      model_key: f.key,
      last_position: f.position,
      last_wear_date: null,
      current_fact_id: f.factId,
    }));
  if (!rows.length) return;
  const { error } = await supabase
    .from("watch_fact_progress").upsert(rows, { onConflict: "user_id,model_key" });
  // Non-fatal: a missed advance just means their first log repeats the emailed
  // fact. Never fail a delivered send over it.
  if (error) console.error(`[run-campaign] fact cursor advance failed:`, error);
}

// Send personalized campaign emails via the Resend batch API, recording each
// successful recipient in email_campaign_sends immediately.
async function deliver(
  supabase: Db,
  campaign: Campaign,
  toSend: Recipient[],
): Promise<{ sent: number; failed: number; trackingFailed: boolean }> {
  let sent = 0;
  let failed = 0;
  let trackingFailed = false;
  const batchSize = 100;
  // Fact lookups/generation are per-recipient and can hit Gemini, so they run
  // sequentially outside the message fan-out, under a per-run budget.
  const wantsFact = needsFactVars(campaign);
  const factBudget = { left: MAX_FACT_GENERATIONS };

  for (let i = 0; i < toSend.length; i += batchSize) {
    const batch = toSend.slice(i, i + batchSize);

    const facts = new Map<string, ResolvedFact>();
    if (wantsFact) {
      for (const r of batch) facts.set(r.uid, await resolveFact(supabase, r.uid, factBudget));
    }

    const messages: MailMessage[] = await Promise.all(batch.map(async (r) => {
      const sig = await hmacSign(r.uid, "updates", UNSUB_KEY);
      const url = unsubUrl(SUPABASE_URL, r.uid, sig, "updates");
      const f = facts.get(r.uid);
      const vars: Record<string, string> = f
        ? { watch: f.watch, watchPhrase: f.watchPhrase, fact: f.fact }
        : {};
      const subject = personalizeSubject(campaign.subject, r.displayName, vars);
      const personalizedBody = personalizeBody(campaign.body_html, r.displayName, vars);
      // Tag by campaign NAME, not the rendered subject: a personalized subject
      // ("A fun fact about {{watchPhrase}}") differs per recipient and would
      // scatter one drip across hundreds of utm_campaign buckets.
      const html = buildHtmlEmail(subject, personalizedBody, url, campaign.name);
      return {
        from: FROM_EMAIL,
        to: [r.email],
        subject,
        html,
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }));

    const { results } = await sendBatch(messages);
    // Track ONLY the recipients whose send succeeded. Resend validates a batch
    // as a unit, so results are uniform within a chunk today — reading them
    // per-recipient keeps this correct either way, and unchanged if the
    // transport switches to SES (which does report per-recipient).
    const okRecipients = batch.filter((_, idx) => results[idx].ok);
    sent += okRecipients.length;
    failed += batch.length - okRecipients.length;
    if (wantsFact && okRecipients.length) {
      await advanceFactCursors(
        supabase,
        okRecipients
          .map((r) => ({ uid: r.uid, f: facts.get(r.uid) }))
          .filter((x): x is { uid: string; f: ResolvedFact } => !!x.f),
      );
    }
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (!r.ok) console.error(`[run-campaign] Resend send failed for ${batch[idx].uid}:`, r.error);
    }
    if (okRecipients.length) {
      const trackRows = okRecipients.map((r) => ({ campaign_id: campaign.id, user_id: r.uid }));
      const { error: trackErr } = await supabase
        .from("email_campaign_sends")
        .upsert(trackRows, { onConflict: "campaign_id,user_id", ignoreDuplicates: true });
      if (trackErr) {
        console.error(`[run-campaign] Send-tracking upsert error, retrying once:`, trackErr);
        // A failed upsert here means backfill will treat these recipients as
        // never-sent and re-email them tomorrow — worth one retry before we
        // give up and surface it.
        const { error: retryErr } = await supabase
          .from("email_campaign_sends")
          .upsert(trackRows, { onConflict: "campaign_id,user_id", ignoreDuplicates: true });
        if (retryErr) {
          console.error(`[run-campaign] Send-tracking retry also failed:`, retryErr);
          trackingFailed = true;
        }
      }
    }
  }

  return { sent, failed, trackingFailed };
}

// Original per-campaign pass: users who signed up exactly delay_days ago
// (24h window). Behavior unchanged from the pre-backfill version.
async function windowPass(
  supabase: Db,
  campaign: Campaign,
  internalIds: Set<string>,
  emailedThisRun: Set<string>,
): Promise<PassResult> {
  const { name } = campaign;
  const { windowStart, windowEnd } = signupWindow(Date.now(), campaign.delay_days);

  const { data: eligible, error: eligErr } = await supabase
    .from("profiles")
    .select("id, display_name, email_prefs")
    .eq("is_suspended", false)
    .gte("created_at", windowStart)
    .lt("created_at", windowEnd);

  if (eligErr) {
    console.error(`[run-campaign] Failed to fetch eligible users:`, eligErr);
    return { sent: 0, skipped: 0, failed: 0, trackingFailed: false };
  }

  // Filter: not internal, not unsubscribed from updates
  let users = filterEligible(eligible || [], internalIds);

  if (!users.length) {
    console.log(`[run-campaign] "${name}": no eligible users in window`);
    return { sent: 0, skipped: 0, failed: 0, trackingFailed: false };
  }

  // Behavior-aware skip: drop users who already did the campaign's target action.
  const skipTbl = skipTable(campaign.skip_if_done);
  if (skipTbl) {
    const { data: doneRows, error: doneErr } = await supabase
      .from(skipTbl)
      .select("user_id")
      .in("user_id", users.map((u: ProfileRow) => u.id));
    if (doneErr) {
      // Fail safe: never send unfiltered. Skip this campaign this run; retry next day.
      console.error(`[run-campaign] "${name}": skip query (${skipTbl}) failed — skipping:`, doneErr);
      return { sent: 0, skipped: users.length, failed: 0, trackingFailed: false };
    }
    const beforeSkip = users.length;
    users = dropDone(users, (doneRows || []).map((r: { user_id: string }) => r.user_id));
    if (!users.length) {
      console.log(`[run-campaign] "${name}": all eligible already did the action`);
      return { sent: 0, skipped: beforeSkip, failed: 0, trackingFailed: false };
    }
  }

  // Check which users already received this campaign. Fail safe: an empty list
  // from a transient error would re-send to everyone, so skip this campaign.
  const { data: alreadySent, error: sentErr } = await supabase
    .from("email_campaign_sends")
    .select("user_id")
    .eq("campaign_id", campaign.id)
    .in("user_id", users.map((u: ProfileRow) => u.id));
  if (sentErr) {
    console.error(`[run-campaign] "${name}": failed to fetch send history — skipping:`, sentErr);
    return { sent: 0, skipped: users.length, failed: 0, trackingFailed: false };
  }

  const split = splitAlreadySent(users, (alreadySent || []).map((r: { user_id: string }) => r.user_id));
  const skipped = split.skipped;
  users = split.pending;

  if (!users.length) {
    console.log(`[run-campaign] "${name}": all eligible already sent`);
    return { sent: 0, skipped, failed: 0, trackingFailed: false };
  }

  const recipients = await resolveRecipients(supabase, users);

  // Cross-campaign dedup: drop anyone already emailed by an earlier campaign
  // this run. First active campaign (by fetch order) wins.
  const toSend = recipients.filter((r) => !emailedThisRun.has(r.uid));
  const crossSkipped = recipients.length - toSend.length;
  for (const r of toSend) emailedThisRun.add(r.uid);

  const { sent, failed, trackingFailed } = await deliver(supabase, campaign, toSend);
  return { sent, skipped: skipped + crossSkipped, failed, trackingFailed };
}

// Backfill pass: drain existing members (signed up before the drip window) at
// backfill_daily per run, newest first, until everyone eligible has been sent.
// Self-exhausting: once all members are in email_campaign_sends it's a no-op.
async function backfillPass(
  supabase: Db,
  campaign: Campaign,
  internalIds: Set<string>,
  emailedThisRun: Set<string>,
): Promise<PassResult> {
  const { name } = campaign;
  const limit = campaign.backfill_daily ?? 0;
  const { windowStart } = signupWindow(Date.now(), campaign.delay_days);

  // Members strictly older than the window pass's 24h slice — the two passes
  // can never overlap. Paged: the member base can exceed one page.
  const { data: profiles, error: profErr } = await fetchAllRows<ProfileRow>((from, to) =>
    supabase
      .from("profiles")
      .select("id, display_name, email_prefs, created_at")
      .eq("is_suspended", false)
      .lt("created_at", windowStart)
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  if (profErr) {
    console.error(`[run-campaign] "${name}" backfill: profiles fetch failed — skipping:`, profErr);
    return { sent: 0, skipped: 0, failed: 0, trackingFailed: false };
  }

  let candidates = filterEligible(profiles || [], internalIds);

  // Behavior-aware skip applies to the backfill too. Paged full-table read of
  // user_ids (bounded: a few thousand rows) — .in() with hundreds of candidate
  // ids would blow the URL length.
  const skipTbl = skipTable(campaign.skip_if_done);
  if (skipTbl) {
    const { data: doneRows, error: doneErr } = await fetchAllRows<{ user_id: string }>((from, to) =>
      supabase.from(skipTbl).select("user_id").range(from, to)
    );
    if (doneErr) {
      // Fail safe: never send unfiltered. Skip this run; retry next day.
      console.error(`[run-campaign] "${name}" backfill: skip query (${skipTbl}) failed — skipping:`, doneErr);
      return { sent: 0, skipped: candidates.length, failed: 0, trackingFailed: false };
    }
    candidates = dropDone(candidates, (doneRows || []).map((r) => r.user_id));
  }

  // Everyone already sent this campaign. Paged: grows past 1000 as the
  // backfill completes. Fail safe: an error here would re-send to everyone.
  const { data: sentRows, error: sentErr } = await fetchAllRows<{ user_id: string }>((from, to) =>
    supabase
      .from("email_campaign_sends")
      .select("user_id")
      .eq("campaign_id", campaign.id)
      .range(from, to)
  );
  if (sentErr) {
    console.error(`[run-campaign] "${name}" backfill: send history failed — skipping:`, sentErr);
    return { sent: 0, skipped: 0, failed: 0, trackingFailed: false };
  }

  const sentSet = new Set((sentRows || []).map((r) => r.user_id));
  const pendingCount = candidates.filter((p) => !sentSet.has(p.id) && !emailedThisRun.has(p.id)).length;
  const picked = pickBackfill(candidates, sentSet, emailedThisRun, limit);

  if (!picked.length) {
    console.log(`[run-campaign] "${name}" backfill: complete (0 pending)`);
    return { sent: 0, skipped: 0, failed: 0, trackingFailed: false };
  }

  const recipients = await resolveRecipients(supabase, picked);
  for (const r of recipients) emailedThisRun.add(r.uid);

  const { sent, failed, trackingFailed } = await deliver(supabase, campaign, recipients);
  console.log(`[run-campaign] "${name}" backfill: sent=${sent} failed=${failed} remaining=${pendingCount - picked.length}`);
  return { sent, skipped: 0, failed, trackingFailed };
}

// ── One-off "Start your streak" broadcast ────────────────────────────────────
// The daily drip only reaches new signups. To reach the existing members it
// never covered, we render the same personalized email per recipient and hand
// the rows to send-broadcast's queue, whose 21:30 UTC drain sends whatever the
// Resend daily quota has left (100 − used_today − 10 reserve). That drain is
// the right slot: ~95% of the day's transactional email lands after 10:00 UTC,
// so run-campaign's own window can't safely claim the day's quota.
//
// Fact generation is deliberately NOT done at drain time — 183 uncovered models
// × a grounded Gemini call would blow the function's wall clock. prewarmFacts()
// fills the shared pool first (which also benefits every future wearer of those
// models in-app), then enqueue is pure DB reads and Resend is the only limit.
const STREAK_CAMPAIGN_ID = "14a9156c-f132-435c-9beb-32800b8c97cb";

type AudienceRow = {
  user_id: string;
  display_name: string | null;
  brand: string | null;
  name: string | null;
  ref: string | null;
  model_key: string | null;
};

// Run `jobs` with at most `width` in flight. Generation is IO-bound on Gemini,
// so serial execution would make a 20-model prewarm take ~7 minutes.
async function pooled<T>(jobs: Array<() => Promise<T>>, width: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, jobs.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

// .in() with 183 keys overflows the request URL — read the pool in slices.
async function fetchFactsForKeys(
  supabase: Db,
  keys: string[],
): Promise<Array<{ model_key: string; position: number; fact: string }>> {
  const all: Array<{ model_key: string; position: number; fact: string }> = [];
  for (let i = 0; i < keys.length; i += 50) {
    const { data, error } = await supabase
      .from("watch_facts").select("model_key, position, fact").in("model_key", keys.slice(i, i + 50));
    if (error) throw new Error(`watch_facts read failed: ${error.message}`);
    all.push(...(data ?? []));
  }
  return all;
}

async function loadAudience(supabase: Db): Promise<AudienceRow[]> {
  const { data, error } = await supabase.rpc("streak_broadcast_audience");
  if (error) throw new Error(`audience rpc failed: ${error.message}`);
  return (data ?? []) as AudienceRow[];
}

// Generate facts for up to `limit` audience models that have none yet. Idempotent:
// re-running only picks up what's still uncovered, so it's safe to call in a loop
// until `remaining` hits 0.
async function prewarmFacts(supabase: Db, limit: number, segment = "never_logged") {
  // Which audience to warm. Both are broadcast segments now; the drip warms
  // itself lazily at send time because it only touches a few users a day.
  // "active_users" warms the pool for the login fun-fact modal, which is gated on
  // a fact being instantly available and skips rather than showing a spinner.
  const rpc = segment === "winback" ? "one_and_done_winback_users"
            : segment === "active_users" ? "active_users_with_watches"
            : "never_logged_users";
  const args = segment === "winback" ? { p_churn_days: 14 }
             : segment === "active_users" ? { p_days: 30 }
             : { p_min_age_days: 4 };
  const { data: seg, error: segErr } = await supabase.rpc(rpc, args);
  if (segErr) throw new Error(`${rpc} failed: ${segErr.message}`);
  const uids = ((seg ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  if (!uids.length) return { segment, audience_models: 0, already_covered: 0, attempted: 0, generated: 0, failed: 0, remaining: 0 };

  const { data: varsRows, error: vErr } = await supabase.rpc("fun_fact_vars", { p_uids: uids });
  if (vErr) throw new Error(`fun_fact_vars failed: ${vErr.message}`);
  type VarRow = { user_id: string; brand: string | null; name: string | null; model_key: string | null; fact: string | null };

  // One entry per model. `fact` non-null means the pool already has a usable
  // one, so it needs no generation.
  const byKey = new Map<string, { brand: string; name: string; covered: boolean }>();
  for (const r of (varsRows ?? []) as VarRow[]) {
    if (!r.model_key || !r.brand || !r.name) continue;
    const prev = byKey.get(r.model_key);
    const covered = !!r.fact || !!prev?.covered;
    byKey.set(r.model_key, { brand: r.brand.trim(), name: r.name.trim(), covered });
  }

  const keys = [...byKey.keys()];
  const covered = keys.filter((k) => byKey.get(k)!.covered);
  const todo = keys.filter((k) => !byKey.get(k)!.covered).slice(0, Math.max(0, limit));

  // Existing pool size per model, so a generated fact never collides with a
  // truncated row already sitting at position 0.
  const existing = await fetchFactsForKeys(supabase, todo);
  const poolSize = new Map<string, number>();
  for (const f of existing) poolSize.set(f.model_key, (poolSize.get(f.model_key) ?? 0) + 1);

  const results = await pooled(
    todo.map((key) => async () => {
      const w = byKey.get(key)!;
      const fact = await generateFact(w.brand, w.name, null, []);
      if (!fact) return { ok: false };
      const position = poolSize.get(key) ?? 0;
      if (position >= 10) return { ok: false };
      const { error } = await supabase
        .from("watch_facts").insert({ model_key: key, position, fact: fact.slice(0, 500) });
      if (error) {
        console.error(`[run-campaign] prewarm insert failed for ${key}@${position}:`, error.message);
        return { ok: false };
      }
      return { ok: true };
    }),
    5,
  );

  const generated = results.filter((r) => r.ok).length;
  return {
    segment,
    audience_models: keys.length,
    already_covered: covered.length,
    attempted: todo.length,
    generated,
    failed: todo.length - generated,
    remaining: keys.length - covered.length - generated,
  };
}

// Render the campaign per recipient and queue it. Pool reads only — anything
// still uncovered after prewarm falls back rather than generating here.
async function enqueueStreakBroadcast(supabase: Db, limit: number) {
  const { data: campaign, error: cErr } = await supabase
    .from("email_campaigns").select("subject, body_html").eq("id", STREAK_CAMPAIGN_ID).single();
  if (cErr || !campaign) throw new Error(`campaign read failed: ${cErr?.message}`);

  const audience = (await loadAudience(supabase)).slice(0, Math.max(0, limit));
  if (!audience.length) return { queued: 0, audience: 0 };

  const keys = [...new Set(audience.map((r) => r.model_key).filter(Boolean))] as string[];
  const facts = await fetchFactsForKeys(supabase, keys);
  const bestByKey = new Map<string, { position: number; fact: string }>();
  for (const f of facts) {
    if (!looksCompleteFact(f.fact)) continue;
    const cur = bestByKey.get(f.model_key);
    if (!cur || f.position < cur.position) bestByKey.set(f.model_key, f);
  }

  // Names this send in the admin Broadcast tab. Per-recipient subjects mean
  // the queue can't identify it by subject the way single-subject sends do.
  const STREAK_BROADCAST_LABEL = "Start your streak — fun fact";
  const rows: Array<{ uid: string; email: string; subject: string; html: string; label: string }> = [];
  let personalized = 0;
  let fallback = 0;
  let noEmail = 0;

  for (const r of audience) {
    const { data: authUser } = await supabase.auth.admin.getUserById(r.user_id);
    const email = authUser?.user?.email;
    if (!email) { noEmail++; continue; }

    const hit = r.model_key ? bestByKey.get(r.model_key) : undefined;
    const label = r.brand && r.name ? watchLabel(r.brand.trim(), r.name.trim()) : "";
    let vars: Record<string, string>;
    if (hit && looksLikeRealWatchLabel(label)) {
      vars = { watch: label, watchPhrase: watchPhrase(label), fact: hit.fact };
      personalized++;
    } else {
      vars = { ...FALLBACK_FACT };
      fallback++;
    }

    rows.push({
      uid: r.user_id,
      email,
      subject: personalizeSubject(campaign.subject, r.display_name, vars),
      // Footer-less: the drain appends unsubFooter() with a freshly signed URL.
      html: buildHtmlEmail("", personalizeBody(campaign.body_html, r.display_name, vars), "", STREAK_BROADCAST_LABEL),
      label: STREAK_BROADCAST_LABEL,
    });
  }

  // Never queue an address that has permanently bounced — SES suppresses it
  // account-wide and each re-send mints a fresh bounce against our reputation.
  const liveRows = excludeBounced(rows, await fetchBouncedEmails(supabase));
  const bouncedSkipped = rows.length - liveRows.length;

  let queued = 0;
  for (let i = 0; i < liveRows.length; i += 500) {
    const slice = liveRows.slice(i, i + 500);
    const { error } = await supabase.from("broadcast_queue").insert(slice);
    if (error) throw new Error(`queue insert failed after ${queued}: ${error.message}`);
    queued += slice.length;
  }

  // Deliberately does NOT write email_campaign_sends. That table is the
  // onboarding drip's record; adding broadcast recipients to it made the
  // campaign report 343 sends when only 77 people got it as onboarding email.
  // streak_broadcast_audience() excludes anyone already in broadcast_queue
  // under this label, so re-running here is still idempotent.

  return { audience: audience.length, queued, personalized, fallback, no_email: noEmail, skipped_bounced: bouncedSkipped };
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth: the daily cron sends a shared secret header (x-campaign-secret); a
    // manual admin trigger (db.functions.invoke) sends the admin's JWT. An open
    // trigger can burn Resend quota and email the whole signup cohort on demand.
    // Enforce only once CAMPAIGN_TRIGGER_SECRET is configured; until then warn and
    // run, so deploying this can't break the daily cron before the secret is set +
    // the cron is updated to send the header (then enforcement is automatic).
    const triggerSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
    if (triggerSecret) {
      const providedSecret = req.headers.get("x-campaign-secret") ?? "";
      let authorized = !!providedSecret && timingSafeEqual(providedSecret, triggerSecret);
      if (!authorized) {
        const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
        if (token) {
          const { data: { user } } = await supabase.auth.getUser(token);
          if (user?.id === ADMIN_USER_ID) authorized = true;
        }
      }
      if (!authorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    } else {
      console.warn("[run-campaign] CAMPAIGN_TRIGGER_SECRET not set — running WITHOUT caller auth (INSECURE). Set the secret + add the x-campaign-secret header to the cron to enable enforcement.");
    }

    // One-off broadcast tooling, behind the same auth as the daily run. Both
    // are idempotent and return counts; neither sends email itself (enqueue
    // hands off to send-broadcast's quota-aware nightly drain).
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if (typeof body?.prewarm_facts === "number") {
      const result = await prewarmFacts(supabase, body.prewarm_facts as number,
        typeof body.segment === "string" ? body.segment : "never_logged");
      console.log(`[run-campaign] prewarm:`, JSON.stringify(result));
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (body?.enqueue_streak_broadcast) {
      const limit = typeof body.limit === "number" ? body.limit : 10000;
      const result = await enqueueStreakBroadcast(supabase, limit);
      console.log(`[run-campaign] enqueue:`, JSON.stringify(result));
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Fetch active campaigns
    const { data: campaigns, error: campErr } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("is_active", true);

    if (campErr) {
      console.error("[run-campaign] Failed to fetch campaigns:", campErr);
      return new Response(JSON.stringify({ error: campErr.message }), { status: 500 });
    }

    if (!campaigns?.length) {
      return new Response(JSON.stringify({ message: "No active campaigns" }), { status: 200 });
    }

    // Get internal accounts to exclude. Fail safe: if this read errors we can't
    // exclude internal accounts, so abort rather than risk emailing them.
    const { data: internalRows, error: internalErr } = await supabase
      .from("internal_accounts")
      .select("user_id");
    if (internalErr) {
      console.error("[run-campaign] Failed to fetch internal_accounts — aborting:", internalErr);
      return new Response(JSON.stringify({ error: internalErr.message }), { status: 500 });
    }
    const internalIds = new Set((internalRows || []).map(r => r.user_id));

    const results: Record<string, PassResult> = {};
    // Track everyone emailed across all campaigns this run so a user can't receive
    // two campaigns in one invocation (e.g. two active campaigns sharing delay_days).
    const emailedThisRun = new Set<string>();
    let anyTrackingFailed = false;

    for (const campaign of campaigns) {
      console.log(`[run-campaign] Processing "${campaign.name}" (delay=${campaign.delay_days}d)`);
      const win = await windowPass(supabase, campaign, internalIds, emailedThisRun);
      let bf: PassResult = { sent: 0, skipped: 0, failed: 0, trackingFailed: false };
      if ((campaign.backfill_daily ?? 0) > 0) {
        bf = await backfillPass(supabase, campaign, internalIds, emailedThisRun);
      }
      const total = {
        sent: win.sent + bf.sent,
        skipped: win.skipped + bf.skipped,
        failed: win.failed + bf.failed,
        trackingFailed: win.trackingFailed || bf.trackingFailed,
      };
      anyTrackingFailed = anyTrackingFailed || total.trackingFailed;
      console.log(`[run-campaign] "${campaign.name}": sent=${total.sent} skipped=${total.skipped} failed=${total.failed}`);
      results[campaign.name] = total;
    }

    // A failed send-tracking upsert means backfill will re-email the same users
    // tomorrow — surface it as a 5xx so the cron's log shows the failure.
    return new Response(JSON.stringify({ results, tracking_failure: anyTrackingFailed }), {
      status: anyTrackingFailed ? 500 : 200,
    });
  } catch (err) {
    console.error("[run-campaign] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
