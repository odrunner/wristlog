-- Next unseen fact for the login modal.
--
-- pick_watch_fact() cannot be reused here: it stamps last_wear_date = today and
-- has a same-day branch that returns the already-chosen fact. Calling it on app
-- open would make a wear log later the same day replay the identical fact,
-- breaking the "log a wear to unlock the next one" promise the modal makes.
--
-- This advances the cursor but deliberately leaves last_wear_date NULL, so the
-- next wear log advances again and yields a genuinely different fact.
--
-- Returns needs_generation = true and WRITES NOTHING when the pool holds nothing
-- new for the model. The caller skips the modal rather than waiting on a ~10-15s
-- grounded generation.
create or replace function public.peek_watch_fact(p_brand text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last  int;
  v_pool  int;
  v_next  int;
  v_serve int;
  v_fact  public.watch_facts%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_brand), '') = '' or coalesce(trim(p_name), '') = '' then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;

  select count(*) into v_pool from public.watch_facts where model_key = v_key;
  v_next := v_last + 1;

  -- Nothing new to show without generating. Write nothing; the caller skips.
  if v_pool = 0 or (v_next >= v_pool and v_pool < 10) then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  -- At the 10-fact cap, wrap like pick_watch_fact does.
  v_serve := v_next % v_pool;
  select * into v_fact from public.watch_facts
    where model_key = v_key and position = v_serve;
  if v_fact.id is null then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  -- last_wear_date stays NULL on purpose: the next wear log must advance again.
  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, null, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position   = v_next,
        last_wear_date  = null,
        current_fact_id = v_fact.id,
        updated_at      = now();

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact, 'needs_generation', false);
end $$;

revoke execute on function public.peek_watch_fact(text, text) from public, anon;
grant execute on function public.peek_watch_fact(text, text) to authenticated;

notify pgrst, 'reload schema';
