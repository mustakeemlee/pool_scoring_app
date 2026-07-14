-- supabase/migrations/20260714020000_rls_policies.sql

-- Public read, admin-only write (writes happen only via service-role Edge Functions)
alter table players enable row level security;
create policy "public read players" on players for select using (true);

alter table seasons enable row level security;
create policy "public read seasons" on seasons for select using (true);

alter table player_season_ratings enable row level security;
create policy "public read player_season_ratings" on player_season_ratings for select using (true);

alter table matches enable row level security;
create policy "public read matches" on matches for select using (true);

alter table weekly_rankings enable row level security;
create policy "public read weekly_rankings" on weekly_rankings for select using (true);

alter table player_statistics enable row level security;
create policy "public read player_statistics" on player_statistics for select using (true);

-- Fully private: no public policy at all, service-role only, except
-- admin_users which lets an authenticated admin read their own row.
alter table admin_users enable row level security;
create policy "self read admin_users" on admin_users for select using (auth.uid() = id);

alter table match_audit_log enable row level security;

alter table rating_events enable row level security;
