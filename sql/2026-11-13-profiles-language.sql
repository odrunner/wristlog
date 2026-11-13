-- profiles.language — the app language a member chose (Profile -> Language).
--
-- Until now the choice lived only in the browser (localStorage wr_lang), so
-- nothing server-side — emails, push, reminders — could know it. NULL means
-- "never recorded" (treat as English); 'en' is an explicit choice of English.
-- The client writes it from loadMyProfile whenever it differs from wr_lang,
-- the same way timezone is synced.
--
-- Private, like timezone: authenticated may UPDATE it (own row, via the
-- existing own-row RLS policy) but not SELECT it on other members. The owner
-- reads it through my_profile() (SETOF profiles, SECURITY DEFINER); edge
-- functions read it with the service role.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_language_check
  CHECK (language IS NULL OR language ~ '^[a-z]{2}$');
GRANT UPDATE (language) ON public.profiles TO authenticated;
NOTIFY pgrst, 'reload schema';
