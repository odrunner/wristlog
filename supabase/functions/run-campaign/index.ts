// Supabase Edge Function: run-campaign
// Invoked daily (via cron or manual trigger) to send drip campaign emails.
// For each active campaign, finds users who signed up `delay_days` ago
// and haven't been sent yet. Sends via Resend batch API.
//
// Required Supabase secrets:
//   RESEND_API_KEY             — API key from resend.com
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildHtmlEmail,
  filterEligible,
  personalizeBody,
  signupWindow,
  splitAlreadySent,
  unsubUrl,
} from "./lib.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    // Get internal accounts to exclude
    const { data: internalRows } = await supabase
      .from("internal_accounts")
      .select("user_id");
    const internalIds = new Set((internalRows || []).map(r => r.user_id));

    const results: Record<string, { sent: number; skipped: number; failed: number }> = {};

    for (const campaign of campaigns) {
      const { id: campaignId, subject, body_html, delay_days, name } = campaign;
      console.log(`[run-campaign] Processing "${name}" (delay=${delay_days}d)`);

      // Find users who signed up delay_days ago (48h-72h window for daily cron)
      const { windowStart, windowEnd } = signupWindow(Date.now(), delay_days);

      const { data: eligible, error: eligErr } = await supabase
        .from("profiles")
        .select("id, display_name, email_prefs")
        .eq("is_suspended", false)
        .gte("created_at", windowStart)
        .lt("created_at", windowEnd);

      if (eligErr) {
        console.error(`[run-campaign] Failed to fetch eligible users:`, eligErr);
        results[name] = { sent: 0, skipped: 0, failed: 0 };
        continue;
      }

      // Filter: not internal, not unsubscribed from updates, not already sent
      let users = filterEligible(eligible || [], internalIds);

      if (!users.length) {
        console.log(`[run-campaign] "${name}": no eligible users in window`);
        results[name] = { sent: 0, skipped: 0, failed: 0 };
        continue;
      }

      // Check which users already received this campaign
      const { data: alreadySent } = await supabase
        .from("email_campaign_sends")
        .select("user_id")
        .eq("campaign_id", campaignId)
        .in("user_id", users.map(u => u.id));

      const split = splitAlreadySent(users, (alreadySent || []).map(r => r.user_id));
      const skipped = split.skipped;
      users = split.pending;

      if (!users.length) {
        console.log(`[run-campaign] "${name}": all eligible already sent`);
        results[name] = { sent: 0, skipped, failed: 0 };
        continue;
      }

      // Resolve emails from auth.users
      const recipients: { uid: string; email: string; displayName: string }[] = [];
      for (const u of users) {
        const { data: authUser } = await supabase.auth.admin.getUserById(u.id);
        if (authUser?.user?.email) {
          recipients.push({ uid: u.id, email: authUser.user.email, displayName: u.display_name || "" });
        }
      }

      // Send emails via Resend batch API
      let sent = 0;
      let failed = 0;
      const batchSize = 100;

      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        const batchPayload = await Promise.all(batch.map(async (r) => {
          const sig = await hmacSign(r.uid, "updates", SUPABASE_SERVICE_ROLE_KEY);
          const url = unsubUrl(SUPABASE_URL, r.uid, sig, "updates");
          // Replace {{name}} placeholder with display name or "there"
          const personalizedBody = personalizeBody(body_html, r.displayName);
          const html = buildHtmlEmail(subject, personalizedBody, url);
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
          } else {
            const errData = await res.json();
            console.error(`[run-campaign] Resend batch error:`, errData);
            failed += batch.length;
          }
        } catch (err) {
          console.error(`[run-campaign] Resend exception:`, err);
          failed += batch.length;
        }

        if (i + batchSize < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Record sends
      if (sent > 0) {
        const sendRecords = recipients.slice(0, sent).map(r => ({
          campaign_id: campaignId,
          user_id: r.uid,
        }));
        await supabase.from("email_campaign_sends").insert(sendRecords);
      }

      console.log(`[run-campaign] "${name}": sent=${sent} skipped=${skipped} failed=${failed}`);
      results[name] = { sent, skipped, failed };
    }

    return new Response(JSON.stringify({ results }), { status: 200 });
  } catch (err) {
    console.error("[run-campaign] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
