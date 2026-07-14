-- supabase/migrations/20260714000000_initial_schema.sql

create extension if not exists "pgcrypto";

create table players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  joined_date date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin_users (
  id uuid primary key,
  display_name text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table player_season_ratings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  season_id uuid not null references seasons(id),
  rating numeric not null default 1500,
  rd numeric not null default 350,
  volatility numeric not null default 0.06,
  matches_played integer not null default 0,
  is_provisional boolean not null default true,
  grade text not null default 'B' check (grade in ('A+', 'A', 'B+', 'B', 'C+', 'C', 'D')),
  season_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, season_id)
);

create index player_season_ratings_leaderboard_idx
  on player_season_ratings (season_id, rating desc);

create table matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  match_date date not null,
  player_a_id uuid not null references players(id),
  player_b_id uuid not null references players(id),
  frames_a integer not null check (frames_a >= 0),
  frames_b integer not null check (frames_b >= 0),
  winner_id uuid not null references players(id),
  entered_by uuid references admin_users(id),
  is_voided boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (player_a_id <> player_b_id),
  check (winner_id = player_a_id or winner_id = player_b_id),
  check (frames_a <> frames_b)
);

create index matches_season_idx on matches (season_id);
create index matches_player_a_idx on matches (player_a_id);
create index matches_player_b_idx on matches (player_b_id);
create index matches_match_date_idx on matches (match_date);

create table match_audit_log (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  changed_by uuid references admin_users(id),
  change_type text not null check (change_type in ('created', 'updated', 'voided')),
  old_values jsonb,
  new_values jsonb,
  changed_at timestamptz not null default now()
);

create table rating_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id),
  player_id uuid not null references players(id),
  season_id uuid not null references seasons(id),
  rating_before numeric not null,
  rd_before numeric not null,
  volatility_before numeric,
  rating_after numeric not null,
  rd_after numeric not null,
  volatility_after numeric,
  expected_score numeric,
  actual_score numeric,
  delta numeric not null,
  event_type text not null check (event_type in ('instant', 'weekly_reconciliation', 'season_carryover')),
  period_end_date date,
  created_at timestamptz not null default now()
);

create index rating_events_player_season_idx on rating_events (player_id, season_id);
create index rating_events_match_idx on rating_events (match_id);

create table weekly_rankings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  week_ending date not null,
  player_id uuid not null references players(id),
  rating numeric not null,
  rd numeric not null,
  volatility numeric not null,
  rank integer not null,
  grade text not null,
  win_pct numeric not null,
  form_score numeric not null,
  season_points integer not null,
  created_at timestamptz not null default now(),
  unique (season_id, week_ending, player_id)
);

create table player_statistics (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  season_id uuid not null references seasons(id),
  wins integer not null default 0,
  losses integer not null default 0,
  win_pct numeric generated always as (
    case when (wins + losses) = 0 then 0
    else round((wins::numeric / (wins + losses)) * 100, 2) end
  ) stored,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  frames_won integer not null default 0,
  frames_lost integer not null default 0,
  avg_opponent_rating numeric,
  form_5 numeric,
  form_10 numeric,
  form_score numeric,
  updated_at timestamptz not null default now(),
  unique (player_id, season_id)
);
