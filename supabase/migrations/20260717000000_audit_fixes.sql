-- supabase/migrations/20260717000000_audit_fixes.sql
--
-- Fixes from the 2026-07-16 production-readiness audit that belong at the
-- database layer. See docs/superpowers/plans/2026-07-17-audit-fixes-backend-data-integrity.md.

-- ---------------------------------------------------------------------
-- Critical: players.email was publicly readable by anon via the blanket
-- table grant in 20260714040000_data_api_grants.sql. leaderboard_view was
-- deliberately built to expose only id/full_name, showing the intent was
-- always to keep contact details private -- the raw table grant defeated
-- that. Column-level grants keep the existing /rest/v1/players endpoint
-- and shape (frontend code is unaffected) while dropping email from the
-- public response. Chosen over a new view because no other change is
-- needed anywhere else in the app.
-- ---------------------------------------------------------------------
revoke select on players from anon, authenticated;
grant select (id, full_name, joined_date, is_active, created_at, updated_at)
  on players to anon, authenticated;

-- ---------------------------------------------------------------------
-- Minor: matches.entered_by (an admin_users id) is publicly readable via
-- the blanket table grant, letting anyone enumerate admin ids. DEVIATION
-- FROM THE PLAN: the plan called for the same column-grant treatment
-- used for players.email above (revoke table select, re-grant every
-- column except entered_by). That was written and applied locally, then
-- reverted after verification (Task 2 Step 2) showed it breaks real,
-- currently-shipping frontend behavior:
--
--   * web/src/hooks/useMatchHistory.ts, useOpenMatches.ts, and
--     usePlayerProfile.ts all query matches with
--     `select('*, player_a:player_a_id(...), player_b:player_b_id(...)')`.
--   * PostgREST (confirmed live against this stack, v14.14) does not
--     auto-narrow a `select=*` (or omitted select) request to only the
--     columns a role has been granted -- it resolves `*` to every column
--     the schema cache knows about regardless of grantee, and Postgres
--     then rejects the whole request with `42501 permission denied for
--     table matches` the moment ANY one of those columns lacks a grant
--     for the requesting role. This reproduced identically for
--     players.email first (confirming the mechanism), then for
--     matches.entered_by against the exact three frontend call sites
--     above -- verified with curl against a fresh (post-restart) schema
--     cache, not a caching artifact.
--   * players.email has no such conflict because every players query in
--     web/src already names explicit columns (`select('id, full_name')`),
--     never `*` -- that's why the identical column-grant approach above
--     is safe for players but not for matches.
--
-- Column-level grants on matches would therefore have taken down match
-- history, the open-matches admin view, and player profiles for every
-- anon/authenticated caller. Fixing this properly requires the three
-- frontend call sites to enumerate matches columns explicitly instead of
-- `*`, which is a web/src change outside this task's file scope
-- (supabase/migrations only) -- left for a follow-up task. matches
-- therefore keeps its existing full-table SELECT grant from
-- 20260714040000_data_api_grants.sql unchanged; entered_by (a Minor,
-- already-flagged, low-severity admin-id-enumeration exposure) remains
-- readable for now, same as current production behavior.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Critical: nothing tied winner_id to the actual higher-scoring player.
-- A backend bug (fixed separately in supabase/functions/enter-match) let
-- a string-typed frame comparison store the losing player as the winner;
-- this constraint is the database-level backstop so that class of bug
-- can never silently corrupt data again, regardless of application code.
--
-- Added NOT VALID (post-review fix): a plain ADD CONSTRAINT validates
-- every existing row as part of this migration's single transaction, so
-- it would abort the ENTIRE migration -- including the players.email fix
-- above -- if any historical match was already corrupted by the very bug
-- this constraint exists to catch (a real possibility, since that bug was
-- reproduced against this app's own data during the audit). NOT VALID
-- attaches and enforces the constraint for all new writes immediately
-- without scanning existing rows, decoupling "protect from now on"
-- (guaranteed to succeed) from "retroactively prove old data is clean"
-- (may legitimately fail and require manual remediation first). Before
-- any real production cutover, run this manually and remediate any
-- reported rows before it's expected to pass:
--   alter table matches validate constraint matches_winner_matches_score;
-- ---------------------------------------------------------------------
alter table matches
  add constraint matches_winner_matches_score
  check ((winner_id = player_a_id) = (frames_a > frames_b))
  not valid;

-- ---------------------------------------------------------------------
-- Important: enforce at most one active season at the database level,
-- backstopping the start-season Edge Function fix (task 7) that
-- completes any other active season before activating a new one.
--
-- Unlike a CHECK constraint, a unique index has no NOT VALID escape
-- hatch -- CREATE UNIQUE INDEX always scans existing rows and always
-- fails outright if a duplicate is already present, which would otherwise
-- abort this whole migration with a generic "could not create unique
-- index" error. The guard below turns that into a specific, actionable
-- error naming the problem so an operator isn't left guessing.
-- ---------------------------------------------------------------------
do $$
declare
  active_count integer;
begin
  select count(*) into active_count from seasons where status = 'active';
  if active_count > 1 then
    raise exception
      'audit_fixes migration: % seasons are already status=active; seasons_single_active_idx cannot be created until all but one is reconciled to another status (e.g. completed).',
      active_count;
  end if;
end $$;

create unique index seasons_single_active_idx on seasons (status) where status = 'active';

-- ---------------------------------------------------------------------
-- Minor: no value-range constraints existed, so a buggy write could store
-- a NaN rating or a negative points/matches total with no objection.
-- Postgres `numeric` has no Infinity, only NaN, and NaN = NaN is TRUE for
-- numeric (unlike IEEE float), so the standard "x <> x" NaN trick doesn't
-- work here -- comparing against the literal 'NaN'::numeric does.
--
-- All five added NOT VALID for the same reason as matches_winner_matches_score
-- above -- a legitimately-earned rating could already sit outside a
-- newly-chosen "sane" range on a long-running instance, and that must not
-- block the rest of this migration. Validate manually before a production
-- cutover:
--   alter table player_season_ratings validate constraint player_season_ratings_rating_sane;
--   alter table player_season_ratings validate constraint player_season_ratings_rd_sane;
--   alter table player_season_ratings validate constraint player_season_ratings_volatility_sane;
--   alter table player_season_ratings validate constraint player_season_ratings_matches_played_sane;
--   alter table player_season_ratings validate constraint player_season_ratings_season_points_sane;
-- ---------------------------------------------------------------------
alter table player_season_ratings
  add constraint player_season_ratings_rating_sane check (rating <> 'NaN'::numeric and rating between -1000 and 5000) not valid,
  add constraint player_season_ratings_rd_sane check (rd <> 'NaN'::numeric and rd > 0) not valid,
  add constraint player_season_ratings_volatility_sane check (volatility <> 'NaN'::numeric and volatility > 0) not valid,
  add constraint player_season_ratings_matches_played_sane check (matches_played >= 0) not valid,
  add constraint player_season_ratings_season_points_sane check (season_points >= 0) not valid;

alter table weekly_rankings
  add constraint weekly_rankings_rank_sane check (rank >= 1) not valid;

-- ---------------------------------------------------------------------
-- Minor: leaderboard_view / grade_distribution_view were owner-rights
-- (security definer) views with no security_invoker, so they currently
-- bypass RLS on their base tables. Harmless today (both base tables are
-- fully public-read) but a landmine the day RLS on them ever tightens.
-- ---------------------------------------------------------------------
alter view leaderboard_view set (security_invoker = on);
alter view grade_distribution_view set (security_invoker = on);

-- ---------------------------------------------------------------------
-- Minor: anon/authenticated retained Supabase's default TRUNCATE/TRIGGER/
-- REFERENCES grants on every table from role bootstrap. Not exploitable
-- via PostgREST, but unnecessary -- revoke as defense-in-depth.
-- ---------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------
-- Minor: updated_at was never refreshed on UPDATE anywhere.
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger players_set_updated_at before update on players
  for each row execute function set_updated_at();
create trigger seasons_set_updated_at before update on seasons
  for each row execute function set_updated_at();
create trigger matches_set_updated_at before update on matches
  for each row execute function set_updated_at();
create trigger player_season_ratings_set_updated_at before update on player_season_ratings
  for each row execute function set_updated_at();
create trigger player_statistics_set_updated_at before update on player_statistics
  for each row execute function set_updated_at();
