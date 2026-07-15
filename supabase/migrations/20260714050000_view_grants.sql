-- supabase/migrations/20260714050000_view_grants.sql
--
-- Fixes a gap flagged during Task 6 review (see progress.md) and confirmed
-- live during the whole-branch review of the full Phase 2 branch:
-- leaderboard_view/grade_distribution_view (20260714030000_views.sql) never
-- received PostgREST grants for anon/authenticated, unlike the base tables
-- (20260714040000_data_api_grants.sql). Confirmed via a live test:
--   set role anon; select * from leaderboard_view;
--   -> ERROR 42501: permission denied for view leaderboard_view
-- (same for grade_distribution_view, same for the authenticated role).
-- Design spec section 6 says Phase 3's frontend reads these two views
-- directly via PostgREST as a public/authenticated user, so this is a real
-- in-scope gap, not a future concern. Views are a separate grantable object
-- from their underlying tables in Postgres, so granting SELECT on the base
-- tables (already done in 20260714040000) does not itself grant SELECT on
-- a view built on top of them.

grant select on leaderboard_view, grade_distribution_view to anon, authenticated;
