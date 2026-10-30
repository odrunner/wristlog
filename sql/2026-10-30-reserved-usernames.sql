-- Reserved usernames (2026-10-30)
-- Stops real users from registering brand/founder/impersonation handles.
-- Single source of truth: the reserved_usernames table (same philosophy as
-- internal_accounts — never hardcode the list in JS or SQL). To reserve or
-- release a name, insert/delete a row; no code change needed.
--
-- Matching: is_pattern=false rows match the exact (lowercased) username;
-- is_pattern=true rows match as a substring, e.g. 'wrotate' also blocks
-- wrotate_app, thewrotate, wrotate2.
--
-- Enforcement is a BEFORE INSERT OR UPDATE OF username trigger on profiles,
-- because the client writes profiles.username directly over PostgREST
-- (signup auto-create, username prompt, profile edit) — a JS-only check is
-- bypassable. Rules, in order:
--   1. username unchanged (case-insensitive)      -> allow
--   2. row belongs to an internal account         -> allow (official account
--      and admin may hold reserved names)
--   3. no auth JWT (handle_new_user auth trigger, admin SQL) -> RENAME to a
--      deterministic fallback instead of raising. handle_new_user inserts the
--      raw email prefix with no conflict handling; an exception there rolls
--      back the auth.users insert and bricks signup for that email address.
--   4. otherwise -> raise, with 'reserved' in the message (the client keys
--      its toast off that word).
--
-- Clients never read the table directly — availability checks go through the
-- SECURITY DEFINER RPC is_username_reserved(), so the table needs no grants
-- and no RLS policies (RLS enabled, zero policies = no API access).
-- Existing holders of a reserved name are untouched: the trigger only fires
-- when the username column is written.

CREATE TABLE IF NOT EXISTS public.reserved_usernames (
  name text PRIMARY KEY CHECK (name = lower(name) AND length(name) BETWEEN 2 AND 30),
  is_pattern boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reserved_usernames ENABLE ROW LEVEL SECURITY;
-- Default privileges on this project still auto-grant API roles on new tables
-- (created pre-2026-10-30) — strip them; only the RPC reads this table.
REVOKE ALL ON TABLE public.reserved_usernames FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_username_reserved(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM reserved_usernames r
    WHERE (NOT r.is_pattern AND r.name = lower(coalesce(p_name, '')))
       OR (r.is_pattern AND lower(coalesce(p_name, '')) LIKE '%' || r.name || '%')
  );
$$;

REVOKE ALL ON FUNCTION public.is_username_reserved(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_username_reserved(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_reserved_username()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.username IS NULL OR NOT public.is_username_reserved(NEW.username) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND lower(OLD.username) = lower(NEW.username) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    -- Server-side path (see header): rename, never raise. 'user' + first 8 hex
    -- chars of the user's uuid — starts with a letter, deterministic, and a
    -- collision just surfaces as the usual unique-violation retry client-side.
    NEW.username := 'user' || substr(replace(NEW.id::text, '-', ''), 1, 8);
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'username "%" is reserved', NEW.username
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reserved_username ON public.profiles;
CREATE TRIGGER trg_enforce_reserved_username
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reserved_username();

-- ── Seed list ──────────────────────────────────────────────────────────────
-- Brand (substring patterns — block every variant)
INSERT INTO public.reserved_usernames (name, is_pattern, note) VALUES
  ('wrotate',  true, 'brand — blocks every variant (wrotate_app, thewrotate, ...)'),
  ('wristlog', true, 'old internal product name')
ON CONFLICT (name) DO NOTHING;

-- Founder + family (exact)
INSERT INTO public.reserved_usernames (name, note) VALUES
  ('ozgur',       'founder'),
  ('dogan',       'founder'),
  ('ozgurdogan',  'founder'),
  ('ozgur_dogan', 'founder'),
  ('odogan',      'founder'),
  ('muge',        'family'),
  ('mugedogan',   'family'),
  ('muge_dogan',  'family'),
  ('mina',        'family'),
  ('minadogan',   'family'),
  ('mina_dogan',  'family'),
  ('beliz',       'family'),
  ('belizdogan',  'family'),
  ('beliz_dogan', 'family'),
  ('timur',       'family'),
  ('timurdogan',  'family'),
  ('timur_dogan', 'family'),
  ('alp',         'family'),
  ('alpdogan',    'family'),
  ('alp_dogan',   'family')
ON CONFLICT (name) DO NOTHING;

-- Impersonation / platform handles (exact)
INSERT INTO public.reserved_usernames (name, note) VALUES
  ('admin',         'impersonation'),
  ('administrator', 'impersonation'),
  ('moderator',     'impersonation'),
  ('mod',           'impersonation'),
  ('support',       'impersonation'),
  ('help',          'impersonation'),
  ('official',      'impersonation'),
  ('team',          'impersonation'),
  ('staff',         'impersonation'),
  ('owner',         'impersonation'),
  ('founder',       'impersonation'),
  ('ceo',           'impersonation'),
  ('root',          'system'),
  ('system',        'system'),
  ('api',           'system'),
  ('security',      'system'),
  ('info',          'contact-style'),
  ('contact',       'contact-style'),
  ('news',          'contact-style'),
  ('legal',         'contact-style'),
  ('privacy',       'contact-style'),
  ('billing',       'contact-style'),
  ('feedback',      'contact-style'),
  ('noreply',       'contact-style'),
  ('no_reply',      'contact-style'),
  ('notifications', 'contact-style'),
  ('webmaster',     'contact-style'),
  ('postmaster',    'contact-style'),
  ('test',          'test accounts'),
  ('demo',          'retired demo mode'),
  ('watchdemo',     'retired demo account name')
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
