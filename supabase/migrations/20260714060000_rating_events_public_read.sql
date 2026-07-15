-- supabase/migrations/20260714060000_rating_events_public_read.sql
--
-- Cross-phase decision: Phase 2 (20260714020000_rls_policies.sql) deliberately
-- kept rating_events fully private (no public SELECT policy), grouped with
-- admin_users/match_audit_log as audit-log-style internal data. Phase 3's
-- PlayerProfile page needs to read rating_events directly as an anon user
-- (rating-history chart + per-match rating deltas) -- confirmed live via
-- Task 8: `permission denied for table rating_events` when queried with the
-- anon key. User decision: grant public SELECT, since rating_events exposes
-- no information more sensitive than what's already fully public (current
-- ratings, match scores, season points) -- it's just the detailed math
-- behind those already-public numbers, with no admin identity or other
-- sensitive fields. RLS was already enabled on rating_events in
-- 20260714020000_rls_policies.sql; this migration only adds the missing
-- SELECT policy and the corresponding Data API grant (both are required --
-- see 20260714040000_data_api_grants.sql for why table-level GRANTs are
-- necessary in addition to RLS policies).

create policy "public read rating_events" on rating_events for select using (true);

grant select on rating_events to anon, authenticated;
