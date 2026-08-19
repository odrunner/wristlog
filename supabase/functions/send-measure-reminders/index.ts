// Supabase Edge Function: send-measure-reminders
// pg_cron-triggered hourly. At each user's local noon, sends ONE re-measure / drift push
// for a watch whose last converged measurement (saved or not — measurement_sessions) is
// 21–60 days old with nothing since. Push only; at most one per user per 30 days.
// Deploy with --no-verify-jwt (auth handled here). Secrets: CAMPAIGN_TRIGGER_SECRET,
// APNS_KEY_P8/KEY_ID/TEAM_ID, SUPABASE_URL/SERVICE_ROLE_KEY (auto).
//
// Body {"dry_run": true} returns the candidates and their message text without sending.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsHost, buildMeasurePush, createAPNsJWT, routeFor, sendPush, timingSafeEqual } from "./lib.ts";
import type { MeasureTarget } from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: targets, error } = await supabase.rpc("measure_reminder_targets");
    if (error) {
      console.error("[send-measure-reminders] target query failed:", error);
      return new Response(JSON.stringify({ error: String(error.message) }), { status: 500 });
    }
    const rows = (targets ?? []) as TargetRow[];

    if (body.dry_run) {
      return new Response(JSON.stringify({
        dry_run: true,
        candidates: rows.map((r) => ({ user_id: r.user_id, watch_id: r.watch_id, message: buildMeasurePush(r).body })),
      }), { status: 200 });
    }
    if (!rows.length) return new Response(JSON.stringify({ pushed: 0, candidates: 0 }), { status: 200 });

    let pushed = 0, failed = 0;
    let jwt: string | null = null;
    for (const t of rows) {
      try {
        const { data: toks } = await supabase.from("device_tokens")
          .select("token, app_version").eq("user_id", t.user_id).eq("platform", "ios");
        if (!toks || !toks.length) continue;
        if (!jwt) jwt = await createAPNsJWT(APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID);
        const msg = buildMeasurePush(t);
        // Tap → timegrapher with this watch preselected (2.6+ only, per token).
        const results = await Promise.all(
          toks.map((x: { token: string; app_version?: string | null }) =>
            sendPush(x.token, msg, jwt!, APNS_HOST, routeFor(x.app_version, "measure", t.watch_id, t.user_id))),
        );
        const expired = results.filter((r) => r.status === 410).map((r) => r.token);
        if (expired.length) await supabase.from("device_tokens").delete().in("token", expired);
        if (!results.some((r) => r.success)) { failed++; continue; }
        pushed++;
        await supabase.from("measure_reminder_sends")
          .upsert({ user_id: t.user_id, watch_id: t.watch_id, sent_on: t.local_today }, { onConflict: "user_id,sent_on", ignoreDuplicates: true });
      } catch (e) {
        failed++;
        console.error(`[send-measure-reminders] user ${t.user_id} failed:`, e);
      }
    }
    return new Response(JSON.stringify({ pushed, failed, candidates: rows.length }), { status: 200 });
  } catch (err) {
    console.error("[send-measure-reminders] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
