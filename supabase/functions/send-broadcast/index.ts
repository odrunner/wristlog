// Supabase Edge Function: send-broadcast
// Invoked by admin to send a marketing/broadcast email to all users.
// Accepts JSON body: { subject, html, test_email? }
// If test_email is provided, sends only to that address (for preview).
// Otherwise, sends to all users who have not disabled marketing emails.
//
// Required Supabase secrets:
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
import { sendSesBatch, sendSesEmail } from "../_shared/ses.ts";
import type { SesMessage } from "../_shared/ses.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const body = await req.json();
    const { subject, html, test_email, segment = "all", campaign_id, cohort, dry_run, limit, enqueue, drain } = body;

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
      const result = await sendEmail(test_email, subject, safeHtml);
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

    // Resolve emails + user IDs from auth.users in parallel batches of 50
    // For cohort blasts, also require dormant (last_sign_in_at < NOW - 21d)
    const DORMANT_CUTOFF_MS = dormantCutoffMs(Date.now());
    const recipients: { uid: string; email: string }[] = [];
    const resolveSize = 50;
    for (let i = 0; i < eligibleProfiles.length; i += resolveSize) {
      const batch = eligibleProfiles.slice(i, i + resolveSize);
      const results = await Promise.allSettled(
        batch.map(async (profile) => {
          const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
          const user = authUser?.user;
          if (!user?.email) return null;
          if (cohort) {
            if (!isDormant(user.last_sign_in_at, DORMANT_CUTOFF_MS)) return null; // active user, skip
          }
          return { uid: profile.id, email: user.email };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) recipients.push(r.value);
      }
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
      const rows = toQueue.map(r => ({ uid: r.uid, email: r.email, subject, html: safeHtml }));
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

    // Send via SES in chunks of 100 (tracking upserts stay ≤100 rows each)
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < filteredRecipients.length; i += batchSize) {
      const batch = filteredRecipients.slice(i, i + batchSize);
      const messages: SesMessage[] = await Promise.all(batch.map(async (r) => {
        const sig = await hmacSign(r.uid, "updates", supabaseServiceKey);
        const url = unsubUrl(supabaseUrl, r.uid, sig, "updates");
        return {
          from: FROM_EMAIL,
          to: [r.email],
          subject,
          html: safeHtml + unsubFooter(url),
          headers: {
            "List-Unsubscribe": `<${url}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      }));

      const { results } = await sendSesBatch(messages);
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
// used_today comes from email_events (the SES webhook logs every send from every
// function), so transactional + campaign email automatically takes priority.
async function drainQueue(supabase: ReturnType<typeof createClient>, supabaseUrl: string, serviceKey: string, quotaOnly = false) {
  const dayStart = utcDayStart(Date.now());
  const { count: usedToday, error: cntErr } = await supabase
    .from("email_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "sent")
    .gte("created_at", dayStart);
  if (cntErr) {
    return jsonResponse({ error: "Quota count failed", details: cntErr.message }, 500);
  }
  const quota = null;
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
      ses_quota: quota,
      fallback_used: quota === null,
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
    .order("id", { ascending: true })
    .limit(budget);
  if (qErr) {
    return jsonResponse({ error: "Queue read failed", details: qErr.message }, 500);
  }
  if (!rows || rows.length === 0) {
    return jsonResponse({ drained: 0, used_today: usedToday, budget, queue_empty: true });
  }

  let sent = 0, failed = 0, deferred = 0;
  const errors: string[] = [];
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const messages: SesMessage[] = await Promise.all(batch.map(async (r) => {
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

    const { results } = await sendSesBatch(messages);
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
        .update({ status: "sent", sent_at: new Date().toISOString() }).in("id", okIds);
    }
    // Failures are rare; one update per row keeps each row's own SES error.
    for (const fr of failedRows) {
      await supabase.from("broadcast_queue")
        .update({ status: "failed", error: fr.error.slice(0, 500) }).in("id", [fr.id]);
    }
    // Left pending on purpose — record why, without changing status.
    for (const dr of deferredRows) {
      await supabase.from("broadcast_queue")
        .update({ error: `retrying: ${dr.error.slice(0, 480)}` }).in("id", [dr.id]);
    }
  }
  console.log(`[send-broadcast] Drain: sent ${sent}, failed ${failed}, deferred ${deferred}, used_today ${usedToday}, limit ${dailyLimit}, budget ${budget}`);
  return jsonResponse({ drained: sent, failed, deferred, used_today: usedToday, daily_limit: dailyLimit, budget, errors: errors.slice(0, 3) });
}

async function sendEmail(to: string, subject: string, html: string) {
  const result = await sendSesEmail({ from: FROM_EMAIL, to: [to], subject, html });
  if (!result.ok) {
    throw new Error(`SES error: ${result.error}`);
  }
  return { id: result.id };
}
