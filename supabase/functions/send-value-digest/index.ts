// Supabase Edge Function: send-value-digest
// pg_cron-triggered monthly. Emails each eligible user their collection's saved market
// value, gain vs paid where known, the most valuable watch, and what is stale — one CTA
// to Stats. Deterministic (no server-side price refresh). Audience + numbers come from
// value_digest_targets(); ≤1 send per user per 25 days via value_digest_sends.
// Deploy with --no-verify-jwt (auth handled here). Secrets: CAMPAIGN_TRIGGER_SECRET,
// SUPABASE_URL/SERVICE_ROLE_KEY (auto), UNSUBSCRIBE_HMAC_SECRET (optional).
//
// Body {"dry_run": true} returns the candidates and their subject lines without sending.
// Body {"limit": N} caps a run (first-send blast radius).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/mailer.ts";
import { fetchBouncedEmails } from "../_shared/bounced.ts";
import { buildDigestEmail, buildHtmlEmail, hmacSign, monthLabel, timingSafeEqual, unsubUrl } from "./lib.ts";
import type { DigestTarget } from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UNSUB_KEY = Deno.env.get("UNSUBSCRIBE_HMAC_SECRET") || SERVICE_KEY;
const FROM_EMAIL = "WRotate <hello@wrotate.com>";

type TargetRow = DigestTarget & { user_id: string; email: string };

serve(async (req) => {
  try {
    const triggerSecret = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";
    const provided = req.headers.get("x-campaign-secret") ?? "";
    if (!triggerSecret || !provided || !timingSafeEqual(provided, triggerSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    let body: { dry_run?: boolean; limit?: number } = {};
    try { body = await req.json(); } catch (_) { /* empty body */ }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: targets, error } = await supabase.rpc("value_digest_targets");
    if (error) {
      console.error("[send-value-digest] target query failed:", error);
      return new Response(JSON.stringify({ error: String(error.message) }), { status: 500 });
    }
    let rows = (targets ?? []) as TargetRow[];
    if (Number.isInteger(body.limit) && body.limit! > 0) rows = rows.slice(0, body.limit);
    const label = monthLabel();

    if (body.dry_run) {
      return new Response(JSON.stringify({
        dry_run: true, month: label, candidates: rows.length,
        sample: rows.slice(0, 5).map((r) => ({ user_id: r.user_id, subject: buildDigestEmail(r, label).subject })),
      }), { status: 200 });
    }
    if (!rows.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

    // Skip permanently bounced addresses — every re-bounce charges SES reputation.
    const bounced = await fetchBouncedEmails(supabase);
    rows = rows.filter((t) => !bounced.has((t.email ?? "").trim().toLowerCase()));

    let emailed = 0, failed = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const t of rows) {
      try {
        if (!t.email) continue;
        const mail = buildDigestEmail(t, label);
        const sig = await hmacSign(t.user_id, "digest", UNSUB_KEY);
        const url = unsubUrl(SUPABASE_URL, t.user_id, sig, "digest");
        const html = buildHtmlEmail(mail.subject, mail.body, url);
        const result = await sendEmail({
          from: FROM_EMAIL, to: [t.email], subject: mail.subject, html,
          headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        if (!result.ok) { failed++; continue; }
        emailed++;
        await supabase.from("value_digest_sends")
          .upsert({ user_id: t.user_id, sent_on: today }, { onConflict: "user_id,sent_on", ignoreDuplicates: true });
      } catch (e) {
        failed++;
        console.error(`[send-value-digest] user ${t.user_id} failed:`, e);
      }
    }
    return new Response(JSON.stringify({ emailed, failed, candidates: rows.length }), { status: 200 });
  } catch (err) {
    console.error("[send-value-digest] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
