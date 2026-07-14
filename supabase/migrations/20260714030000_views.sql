-- supabase/migrations/20260714030000_views.sql

create view leaderboard_view as
  select p.id as player_id, p.full_name, psr.season_id, psr.rating, psr.grade,
         psr.season_points,
         rank() over (partition by psr.season_id order by psr.rating desc) as rank
  from player_season_ratings psr
  join players p on p.id = psr.player_id
  where psr.matches_played >= 3;

create view grade_distribution_view as
  select season_id, grade, count(*) as player_count
  from player_season_ratings
  where matches_played >= 3
  group by season_id, grade;
