// Supabase Edge Function: auto-add-brand
// Triggered by Database Webhook on INSERT into feedback table.
// When a user requests a brand, verifies it via Claude + web search,
// then adds it to the brands table and notifies the user.
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY         — for Claude verification
//   SUPABASE_URL              — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  extractJson,
  isValidBrandName,
  parseBrandRequest,
  pickFinalBrandName,
  sanitizeBrandName,
} from "./lib.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRIGGER_SECRET = Deno.env.get("CAMPAIGN_TRIGGER_SECRET") ?? "";

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    // The DB webhook is the only legitimate caller. Without this the function was
    // reachable unauthenticated: anyone could replay a known feedback id and burn
    // an Anthropic web-search call per request (verified 200 with no auth header).
    if (TRIGGER_SECRET && req.headers.get("x-campaign-secret") !== TRIGGER_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    const record = body.record;
    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    // Only process brand addition requests
    const brandMatch = parseBrandRequest(record.title);
    if (!brandMatch) {
      return new Response(JSON.stringify({ skipped: "not a brand request" }), { status: 200 });
    }

    const requestedName = sanitizeBrandName(brandMatch);
    const userId = record.user_id;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Webhook verification: confirm record exists in database ─────────────
    const { data: verifyRecord, error: verifyError } = await supabase
      .from("feedback")
      .select("id, status")
      .eq("id", record.id)
      .maybeSingle();
    if (!verifyError && verifyRecord?.status === "resolved") {
      // Already handled — replaying must not spend another verification call.
      return new Response(JSON.stringify({ skipped: "already resolved" }), { status: 200 });
    }
    if (verifyError || !verifyRecord) {
      console.warn(`[auto-add-brand] Record ${record.id} not found in feedback table — rejecting`);
      return new Response(JSON.stringify({ error: "Record not found" }), { status: 400 });
    }

    // ── Brand name validation: reject unsafe characters ─────────────────────
    if (!isValidBrandName(requestedName)) {
      console.warn(`[auto-add-brand] Invalid brand name characters: "${requestedName}"`);
      return new Response(JSON.stringify({ error: "Invalid brand name characters" }), { status: 400 });
    }

    console.log(`[auto-add-brand] Processing request for "${requestedName}" from user ${userId}`);

    // ── Step 1: Verify via Claude + web search ───────────────────────────────

    const verifyResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{
          role: "user",
          content: `Is "${requestedName}" a real wristwatch or clock brand? Search the web to verify. Be lenient — microbrands, indie watchmakers, vintage brands, and small manufacturers all count. Respond with JSON only: {"is_brand": true, "canonical_name": "CorrectSpelling"} or {"is_brand": false, "reason": "one sentence"}`,
        }],
      }),
    });

    if (!verifyResp.ok) {
      const errText = await verifyResp.text();
      console.error("[auto-add-brand] Claude API error:", verifyResp.status, errText);
      return new Response(JSON.stringify({ error: "verification_api_failed" }), { status: 502 });
    }

    const verifyResult = await verifyResp.json();
    const textBlock = verifyResult.content?.find((b: { type: string }) => b.type === "text");
    const parsed = extractJson(textBlock?.text ?? "");

    if (!parsed) {
      console.error("[auto-add-brand] Could not parse verification:", textBlock?.text);
      return new Response(JSON.stringify({ error: "parse_failed" }), { status: 500 });
    }

    if (!parsed.is_brand) {
      console.log(`[auto-add-brand] "${requestedName}" not verified: ${parsed.reason}`);
      return new Response(JSON.stringify({ verified: false, reason: parsed.reason }), { status: 200 });
    }

    const finalName = pickFinalBrandName(parsed.canonical_name, requestedName);
    // canonical_name comes from the model and was never re-validated. Since these
    // rows are written with is_canonical:true they render in EVERY user's brand
    // picker, so a prompt-injected name would be stored app-wide.
    if (!isValidBrandName(finalName)) {
      console.warn(`[auto-add-brand] Rejected canonical name: "${finalName}"`);
      return new Response(JSON.stringify({ error: "Invalid canonical brand name" }), { status: 400 });
    }
    console.log(`[auto-add-brand] Verified "${requestedName}" → canonical: "${finalName}"`);

    // ── Step 2: Check if brand already exists in DB ─────────────────────────

    const { data: existing } = await supabase
      .from("brands")
      .select("name")
      .ilike("name", finalName)
      .maybeSingle();

    if (existing) {
      console.log(`[auto-add-brand] "${finalName}" already in brands table`);
      // It may exist as a personal-only row (is_canonical false) from before the
      // list was locked down. Claude just verified it is a real brand, so
      // promote it into the shared list rather than leaving it hidden.
      await supabase.from("brands").update({ is_canonical: true }).eq("name", existing.name);
      await supabase.from("feedback").update({ status: "resolved" }).eq("id", record.id);
      if (userId) {
        await supabase.from("notifications").insert({
          user_id: userId, type: "system", ref_id: finalName, is_read: false,
        });
      }
      return new Response(JSON.stringify({ already_exists: true, brand: finalName }), { status: 200 });
    }

    // ── Step 3: Insert brand into DB ────────────────────────────────────────

    // is_canonical: true — this is the ONLY sanctioned way into the shared brand
    // list. Client-side writes are blocked by RLS; rows default to false.
    const { error: insertError } = await supabase
      .from("brands")
      .insert({ name: finalName, is_canonical: true });

    if (insertError) {
      console.error("[auto-add-brand] Insert failed:", insertError.message);
      return new Response(JSON.stringify({ error: "insert_failed", details: insertError.message }), { status: 500 });
    }

    console.log(`[auto-add-brand] Added "${finalName}" to brands table`);

    // ── Step 4: Mark resolved & notify the user ─────────────────────────────

    await supabase.from("feedback").update({ status: "resolved" }).eq("id", record.id);

    if (userId) {
      await supabase.from("notifications").insert({
        user_id: userId, type: "system", ref_id: finalName, is_read: false,
      });
      console.log(`[auto-add-brand] Notified user ${userId}`);
    }

    return new Response(
      JSON.stringify({ added: finalName }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[auto-add-brand] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
