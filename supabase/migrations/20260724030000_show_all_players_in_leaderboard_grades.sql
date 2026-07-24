-- supabase/migrations/20260724030000_show_all_players_in_leaderboard_grades.sql
--
-- Product decision: leaderboard_view/grade_distribution_view previously
-- excluded any player with fewer than 3 matches played in the season
-- (originally to hide wildly-swung ratings from a tiny sample size). Every
-- active player now shows up regardless of matches played: anyone who
-- hasn't played this season sinks to the bottom of the leaderboard (ranked
-- below every player who has played at least once) and displays the worst
-- grade ('D'), rather than the schema's neutral 1500/'B' default implying
-- an unearned mid-table rating they haven't actually proven.
--
-- This requires restructuring both views. The old ones started from
-- player_season_ratings, which simply has no row at all for a player who
-- hasn't played yet this season -- an inner join can never produce a row
-- for them. The new ones start from players CROSS JOIN seasons, LEFT JOIN
-- player_season_ratings, so a player with no row for a given season still
-- produces one, defaulted via coalesce.

-- Column order matches the existing view exactly through `photo_url` --
-- CREATE OR REPLACE VIEW only allows appending new columns at the end, not
-- inserting them (see 20260719000000_player_photos.sql's photo_url, which
-- established this same append-only convention).
create or replace view leaderboard_view as
  select
    p.id as player_id,
    p.full_name,
    s.id as season_id,
    coalesce(psr.rating, 1500) as rating,
    case when coalesce(psr.matches_played, 0) = 0 then 'D' else psr.grade end as grade,
    coalesce(psr.season_points, 0) as season_points,
    rank() over (
      partition by s.id
      order by (coalesce(psr.matches_played, 0) > 0) desc, coalesce(psr.rating, 1500) desc
    ) as rank,
    p.photo_url,
    coalesce(psr.matches_played, 0) as matches_played
  from players p
  cross join seasons s
  left join player_season_ratings psr on psr.player_id = p.id and psr.season_id = s.id
  where p.is_active = true;

create or replace view grade_distribution_view as
  select
    s.id as season_id,
    case when coalesce(psr.matches_played, 0) = 0 then 'D' else psr.grade end as grade,
    count(*) as player_count
  from players p
  cross join seasons s
  left join player_season_ratings psr on psr.player_id = p.id and psr.season_id = s.id
  where p.is_active = true
  group by s.id, case when coalesce(psr.matches_played, 0) = 0 then 'D' else psr.grade end;
