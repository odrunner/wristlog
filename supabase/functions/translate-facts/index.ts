// Supabase Edge Function: translate-facts
//
// Fills watch_facts.translations (sql/2026-11-13-fact-translations.sql). Run by
// pg_cron every five minutes with the campaign secret; each run takes the oldest
// facts still missing a language, asks the model once per language per batch,
// and stores only answers that pass _shared/translate-lib.ts. It works through
// the backlog and then keeps up with newly generated facts by itself.
//
// POST {}                 → translate up to MAX_FACTS facts
// POST {"dry_run": true}  → report how many are waiting, change nothing
// Deploy: npx supabase functions deploy translate-facts --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { serviceKey } from "../_shared/keys.ts";
import { triggerSecretOk } from "../_shared/trigger-auth.ts";
import { OTHER_LANGS } from "../_shared/translate-lib.ts";
import type { Fields, OtherLang } from "../_shared/translate-lib.ts";
import { translateFields } from "../_shared/translate.ts";
import { batchFields, chunk, mergeAnswers } from "./lib.ts";
import type { FactRow } from "./lib.ts";

const BATCH = 12;      // facts per model call
const MAX_FACTS = 36;  // facts per run: 3 batches x 6 languages = 18 calls

serve(async (req) => {
  if (!triggerSecretOk(req.headers.get("x-campaign-secret"), Deno.env.get("CAMPAIGN_TRIGGER_SECRET"))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey());

    // PostgREST has no "has all keys" operator, so the work list comes from a
    // filter on each language key being absent, OR-ed together.
    const missingAny = OTHER_LANGS.map((l) => `translations->>${l}.is.null`).join(",");
    if (body?.dry_run) {
      const { count } = await supabase.from("watch_facts")
        .select("id", { count: "exact", head: true }).or(missingAny).lt("translate_attempts", 3);
      return new Response(JSON.stringify({ dry_run: true, waiting: count ?? null }), { status: 200 });
    }
    const { data, error } = await supabase.from("watch_facts")
      .select("id, fact, translations, translate_attempts")
      .or(missingAny).lt("translate_attempts", 3)
      .order("created_at", { ascending: true }).limit(MAX_FACTS);
    if (error) throw error;
    const rows = (data ?? []) as FactRow[];
    if (!rows.length) return new Response(JSON.stringify({ translated: 0, waiting: 0 }), { status: 200 });

    let stored = 0, calls = 0, rejected = 0;
    for (const batch of chunk(rows, BATCH)) {
      const answers = new Map<OtherLang, Fields>();
      await Promise.all(OTHER_LANGS.map(async (lang) => {
        const fields = batchFields(batch, lang);
        if (!Object.keys(fields).length) return;
        calls++;
        const out = await translateFields(fields, lang, { timeoutMs: 45000, tag: "facts" });
        if (out) answers.set(lang, out); else rejected++;
      }));
      const merged = mergeAnswers(batch, answers);
      const gained = new Set(merged.map((m) => m.id));
      for (const m of merged) {
        const { error: upErr } = await supabase.from("watch_facts").update({ translations: m.translations }).eq("id", m.id);
        if (upErr) console.error("[translate-facts] store failed:", upErr.message); else stored++;
      }
      // Count a try against every row in the batch that is still incomplete, so a
      // fact the model cannot handle stops being retried after three runs.
      for (const r of batch) {
        const done = gained.has(r.id) && OTHER_LANGS.every((l) => {
          const t = merged.find((m) => m.id === r.id)?.translations ?? {};
          return typeof t[l] === "string" && t[l];
        });
        if (!done) await supabase.from("watch_facts").update({ translate_attempts: r.translate_attempts + 1 }).eq("id", r.id);
      }
    }
    console.log(`[translate-facts] rows ${rows.length}, stored ${stored}, calls ${calls}, rejected ${rejected}`);
    return new Response(JSON.stringify({ rows: rows.length, stored, calls, rejected }), { status: 200 });
  } catch (err) {
    console.error("[translate-facts] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
