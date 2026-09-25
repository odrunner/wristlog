-- Audit 2026-09-23 SEC-23-9 follow-up. timegrapher_tuning row 1 feeds live
-- parameters into every user's measurement (index.html reads it at start).
-- UPDATE was open to every internal_accounts member — which includes the demo
-- account (anyone can mint a demo session via demo-login) and the test
-- accounts whose password sat in this public repo. Nothing in the client,
-- scripts or edge functions writes the row, so only the admin may.
DROP POLICY IF EXISTS tuning_update_internal ON public.timegrapher_tuning;
CREATE POLICY tuning_update_admin ON public.timegrapher_tuning FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
