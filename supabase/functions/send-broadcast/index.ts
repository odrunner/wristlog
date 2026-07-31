// Supabase Edge Function: send-broadcast
// Invoked by admin to send a marketing/broadcast email to all users.
// Accepts JSON body: { subject, html, test_email? }
// If test_email is provided, sends only to that address (for preview).
// Otherwise, sends to all users who have not disabled marketing emails.
//
// Required Supabase secrets:
//   RESEND_API_KEY             — API key from resend.com
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  batchSegment,
  capRecipients,
  COHORTS,
  DAILY_EMAIL_LIMIT,
  dormantCutoffMs,
  drainBudget,
  effectiveLimit as computeEffectiveLimit,
  excludeAlreadyEmailed,
  excludeIds,
  keepIds,
  filterNeverMeasured,
  filterOptedIn,
  isDormant,
  nextBatchSlice,
  parseBatchSuffix,
  sanitizeHtml,
  segmentDateGte,
  segmentUserId,
  unsubFooter,
  unsubUrl,
  utcDayStart,
  validateBroadcastInput,
} from "./lib.ts";
// Same personalization the onboarding drip uses, so a broadcast carrying the
// same copy renders identically. {{watch}}/{{watchPhrase}}/{{fact}} are filled
// per recipient from their own collection + the shared fact pool.
import {
  FALLBACK_FACT,
  looksLikeRealWatchLabel,
  needsFactVars,
  personalizeBody,
  personalizeSubject,
  watchLabel,
  watchPhrase,
} from "../_shared/email-personalize.ts";
// Transport: ../_shared/mailer.ts — provider chosen at runtime by the
// EMAIL_PROVIDER secret (defaults to Resend).
import { currentProvider, sendBatch, sendEmail as sendProviderEmail } from "../_shared/mailer.ts";
import type { MailMessage } from "../_shared/mailer.ts";

const ADMIN_USER_ID = "d70b1a85-4f31-4431-b3b7-db76543daaf5";
const FROM_EMAIL = "WRotate <hello@wrotate.com>";

async function hmacSign(uid: string, cat: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`${uid}:${cat}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// PostgREST caps an unbounded select at 1000 rows. Page through with explicit
// ranges so a cohort or exclusion list larger than 1000 isn't silently
// truncated — truncation would either skip recipients (cohort) or fail to
// exclude already-sent / internal / measured users, re-emailing them.
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


// Per-recipient {{watch}}/{{watchPhrase}}/{{fact}} values. One RPC round trip
// for the whole send rather than two queries each. Recipients with no usable
// watch, no complete pool fact, or a free-text name that would embarrass in a
// subject line ("Omega Fake Omega - Likely ETA 2824-2") get the curated
// fallback — never a broken email, never a dropped recipient.
async function factVarsFor(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  uids: string[],
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (!uids.length) return out;
  const { data, error } = await supabase.rpc("fun_fact_vars", { p_uids: uids });
  if (error) {
    console.error("[send-broadcast] fun_fact_vars failed, using fallback for all:", error.message);
    return out;
  }
  for (const r of (data ?? []) as Array<{ user_id: string; brand: string | null; name: string | null; fact: string | null }>) {
    const label = r.brand && r.name ? watchLabel(r.brand.trim(), r.name.trim()) : "";
    if (r.fact && looksLikeRealWatchLabel(label)) {
      out.set(r.user_id, { watch: label, watchPhrase: watchPhrase(label), fact: r.fact });
    }
  }
  return out;
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const body = await req.json();
    const { subject, html, test_email, segment = "all", campaign_id, cohort, dry_run, limit, enqueue, drain, priority } = body;
    // Drain order for a queued broadcast: lower goes first, id breaks ties.
    // Comes from the draft's position in the admin's Saved Drafts list, so the
    // order can be set before anything is sent. Defaults to 0 = old FIFO.
    const queuePriority = Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : 0;
    // Set once the admin JWT is verified; used to personalize a test send.
    let adminUserId: string | null = null;

    // Drain can be invoked by the nightly pg_cron job via the campaign secret
    // (no user JWT); everything else requires the admin JWT below.
    const cronSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
    const isCronDrain = !!drain && !!cronSecret &&
      req.headers.get("x-campaign-secret") === cronSecret;

    if (!isCronDrain) {
      // Verify the caller is admin
      const token = authHeader.replace("Bearer ", "");
      const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
      console.log("[send-broadcast] Auth check:", {
        hasToken: !!token,
        tokenLen: token?.length,
        userId: user?.id,
        error: userError?.message,
        adminMatch: user?.id === ADMIN_USER_ID
      });
      adminUserId = user?.id ?? null;
      if (userError || !user || user.id !== ADMIN_USER_ID) {
        return jsonResponse({ error: "Unauthorized", details: userError?.message }, 403);
      }
    }

    if (drain) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      return await drainQueue(supabase, supabaseUrl, supabaseServiceKey, !!body.quota_only);
    }

    const inputError = validateBroadcastInput({ subject, html, cohort, campaign_id, segment });
    if (inputError) {
      return jsonResponse({ error: inputError }, 400);
    }

    const safeHtml = sanitizeHtml(html);

    // Use service role client for admin operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Test mode: send to a single email
    if (test_email) {
      // Personalize against the caller's own collection — a test that shows
      // "{{fact}}" tells you nothing about what recipients will get.
      let tSubject = subject, tHtml = safeHtml;
      if (needsFactVars({ subject, body_html: safeHtml }) && adminUserId) {
        const vars = await factVarsFor(supabase, [adminUserId]);
        const v = vars.get(adminUserId) ?? { ...FALLBACK_FACT };
        tSubject = personalizeSubject(subject, null, v);
        tHtml = personalizeBody(safeHtml, null, v);
      }
      const result = await sendEmail(test_email, tSubject, tHtml);
      return jsonResponse({ sent: 1, test: true, result });
    }

    // Production mode: send to all users
    // Fetch all users who haven't opted out of marketing emails.
    // Date-windowed segment (e.g. "may_onward_1of2"): created_at >= gte, no upper bound.
    const segGte = segmentDateGte(segment);
    // Single-user segment ("uid:<uuid>"): narrow to exactly one profile.
    const segUid = segmentUserId(segment);
    const mkProfilesQuery = (from: number, to: number) => {
      let q = supabase
        .from("profiles")
        .select("id, email_prefs, created_at")
        .eq("is_suspended", false)
        .order("created_at", { ascending: true });
      if (cohort) {
        const window = COHORTS[cohort];
        if (window.gte) q = q.gte("created_at", window.gte);
        if (window.lt) q = q.lt("created_at", window.lt);
      }
      if (segGte) q = q.gte("created_at", segGte);
      if (segUid) q = q.eq("id", segUid);
      return q.range(from, to);
    };

    const { data: profiles, error: profilesError } = await fetchAllRows(mkProfilesQuery);

    if (profilesError) {
      return jsonResponse({ error: "Failed to fetch profiles", details: profilesError }, 500);
    }

    // Filter out users who have disabled "Updates & new features" emails
    let eligibleProfiles = filterOptedIn(profiles || []);

    // Cohort blast: exclude internal accounts
    if (cohort) {
      const { data: internalRows } = await supabase.from("internal_accounts").select("user_id");
      eligibleProfiles = excludeIds(eligibleProfiles, (internalRows || []).map(r => r.user_id));
    }

    // Cohort blast: exclude users already sent this campaign
    if (cohort && campaign_id) {
      const { data: sentRows } = await fetchAllRows<{ user_id: string }>((from, to) => supabase
        .from("email_campaign_sends")
        .select("user_id")
        .eq("campaign_id", campaign_id)
        .range(from, to));
      eligibleProfiles = excludeIds(eligibleProfiles, (sentRows || []).map(r => r.user_id));
    }

    // Segment filter: "never_measured" excludes users with any timegrapher_results row
    if (segment === "never_measured") {
      const { data: measuredRows, error: measuredErr } = await fetchAllRows<{ user_id: string }>((from, to) => supabase
        .from("timegrapher_results")
        .select("user_id")
        .range(from, to));
      if (measuredErr) {
        return jsonResponse({ error: "Failed to fetch measurement users", details: measuredErr }, 500);
      }
      eligibleProfiles = filterNeverMeasured(eligibleProfiles, (measuredRows || []).map(r => r.user_id));
    }

    // Segment filter: "one_done_winback" keeps one-and-done churned wear-loggers.
    // Aggregated server-side (sql/2026-07-26-winback-segment-rpc.sql) rather than
    // pulling the whole logs table and counting in JS. The RPC owns the wear rule
    // (watch_id IS NOT NULL AND use_case <> 'measurement', matching isWearEntry) and
    // excludes internal accounts, so there is exactly one definition to keep right.
    if (segment === "one_done_winback") {
      const { data: winbackRows, error: wbErr } = await supabase
        .rpc("one_and_done_winback_users", { p_churn_days: 14 });
      if (wbErr) {
        return jsonResponse({ error: "Failed to resolve win-back segment", details: wbErr }, 500);
      }
      eligibleProfiles = keepIds(eligibleProfiles, (winbackRows || []).map((r: { user_id: string }) => r.user_id));
    }

    // Segment filter: "never_logged" — members who have never logged a wear.
    // The one-off counterpart to the day-3 "Start your streak" drip; the RPC
    // excludes anyone that drip already emailed, so the two never overlap.
    if (segment === "never_logged") {
      const { data: nlRows, error: nlErr } = await supabase
        .rpc("never_logged_users", { p_min_age_days: 4 });
      if (nlErr) {
        return jsonResponse({ error: "Failed to resolve never-logged segment", details: nlErr }, 500);
      }
      eligibleProfiles = keepIds(eligibleProfiles, (nlRows || []).map((r: { user_id: string }) => r.user_id));
    }

    // Resolve emails via paginated listUsers (1-2 requests) instead of one
    // GoTrue admin call per profile.
    const usersById = new Map<string, { email?: string; last_sign_in_at?: string }>();
    for (let page = 1; ; page++) {
      const { data: pageData, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (listErr) {
        return jsonResponse({ error: "Failed to list users", details: listErr.message }, 500);
      }
      const users = pageData?.users ?? [];
      for (const u of users) usersById.set(u.id, { email: u.email, last_sign_in_at: u.last_sign_in_at });
      if (users.length < 1000) break;
    }

    const DORMANT_CUTOFF_MS = dormantCutoffMs(Date.now());
    const recipients: { uid: string; email: string }[] = [];
    for (const profile of eligibleProfiles) {
      const user = usersById.get(profile.id);
      if (!user?.email) continue;
      if (cohort && !isDormant(user.last_sign_in_at, DORMANT_CUTOFF_MS)) continue; // active user, skip
      recipients.push({ uid: profile.id, email: user.email });
    }

    // Optional limit (e.g. test slice of 20 before sending to whole cohort)
    const effectiveLimit = computeEffectiveLimit(limit);
    const cappedRecipients = capRecipients(recipients, effectiveLimit);

    // Dry run: just return the count without sending
    if (dry_run) {
      return jsonResponse({
        eligible: recipients.length,
        will_send: cappedRecipients.length,
        cohort,
        campaign_id,
        limit: effectiveLimit,
      });
    }

    // Batched "_NofM" segments: exclude everyone who already received this
    // campaign (matched by subject in email_events, last 14 days), then send the
    // next chunk of what remains. History-based exclusion can't double-send even
    // if a batch is re-clicked or the recipient list changed between batch runs.
    // Caveats: keep the subject identical across the campaign's batches, and
    // leave a few minutes between batches (Resend webhook ingestion lag).
    let filteredRecipients: typeof cappedRecipients;
    const batchInfo = parseBatchSuffix(segment);
    if (batchInfo) {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: sentRows, error: sentErr } = await fetchAllRows<{ email_to: string }>((from, to) => supabase
        .from("email_events")
        .select("email_to")
        .eq("event_type", "sent")
        .eq("subject", subject)
        .gte("created_at", since)
        .range(from, to));
      if (sentErr) {
        return jsonResponse({ error: "Failed to fetch send history for batch segment", details: sentErr }, 500);
      }
      const remaining = excludeAlreadyEmailed(cappedRecipients, (sentRows || []).map(r => r.email_to));
      filteredRecipients = nextBatchSlice(remaining, batchInfo.num, batchInfo.count);
    } else {
      // Legacy batch_1/2/3 positional split, or pass-through for plain segments
      filteredRecipients = batchSegment(cappedRecipients, segment);
    }

    // Queue mode: insert rows for the nightly drain instead of sending now.
    // Skips recipients already pending with the same subject (re-click safe).
    if (enqueue) {
      const { data: pendingRows } = await fetchAllRows<{ uid: string }>((from, to) => supabase
        .from("broadcast_queue")
        .select("uid")
        .eq("status", "pending")
        .eq("subject", subject)
        .range(from, to));
      const alreadyQueued = new Set((pendingRows || []).map(r => r.uid));
      const toQueue = filteredRecipients.filter(r => !alreadyQueued.has(r.uid));
      // Rows are stored fully rendered, so the drain stays a dumb sender.
      const wantsFact = needsFactVars({ subject, body_html: safeHtml });
      const vars = wantsFact ? await factVarsFor(supabase, toQueue.map(r => r.uid)) : new Map();
      const rows = toQueue.map(r => {
        const v = wantsFact ? (vars.get(r.uid) ?? { ...FALLBACK_FACT }) : {};
        return {
          uid: r.uid,
          email: r.email,
          subject: personalizeSubject(subject, null, v),
          html: personalizeBody(safeHtml, null, v),
          label: subject,
          priority: queuePriority,
        };
      });
      let queued = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { error: insErr } = await supabase.from("broadcast_queue").insert(rows.slice(i, i + 500));
        if (insErr) {
          return jsonResponse({ error: "Queue insert failed", details: insErr.message, queued }, 500);
        }
        queued += Math.min(500, rows.length - i);
      }
      console.log(`[send-broadcast] Queued ${queued} (skipped ${alreadyQueued.size} already pending) for nightly drain`);
      return jsonResponse({ queued, skipped_already_queued: filteredRecipients.length - toQueue.length, total_eligible: filteredRecipients.length });
    }

    // Send via Resend in chunks of 100 (tracking upserts stay ≤100 rows each)
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const batchSize = 100;

    const directWantsFact = needsFactVars({ subject, body_html: safeHtml });
    const directVars = directWantsFact
      ? await factVarsFor(supabase, filteredRecipients.map((r) => r.uid))
      : new Map<string, Record<string, string>>();

    for (let i = 0; i < filteredRecipients.length; i += batchSize) {
      const batch = filteredRecipients.slice(i, i + batchSize);
      const messages: MailMessage[] = await Promise.all(batch.map(async (r) => {
        const sig = await hmacSign(r.uid, "updates", supabaseServiceKey);
        const url = unsubUrl(supabaseUrl, r.uid, sig, "updates");
        const v = directWantsFact ? (directVars.get(r.uid) ?? { ...FALLBACK_FACT }) : {};
        return {
          from: FROM_EMAIL,
          to: [r.email],
          subject: personalizeSubject(subject, null, v),
          html: personalizeBody(safeHtml, null, v) + unsubFooter(url),
          headers: {
            "List-Unsubscribe": `<${url}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      }));

      const { results } = await sendBatch(messages);
      const okRecipients = batch.filter((_, idx) => results[idx].ok);
      sent += okRecipients.length;
      failed += batch.length - okRecipients.length;
      for (let idx = 0; idx < results.length; idx++) {
        const r = results[idx];
        if (!r.ok) errors.push(`${batch[idx].email}: ${r.error}`);
      }

      // Cohort blast: record successful sends so re-clicking won't double-send
      if (cohort && campaign_id && okRecipients.length) {
        const now = new Date().toISOString();
        const rows = okRecipients.map(r => ({ campaign_id, user_id: r.uid, sent_at: now }));
        const { error: trackErr } = await supabase
          .from("email_campaign_sends")
          .upsert(rows, { onConflict: "campaign_id,user_id", ignoreDuplicates: true });
        if (trackErr) {
          errors.push(`Tracking upsert error: ${trackErr.message}`);
        }
      }
    }

    console.log(`[send-broadcast] Sent ${sent}, failed ${failed}, total eligible ${filteredRecipients.length} (segment=${segment})`);
    return jsonResponse({ sent, failed, total: filteredRecipients.length, segment, errors: errors.slice(0, 5) });

  } catch (err) {
    console.error("[send-broadcast] Error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});

// Nightly drain: send queued broadcast rows with whatever daily quota remains.
// used_today comes from email_events (the Resend webhook logs every send from every
// function), so transactional + campaign email automatically takes priority.
async function drainQueue(supabase: ReturnType<typeof createClient>, supabaseUrl: string, serviceKey: string, quotaOnly = false) {
  // Reap claims from crashed drains: anything 'sending' for >15 min goes back
  // to pending. A healthy drain finishes a wave in well under a minute.
  await supabase.from("broadcast_queue")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "sending")
    .lt("claimed_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const dayStart = utcDayStart(Date.now());
  const { count: usedToday, error: cntErr } = await supabase
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "sent")
    .gte("created_at", dayStart);
  if (cntErr) {
    return jsonResponse({ error: "Quota count failed", details: cntErr.message }, 500);
  }
  const dailyLimit = DAILY_EMAIL_LIMIT;
  const budget = drainBudget(usedToday ?? 0, dailyLimit);

  // Read-only introspection: report the live quota and what tonight's drain would
  // send, without sending anything. Used to verify the quota wiring after deploy.
  if (quotaOnly) {
    const { count: pending } = await supabase
      .from("broadcast_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return jsonResponse({
      quota_only: true,
      provider: "resend",
      daily_limit: dailyLimit,
      used_today: usedToday,
      budget,
      pending,
    });
  }
  if (budget <= 0) {
    console.log(`[send-broadcast] Drain: no quota left (used ${usedToday} of ${dailyLimit} today)`);
    return jsonResponse({ drained: 0, used_today: usedToday, daily_limit: dailyLimit, budget });
  }

  const { data: rows, error: qErr } = await supabase
    .from("broadcast_queue")
    .select("id, uid, email, subject, html")
    .eq("status", "pending")
    // priority first (admin_move_broadcast reorders it), id as tie-breaker.
    // With every priority at its 0 default this is the original FIFO.
    .order("priority", { ascending: true })
    .order("id", { ascending: true })
    .limit(budget);
  if (qErr) {
    return jsonResponse({ error: "Queue read failed", details: qErr.message }, 500);
  }
  if (!rows || rows.length === 0) {
    return jsonResponse({ drained: 0, used_today: usedToday, budget, queue_empty: true });
  }

  // Claim: move the selected rows to 'sending' first, and work only on the
  // ones the claim actually won — protects against a concurrent drain
  // claiming the same rows between this read and the claim update.
  const ids = rows.map((r) => r.id);
  const { data: claimed, error: claimErr } = await supabase
    .from("broadcast_queue")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id, uid, email, subject, html");
  if (claimErr) {
    return jsonResponse({ error: "Queue claim failed", details: claimErr.message }, 500);
  }
  if (!claimed || claimed.length === 0) {
    return jsonResponse({ drained: 0, used_today: usedToday, budget, queue_empty: true });
  }

  let sent = 0, failed = 0, deferred = 0;
  const errors: string[] = [];
  const batchSize = 100;
  for (let i = 0; i < claimed.length; i += batchSize) {
    const batch = claimed.slice(i, i + batchSize);
    const messages: MailMessage[] = await Promise.all(batch.map(async (r) => {
      const sig = await hmacSign(r.uid, "updates", serviceKey);
      const url = unsubUrl(supabaseUrl, r.uid, sig, "updates");
      return {
        from: FROM_EMAIL,
        to: [r.email],
        subject: r.subject,
        html: r.html + unsubFooter(url),
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }));

    const { results } = await sendBatch(messages);
    const okIds: number[] = [];
    const failedRows: { id: number; error: string }[] = [];
    // Transient failures (throttling, 5xx, network) stay `pending` so a later
    // drain retries them. Marking them `failed` dropped those recipients for
    // good — the drain only ever re-selects `pending`.
    const deferredRows: { id: number; error: string }[] = [];
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      if (r.ok) okIds.push(batch[idx].id);
      else if (r.retryable) {
        deferredRows.push({ id: batch[idx].id, error: r.error });
        errors.push(`[retryable] ${r.error}`);
      } else {
        failedRows.push({ id: batch[idx].id, error: r.error });
        errors.push(r.error);
      }
    }
    sent += okIds.length;
    failed += failedRows.length;
    deferred += deferredRows.length;
    if (okIds.length) {
      await supabase.from("broadcast_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), claimed_at: null }).in("id", okIds);
    }
    // Failures are rare; one update per row keeps each row's own Resend error.
    for (const fr of failedRows) {
      await supabase.from("broadcast_queue")
        .update({ status: "failed", error: fr.error.slice(0, 500), claimed_at: null }).in("id", [fr.id]);
    }
    // Rows are 'sending' now (claimed above), so a retryable failure MUST be
    // reset to pending — otherwise it strands in 'sending' until the reaper.
    for (const dr of deferredRows) {
      await supabase.from("broadcast_queue")
        .update({ status: "pending", claimed_at: null, error: `retrying: ${dr.error.slice(0, 480)}` }).in("id", [dr.id]);
    }
  }
  console.log(`[send-broadcast] Drain: sent ${sent}, failed ${failed}, deferred ${deferred}, used_today ${usedToday}, limit ${dailyLimit}, budget ${budget}`);
  return jsonResponse({ drained: sent, failed, deferred, used_today: usedToday, daily_limit: dailyLimit, budget, errors: errors.slice(0, 3) });
}

async function sendEmail(to: string, subject: string, html: string) {
  const result = await sendProviderEmail({ from: FROM_EMAIL, to: [to], subject, html });
  if (!result.ok) {
    throw new Error(`Email send error (${currentProvider}): ${result.error}`);
  }
  return { id: result.id };
}
