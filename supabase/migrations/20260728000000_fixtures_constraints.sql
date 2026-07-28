-- supabase/migrations/20260728000000_fixtures_constraints.sql
--
-- Two CHECK constraints on `fixtures` that the original migration
-- (20260727000000_fixtures.sql) left unenforced at the DB level, relying
-- only on application-level guards:
-- 1. `matches` already rejects a player playing against themselves
--    (check (player_a_id <> player_b_id)) -- `fixtures` had no equivalent,
--    relying solely on the CreateFixture form's client-side guard.
-- 2. Nothing stopped a `completed` fixture from having a null
--    `completed_match_id`, which is a self-contradictory state (a
--    "completed" fixture that isn't actually linked to a result).

alter table fixtures add constraint fixtures_players_differ check (player_a_id <> player_b_id);

alter table fixtures add constraint fixtures_completed_has_match
  check (status <> 'completed' or completed_match_id is not null);
