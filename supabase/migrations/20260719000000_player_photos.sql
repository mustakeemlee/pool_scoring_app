-- supabase/migrations/20260719000000_player_photos.sql
--
-- Player photo support for the FPL-style redesign:
-- 1. photo_url column on players
-- 2. leaderboard_view exposes it (column appended at the end so
--    CREATE OR REPLACE VIEW is allowed; existing grants are preserved)
-- 3. Admins (any authenticated user present in admin_users) may update
--    players.photo_url directly from the web app
-- 4. Public storage bucket "player-photos" with admin-only writes
--
-- The storage section is guarded with to_regclass so this migration also
-- succeeds on a database whose storage schema isn't installed yet. The
-- self-hosted docker-compose stack now ships a storage-api service, so photo
-- uploads work there, on the Supabase CLI stack, and on hosted Supabase.

alter table players add column if not exists photo_url text;

create or replace view leaderboard_view as
  select p.id as player_id, p.full_name, psr.season_id, psr.rating, psr.grade,
         psr.season_points,
         rank() over (partition by psr.season_id order by psr.rating desc) as rank,
         p.photo_url
  from player_season_ratings psr
  join players p on p.id = psr.player_id
  where psr.matches_played >= 3;

-- Admin update policy (writes otherwise happen only via service-role Edge
-- Functions; photo management is a low-risk direct update).
drop policy if exists "admin update players" on players;
create policy "admin update players" on players
  for update
  using (exists (select 1 from admin_users a where a.id = auth.uid()))
  with check (exists (select 1 from admin_users a where a.id = auth.uid()));

grant update (photo_url) on players to authenticated;

-- Storage bucket for player photos: public read, admin-only write.
-- Skipped entirely when the storage schema isn't installed (self-host stack).
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping player-photos bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('player-photos', 'player-photos', true)
  on conflict (id) do nothing;

  drop policy if exists "public read player photos" on storage.objects;
  create policy "public read player photos" on storage.objects
    for select using (bucket_id = 'player-photos');

  drop policy if exists "admin insert player photos" on storage.objects;
  create policy "admin insert player photos" on storage.objects
    for insert
    with check (
      bucket_id = 'player-photos'
      and exists (select 1 from admin_users a where a.id = auth.uid())
    );

  drop policy if exists "admin update player photos" on storage.objects;
  create policy "admin update player photos" on storage.objects
    for update
    using (
      bucket_id = 'player-photos'
      and exists (select 1 from admin_users a where a.id = auth.uid())
    );

  drop policy if exists "admin delete player photos" on storage.objects;
  create policy "admin delete player photos" on storage.objects
    for delete
    using (
      bucket_id = 'player-photos'
      and exists (select 1 from admin_users a where a.id = auth.uid())
    );
end
$$;
