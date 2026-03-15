// Supabase Edge Function: delete-user
// Called by the client after all user data has been deleted.
// Deletes the user from auth.users using the admin API.
//
// Requires a valid JWT — the user can only delete themselves.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    // Get the user's JWT from the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), { status: 401 });
    }

    // Create a client with the user's JWT to verify identity
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user is authenticated
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Use service role to delete the user from auth.users
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error('[delete-user] Failed:', deleteError);
      return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
    }

    console.log(`[delete-user] Deleted auth user: ${user.id}`);
    return new Response(JSON.stringify({ deleted: true }), { status: 200 });

  } catch (err) {
    console.error('[delete-user] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
