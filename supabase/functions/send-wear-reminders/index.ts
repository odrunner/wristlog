// Supabase Edge Function: send-wear-reminders
// pg_cron-triggered hourly. At each user's local 5pm, nudges recently-active
// loggers who haven't logged today — push (iOS) or throttled email (web).
// Deploy with --no-verify-jwt (auth handled here). Secrets: CAMPAIGN_TRIGGER_SECRET,
// APNS_KEY_P8/KEY_ID/TEAM_ID, SUPABASE_URL/SERVICE_ROLE_KEY (auto).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Transport: ../_shared/mailer.ts — provider chosen at runtime by the
// EMAIL_PROVIDER secret (defaults to Resend).
import { sendEmail } from "../_shared/mailer.ts";
import { fetchBouncedEmails } from "../_shared/bounced.ts";
import {
  apnsHost, buildHtmlEmail, buildReminderEmail, buildReminderPush,
  createAPNsJWT, hmacSign, sendPush, timingSafeEqual, unsubUrl,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Unsubscribe links are signed with a dedicated secret when one is set, falling
// back to the service-role key so nothing changes until it is. The verifier
// (email-unsubscribe) accepts both, so rotating the service-role key no longer
// invalidates links already sitting in inboxes. See audit S4.
const UNSUB_KEY = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || SERVICE_KEY;
const FROM_EMAIL = "WRotate <hello@wrotate.com>";
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_HOST = apnsHost(Deno.env.get("APNS_SANDBOX") === "true");

serve(async (req) => {
  try {
    // Secret-gate (same as run-campaign). Missing secret config → 401 (no send).
    const triggerSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
    const provided = req.headers.get("x-campaign-secret") ?? "";
    if (!triggerSecret || !provided || !timingSafeEqual(provided, triggerSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: targets, error } = await supabase.rpc("wear_reminder_targets");
    if (error) {
      console.error("[send-wear-reminders] target query failed:", error);
      return new Response(JSON.stringify({ error: String(error.message) }), { status: 500 });
    }
    const allRows = (targets ?? []) as { user_id: string; email: string; channel: string; local_today: string }[];
    if (!allRows.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

    // Skip addresses that have permanently bounced. This runs hourly, so a dead
    // mailbox left in the target list re-bounces on every throttle window and
    // keeps charging the SES reputation that gates the whole account.
    // Push-channel targets have no email and are never filtered out.
    // Checked only when there are targets — most hourly runs match nobody
    // (the RPC selects users whose LOCAL hour is 5pm), and paying for a
    // suppression lookup on every empty run is 20+ wasted queries a day.
    const bounced = await fetchBouncedEmails(supabase);
    const rows = allRows.filter((t) => t.channel === "push" || !bounced.has((t.email ?? "").trim().toLowerCase()));
    if (!rows.length) return new Response(JSON.stringify({ sent: 0, skipped_bounced: allRows.length }), { status: 200 });

    let pushed = 0, emailed = 0, failed = 0;
    let jwt: string | null = null;
    const push = buildReminderPush();
    const mail = buildReminderEmail();

    for (const t of rows) {
      try {
        if (t.channel === "push") {
          const { data: toks } = await supabase.from("device_tokens")
            .select("token").eq("user_id", t.user_id).eq("platform", "ios");
          if (!toks || !toks.length) continue;
          if (!jwt) jwt = await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);
          const results = await Promise.all(
            toks.map((x: { token: string }) => sendPush(x.token, push, jwt!, APNS_HOST)),
          );
          const expired = results.filter((r) => r.status === 410).map((r) => r.token);
          if (expired.length) await supabase.from("device_tokens").delete().in("token", expired);
          if (!results.some((r) => r.success)) { failed++; continue; }
          pushed++;
        } else {
          if (!t.email) continue;
          const sig = await hmacSign(t.user_id, "reminders", UNSUB_KEY);
          const url = unsubUrl(SUPABASE_URL, t.user_id, sig, "reminders");
          const html = buildHtmlEmail(mail.subject, mail.body, url);
          const result = await sendEmail({
            from: FROM_EMAIL,
            to: [t.email],
            subject: mail.subject,
            html,
            headers: {
              "List-Unsubscribe": `<${url}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          if (!result.ok) { failed++; continue; }
          emailed++;
        }
        await supabase.from("wear_reminder_sends")
          .upsert({ user_id: t.user_id, channel: t.channel, sent_on: t.local_today }, { onConflict: "user_id,sent_on", ignoreDuplicates: true });
      } catch (e) {
        failed++;
        console.error(`[send-wear-reminders] user ${t.user_id} failed:`, e);
      }
    }

    return new Response(JSON.stringify({ pushed, emailed, failed, candidates: rows.length, skipped_bounced: allRows.length - rows.length }), { status: 200 });
  } catch (err) {
    console.error("[send-wear-reminders] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
