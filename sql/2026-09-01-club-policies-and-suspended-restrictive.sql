-- Audit 2026-09-01 SEC-6 (club takeover) + the suspended-check OR-defeat class.
--
-- SEC-6: the short-named policy family (cm_*, ci_*, cjr_*, clubs_*) OR-overrode
-- the careful long-named ones:
--   * cm_insert / "Users can join clubs": any user could INSERT themselves as
--     role='owner' into ANY club (private included) — instant takeover.
--   * cm_update: tautology (club_members_1.club_id = club_members_1.club_id) →
--     "owner of any club" could update ANY membership row anywhere. The client
--     never UPDATEs club_members (promote = delete + re-insert), so the policy
--     is dropped outright rather than fixed.
--   * cm_delete: any member could kick anyone, including the owner.
--   * clubs_update: any member could rename/deface/flip privacy of any club.
--   * ci_insert / "Members can create invites": OR of the two let any
--     non-member invite, or any member forge invited_by.
--
-- Legit shapes preserved (verified against index.html):
--   * creator bootstrap: self-insert role='owner' when clubs.created_by = uid  (:10059)
--   * join public club:  self-insert role='member'                             (:10078)
--   * accept invite:     self-insert role='member' with a standing invite      (:10641)
--   * owner accepts join request: cross-user insert role='member'              (:10110)
--   * owner promotes: delete target row + re-insert role='owner' (+rollback)   (:10139-10144)
--   * self-leave / owner removes member                                        (:10091, :10160)
--
-- Suspended-check class (same OR-defeat as SEC-7): every permissive
-- "Suspended users cannot …" policy is defeated by its permissive sibling.
-- All are converted to RESTRICTIVE so they intersect. comments and logs had the
-- suspended policy as their ONLY user INSERT policy, so each gets a clean
-- own-row permissive sibling.
--
-- service_role / triggers bypass RLS — unaffected.

BEGIN;

-- ---------- helper ----------
CREATE OR REPLACE FUNCTION public.is_club_owner(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- ---------- club_members ----------
DROP POLICY "Users can join clubs" ON public.club_members;
DROP POLICY "cm_insert" ON public.club_members;
DROP POLICY "cm_update" ON public.club_members;
DROP POLICY "cm_delete" ON public.club_members;
DROP POLICY "Users can leave clubs or owners can remove" ON public.club_members;

CREATE POLICY "Members join and owners manage memberships"
  ON public.club_members FOR INSERT TO public
  WITH CHECK (
    -- self-join as plain member: public club, or a standing invite
    ( user_id = (SELECT auth.uid()) AND role = 'member' AND (
        EXISTS (SELECT 1 FROM clubs c WHERE c.id = club_members.club_id AND c.privacy = 'public')
        OR EXISTS (SELECT 1 FROM club_invites i
                   WHERE i.club_id = club_members.club_id
                     AND i.invitee_id = (SELECT auth.uid()))
      )
    )
    -- creator bootstrap: own owner row right after creating the club
    OR ( user_id = (SELECT auth.uid()) AND role = 'owner'
         AND (SELECT auth.uid()) = (SELECT c.created_by FROM clubs c WHERE c.id = club_members.club_id) )
    -- owners manage: accept join requests (member), promote (owner)
    OR is_club_owner(club_id)
  );

CREATE POLICY "Members leave and owners remove"
  ON public.club_members FOR DELETE TO public
  USING ( user_id = (SELECT auth.uid()) OR is_club_owner(club_id) );

-- ---------- clubs ----------
DROP POLICY "clubs_insert" ON public.clubs;
DROP POLICY "clubs_update" ON public.clubs;
DROP POLICY "clubs_delete" ON public.clubs;
DROP POLICY "clubs_select" ON public.clubs;
DROP POLICY "Club owners can update clubs" ON public.clubs;
DROP POLICY "Suspended users cannot create clubs" ON public.clubs;

CREATE POLICY "Club owners can update clubs"
  ON public.clubs FOR UPDATE TO public
  USING ( created_by = (SELECT auth.uid()) OR is_club_owner(id) )
  WITH CHECK ( created_by = (SELECT auth.uid()) OR is_club_owner(id) );

CREATE POLICY "Suspended users cannot create clubs"
  ON public.clubs AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM profiles
                WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true)
  );

-- ---------- club_invites ----------
DROP POLICY "Members can create invites" ON public.club_invites;
DROP POLICY "ci_insert" ON public.club_invites;
DROP POLICY "ci_delete" ON public.club_invites;
DROP POLICY "Users can delete own invites" ON public.club_invites;

CREATE POLICY "Members can create invites"
  ON public.club_invites FOR INSERT TO public
  WITH CHECK ( invited_by = (SELECT auth.uid()) AND is_club_member(club_id) );

CREATE POLICY "Invitee, inviter or owner can delete invites"
  ON public.club_invites FOR DELETE TO public
  USING ( invitee_id = (SELECT auth.uid())
          OR invited_by = (SELECT auth.uid())
          OR is_club_owner(club_id) );

-- ---------- club_join_requests ----------
DROP POLICY "cjr_insert" ON public.club_join_requests;
DROP POLICY "cjr_delete" ON public.club_join_requests;
DROP POLICY "cjr_select" ON public.club_join_requests;
DROP POLICY "Suspended users cannot join clubs" ON public.club_join_requests;

CREATE POLICY "Suspended users cannot join clubs"
  ON public.club_join_requests AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM profiles
                WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true)
  );

-- ---------- suspended-check conversions on the remaining tables ----------
DROP POLICY "Suspended users cannot insert comment_likes" ON public.comment_likes;
CREATE POLICY "Suspended users cannot insert comment_likes"
  ON public.comment_likes AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

DROP POLICY "Suspended users cannot insert comments" ON public.comments;
CREATE POLICY "Users can insert own comments"
  ON public.comments FOR INSERT TO public
  WITH CHECK ( user_id = (SELECT auth.uid()) );
CREATE POLICY "Suspended users cannot insert comments"
  ON public.comments AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

DROP POLICY "Suspended users cannot insert follow_requests" ON public.follow_requests;
CREATE POLICY "Suspended users cannot insert follow_requests"
  ON public.follow_requests AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

DROP POLICY "Suspended users cannot insert follows" ON public.follows;
CREATE POLICY "Suspended users cannot insert follows"
  ON public.follows AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

DROP POLICY "Suspended users cannot insert friend_requests" ON public.friend_requests;
CREATE POLICY "Suspended users cannot insert friend_requests"
  ON public.friend_requests AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

DROP POLICY "Suspended users cannot insert likes" ON public.likes;
CREATE POLICY "Suspended users cannot insert likes"
  ON public.likes AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

DROP POLICY "Suspended users cannot insert logs" ON public.logs;
CREATE POLICY "Users can insert own logs"
  ON public.logs FOR INSERT TO public
  WITH CHECK ( user_id = (SELECT auth.uid()) );
CREATE POLICY "Suspended users cannot insert logs"
  ON public.logs AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (NOT EXISTS (SELECT 1 FROM profiles
              WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_suspended = true));

COMMIT;
