-- sql/2026-09-12-avatar-import-trigger.sql
-- Proposal 2 of the 2026-09-10 usage review (F4): the Google-photo default avatar shipped on
-- 2026-08-16 never ran. handle_new_user() creates the profile row from the auth trigger
-- BEFORE the web app loads, so the client's "brand new profile" branch (isNewUser →
-- maybeImportProviderAvatar) was dead code: 40 of 41 Google sign-ups since 16 Aug had a
-- null avatar although every one carried a picture in auth.users.raw_user_meta_data.
-- Fix: copy the provider picture in the trigger itself. Apple supplies no picture, so
-- Apple sign-ups keep the monogram. The client function stays as a harmless no-op.
-- Deploy with: npx supabase db query --linked --file sql/2026-09-12-avatar-import-trigger.sql
-- Guarded by tests/avatar-import-trigger-sql.test.js. Mirror kept in sql/schema.sql.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Google sign-in puts the same URL under both keys; keep both in case a provider only
  -- sets one. Only https URLs are accepted (nothing else ever reaches an <img src>).
  pic text := coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''),
                       nullif(new.raw_user_meta_data->>'picture', ''));
begin
  insert into public.profiles (id, username, display_name, theme_preference, default_post_visibility, avatar_url)
  values (
    new.id,
    split_part(new.email, '@', 1),
    split_part(new.email, '@', 1),
    'light',
    'public',
    case when pic ~ '^https://' then pic else null end
  );
  return new;
end;
$function$;

-- One-off backfill for the sign-ups the dead code path should have covered: profiles
-- created since the feature shipped, still without an avatar, whose provider metadata
-- carries an https picture. Older profiles are deliberately left alone (the 2026-08-16
-- design: new sign-ups only, existing users are never surprised with a photo).
UPDATE profiles p
SET avatar_url = coalesce(nullif(u.raw_user_meta_data->>'avatar_url', ''), nullif(u.raw_user_meta_data->>'picture', ''))
FROM auth.users u
WHERE u.id = p.id
  AND p.created_at > '2026-08-16'
  AND (p.avatar_url IS NULL OR p.avatar_url = '')
  AND coalesce(nullif(u.raw_user_meta_data->>'avatar_url', ''), nullif(u.raw_user_meta_data->>'picture', '')) ~ '^https://'
  AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = p.id);
