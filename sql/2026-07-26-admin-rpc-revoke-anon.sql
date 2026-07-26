-- Finish the 2026-07-19 admin RPC lockdown (2026-07-25 audit, S2).
--
-- That fix added an is_admin guard to all 21 admin_* SECURITY DEFINER functions and
-- REVOKEd six of them. Nine were left executable by anon. They all DENY today —
-- probed live with the production anon key, every one returns "Not authorized" — so
-- this is defence in depth, not an open hole. The point is that the in-function guard
-- is currently the ONLY barrier: a future CREATE OR REPLACE that drops the guard line
-- silently republishes the data to anon with no other check in the way.
--
-- Revoking from anon only. `authenticated` must keep EXECUTE — the guard is what
-- distinguishes an admin from an ordinary logged-in user, and the admin dashboard
-- calls these with a normal user JWT.

revoke execute on function public.admin_active_dau()             from anon;
revoke execute on function public.admin_broadcast_queue_status() from anon;
revoke execute on function public.admin_demo_views()             from anon;
revoke execute on function public.admin_email_engagement()       from anon;
revoke execute on function public.admin_last_active()            from anon;
revoke execute on function public.admin_prov2_beta_stats()       from anon;
revoke execute on function public.admin_traffic_stats()          from anon;
revoke execute on function public.admin_unsub_stats()            from anon;
revoke execute on function public.admin_user_detail(uuid)        from anon;

-- PUBLIC carries the default EXECUTE grant that anon inherits, so it has to go too —
-- revoking from anon alone leaves the privilege reachable through PUBLIC.
revoke execute on function public.admin_active_dau()             from public;
revoke execute on function public.admin_broadcast_queue_status() from public;
revoke execute on function public.admin_demo_views()             from public;
revoke execute on function public.admin_email_engagement()       from public;
revoke execute on function public.admin_last_active()            from public;
revoke execute on function public.admin_prov2_beta_stats()       from public;
revoke execute on function public.admin_traffic_stats()          from public;
revoke execute on function public.admin_unsub_stats()            from public;
revoke execute on function public.admin_user_detail(uuid)        from public;

-- Re-grant to the roles that legitimately call them (PUBLIC revoke also strips these).
grant execute on function public.admin_active_dau()             to authenticated, service_role;
grant execute on function public.admin_broadcast_queue_status() to authenticated, service_role;
grant execute on function public.admin_demo_views()             to authenticated, service_role;
grant execute on function public.admin_email_engagement()       to authenticated, service_role;
grant execute on function public.admin_last_active()            to authenticated, service_role;
grant execute on function public.admin_prov2_beta_stats()       to authenticated, service_role;
grant execute on function public.admin_traffic_stats()          to authenticated, service_role;
grant execute on function public.admin_unsub_stats()            to authenticated, service_role;
grant execute on function public.admin_user_detail(uuid)        to authenticated, service_role;
