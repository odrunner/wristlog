-- A device token belongs to exactly one account at a time.
--
-- Problem this fixes: PushManager only deletes the token row on an explicit
-- sign-OUT. Switching accounts (very common: try the demo, then sign into your
-- own account) leaves the old row attached forever, and send-push fans out to
-- every row belonging to the recipient. A notification for the account you are
-- no longer signed into then pushes a banner to your phone about activity you
-- cannot see — you tap it, the app opens as you, and there is nothing there.
--
-- On 2026-08-01 this had 36 stale rows across 32 devices; 27 of them held the
-- read-only demo account (alexrivera / 73e4e48e-…) alongside a real user.
--
-- The trigger is SECURITY DEFINER because RLS on device_tokens scopes a user to
-- their own rows — claiming a token means deleting somebody else's row.

CREATE OR REPLACE FUNCTION public.device_tokens_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.device_tokens
   WHERE token = NEW.token
     AND user_id <> NEW.user_id;
  RETURN NEW;
END;
$$;

-- Fires on UPDATE too: the client upserts with resolution=merge-duplicates, so a
-- re-registration of an existing (user_id, token) pair lands as an UPDATE and
-- would otherwise skip the claim.
DROP TRIGGER IF EXISTS device_tokens_claim_trg ON public.device_tokens;
CREATE TRIGGER device_tokens_claim_trg
BEFORE INSERT OR UPDATE OF token, user_id ON public.device_tokens
FOR EACH ROW EXECUTE FUNCTION public.device_tokens_claim();

-- One-off purge of the rows that accumulated before the trigger existed.
-- Keeps the most recent registration per token — the account most recently
-- signed in on that device — and detaches every older one.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY token
             ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id) AS rn
    FROM public.device_tokens
)
DELETE FROM public.device_tokens d
 USING ranked r
 WHERE d.id = r.id
   AND r.rn > 1;
