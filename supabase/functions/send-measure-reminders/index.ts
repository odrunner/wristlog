// Supabase Edge Function: send-measure-reminders
// pg_cron-triggered hourly. Two phases:
//   1. At each user's local noon, ONE re-measure / drift push for a watch whose last
//      converged measurement (saved or not — measurement_sessions) is 21–60 days old with
//      nothing since. Push only; at most one per user per 30 days.
//   2. At each user's local 7pm, the day-7 "did it hold?" nudge (experiment remeasure_d7,
//      2026-09-11): one message ever, seven days after the FIRST kept reading, on that
//      watch, quoting its rate. Push when the token is backed by a real grant, email
//      otherwise. Arms are assigned by the RPC at this moment; control gets nothing.
// Deploy with --no-verify-jwt (auth handled here). Secrets: CAMPAIGN_TRIGGER_SECRET,
// APNS_KEY_P8/KEY_ID/TEAM_ID, SUPABASE_URL/SERVICE_ROLE_KEY (auto), UNSUBSCRIBE_HMAC_SECRET.
//
// Body {"dry_run": true} returns both phases' candidates and message text without sending
// or assigning.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Transport: ../_shared/mailer.ts (AWS SES).
import { sendEmail } from "../_shared/mailer.ts";
import { fetchBouncedEmails } from "../_shared/bounced.ts";
import { fetchTrackedUids, TRACKED_CONFIG_SET } from "../_shared/tracked.ts";
import {
  apnsHost, buildHtmlEmail, buildMeasurePush, buildRemeasureD7Email, buildRemeasureD7Push,
  createAPNsJWT, hmacSign, routeFor, sendPush, timingSafeEqual, unsubUrl,
} from "./lib.ts";
import type { MeasureTarget, RemeasureD7Target } from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Same fallback chain as send-wear-reminders (audit S4): dedicated unsubscribe secret when
// set, else the service-role key; email-unsubscribe verifies both.
const UNSUB_KEY = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || SERVICE_KEY;
const FROM_EMAIL = "WRotate <hello@wrotate.com>";
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_HOST = apnsHost(Deno.env.get("APNS_SANDBOX") === "true");

type TargetRow = MeasureTarget & { user_id: string; watch_id: string; local_today: string };

serve(async (req) => {
  try {
    const triggerSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
    const provided = req.headers.get("x-campaign-secret") ?? "";
    if (!triggerSecret || !provided || !timingSafeEqual(provided, triggerSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    let body: { dry_run?: boolean } = {};
    try { body = await req.json(); } catch (_) { /* empty body */ }
    const dry = !!body.dry_run;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    let jwt: string | null = null;
    const apnsJwt = async () => jwt ??= await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);

    // Sends `msg` to every iOS token of `userId`; prunes expired tokens. false = nothing landed.
    const pushUser = async (userId: string, msg: { title: string; body: string }, route: string, id: string | null): Promise<boolean> => {
      const { data: toks } = await supabase.from("device_tokens")
        .select("token, app_version").eq("user_id", userId).eq("platform", "ios");
      if (!toks || !toks.length) return false;
      const j = await apnsJwt();
      const results = await Promise.all(
        toks.map((x: { token: string; app_version?: string | null }) =>
          sendPush(x.token, msg, j, APNS_HOST, routeFor(x.app_version, route, id, userId))),
      );
      const expired = results.filter((r) => r.status === 410).map((r) => r.token);
      if (expired.length) await supabase.from("device_tokens").delete().in("token", expired);
      return results.some((r) => r.success);
    };

    // ── Phase 1: 21–60 day re-measure / drift push (local noon) ─────────────────
    const { data: targets, error } = await supabase.rpc("measure_reminder_targets");
    if (error) {
      console.error("[send-measure-reminders] target query failed:", error);
      return new Response(JSON.stringify({ error: String(error.message) }), { status: 500 });
    }
    const rows = (targets ?? []) as TargetRow[];

    // ── Phase 2: day-7 "did it hold?" nudge (local 7pm, experiment remeasure_d7) ──
    const { data: d7data, error: d7err } = await supabase.rpc("remeasure_d7_targets", { p_dry: dry });
    if (d7err) console.error("[send-measure-reminders] remeasure_d7 target query failed:", d7err);
    const d7rows = (d7data ?? []) as RemeasureD7Target[];

    if (dry) {
      return new Response(JSON.stringify({
        dry_run: true,
        candidates: rows.map((r) => ({ user_id: r.user_id, watch_id: r.watch_id, message: buildMeasurePush(r).body })),
        d7_candidates: d7rows.map((r) => ({
          user_id: r.user_id, watch_id: r.watch_id, variant: r.variant, channel: r.channel,
          message: r.channel === "push" ? buildRemeasureD7Push(r).body : buildRemeasureD7Email(r).subject,
        })),
      }), { status: 200 });
    }

    let pushed = 0, failed = 0;
    for (const t of rows) {
      try {
        if (!await pushUser(t.user_id, buildMeasurePush(t), "measure", t.watch_id)) { failed++; continue; }
        pushed++;
        await supabase.from("measure_reminder_sends")
          .upsert({ user_id: t.user_id, watch_id: t.watch_id, sent_on: t.local_today }, { onConflict: "user_id,sent_on", ignoreDuplicates: true });
      } catch (e) {
        failed++;
        console.error(`[send-measure-reminders] user ${t.user_id} failed:`, e);
      }
    }

    let d7pushed = 0, d7emailed = 0, d7failed = 0, d7skipped = 0;
    if (d7rows.length) {
      const emailRows = d7rows.filter((r) => r.channel === "email");
      // Suppression + per-recipient click-tracked config set (2.6+ tokens only — a
      // rewritten link opens Safari on older builds; see _shared/tracked.ts).
      const bounced = emailRows.length ? await fetchBouncedEmails(supabase) : new Set<string>();
      const tracked = emailRows.length ? await fetchTrackedUids(supabase, emailRows.map((r) => r.user_id)) : new Set<string>();
      for (const t of d7rows) {
        try {
          if (t.channel === "push") {
            if (!await pushUser(t.user_id, buildRemeasureD7Push(t), "measure", t.watch_id)) { d7failed++; continue; }
            d7pushed++;
          } else {
            const to = (t.email ?? "").trim();
            if (!to || bounced.has(to.toLowerCase())) { d7skipped++; continue; }
            const sig = await hmacSign(t.user_id, "reminders", UNSUB_KEY);
            const url = unsubUrl(SUPABASE_URL, t.user_id, sig, "reminders");
            const mail = buildRemeasureD7Email(t);
            const result = await sendEmail({
              from: FROM_EMAIL,
              to: [to],
              subject: mail.subject,
              html: buildHtmlEmail(mail.subject, mail.body, url),
              headers: {
                "List-Unsubscribe": `<${url}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
              ...(tracked.has(t.user_id) ? { configSet: TRACKED_CONFIG_SET } : {}),
            });
            if (!result.ok) { d7failed++; continue; }
            d7emailed++;
          }
          await supabase.from("remeasure_d7_sends")
            .upsert({ user_id: t.user_id, watch_id: t.watch_id, channel: t.channel, sent_on: t.local_today }, { onConflict: "user_id", ignoreDuplicates: true });
        } catch (e) {
          d7failed++;
          console.error(`[send-measure-reminders] d7 user ${t.user_id} failed:`, e);
        }
      }
    }

    return new Response(JSON.stringify({
      pushed, failed, candidates: rows.length,
      d7: { pushed: d7pushed, emailed: d7emailed, failed: d7failed, skipped: d7skipped, candidates: d7rows.length },
    }), { status: 200 });
  } catch (err) {
    console.error("[send-measure-reminders] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
