-- supabase/migrations/20260724010000_require_login_for_league_data.sql
--
-- Product decision: the league's data (leaderboard, grades, match history,
-- player profiles, rating history) is no longer publicly readable -- this
-- reverses the "public read" design established in
-- 20260714020000_rls_policies.sql, 20260714050000_view_grants.sql, and
-- 20260714060000_rating_events_public_read.sql. web/src/App.tsx now guards
-- these routes behind login; this migration is the real enforcement layer
-- (see CLAUDE.md: route guards are UX, RLS/grants are the security
-- boundary).
--
-- The RLS policies themselves (`using (true)`) are untouched and stay
-- correct for `authenticated`: access here is controlled entirely by the
-- table/view-level GRANTs (as it always has been for these "public read"
-- tables -- see 20260714040000_data_api_grants.sql), so revoking anon's
-- GRANTs is sufficient and no policy needs to change.
--
-- players needs its own column-level REVOKE: 20260717000000_audit_fixes.sql
-- replaced its blanket table grant with a column allowlist (to keep email
-- private), and Postgres tracks column-level ACLs (pg_attribute.attacl)
-- independently of the table-level ACL (pg_class.relacl) -- a plain
-- `revoke select on players from anon` does not touch column-level grants
-- at all, so every previously-granted column must be named explicitly.

revoke select (id, full_name, joined_date, is_active, created_at, updated_at, photo_url)
  on players from anon;

revoke select on seasons, player_season_ratings, matches, weekly_rankings, player_statistics
  from anon;

revoke select on leaderboard_view, grade_distribution_view from anon;

revoke select on rating_events from anon;
