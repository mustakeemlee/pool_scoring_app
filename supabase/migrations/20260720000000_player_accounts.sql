-- supabase/migrations/20260720000000_player_accounts.sql
--
-- Public player-signup and admin-approved account-linking:
-- 1. user_profiles: one row per signed-up auth account, holding an optional
--    link to a `players` row. Auto-created by a trigger on auth.users insert.
-- 2. player_claims: a user's request to link their account to a player,
--    reviewed (approved/rejected) by an admin via the review-player-claim
--    Edge Function (added in Task 2 of this feature's implementation plan).
-- 3. Linked players get a self-service photo-write RLS policy, mirroring the
--    existing admin-only one from 20260719000000_player_photos.sql.
-- 4. Admins can now update their own admin_users.display_name (previously
--    read-only).
--
-- IMPORTANT (see src/db/applyMigrations.ts's own warning about the `auth`
-- schema): this migration attaches a trigger to the real, shared
-- `auth.users` table. Every src/db test run re-applies every migration
-- file against a fresh scratch SCHEMA (never a scratch DATABASE --
-- Supabase Cloud only has the one), but `auth.users` itself is NOT
-- schema-scoped -- there is exactly one, shared by every scratch schema
-- and the real `public` schema alike. If the trigger function or its
-- INSERT target were left unqualified (as every other object in this
-- migration deliberately is, so it resolves via `search_path` into
-- whichever scratch schema is active), CREATE FUNCTION would obey
-- `search_path` too and the shared trigger would end up pointing at a
-- function living inside a scratch schema -- one that a later
-- `drop schema ... cascade` (see src/db/scratchSchema.ts) deletes,
-- cascade-dropping the trigger along with it and silently breaking real
-- signups against the live cloud project between test runs. The function
-- and its INSERT target are therefore explicitly qualified to `public` --
-- never left to resolve via search_path -- so every src/db test run
-- harmlessly re-installs the exact same real trigger pointing at the
-- exact same real function, no matter which scratch schema is active.

create table user_profiles (
  id uuid primary key references auth.users(id),
  linked_player_id uuid references players(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_profiles_set_updated_at before update on user_profiles
  for each row execute function set_updated_at();

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer as $$
begin
  insert into public.user_profiles (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table player_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  player_id uuid not null references players(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references admin_users(id),
  reviewed_at timestamptz
);

create index player_claims_player_idx on player_claims (player_id);
create index player_claims_user_idx on player_claims (user_id);

alter table user_profiles enable row level security;
create policy "self read user_profiles" on user_profiles for select using (auth.uid() = id);
grant select on user_profiles to authenticated;

alter table player_claims enable row level security;
create policy "self read own claims" on player_claims for select using (auth.uid() = user_id);
create policy "admin read all claims" on player_claims for select
  using (exists (select 1 from admin_users a where a.id = auth.uid()));
create policy "self insert own claim" on player_claims for insert
  with check (auth.uid() = user_id and status = 'pending');
grant select, insert on player_claims to authenticated;

-- Linked-player self-service photo write, additive alongside the existing
-- admin-only "admin update players" policy from 20260719000000_player_photos.sql
-- (multiple permissive policies for the same command are OR'd together --
-- an admin OR a linked player satisfies at least one, either is allowed).
create policy "linked player update own photo" on players
  for update
  using (exists (select 1 from user_profiles up where up.id = auth.uid() and up.linked_player_id = players.id))
  with check (exists (select 1 from user_profiles up where up.id = auth.uid() and up.linked_player_id = players.id));

create policy "self update admin_users" on admin_users
  for update using (auth.uid() = id) with check (auth.uid() = id);
grant update (display_name) on admin_users to authenticated;

-- Storage: linked-player self-service photo write, mirroring the existing
-- admin-only storage policies exactly. Skipped when the storage schema
-- isn't installed (self-host stack), matching 20260719000000_player_photos.sql.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping player photo self-service storage policies';
    return;
  end if;

  drop policy if exists "linked player insert own photo" on storage.objects;
  create policy "linked player insert own photo" on storage.objects
    for insert
    with check (
      bucket_id = 'player-photos'
      and exists (
        select 1 from user_profiles up
        where up.id = auth.uid() and name like (up.linked_player_id::text || '-%')
      )
    );

  drop policy if exists "linked player update own photo storage" on storage.objects;
  create policy "linked player update own photo storage" on storage.objects
    for update
    using (
      bucket_id = 'player-photos'
      and exists (
        select 1 from user_profiles up
        where up.id = auth.uid() and name like (up.linked_player_id::text || '-%')
      )
    );

  drop policy if exists "linked player delete own photo" on storage.objects;
  create policy "linked player delete own photo" on storage.objects
    for delete
    using (
      bucket_id = 'player-photos'
      and exists (
        select 1 from user_profiles up
        where up.id = auth.uid() and name like (up.linked_player_id::text || '-%')
      )
    );
end
$$;
