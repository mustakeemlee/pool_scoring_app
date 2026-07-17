// supabase/functions/_shared/playerStatisticsRecompute.ts
import type { TransactionSql } from './dbTransaction.ts';
import {
  winPercentage,
  currentStreak,
  longestStreak,
  averageOpponentRating,
  formScore,
} from './rating/statistics.ts';

export async function recomputePlayerStatistics(
  sql: TransactionSql,
  playerId: string,
  seasonId: string,
): Promise<void> {
  const matches = await sql`
    select id, winner_id, player_a_id, player_b_id, frames_a, frames_b, match_date
    from matches
    where (player_a_id = ${playerId} or player_b_id = ${playerId})
      and season_id = ${seasonId} and is_voided = false
    order by match_date asc
  `;

  const outcomes = matches.map((m) => m.winner_id === playerId);
  const wins = outcomes.filter(Boolean).length;
  const losses = outcomes.length - wins;
  const framesWon = matches.reduce(
    (sum, m) => sum + (m.player_a_id === playerId ? m.frames_a : m.frames_b),
    0,
  );
  const framesLost = matches.reduce(
    (sum, m) => sum + (m.player_a_id === playerId ? m.frames_b : m.frames_a),
    0,
  );

  // Opponent's rating AT THE TIME of each historical match: see the
  // identical comment previously in this file's non-transactional version
  // (enter-match kept its own copy before this extraction) -- every match
  // writes one 'instant' rating_events row per player, so the opponent's
  // row for the same match_id carries their rating_before at that point.
  const matchIds = matches.map((m) => m.id);
  const opponentEvents = matchIds.length > 0
    ? await sql`
        select rating_before from rating_events
        where match_id in ${sql(matchIds)} and event_type = 'instant' and player_id <> ${playerId}
      `
    : [];
  // rating_before is a `numeric` column; postgres.js returns numeric as a
  // string (to avoid float precision loss), so it must be coerced to a JS
  // number before averageOpponentRating sums it.
  const opponentRatingsAtMatchTime = opponentEvents.map((e) => Number(e.rating_before));

  const last5 = outcomes.slice(-5);
  const last10 = outcomes.slice(-10);

  await sql`
    insert into player_statistics (
      player_id, season_id, wins, losses, current_streak, longest_streak,
      frames_won, frames_lost, avg_opponent_rating, form_5, form_10, form_score
    )
    values (
      ${playerId}, ${seasonId}, ${wins}, ${losses}, ${currentStreak(outcomes)}, ${longestStreak(outcomes)},
      ${framesWon}, ${framesLost}, ${averageOpponentRating(opponentRatingsAtMatchTime)},
      ${winPercentage(last5.filter(Boolean).length, last5.length - last5.filter(Boolean).length)},
      ${winPercentage(last10.filter(Boolean).length, last10.length - last10.filter(Boolean).length)},
      ${formScore(last5, last10)}
    )
    on conflict (player_id, season_id) do update set
      wins = excluded.wins,
      losses = excluded.losses,
      current_streak = excluded.current_streak,
      longest_streak = excluded.longest_streak,
      frames_won = excluded.frames_won,
      frames_lost = excluded.frames_lost,
      avg_opponent_rating = excluded.avg_opponent_rating,
      form_5 = excluded.form_5,
      form_10 = excluded.form_10,
      form_score = excluded.form_score
  `;
}
