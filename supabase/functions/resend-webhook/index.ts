import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEmailEventRow,
  isValidPayload,
  timestampWithinTolerance,
  verifyWebhookSignature,
} from "./lib.ts";

const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Read the raw body first — the signature is computed over the exact bytes,
    // so we must verify before JSON.parse (re-stringifying would change them).
    const rawBody = await req.text();

    // Verify the Svix signature (Resend's scheme). Without this, anyone could POST
    // forged events and poison the admin engagement metrics.
    // Enforce only once RESEND_WEBHOOK_SECRET is configured; until then log a loud
    // warning and accept, so deploying this can't halt email-event ingestion before
    // the secret is set (setting it later flips enforcement on with no redeploy).
    if (WEBHOOK_SECRET) {
      const svixHeaders = {
        svixId: req.headers.get("svix-id"),
        svixTimestamp: req.headers.get("svix-timestamp"),
        svixSignature: req.headers.get("svix-signature"),
      };
      if (!timestampWithinTolerance(svixHeaders.svixTimestamp, Date.now())) {
        return new Response(JSON.stringify({ error: "Stale or missing timestamp" }), { status: 401 });
      }
      const signatureOk = await verifyWebhookSignature(WEBHOOK_SECRET, svixHeaders, rawBody);
      if (!signatureOk) {
        console.warn("[resend-webhook] Invalid signature — rejecting");
        return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
      }
    } else {
      console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET not set — accepting WITHOUT signature verification (INSECURE). Set the secret to enable enforcement.");
    }

    const body = JSON.parse(rawBody);

    if (!isValidPayload(body)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const row = buildEmailEventRow(body, new Date().toISOString());

    const { error } = await supabase.from("email_events").insert(row);
    if (error) {
      console.error("[resend-webhook] Insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    console.log(`[resend-webhook] Stored ${row.event_type} for ${row.email_to}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("[resend-webhook] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
