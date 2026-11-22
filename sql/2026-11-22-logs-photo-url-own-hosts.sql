-- 2026-11-22: a post's photo can only live on WRotate's own storage.
--
-- logs.photo_url had no rule on where it points, and the insert/update
-- policies only ask for user_id = auth.uid(). A member could set their own
-- public post's photo to any https address with one API call; the feed, the
-- model page and the brand page then load it for every visitor, handing that
-- server each visitor's IP address and browser (weekly security review
-- 2026-11-22, F1). Nobody had done it: all 1,488 photo rows passed this rule
-- the day it was added.
--
-- The value is EITHER one address or the JSON array JSON.stringify() writes
-- for a multi-photo post (up to six, no spaces). Both hosts are ours:
-- api.wrotate.com is the project behind our own name, the supabase.co form is
-- what posts from before 2026-03-04 were saved with. A plain pattern, no
-- helper function: nothing to grant, nothing to keep in step.
--
-- Writers checked in index.html before adding this (every one goes through
-- uploadImage()/uploadVideo() -> getPublicUrl()): new post, add photo to a
-- post, edit post, quick "track" post. The official-account publish used to
-- pass a draft's pasted image address through as-is; the client now refuses
-- one that is not on our storage, with a message that says to upload it.
--
-- Rollback: alter table public.logs drop constraint logs_photo_url_own_hosts;
alter table public.logs add constraint logs_photo_url_own_hosts check (
  photo_url is null
  or photo_url ~ '^https://(api\.wrotate\.com|xnzweevzrojmouzhpwzv\.supabase\.co)/storage/v1/object/public/media/[A-Za-z0-9._/?=&%-]+$'
  or photo_url ~ '^\["https://(api\.wrotate\.com|xnzweevzrojmouzhpwzv\.supabase\.co)/storage/v1/object/public/media/[A-Za-z0-9._/?=&%-]+"(,"https://(api\.wrotate\.com|xnzweevzrojmouzhpwzv\.supabase\.co)/storage/v1/object/public/media/[A-Za-z0-9._/?=&%-]+"){0,5}\]$'
) not valid;
alter table public.logs validate constraint logs_photo_url_own_hosts;
