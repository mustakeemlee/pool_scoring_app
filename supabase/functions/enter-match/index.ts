// supabase/functions/enter-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import {
  winPercentage,
  currentStreak,
  longestStreak,
  averageOpponentRating,
  formScore,
} from '../_shared/rating/statistics.ts';
import { calculateSeasonPoints } from '../_shared/rating/seasonPoints.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';

interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
}

async function ensureRatingRow(db: ReturnType<typeof createServiceRoleClient>, playerId: string, seasonId: string) {
  const { data: existing } = await db
    .from('player_season_ratings')
    .select('rating, rd, volatility, matches_played, season_points')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await db
    .from('player_season_ratings')
    .insert({ player_id: playerId, season_id: seasonId })
    .select('rating, rd, volatility, matches_played, season_points')
    .single();
  if (error) throw new Error(`Failed to create rating row: ${error.message}`);
  return created;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as EnterMatchBody;
  const { season_id, match_date, player_a_id, player_b_id, frames_a, frames_b } = body;

  const ratingA = await ensureRatingRow(db, player_a_id, season_id);
  const ratingB = await ensureRatingRow(db, player_b_id, season_id);

  const winnerId = frames_a > frames_b ? player_a_id : player_b_id;

  const { data: match, error: matchError } = await db
    .from('matches')
    .insert({
      season_id,
      match_date,
      player_a_id,
      player_b_id,
      frames_a,
      frames_b,
      winner_id: winnerId,
      entered_by: admin.id,
    })
    .select('id')
    .single();
  if (matchError) return jsonResponse({ error: matchError.message }, 400);

  const nudge = applyInstantNudge({
    ratingA: ratingA.rating,
    rdA: ratingA.rd,
    ratingB: ratingB.rating,
    rdB: ratingB.rd,
    framesA: frames_a,
    framesB: frames_b,
  });

  const { error: ratingEventsError } = await db.from('rating_events').insert([
    {
      match_id: match.id,
      player_id: player_a_id,
      season_id,
      rating_before: ratingA.rating,
      rd_before: ratingA.rd,
      rating_after: nudge.newRatingA,
      rd_after: ratingA.rd,
      expected_score: nudge.expectedScoreA,
      actual_score: nudge.actualScoreA,
      delta: nudge.deltaA,
      event_type: 'instant',
    },
    {
      match_id: match.id,
      player_id: player_b_id,
      season_id,
      rating_before: ratingB.rating,
      rd_before: ratingB.rd,
      rating_after: nudge.newRatingB,
      rd_after: ratingB.rd,
      expected_score: 1 - nudge.expectedScoreA,
      actual_score: 1 - nudge.actualScoreA,
      delta: -nudge.deltaA,
      event_type: 'instant',
    },
  ]);
  if (ratingEventsError) return jsonResponse({ error: ratingEventsError.message }, 500);

  const updateAResult = await updatePlayerAfterMatch(db, {
    playerId: player_a_id,
    seasonId: season_id,
    newRating: nudge.newRatingA,
    priorMatchesPlayed: ratingA.matches_played,
    priorSeasonPoints: ratingA.season_points,
    won: winnerId === player_a_id,
    framesFor: frames_a,
    framesAgainst: frames_b,
    opponentRating: ratingB.rating,
  });
  if (updateAResult.error) return jsonResponse({ error: updateAResult.error }, 500);

  const updateBResult = await updatePlayerAfterMatch(db, {
    playerId: player_b_id,
    seasonId: season_id,
    newRating: nudge.newRatingB,
    priorMatchesPlayed: ratingB.matches_played,
    priorSeasonPoints: ratingB.season_points,
    won: winnerId === player_b_id,
    framesFor: frames_b,
    framesAgainst: frames_a,
    opponentRating: ratingA.rating,
  });
  if (updateBResult.error) return jsonResponse({ error: updateBResult.error }, 500);

  const { error: auditLogError } = await db.from('match_audit_log').insert({
    match_id: match.id,
    changed_by: admin.id,
    change_type: 'created',
    new_values: body,
  });
  if (auditLogError) return jsonResponse({ error: auditLogError.message }, 500);

  return jsonResponse({ match_id: match.id }, 201);
});

interface UpdatePlayerArgs {
  playerId: string;
  seasonId: string;
  newRating: number;
  priorMatchesPlayed: number;
  priorSeasonPoints: number;
  won: boolean;
  framesFor: number;
  framesAgainst: number;
  opponentRating: number;
}

async function updatePlayerAfterMatch(
  db: ReturnType<typeof createServiceRoleClient>,
  args: UpdatePlayerArgs,
): Promise<{ error: string | null }> {
  const matchesPlayed = args.priorMatchesPlayed + 1;
  const seasonPointsEarned = calculateSeasonPoints({
    won: args.won,
    framesFor: args.framesFor,
    framesAgainst: args.framesAgainst,
    ownRating: args.newRating,
    opponentRating: args.opponentRating,
  });

  const { error: ratingUpdateError } = await db
    .from('player_season_ratings')
    .update({
      rating: args.newRating,
      matches_played: matchesPlayed,
      is_provisional: matchesPlayed < MIN_MATCHES_FOR_RANKING,
      grade: gradeForRating(args.newRating),
      season_points: args.priorSeasonPoints + seasonPointsEarned,
    })
    .eq('player_id', args.playerId)
    .eq('season_id', args.seasonId);
  if (ratingUpdateError) {
    return { error: `Failed to update player_season_ratings: ${ratingUpdateError.message}` };
  }

  const { data: pastMatches } = await db
    .from('matches')
    .select('id, winner_id, player_a_id, player_b_id, frames_a, frames_b, match_date')
    .or(`player_a_id.eq.${args.playerId},player_b_id.eq.${args.playerId}`)
    .eq('season_id', args.seasonId)
    .eq('is_voided', false)
    .order('match_date', { ascending: true });

  const matches = pastMatches ?? [];
  const outcomes = matches.map((m) => m.winner_id === args.playerId);
  const wins = outcomes.filter(Boolean).length;
  const losses = outcomes.length - wins;
  const framesWon = matches.reduce(
    (sum, m) => sum + (m.player_a_id === args.playerId ? m.frames_a : m.frames_b),
    0,
  );
  const framesLost = matches.reduce(
    (sum, m) => sum + (m.player_a_id === args.playerId ? m.frames_b : m.frames_a),
    0,
  );

  // Opponent's rating AT THE TIME of each historical match: every match writes
  // one 'instant' rating_events row per player, so the opponent's row for the
  // same match_id carries their rating_before at that point in time.
  const matchIds = matches.map((m) => m.id);
  const { data: opponentEvents } = await db
    .from('rating_events')
    .select('match_id, player_id, rating_before')
    .in('match_id', matchIds)
    .eq('event_type', 'instant')
    .neq('player_id', args.playerId);
  const opponentRatingsAtMatchTime = (opponentEvents ?? []).map((e) => e.rating_before);

  const last5 = outcomes.slice(-5);
  const last10 = outcomes.slice(-10);

  const { error: statsError } = await db.from('player_statistics').upsert(
    {
      player_id: args.playerId,
      season_id: args.seasonId,
      wins,
      losses,
      current_streak: currentStreak(outcomes),
      longest_streak: longestStreak(outcomes),
      frames_won: framesWon,
      frames_lost: framesLost,
      avg_opponent_rating: averageOpponentRating(opponentRatingsAtMatchTime),
      form_5: winPercentage(last5.filter(Boolean).length, last5.length - last5.filter(Boolean).length),
      form_10: winPercentage(last10.filter(Boolean).length, last10.length - last10.filter(Boolean).length),
      form_score: formScore(last5, last10),
    },
    { onConflict: 'player_id,season_id' },
  );
  if (statsError) {
    return { error: `Failed to upsert player_statistics: ${statsError.message}` };
  }

  return { error: null };
}
