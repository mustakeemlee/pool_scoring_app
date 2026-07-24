-- supabase/migrations/20260724000000_user_profiles_backfill.sql
--
-- Final-review fixes for 20260720000000_player_accounts.sql:
--
-- 1. Backfill: the on_auth_user_created trigger only fires for NEW signups,
--    so every auth.users row created before that migration was deployed
--    (including, almost certainly, the live production admin) has no
--    user_profiles row. web/src/hooks/useUserProfile.ts read this table with
--    .single(), which errors on zero rows -- breaking Dashboard/Settings for
--    every pre-existing account. This is a one-time data fix, not a trigger,
--    so (unlike 20260720000000_player_accounts.sql's trigger function) it is
--    intentionally left unqualified: it should resolve via search_path, so a
--    src/db scratch-schema test run harmlessly backfills that scratch
--    schema's own user_profiles copy from the real (shared) auth.users, and
--    a real `supabase db push` backfills the real public.user_profiles.
insert into user_profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- 2. A player must link to at most one account. review-player-claim's
--    approve branch already auto-rejects other *pending* claims on the same
--    player, but nothing stopped a second, later-approved claim from linking
--    the same player to a second account. This unique index is the real
--    guarantee (the Edge Function also gets an explicit pre-check for a
--    clean error message in the common case -- defense in depth).
create unique index user_profiles_linked_player_id_unique on user_profiles (linked_player_id)
  where linked_player_id is not null;
