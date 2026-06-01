// Supabase Edge Function: delete-user
// Called by the client after all user data has been deleted.
// Deletes the user from auth.users using the admin API.
//
// Requires a valid JWT — the user can only delete themselves.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAuthHeader } from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://wrotate.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!hasAuthHeader(authHeader)) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error('[delete-user] Failed:', deleteError);
      return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    console.log(`[delete-user] Deleted auth user: ${user.id}`);
    return new Response(JSON.stringify({ deleted: true }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error('[delete-user] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
