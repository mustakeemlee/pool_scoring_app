-- supabase/migrations/20260724020000_private_player_photos.sql
--
-- Player photos were served from a `public: true` storage bucket
-- (players.photo_url stored the permanent public URL), so photos were
-- fetchable by anyone with the URL regardless of login -- inconsistent
-- with 20260724010000_require_login_for_league_data.sql, which requires
-- login for every other piece of league data.
--
-- 1. Marks the player-photos bucket private.
-- 2. Replaces the public storage-read policy with an authenticated-only
--    one (mirrors the rest of the app: any logged-in user, not just
--    admins/the linked player -- the write policies already added in
--    20260719000000_player_photos.sql / 20260720000000_player_accounts.sql
--    stay unchanged).
-- 3. Converts players.photo_url from a stored public URL to a bare
--    storage object path (e.g. "<player-id>-<timestamp>.jpg"). The
--    frontend now resolves that path to a short-lived signed URL per
--    authenticated request (supabase.storage.createSignedUrls) instead of
--    relying on a permanent public URL.
--
-- Guarded with to_regclass, matching 20260719000000_player_photos.sql:
-- skips entirely on a database whose storage schema isn't installed.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping private player-photos migration';
    return;
  end if;

  update storage.buckets set public = false where id = 'player-photos';

  drop policy if exists "public read player photos" on storage.objects;
  -- storage.objects, like auth.users, is a shared cluster-wide table, not
  -- schema-scoped -- every src/db scratch-schema test run re-applies every
  -- migration against the same real storage.objects, so this drop must
  -- cover the policy this very migration creates too, or the second test
  -- run's CREATE POLICY collides with the first's.
  drop policy if exists "authenticated read player photos" on storage.objects;
  create policy "authenticated read player photos" on storage.objects
    for select to authenticated
    using (bucket_id = 'player-photos');
end
$$;

update players
set photo_url = regexp_replace(photo_url, '^.*/player-photos/', '')
where photo_url is not null;
