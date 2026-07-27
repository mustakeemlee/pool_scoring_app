-- supabase/migrations/20260727000000_fixtures.sql
--
-- Scheduled-but-not-yet-played matches ("Fixtures"), kept entirely separate
-- from `matches` -- a `matches` row has always meant "a result was entered"
-- everywhere else in this codebase (rating engine, weekly close, season
-- points, statistics), and this migration doesn't touch any of that. A
-- fixture is completed by linking it to the `matches` row that resulted
-- from it (see the `enter-match` Edge Function extension, a later task in
-- this plan) or voided directly without ever producing a match.

create table fixtures (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  scheduled_date date not null,
  player_a_id uuid not null references players(id),
  player_b_id uuid not null references players(id),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'voided')),
  completed_match_id uuid references matches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fixtures_season_date_idx on fixtures (season_id, scheduled_date);

create trigger fixtures_set_updated_at before update on fixtures
  for each row execute function set_updated_at();

alter table fixtures enable row level security;

-- Same "using (true), access controlled by GRANTs" pattern already
-- established for every other league-data table since
-- 20260724010000_require_login_for_league_data.sql -- authenticated-only
-- read, no anon grant given at all (so no anon revoke is needed either,
-- unlike that migration which had to undo a pre-existing anon grant).
create policy "authenticated read fixtures" on fixtures for select using (true);
grant select on fixtures to authenticated;

-- Admin-only write, enforced by RLS predicate (the table-level GRANT below
-- is necessary but not sufficient -- it lets any authenticated user attempt
-- the statement, and the policy below then restricts which rows/requests
-- actually succeed).
create policy "admin insert fixtures" on fixtures for insert
  with check (exists (select 1 from admin_users a where a.id = auth.uid()));
create policy "admin update fixtures" on fixtures for update
  using (exists (select 1 from admin_users a where a.id = auth.uid()));
grant insert, update on fixtures to authenticated;
