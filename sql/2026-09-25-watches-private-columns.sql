-- Audit 2026-09-23 SEC-23-8 part B — signed-in users could read the price /
-- insurance / receipt columns of any watch visible to them. Hiding those
-- columns needs the owner's reads and writes to stop depending on table-level
-- SELECT: the client's upsert (ON CONFLICT … SET col = EXCLUDED.col) needs
-- SELECT on every column it writes.
-- Step 1: my_watches() (owner's full rows) and save_watches() (update-else-
-- insert of just the keys sent; SECURITY INVOKER, so RLS — own rows, demo,
-- suspended — applies unchanged, and it never reads the private columns).
-- Step 2 (after the client switched): column-level SELECT for authenticated.

CREATE OR REPLACE FUNCTION public.my_watches()
RETURNS SETOF public.watches
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT * FROM public.watches WHERE user_id = auth.uid() $$;
REVOKE EXECUTE ON FUNCTION public.my_watches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_watches() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_watches(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  e jsonb;
  cols text[];
  col_list text;
  n int := 0;
  c int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'p_rows must be an array'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(e) <> 'object' OR coalesce(e->>'id', '') = '' THEN CONTINUE; END IF;
    -- Only real columns; id is the key and user_id is always the caller.
    SELECT array_agg(k ORDER BY k) INTO cols
      FROM jsonb_object_keys(e) k
     WHERE k NOT IN ('id', 'user_id')
       AND k IN (SELECT attname FROM pg_attribute
                  WHERE attrelid = 'public.watches'::regclass AND attnum > 0 AND NOT attisdropped);
    c := 0;
    IF cols IS NOT NULL THEN
      col_list := (SELECT string_agg(quote_ident(x), ', ') FROM unnest(cols) x);
      EXECUTE format(
        'UPDATE public.watches SET (%1$s) = (SELECT %1$s FROM jsonb_populate_record(NULL::public.watches, $1)) WHERE id = $1->>''id''',
        CASE WHEN array_length(cols, 1) = 1 THEN col_list ELSE col_list END)
        USING e;
      GET DIAGNOSTICS c = ROW_COUNT;
    ELSIF EXISTS (SELECT 1 FROM public.watches WHERE id = e->>'id') THEN
      c := 1;
    END IF;
    IF c = 0 THEN
      EXECUTE format(
        'INSERT INTO public.watches (id, user_id%1$s) SELECT $1->>''id'', $2%2$s FROM jsonb_populate_record(NULL::public.watches, $1)',
        CASE WHEN cols IS NULL THEN '' ELSE ', ' || col_list END,
        CASE WHEN cols IS NULL THEN '' ELSE ', ' || col_list END)
        USING e, v_uid;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_watches(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_watches(jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
