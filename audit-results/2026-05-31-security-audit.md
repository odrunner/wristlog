# Security Audit — 2026-05-31

## CRITICAL (NEW): Permissive `demo_readonly_*` write policies bypass ownership RLS

**Severity:** Critical — broken access control (any authenticated user can write other users' rows).

**Discovered:** During the "delete a comment" feature work (mandatory Check-RLS step).

### What
A family of `demo_readonly_*` RLS policies, intended to make the demo account read-only,
were created as **PERMISSIVE** instead of **RESTRICTIVE**. Postgres OR's permissive policies,
so e.g. `demo_readonly_comments_delete USING (auth.uid() <> demo_uuid)` does NOT restrict the
demo account — it grants the action to **every other authenticated user**, bypassing the
ownership policies (`comments_delete USING (user_id = auth.uid())`, etc.).

The demo account is independently gated client-side by `demoGuard()`, so these DB policies
provide no real protection and only open the hole.

### Proof (live DB, rolled back)
An unrelated user (not commenter, not post owner) deleted a comment successfully:
`rows_deleted_by_stranger: 1`.

### Scope
**21 tables, 44 write policies** (DELETE / INSERT / UPDATE) carry permissive `demo_readonly_*`
policies — including `comments`, `comment_likes`, `likes`, `follows`, `friend_requests`,
`clubs`, `club_members`, `club_invites`, `club_join_requests`, `follow_requests`, and more.

### Fix (verified for comments)
Convert each `demo_readonly_*` write policy from PERMISSIVE to `AS RESTRICTIVE`. After the fix,
verified comment deletion: stranger ❌, commenter ✅, post owner ✅, demo ❌.

```sql
DROP POLICY "demo_readonly_comments_delete" ON comments;
CREATE POLICY "demo_readonly_comments_delete" ON comments
  AS RESTRICTIVE FOR DELETE USING (auth.uid() <> '<demo_uuid>'::uuid);
```

Apply the same RESTRICTIVE conversion to all 44 policies across the 21 tables. Test per table
(stranger blocked, owner allowed, demo blocked) before and after.

**Status:** FIXED 2026-05-31 — all 44 `demo_readonly_*` write policies across 21 tables converted
to RESTRICTIVE (migration `supabase/migrations/20260531_demo_readonly_restrictive.sql`, applied to
remote). Verified `permissive=0 / restrictive=44`. Live cross-user delete tests (rolled back) on
`comments`, `logs`, `likes`, `follows`: **stranger blocked, owner allowed, demo blocked** in every
case. Each (table,command) confirmed to retain a sibling permissive ownership policy, so legitimate
access is preserved.

---

## Related (this build): comment deletion authorization

Added policy `"Owner or post author can delete comments"` on `comments` (additive, permissive)
so a post owner can delete any comment on their post (Instagram/Strava model). Correct, but
masked until the demo_readonly hole above is fixed. See
`docs/superpowers/specs/2026-05-31-delete-comment-design.md`.
