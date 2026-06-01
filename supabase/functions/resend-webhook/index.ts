import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEmailEventRow, isValidPayload } from "./lib.ts";

const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();

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

    console.log(`[resend-webhook] Stored ${eventType} for ${row.email_to}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("[resend-webhook] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
