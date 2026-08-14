-- ROLLBACK for audit P2 (the ( SELECT auth.uid() ) rewrite).
-- Captured from pg_policies immediately before applying, 2026-08-13.
-- Restores all 192 policies to calling auth.uid() bare.


-- app_feedback
BEGIN;
DROP POLICY IF EXISTS "Users can insert own feedback" ON public.app_feedback;
CREATE POLICY "Users can insert own feedback" ON public.app_feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own feedback" ON public.app_feedback;
CREATE POLICY "Users can read own feedback" ON public.app_feedback AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
COMMIT;

-- club_invites
BEGIN;
DROP POLICY IF EXISTS "Members can create invites" ON public.club_invites;
CREATE POLICY "Members can create invites" ON public.club_invites AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = invited_by));

DROP POLICY IF EXISTS "Relevant users can read invites" ON public.club_invites;
CREATE POLICY "Relevant users can read invites" ON public.club_invites AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = invitee_id) OR (auth.uid() = invited_by)));

DROP POLICY IF EXISTS "Users can delete own invites" ON public.club_invites;
CREATE POLICY "Users can delete own invites" ON public.club_invites AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = invitee_id) OR (auth.uid() = invited_by)));

DROP POLICY IF EXISTS "ci_delete" ON public.club_invites;
CREATE POLICY "ci_delete" ON public.club_invites AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = invitee_id) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "ci_select" ON public.club_invites;
CREATE POLICY "ci_select" ON public.club_invites AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = invitee_id) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "demo_readonly_club_invites_delete" ON public.club_invites;
CREATE POLICY "demo_readonly_club_invites_delete" ON public.club_invites AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_club_invites_insert" ON public.club_invites;
CREATE POLICY "demo_readonly_club_invites_insert" ON public.club_invites AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- club_join_requests
BEGIN;
DROP POLICY IF EXISTS "Relevant users can read join requests" ON public.club_join_requests;
CREATE POLICY "Relevant users can read join requests" ON public.club_join_requests AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR (auth.uid() IN ( SELECT cm.user_id
   FROM club_members cm
  WHERE ((cm.club_id = club_join_requests.club_id) AND (cm.role = 'owner'::text))))));

DROP POLICY IF EXISTS "Suspended users cannot join clubs" ON public.club_join_requests;
CREATE POLICY "Suspended users cannot join clubs" ON public.club_join_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can create join requests" ON public.club_join_requests;
CREATE POLICY "Users can create join requests" ON public.club_join_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users or owners can delete join requests" ON public.club_join_requests;
CREATE POLICY "Users or owners can delete join requests" ON public.club_join_requests AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) OR (auth.uid() IN ( SELECT cm.user_id
   FROM club_members cm
  WHERE ((cm.club_id = club_join_requests.club_id) AND (cm.role = 'owner'::text))))));

DROP POLICY IF EXISTS "cjr_delete" ON public.club_join_requests;
CREATE POLICY "cjr_delete" ON public.club_join_requests AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "cjr_insert" ON public.club_join_requests;
CREATE POLICY "cjr_insert" ON public.club_join_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "cjr_select" ON public.club_join_requests;
CREATE POLICY "cjr_select" ON public.club_join_requests AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "demo_readonly_club_join_requests_delete" ON public.club_join_requests;
CREATE POLICY "demo_readonly_club_join_requests_delete" ON public.club_join_requests AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_club_join_requests_insert" ON public.club_join_requests;
CREATE POLICY "demo_readonly_club_join_requests_insert" ON public.club_join_requests AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- club_members
BEGIN;
DROP POLICY IF EXISTS "Users can join clubs" ON public.club_members;
CREATE POLICY "Users can join clubs" ON public.club_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) OR (auth.uid() IN ( SELECT c.created_by
   FROM clubs c
  WHERE (c.id = club_members.club_id)))));

DROP POLICY IF EXISTS "Users can leave clubs or owners can remove" ON public.club_members;
CREATE POLICY "Users can leave clubs or owners can remove" ON public.club_members AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) OR (auth.uid() IN ( SELECT c.created_by
   FROM clubs c
  WHERE (c.id = club_members.club_id)))));

DROP POLICY IF EXISTS "cm_delete" ON public.club_members;
CREATE POLICY "cm_delete" ON public.club_members AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "cm_insert" ON public.club_members;
CREATE POLICY "cm_insert" ON public.club_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "cm_select" ON public.club_members;
CREATE POLICY "cm_select" ON public.club_members AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM clubs
  WHERE ((clubs.id = club_members.club_id) AND (clubs.privacy = 'public'::text)))) OR is_club_member(club_id)));

DROP POLICY IF EXISTS "cm_update" ON public.club_members;
CREATE POLICY "cm_update" ON public.club_members AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM club_members club_members_1
  WHERE ((club_members_1.club_id = club_members_1.club_id) AND (club_members_1.user_id = auth.uid()) AND (club_members_1.role = 'owner'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM club_members club_members_1
  WHERE ((club_members_1.club_id = club_members_1.club_id) AND (club_members_1.user_id = auth.uid()) AND (club_members_1.role = 'owner'::text)))));

DROP POLICY IF EXISTS "demo_readonly_club_members_delete" ON public.club_members;
CREATE POLICY "demo_readonly_club_members_delete" ON public.club_members AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_club_members_insert" ON public.club_members;
CREATE POLICY "demo_readonly_club_members_insert" ON public.club_members AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- clubs
BEGIN;
DROP POLICY IF EXISTS "Authenticated users can create clubs" ON public.clubs;
CREATE POLICY "Authenticated users can create clubs" ON public.clubs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = created_by));

DROP POLICY IF EXISTS "Club owners can delete clubs" ON public.clubs;
CREATE POLICY "Club owners can delete clubs" ON public.clubs AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "Club owners can update clubs" ON public.clubs;
CREATE POLICY "Club owners can update clubs" ON public.clubs AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "Suspended users cannot create clubs" ON public.clubs;
CREATE POLICY "Suspended users cannot create clubs" ON public.clubs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = created_by) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "clubs_delete" ON public.clubs;
CREATE POLICY "clubs_delete" ON public.clubs AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = created_by));

DROP POLICY IF EXISTS "clubs_insert" ON public.clubs;
CREATE POLICY "clubs_insert" ON public.clubs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = created_by));

DROP POLICY IF EXISTS "clubs_select" ON public.clubs;
CREATE POLICY "clubs_select" ON public.clubs AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "demo_readonly_clubs_delete" ON public.clubs;
CREATE POLICY "demo_readonly_clubs_delete" ON public.clubs AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_clubs_insert" ON public.clubs;
CREATE POLICY "demo_readonly_clubs_insert" ON public.clubs AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_clubs_update" ON public.clubs;
CREATE POLICY "demo_readonly_clubs_update" ON public.clubs AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- comment_likes
BEGIN;
DROP POLICY IF EXISTS "Suspended users cannot insert comment_likes" ON public.comment_likes;
CREATE POLICY "Suspended users cannot insert comment_likes" ON public.comment_likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can delete own comment likes" ON public.comment_likes;
CREATE POLICY "Users can delete own comment likes" ON public.comment_likes AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own comment likes" ON public.comment_likes;
CREATE POLICY "Users can insert own comment likes" ON public.comment_likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "demo_readonly_comment_likes_delete" ON public.comment_likes;
CREATE POLICY "demo_readonly_comment_likes_delete" ON public.comment_likes AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_comment_likes_insert" ON public.comment_likes;
CREATE POLICY "demo_readonly_comment_likes_insert" ON public.comment_likes AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- comments
BEGIN;
DROP POLICY IF EXISTS "Anyone can read comments" ON public.comments;
CREATE POLICY "Anyone can read comments" ON public.comments AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR (moderation_status IS NULL)));

DROP POLICY IF EXISTS "Owner or post author can delete comments" ON public.comments;
CREATE POLICY "Owner or post author can delete comments" ON public.comments AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) OR (auth.uid() = ( SELECT logs.user_id
   FROM logs
  WHERE (logs.id = comments.log_id)))));

DROP POLICY IF EXISTS "Reporter can flag comments" ON public.comments;
CREATE POLICY "Reporter can flag comments" ON public.comments AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() IS NOT NULL) AND (auth.uid() <> user_id)))
  WITH CHECK ((moderation_status = 'flagged'::text));

DROP POLICY IF EXISTS "Suspended users cannot insert comments" ON public.comments;
CREATE POLICY "Suspended users cannot insert comments" ON public.comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
CREATE POLICY "Users can delete own comments" ON public.comments AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own comments" ON public.comments;
CREATE POLICY "Users can update own comments" ON public.comments AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "comments_delete" ON public.comments;
CREATE POLICY "comments_delete" ON public.comments AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "demo_readonly_comments_delete" ON public.comments;
CREATE POLICY "demo_readonly_comments_delete" ON public.comments AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_comments_insert" ON public.comments;
CREATE POLICY "demo_readonly_comments_insert" ON public.comments AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- content_reports
BEGIN;
DROP POLICY IF EXISTS "Users can read own reports" ON public.content_reports;
CREATE POLICY "Users can read own reports" ON public.content_reports AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = reporter_id));

DROP POLICY IF EXISTS "Users can report content" ON public.content_reports;
CREATE POLICY "Users can report content" ON public.content_reports AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = reporter_id));

DROP POLICY IF EXISTS "demo_readonly_content_reports_insert" ON public.content_reports;
CREATE POLICY "demo_readonly_content_reports_insert" ON public.content_reports AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- deep_test_chunks
BEGIN;
DROP POLICY IF EXISTS "dtc_owner" ON public.deep_test_chunks;
CREATE POLICY "dtc_owner" ON public.deep_test_chunks AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
COMMIT;

-- device_tokens
BEGIN;
DROP POLICY IF EXISTS "Users can manage own tokens" ON public.device_tokens;
CREATE POLICY "Users can manage own tokens" ON public.device_tokens AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_device_tokens_insert" ON public.device_tokens;
CREATE POLICY "demo_readonly_device_tokens_insert" ON public.device_tokens AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_device_tokens_update" ON public.device_tokens;
CREATE POLICY "demo_readonly_device_tokens_update" ON public.device_tokens AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- email_campaign_sends
BEGIN;
DROP POLICY IF EXISTS "Admin full access" ON public.email_campaign_sends;
CREATE POLICY "Admin full access" ON public.email_campaign_sends AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));
COMMIT;

-- email_campaigns
BEGIN;
DROP POLICY IF EXISTS "Admin full access" ON public.email_campaigns;
CREATE POLICY "Admin full access" ON public.email_campaigns AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));
COMMIT;

-- eula_acceptances
BEGIN;
DROP POLICY IF EXISTS "Users can insert own eula" ON public.eula_acceptances;
CREATE POLICY "Users can insert own eula" ON public.eula_acceptances AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own eula" ON public.eula_acceptances;
CREATE POLICY "Users can read own eula" ON public.eula_acceptances AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_eula_insert" ON public.eula_acceptances;
CREATE POLICY "demo_readonly_eula_insert" ON public.eula_acceptances AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- fact_clicks
BEGIN;
DROP POLICY IF EXISTS "fact_clicks_insert_own" ON public.fact_clicks;
CREATE POLICY "fact_clicks_insert_own" ON public.fact_clicks AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- fact_impressions
BEGIN;
DROP POLICY IF EXISTS "fact_impressions_insert_own" ON public.fact_impressions;
CREATE POLICY "fact_impressions_insert_own" ON public.fact_impressions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- feedback
BEGIN;
DROP POLICY IF EXISTS "Users can delete own feedback" ON public.feedback;
CREATE POLICY "Users can delete own feedback" ON public.feedback AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert feedback" ON public.feedback;
CREATE POLICY "Users can insert feedback" ON public.feedback AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "admin_read_feedback" ON public.feedback;
CREATE POLICY "admin_read_feedback" ON public.feedback AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));

DROP POLICY IF EXISTS "admin_update_feedback" ON public.feedback;
CREATE POLICY "admin_update_feedback" ON public.feedback AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));

DROP POLICY IF EXISTS "demo_readonly_feedback_insert" ON public.feedback;
CREATE POLICY "demo_readonly_feedback_insert" ON public.feedback AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- follow_requests
BEGIN;
DROP POLICY IF EXISTS "Suspended users cannot insert follow_requests" ON public.follow_requests;
CREATE POLICY "Suspended users cannot insert follow_requests" ON public.follow_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = requester_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can create follow requests" ON public.follow_requests;
CREATE POLICY "Users can create follow requests" ON public.follow_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = requester_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can delete own follow requests" ON public.follow_requests;
CREATE POLICY "Users can delete own follow requests" ON public.follow_requests AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = requester_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "Users can see own follow requests" ON public.follow_requests;
CREATE POLICY "Users can see own follow requests" ON public.follow_requests AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = requester_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "delete_own_requests" ON public.follow_requests;
CREATE POLICY "delete_own_requests" ON public.follow_requests AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = requester_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "demo_readonly_follow_requests_delete" ON public.follow_requests;
CREATE POLICY "demo_readonly_follow_requests_delete" ON public.follow_requests AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_follow_requests_insert" ON public.follow_requests;
CREATE POLICY "demo_readonly_follow_requests_insert" ON public.follow_requests AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "view_own_requests" ON public.follow_requests;
CREATE POLICY "view_own_requests" ON public.follow_requests AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = requester_id) OR (auth.uid() = target_id)));
COMMIT;

-- follows
BEGIN;
DROP POLICY IF EXISTS "Suspended users cannot insert follows" ON public.follows;
CREATE POLICY "Suspended users cannot insert follows" ON public.follows AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = follower_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can follow others" ON public.follows;
CREATE POLICY "Users can follow others" ON public.follows AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((auth.uid() = follower_id) OR (auth.uid() = following_id)) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can unfollow" ON public.follows;
CREATE POLICY "Users can unfollow" ON public.follows AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = follower_id));

DROP POLICY IF EXISTS "demo_readonly_follows_delete" ON public.follows;
CREATE POLICY "demo_readonly_follows_delete" ON public.follows AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_follows_insert" ON public.follows;
CREATE POLICY "demo_readonly_follows_insert" ON public.follows AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "follows_delete" ON public.follows;
CREATE POLICY "follows_delete" ON public.follows AS PERMISSIVE FOR DELETE TO public
  USING (((follower_id = auth.uid()) OR (following_id = auth.uid())));

DROP POLICY IF EXISTS "users_can_view_own_followers" ON public.follows;
CREATE POLICY "users_can_view_own_followers" ON public.follows AS PERMISSIVE FOR SELECT TO public
  USING (((following_id = auth.uid()) OR (follower_id = auth.uid())));
COMMIT;

-- friend_requests
BEGIN;
DROP POLICY IF EXISTS "Suspended users cannot insert friend_requests" ON public.friend_requests;
CREATE POLICY "Suspended users cannot insert friend_requests" ON public.friend_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = initiator_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can create friend requests" ON public.friend_requests;
CREATE POLICY "Users can create friend requests" ON public.friend_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = initiator_id));

DROP POLICY IF EXISTS "Users can delete own friend requests" ON public.friend_requests;
CREATE POLICY "Users can delete own friend requests" ON public.friend_requests AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = initiator_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "Users can see own friend requests" ON public.friend_requests;
CREATE POLICY "Users can see own friend requests" ON public.friend_requests AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = initiator_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "Users can update own friend requests" ON public.friend_requests;
CREATE POLICY "Users can update own friend requests" ON public.friend_requests AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() = initiator_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "demo_readonly_friend_requests_delete" ON public.friend_requests;
CREATE POLICY "demo_readonly_friend_requests_delete" ON public.friend_requests AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_friend_requests_insert" ON public.friend_requests;
CREATE POLICY "demo_readonly_friend_requests_insert" ON public.friend_requests AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_friend_requests_update" ON public.friend_requests;
CREATE POLICY "demo_readonly_friend_requests_update" ON public.friend_requests AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "fr_delete" ON public.friend_requests;
CREATE POLICY "fr_delete" ON public.friend_requests AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = initiator_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "fr_insert" ON public.friend_requests;
CREATE POLICY "fr_insert" ON public.friend_requests AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = initiator_id));

DROP POLICY IF EXISTS "fr_select" ON public.friend_requests;
CREATE POLICY "fr_select" ON public.friend_requests AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = initiator_id) OR (auth.uid() = target_id)));

DROP POLICY IF EXISTS "fr_update" ON public.friend_requests;
CREATE POLICY "fr_update" ON public.friend_requests AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() = initiator_id) OR (auth.uid() = target_id)));
COMMIT;

-- identify_attempts
BEGIN;
DROP POLICY IF EXISTS "Users can read their own identify attempts" ON public.identify_attempts;
CREATE POLICY "Users can read their own identify attempts" ON public.identify_attempts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
COMMIT;

-- likes
BEGIN;
DROP POLICY IF EXISTS "Suspended users cannot insert likes" ON public.likes;
CREATE POLICY "Suspended users cannot insert likes" ON public.likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can delete own likes" ON public.likes;
CREATE POLICY "Users can delete own likes" ON public.likes AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own likes" ON public.likes;
CREATE POLICY "Users can insert own likes" ON public.likes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "demo_readonly_likes_delete" ON public.likes;
CREATE POLICY "demo_readonly_likes_delete" ON public.likes AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_likes_insert" ON public.likes;
CREATE POLICY "demo_readonly_likes_insert" ON public.likes AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "likes_delete" ON public.likes;
CREATE POLICY "likes_delete" ON public.likes AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));
COMMIT;

-- logs
BEGIN;
DROP POLICY IF EXISTS "Others can read shared logs" ON public.logs;
CREATE POLICY "Others can read shared logs" ON public.logs AS PERMISSIVE FOR SELECT TO public
  USING (((moderation_status IS NULL) AND ((visibility = 'public'::text) OR ((visibility = 'followers'::text) AND (EXISTS ( SELECT 1
   FROM follows
  WHERE ((follows.follower_id = auth.uid()) AND (follows.following_id = logs.user_id))))) OR ((visibility = 'friends'::text) AND (EXISTS ( SELECT 1
   FROM friend_requests
  WHERE ((friend_requests.status = 'accepted'::text) AND (((friend_requests.initiator_id = auth.uid()) AND (friend_requests.target_id = logs.user_id)) OR ((friend_requests.target_id = auth.uid()) AND (friend_requests.initiator_id = logs.user_id))))))) OR ((visibility IS NULL) AND (EXISTS ( SELECT 1
   FROM follows
  WHERE ((follows.follower_id = auth.uid()) AND (follows.following_id = logs.user_id))))) OR ((club_id IS NOT NULL) AND (visibility IS DISTINCT FROM 'private'::text) AND (EXISTS ( SELECT 1
   FROM club_members
  WHERE ((club_members.club_id = logs.club_id) AND (club_members.user_id = auth.uid()))))))));

DROP POLICY IF EXISTS "Reporter can flag logs" ON public.logs;
CREATE POLICY "Reporter can flag logs" ON public.logs AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() IS NOT NULL) AND (auth.uid() <> user_id)))
  WITH CHECK ((moderation_status = 'flagged'::text));

DROP POLICY IF EXISTS "Suspended users cannot insert logs" ON public.logs;
CREATE POLICY "Suspended users cannot insert logs" ON public.logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can delete own logs" ON public.logs;
CREATE POLICY "Users can delete own logs" ON public.logs AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own logs" ON public.logs;
CREATE POLICY "Users can read own logs" ON public.logs AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own logs" ON public.logs;
CREATE POLICY "Users can update own logs" ON public.logs AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_logs_delete" ON public.logs;
CREATE POLICY "demo_readonly_logs_delete" ON public.logs AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_logs_insert" ON public.logs;
CREATE POLICY "demo_readonly_logs_insert" ON public.logs AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_logs_update" ON public.logs;
CREATE POLICY "demo_readonly_logs_update" ON public.logs AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "logs_delete" ON public.logs;
CREATE POLICY "logs_delete" ON public.logs AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "logs_own" ON public.logs;
CREATE POLICY "logs_own" ON public.logs AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "logs_update" ON public.logs;
CREATE POLICY "logs_update" ON public.logs AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = auth.uid()));
COMMIT;

-- measurement_batch_runs
BEGIN;
DROP POLICY IF EXISTS "mbr_admin_all" ON public.measurement_batch_runs;
CREATE POLICY "mbr_admin_all" ON public.measurement_batch_runs AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid))
  WITH CHECK ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));
COMMIT;

-- notifications
BEGIN;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;
CREATE POLICY "Authenticated users can insert notifications" ON public.notifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "Suspended users cannot insert notifications" ON public.notifications;
CREATE POLICY "Suspended users cannot insert notifications" ON public.notifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = actor_id) AND (NOT (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_suspended = true)))))));

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert notifications they send" ON public.notifications;
CREATE POLICY "Users can insert notifications they send" ON public.notifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((actor_id = auth.uid()));

DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_notifications_insert" ON public.notifications;
CREATE POLICY "demo_readonly_notifications_insert" ON public.notifications AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_notifications_update" ON public.notifications;
CREATE POLICY "demo_readonly_notifications_update" ON public.notifications AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "notif_delete" ON public.notifications;
CREATE POLICY "notif_delete" ON public.notifications AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "notif_select" ON public.notifications;
CREATE POLICY "notif_select" ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "notif_update" ON public.notifications;
CREATE POLICY "notif_update" ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
CREATE POLICY "notifications_delete" ON public.notifications AS PERMISSIVE FOR DELETE TO public
  USING (((user_id = auth.uid()) OR (actor_id = auth.uid())));
COMMIT;

-- page_visits
BEGIN;
DROP POLICY IF EXISTS "Admin can read page visits" ON public.page_visits;
CREATE POLICY "Admin can read page visits" ON public.page_visits AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));

DROP POLICY IF EXISTS "Users can backfill own visit" ON public.page_visits;
CREATE POLICY "Users can backfill own visit" ON public.page_visits AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id IS NULL))
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- post_cta_events
BEGIN;
DROP POLICY IF EXISTS "admin reads post_cta_events" ON public.post_cta_events;
CREATE POLICY "admin reads post_cta_events" ON public.post_cta_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = 'd70b1a85-4f31-4431-b3b7-db76543daaf5'::uuid));

DROP POLICY IF EXISTS "users insert own post_cta_events" ON public.post_cta_events;
CREATE POLICY "users insert own post_cta_events" ON public.post_cta_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));
COMMIT;

-- profiles
BEGIN;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = id));

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id));

DROP POLICY IF EXISTS "demo_readonly_profiles_update" ON public.profiles;
CREATE POLICY "demo_readonly_profiles_update" ON public.profiles AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles AS PERMISSIVE FOR DELETE TO public
  USING ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));
COMMIT;

-- promo_events
BEGIN;
DROP POLICY IF EXISTS "promo_events_insert_own" ON public.promo_events;
CREATE POLICY "promo_events_insert_own" ON public.promo_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "promo_events_select_own" ON public.promo_events;
CREATE POLICY "promo_events_select_own" ON public.promo_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
COMMIT;

-- recap_shares
BEGIN;
DROP POLICY IF EXISTS "recap_shares_delete_own" ON public.recap_shares;
CREATE POLICY "recap_shares_delete_own" ON public.recap_shares AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "recap_shares_insert_own" ON public.recap_shares;
CREATE POLICY "recap_shares_insert_own" ON public.recap_shares AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "recap_shares_select_own" ON public.recap_shares;
CREATE POLICY "recap_shares_select_own" ON public.recap_shares AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
COMMIT;

-- review_prompt_events
BEGIN;
DROP POLICY IF EXISTS "Users insert their own prompt events" ON public.review_prompt_events;
CREATE POLICY "Users insert their own prompt events" ON public.review_prompt_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users read their own prompt events" ON public.review_prompt_events;
CREATE POLICY "Users read their own prompt events" ON public.review_prompt_events AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
COMMIT;

-- timegrapher_debug_logs
BEGIN;
DROP POLICY IF EXISTS "Users can insert own logs" ON public.timegrapher_debug_logs;
CREATE POLICY "Users can insert own logs" ON public.timegrapher_debug_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own logs" ON public.timegrapher_debug_logs;
CREATE POLICY "Users can read own logs" ON public.timegrapher_debug_logs AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
COMMIT;

-- timegrapher_results
BEGIN;
DROP POLICY IF EXISTS "Users can delete own results" ON public.timegrapher_results;
CREATE POLICY "Users can delete own results" ON public.timegrapher_results AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own results" ON public.timegrapher_results;
CREATE POLICY "Users can insert own results" ON public.timegrapher_results AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own results" ON public.timegrapher_results;
CREATE POLICY "Users can read own results" ON public.timegrapher_results AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own results" ON public.timegrapher_results;
CREATE POLICY "Users can update own results" ON public.timegrapher_results AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_tg_delete" ON public.timegrapher_results;
CREATE POLICY "demo_readonly_tg_delete" ON public.timegrapher_results AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_tg_insert" ON public.timegrapher_results;
CREATE POLICY "demo_readonly_tg_insert" ON public.timegrapher_results AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_tg_update" ON public.timegrapher_results;
CREATE POLICY "demo_readonly_tg_update" ON public.timegrapher_results AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- timegrapher_tuning
BEGIN;
DROP POLICY IF EXISTS "tuning_update_internal" ON public.timegrapher_tuning;
CREATE POLICY "tuning_update_internal" ON public.timegrapher_tuning AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM internal_accounts ia
  WHERE (ia.user_id = auth.uid()))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM internal_accounts ia
  WHERE (ia.user_id = auth.uid()))));
COMMIT;

-- user_badges
BEGIN;
DROP POLICY IF EXISTS "Users can insert own badges" ON public.user_badges;
CREATE POLICY "Users can insert own badges" ON public.user_badges AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own badges" ON public.user_badges;
CREATE POLICY "Users can read own badges" ON public.user_badges AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own badges" ON public.user_badges;
CREATE POLICY "Users can update own badges" ON public.user_badges AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
COMMIT;

-- user_blocks
BEGIN;
DROP POLICY IF EXISTS "Users can block others" ON public.user_blocks;
CREATE POLICY "Users can block others" ON public.user_blocks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = blocker_id));

DROP POLICY IF EXISTS "Users can read own blocks" ON public.user_blocks;
CREATE POLICY "Users can read own blocks" ON public.user_blocks AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = blocker_id));

DROP POLICY IF EXISTS "Users can unblock" ON public.user_blocks;
CREATE POLICY "Users can unblock" ON public.user_blocks AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = blocker_id));

DROP POLICY IF EXISTS "demo_readonly_user_blocks_delete" ON public.user_blocks;
CREATE POLICY "demo_readonly_user_blocks_delete" ON public.user_blocks AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_user_blocks_insert" ON public.user_blocks;
CREATE POLICY "demo_readonly_user_blocks_insert" ON public.user_blocks AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));
COMMIT;

-- valuation_events
BEGIN;
DROP POLICY IF EXISTS "Users can insert own valuation events" ON public.valuation_events;
CREATE POLICY "Users can insert own valuation events" ON public.valuation_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own valuation events" ON public.valuation_events;
CREATE POLICY "Users can read own valuation events" ON public.valuation_events AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
COMMIT;

-- watch_fact_days
BEGIN;
DROP POLICY IF EXISTS "watch_fact_days_own" ON public.watch_fact_days;
CREATE POLICY "watch_fact_days_own" ON public.watch_fact_days AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- watch_fact_progress
BEGIN;
DROP POLICY IF EXISTS "watch_fact_progress_own" ON public.watch_fact_progress;
CREATE POLICY "watch_fact_progress_own" ON public.watch_fact_progress AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- watches
BEGIN;
DROP POLICY IF EXISTS "Others can read shared watches" ON public.watches;
CREATE POLICY "Others can read shared watches" ON public.watches AS PERMISSIVE FOR SELECT TO public
  USING (((watch_privacy = 'public'::text) OR (watch_privacy IS NULL) OR ((watch_privacy = 'followers'::text) AND (EXISTS ( SELECT 1
   FROM follows
  WHERE ((follows.follower_id = auth.uid()) AND (follows.following_id = watches.user_id))))) OR ((watch_privacy = 'friends'::text) AND (EXISTS ( SELECT 1
   FROM friend_requests
  WHERE ((friend_requests.status = 'accepted'::text) AND (((friend_requests.initiator_id = auth.uid()) AND (friend_requests.target_id = watches.user_id)) OR ((friend_requests.target_id = auth.uid()) AND (friend_requests.initiator_id = watches.user_id)))))))));

DROP POLICY IF EXISTS "Users can delete own watches" ON public.watches;
CREATE POLICY "Users can delete own watches" ON public.watches AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own watches" ON public.watches;
CREATE POLICY "Users can insert own watches" ON public.watches AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own watches" ON public.watches;
CREATE POLICY "Users can read own watches" ON public.watches AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own watches" ON public.watches;
CREATE POLICY "Users can update own watches" ON public.watches AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_watches_delete" ON public.watches;
CREATE POLICY "demo_readonly_watches_delete" ON public.watches AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_watches_insert" ON public.watches;
CREATE POLICY "demo_readonly_watches_insert" ON public.watches AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_watches_update" ON public.watches;
CREATE POLICY "demo_readonly_watches_update" ON public.watches AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "watches_own" ON public.watches;
CREATE POLICY "watches_own" ON public.watches AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- wishlist
BEGIN;
DROP POLICY IF EXISTS "Others can read shared wishlist" ON public.wishlist;
CREATE POLICY "Others can read shared wishlist" ON public.wishlist AS PERMISSIVE FOR SELECT TO public
  USING (((wish_privacy = 'public'::text) OR (wish_privacy IS NULL) OR ((wish_privacy = 'followers'::text) AND (EXISTS ( SELECT 1
   FROM follows
  WHERE ((follows.follower_id = auth.uid()) AND (follows.following_id = wishlist.user_id))))) OR ((wish_privacy = 'friends'::text) AND (EXISTS ( SELECT 1
   FROM friend_requests
  WHERE ((friend_requests.status = 'accepted'::text) AND (((friend_requests.initiator_id = auth.uid()) AND (friend_requests.target_id = wishlist.user_id)) OR ((friend_requests.target_id = auth.uid()) AND (friend_requests.initiator_id = wishlist.user_id)))))))));

DROP POLICY IF EXISTS "Read public and friends wishlists" ON public.wishlist;
CREATE POLICY "Read public and friends wishlists" ON public.wishlist AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = wishlist.user_id) AND (p.wishlist_visibility = ANY (ARRAY['public'::text, 'friends_only'::text])))))));

DROP POLICY IF EXISTS "Users can delete own wishlist" ON public.wishlist;
CREATE POLICY "Users can delete own wishlist" ON public.wishlist AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own wishlist" ON public.wishlist;
CREATE POLICY "Users can insert own wishlist" ON public.wishlist AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own wishlist" ON public.wishlist;
CREATE POLICY "Users can read own wishlist" ON public.wishlist AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own wishlist" ON public.wishlist;
CREATE POLICY "Users can update own wishlist" ON public.wishlist AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "demo_readonly_wishlist_delete" ON public.wishlist;
CREATE POLICY "demo_readonly_wishlist_delete" ON public.wishlist AS RESTRICTIVE FOR DELETE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_wishlist_insert" ON public.wishlist;
CREATE POLICY "demo_readonly_wishlist_insert" ON public.wishlist AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "demo_readonly_wishlist_update" ON public.wishlist;
CREATE POLICY "demo_readonly_wishlist_update" ON public.wishlist AS RESTRICTIVE FOR UPDATE TO public
  USING ((auth.uid() <> '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'::uuid));

DROP POLICY IF EXISTS "wishlist_own" ON public.wishlist;
CREATE POLICY "wishlist_own" ON public.wishlist AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
COMMIT;

-- wishlist_shares
BEGIN;
DROP POLICY IF EXISTS "wishlist_shares_delete_own" ON public.wishlist_shares;
CREATE POLICY "wishlist_shares_delete_own" ON public.wishlist_shares AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "wishlist_shares_insert_own" ON public.wishlist_shares;
CREATE POLICY "wishlist_shares_insert_own" ON public.wishlist_shares AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "wishlist_shares_select_own" ON public.wishlist_shares;
CREATE POLICY "wishlist_shares_select_own" ON public.wishlist_shares AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "wishlist_shares_update_own" ON public.wishlist_shares;
CREATE POLICY "wishlist_shares_update_own" ON public.wishlist_shares AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
COMMIT;
