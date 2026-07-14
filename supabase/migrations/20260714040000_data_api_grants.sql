-- supabase/migrations/20260714040000_data_api_grants.sql
--
-- Discovered while verifying Task 6 (shared Edge Function helpers): current
-- Supabase CLI defaults no longer auto-expose newly created public-schema
-- tables to the Data API roles (anon, authenticated, service_role) without
-- explicit GRANTs -- see the `auto_expose_new_tables` comment in
-- supabase/config.toml. RLS policies alone are not sufficient; Postgres
-- also requires table-level privileges. Without this, service_role (which
-- bypasses RLS but still needs table grants) got "permission denied" on
-- every table, which would have broken every Edge Function in Tasks 7-10.

-- service_role bypasses RLS and performs all backend reads/writes
-- (match entry, rating recalculation, audit logging, admin auth checks).
grant select, insert, update, delete on
  players, seasons, player_season_ratings, matches, weekly_rankings,
  player_statistics, admin_users, match_audit_log, rating_events
to service_role;

-- anon/authenticated: table-level SELECT only for tables with a public read
-- RLS policy (see 20260714020000_rls_policies.sql); RLS still filters rows
-- per policy in each case.
grant select on
  players, seasons, player_season_ratings, matches, weekly_rankings,
  player_statistics
to anon, authenticated;

-- admin_users: authenticated admins may read their own row only (RLS-enforced
-- by the "self read admin_users" policy). anon is intentionally excluded.
grant select on admin_users to authenticated;
