-- Users the login fun-fact modal can fire for: signed in recently and owning at
-- least one usable watch. Used only to prewarm the shared fact pool so the modal
-- never has to skip for want of a warm fact.
create or replace function public.active_users_with_watches(p_days integer default 30)
returns table (user_id uuid)
language sql
security definer
set search_path = public, auth
as $$
  select u.id
  from auth.users u
  where u.last_sign_in_at > now() - make_interval(days => p_days)
    and not exists (select 1 from internal_accounts ia where ia.user_id = u.id)
    and exists (
      select 1 from watches w
      where w.user_id = u.id
        and trim(coalesce(w.brand, '')) <> ''
        and trim(coalesce(w.name, ''))  <> ''
    );
$$;

revoke execute on function public.active_users_with_watches(integer) from public, anon;
grant execute on function public.active_users_with_watches(integer) to service_role;

notify pgrst, 'reload schema';
