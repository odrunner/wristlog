// Supabase Edge Function: run-campaign
// Invoked daily (via cron or manual trigger) to send drip campaign emails.
// For each active campaign, finds users who signed up `delay_days` ago
// and haven't been sent yet. Sends via Resend batch API.
// Campaigns with backfill_daily > 0 also drain existing members (older than
// the signup window) at that rate per run, newest first, until exhausted.
//
// Required Supabase secrets:
//   RESEND_API_KEY             — API key from resend.com
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildHtmlEmail,
  dropDone,
  filterEligible,
  personalizeBody,
  pickBackfill,
  signupWindow,
  skipTable,
  splitAlreadySent,
  unsubUrl,
} from "./lib.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL = "WRotate <hello@wrotate.com>";
const ADMIN_USER_ID = "d70b1a85-4f31-4431-b3b7-db76543daaf5";

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

type PassResult = { sent: number; skipped: number; failed: number };
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

// Resolve profile rows to email recipients via auth.users.
async function resolveRecipients(supabase: Db, users: ProfileRow[]): Promise<Recipient[]> {
  const recipients: Recipient[] = [];
  for (const u of users) {
    const { data: authUser } = await supabase.auth.admin.getUserById(u.id);
    if (authUser?.user?.email) {
      recipients.push({ uid: u.id, email: authUser.user.email, displayName: u.display_name || "" });
    }
  }
  return recipients;
}

// Send personalized campaign emails via the Resend batch API, recording each
// successful batch in email_campaign_sends immediately.
async function deliver(
  supabase: Db,
  campaign: Campaign,
  toSend: Recipient[],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const batchSize = 100;

  for (let i = 0; i < toSend.length; i += batchSize) {
    const batch = toSend.slice(i, i + batchSize);
    const batchPayload = await Promise.all(batch.map(async (r) => {
      const sig = await hmacSign(r.uid, "updates", SUPABASE_SERVICE_ROLE_KEY);
      const url = unsubUrl(SUPABASE_URL, r.uid, sig, "updates");
      // Replace {{name}} placeholder with display name or "there"
      const personalizedBody = personalizeBody(campaign.body_html, r.displayName);
      const html = buildHtmlEmail(campaign.subject, personalizedBody, url);
      return {
        from: FROM_EMAIL,
        to: [r.email],
        subject: campaign.subject,
        html,
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }));

    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batchPayload),
      });
      if (res.ok) {
        sent += batch.length;
        // Record this batch's sends immediately: recording all batches at the
        // end (recipients.slice(0, sent)) misattributed sends when an earlier
        // batch failed — the failed users were marked sent (never retried) and
        // the sent users weren't (re-emailed next run).
        const { error: trackErr } = await supabase
          .from("email_campaign_sends")
          .upsert(
            batch.map((r) => ({ campaign_id: campaign.id, user_id: r.uid })),
            { onConflict: "campaign_id,user_id", ignoreDuplicates: true },
          );
        if (trackErr) {
          console.error(`[run-campaign] Send-tracking upsert error:`, trackErr);
        }
      } else {
        const errData = await res.json();
        console.error(`[run-campaign] Resend batch error:`, errData);
        failed += batch.length;
      }
    } catch (err) {
      console.error(`[run-campaign] Resend exception:`, err);
      failed += batch.length;
    }

    if (i + batchSize < toSend.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { sent, failed };
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
    return { sent: 0, skipped: 0, failed: 0 };
  }

  // Filter: not internal, not unsubscribed from updates
  let users = filterEligible(eligible || [], internalIds);

  if (!users.length) {
    console.log(`[run-campaign] "${name}": no eligible users in window`);
    return { sent: 0, skipped: 0, failed: 0 };
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
      return { sent: 0, skipped: users.length, failed: 0 };
    }
    const beforeSkip = users.length;
    users = dropDone(users, (doneRows || []).map((r: { user_id: string }) => r.user_id));
    if (!users.length) {
      console.log(`[run-campaign] "${name}": all eligible already did the action`);
      return { sent: 0, skipped: beforeSkip, failed: 0 };
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
    return { sent: 0, skipped: users.length, failed: 0 };
  }

  const split = splitAlreadySent(users, (alreadySent || []).map((r: { user_id: string }) => r.user_id));
  const skipped = split.skipped;
  users = split.pending;

  if (!users.length) {
    console.log(`[run-campaign] "${name}": all eligible already sent`);
    return { sent: 0, skipped, failed: 0 };
  }

  const recipients = await resolveRecipients(supabase, users);

  // Cross-campaign dedup: drop anyone already emailed by an earlier campaign
  // this run. First active campaign (by fetch order) wins.
  const toSend = recipients.filter((r) => !emailedThisRun.has(r.uid));
  const crossSkipped = recipients.length - toSend.length;
  for (const r of toSend) emailedThisRun.add(r.uid);

  const { sent, failed } = await deliver(supabase, campaign, toSend);
  return { sent, skipped: skipped + crossSkipped, failed };
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
    return { sent: 0, skipped: 0, failed: 0 };
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
      return { sent: 0, skipped: candidates.length, failed: 0 };
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
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const sentSet = new Set((sentRows || []).map((r) => r.user_id));
  const pendingCount = candidates.filter((p) => !sentSet.has(p.id) && !emailedThisRun.has(p.id)).length;
  const picked = pickBackfill(candidates, sentSet, emailedThisRun, limit);

  if (!picked.length) {
    console.log(`[run-campaign] "${name}" backfill: complete (0 pending)`);
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const recipients = await resolveRecipients(supabase, picked);
  for (const r of recipients) emailedThisRun.add(r.uid);

  const { sent, failed } = await deliver(supabase, campaign, recipients);
  console.log(`[run-campaign] "${name}" backfill: sent=${sent} failed=${failed} remaining=${pendingCount - picked.length}`);
  return { sent, skipped: 0, failed };
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

    for (const campaign of campaigns) {
      console.log(`[run-campaign] Processing "${campaign.name}" (delay=${campaign.delay_days}d)`);
      const win = await windowPass(supabase, campaign, internalIds, emailedThisRun);
      let bf: PassResult = { sent: 0, skipped: 0, failed: 0 };
      if ((campaign.backfill_daily ?? 0) > 0) {
        bf = await backfillPass(supabase, campaign, internalIds, emailedThisRun);
      }
      const total = {
        sent: win.sent + bf.sent,
        skipped: win.skipped + bf.skipped,
        failed: win.failed + bf.failed,
      };
      console.log(`[run-campaign] "${campaign.name}": sent=${total.sent} skipped=${total.skipped} failed=${total.failed}`);
      results[campaign.name] = total;
    }

    return new Response(JSON.stringify({ results }), { status: 200 });
  } catch (err) {
    console.error("[run-campaign] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
