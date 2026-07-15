// supabase/functions/close-week/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { reconcilePeriod, type Glicko2Opponent } from '../_shared/rating/glicko2.ts';
import { computeLeaderboard } from '../_shared/rating/ranking.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';

interface CloseWeekBody {
  season_id: string;
  week_ending: string;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { season_id, week_ending } = (await req.json()) as CloseWeekBody;

  const { data: openMatches, error: openMatchesError } = await db
    .from('matches')
    .select('id, player_a_id, player_b_id, winner_id')
    .eq('season_id', season_id)
    .eq('is_period_closed', false)
    .eq('is_voided', false)
    .lte('match_date', week_ending);
  if (openMatchesError) {
    return jsonResponse({ error: `Failed to load open matches: ${openMatchesError.message}` }, 500);
  }

  const matches = openMatches ?? [];
  const playerIds = Array.from(
    new Set(matches.flatMap((m) => [m.player_a_id, m.player_b_id])),
  );

  // Snapshot every involved player's PRE-period rating/rd/volatility up
  // front, before any writes happen this run. Glicko-2 batch reconciliation
  // assumes every player in the period is evaluated against opponents'
  // *pre-period* state simultaneously. If opponent state were instead read
  // live/per-iteration from player_season_ratings while this same loop is
  // also writing reconciled results back to that table (the brief's
  // original ordering), a player processed earlier in playerIds would
  // contaminate the opponent input used for anyone processed later who
  // played them this period - silently corrupting the math for any pair
  // that both closed out in the same close-week call. Reading opponents
  // only from this frozen snapshot for the rest of the function avoids that
  // regardless of iteration/write order.
  let snapshotRows: { player_id: string; rating: number; rd: number; volatility: number }[] = [];
  if (playerIds.length > 0) {
    const { data: snapshot, error: snapshotError } = await db
      .from('player_season_ratings')
      .select('player_id, rating, rd, volatility')
      .eq('season_id', season_id)
      .in('player_id', playerIds);
    if (snapshotError) {
      return jsonResponse({ error: `Failed to load pre-period ratings: ${snapshotError.message}` }, 500);
    }
    snapshotRows = snapshot ?? [];
  }
  const preRatings = new Map(snapshotRows.map((r) => [r.player_id, r]));

  for (const playerId of playerIds) {
    const ratingRow = preRatings.get(playerId);
    if (!ratingRow) continue;

    const opponents: Glicko2Opponent[] = [];
    for (const match of matches) {
      if (match.player_a_id !== playerId && match.player_b_id !== playerId) continue;
      const opponentId = match.player_a_id === playerId ? match.player_b_id : match.player_a_id;
      const opponentRating = preRatings.get(opponentId);
      if (!opponentRating) continue;
      opponents.push({
        rating: opponentRating.rating,
        rd: opponentRating.rd,
        score: (match.winner_id === playerId ? 1 : 0) as 0 | 1,
      });
    }

    const reconciled = reconcilePeriod(
      { rating: ratingRow.rating, rd: ratingRow.rd, volatility: ratingRow.volatility },
      opponents,
    );

    const { error: ratingEventError } = await db.from('rating_events').insert({
      player_id: playerId,
      season_id,
      rating_before: ratingRow.rating,
      rd_before: ratingRow.rd,
      volatility_before: ratingRow.volatility,
      rating_after: reconciled.rating,
      rd_after: reconciled.rd,
      volatility_after: reconciled.volatility,
      delta: reconciled.rating - ratingRow.rating,
      event_type: 'weekly_reconciliation',
      period_end_date: week_ending,
    });
    if (ratingEventError) {
      return jsonResponse(
        { error: `Failed to insert weekly_reconciliation rating_events for player ${playerId}: ${ratingEventError.message}` },
        500,
      );
    }

    const { error: ratingUpdateError } = await db
      .from('player_season_ratings')
      .update({
        rating: reconciled.rating,
        rd: reconciled.rd,
        volatility: reconciled.volatility,
        grade: gradeForRating(reconciled.rating),
      })
      .eq('player_id', playerId)
      .eq('season_id', season_id);
    if (ratingUpdateError) {
      return jsonResponse(
        { error: `Failed to update player_season_ratings for player ${playerId}: ${ratingUpdateError.message}` },
        500,
      );
    }
  }

  const { data: allRatings, error: allRatingsError } = await db
    .from('player_season_ratings')
    .select('player_id, rating, rd, volatility, matches_played, grade, season_points')
    .eq('season_id', season_id);
  if (allRatingsError) {
    return jsonResponse({ error: `Failed to load season ratings for leaderboard: ${allRatingsError.message}` }, 500);
  }

  // weekly_rankings is meant as a full historical snapshot of every player
  // carrying a rating this season, not just players who currently clear the
  // MIN_MATCHES_FOR_RANKING eligibility bar that gates the *live*
  // leaderboard_view (design spec sec 6) - so rank every player who has a
  // player_season_ratings row this season, overriding
  // computeLeaderboard's default minMatches filter with 0.
  const leaderboard = computeLeaderboard(
    (allRatings ?? []).map((r) => ({
      playerId: r.player_id,
      rating: r.rating,
      matchesPlayed: r.matches_played,
    })),
    0,
  );

  for (const entry of leaderboard) {
    const row = (allRatings ?? []).find((r) => r.player_id === entry.playerId);
    if (!row) continue;
    const { data: stats } = await db
      .from('player_statistics')
      .select('wins, losses, form_score')
      .eq('player_id', entry.playerId)
      .eq('season_id', season_id)
      .maybeSingle();

    // Upsert rather than a plain insert: close-week can legitimately run
    // again for the same (season_id, week_ending) pair later - e.g. an
    // admin closes out a second batch of matches under the same
    // week_ending - and weekly_rankings has a (season_id, week_ending,
    // player_id) unique constraint. A plain insert would hit a duplicate
    // key error (and, with the error handling below, fail the whole
    // request) for every player who already has a row for this week, even
    // though nothing about their own reconciliation changed this call.
    // Upserting keeps every player's snapshot in sync with the latest
    // leaderboard/rank numbers instead of erroring out.
    const { error: rankingError } = await db.from('weekly_rankings').upsert(
      {
        season_id,
        week_ending,
        player_id: entry.playerId,
        rating: entry.rating,
        rd: row.rd,
        volatility: row.volatility,
        rank: entry.rank,
        grade: row.grade,
        win_pct: stats ? (stats.wins / Math.max(1, stats.wins + stats.losses)) * 100 : 0,
        form_score: stats?.form_score ?? 0,
        season_points: row.season_points,
      },
      { onConflict: 'season_id,week_ending,player_id' },
    );
    if (rankingError) {
      return jsonResponse(
        { error: `Failed to write weekly_rankings for player ${entry.playerId}: ${rankingError.message}` },
        500,
      );
    }
  }

  if (matches.length > 0) {
    const { error: closeError } = await db
      .from('matches')
      .update({ is_period_closed: true })
      .in(
        'id',
        matches.map((m) => m.id),
      );
    if (closeError) {
      return jsonResponse({ error: `Failed to lock closed matches: ${closeError.message}` }, 500);
    }
  }

  return jsonResponse({ closed_matches: matches.length, players_reconciled: playerIds.length }, 200);
});
