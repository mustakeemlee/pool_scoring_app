// supabase/functions/correct-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { withTransaction, type TransactionSql } from '../_shared/dbTransaction.ts';
import { HttpError } from '../_shared/httpError.ts';
import { isUuid, isValidFrameCount } from '../_shared/validation.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import { calculateSeasonPoints } from '../_shared/rating/seasonPoints.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';
import { getPriorPeriodBaseline } from '../_shared/priorPeriodBaseline.ts';
import { recomputePlayerStatistics } from '../_shared/playerStatisticsRecompute.ts';

interface CorrectMatchBody {
  match_id: string;
  match_date?: string;
  frames_a?: number;
  frames_b?: number;
}

async function lockRatingRow(sql: TransactionSql, playerId: string, seasonId: string): Promise<void> {
  // Mirrors enter-match's ensureRatingRow: an ON CONFLICT DO UPDATE with a
  // harmless self-assignment both guarantees the row exists and takes a row
  // lock held until this transaction commits/rolls back. Acquiring it up
  // front (in ascending-id order, see the call site) stops a concurrent
  // enter-match / close-week / correct-match touching either player from
  // interleaving mid-correction, and the fixed ordering prevents a deadlock
  // with another request naming the same two players in the opposite order.
  await sql`
    insert into player_season_ratings (player_id, season_id)
    values (${playerId}, ${seasonId})
    on conflict (player_id, season_id) do update set player_id = excluded.player_id
  `;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: CorrectMatchBody;
  try {
    body = (await req.json()) as CorrectMatchBody;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }

  // Same input-validation class as enter-match, reachable here too: a frame
  // count arriving as a string would make the `framesA > framesB` winner
  // comparison below a string comparison ("2" > "10" is true), storing the
  // wrong winner_id. frames_a/frames_b are optional on a correction, so each
  // is only validated when provided; if both are provided they must differ
  // (the matches table also enforces frames_a <> frames_b as a backstop).
  if (!isUuid(body.match_id)) {
    return jsonResponse({ error: 'match_id must be a valid UUID' }, 400);
  }
  if (body.frames_a !== undefined && !isValidFrameCount(body.frames_a)) {
    return jsonResponse({ error: 'frames_a must be an integer between 0 and 50' }, 400);
  }
  if (body.frames_b !== undefined && !isValidFrameCount(body.frames_b)) {
    return jsonResponse({ error: 'frames_b must be an integer between 0 and 50' }, 400);
  }
  if (body.frames_a !== undefined && body.frames_b !== undefined && body.frames_a === body.frames_b) {
    return jsonResponse({ error: 'frames_a and frames_b cannot be equal' }, 400);
  }

  // Load the original match and run the not-found / already-closed / already-
  // voided early returns BEFORE opening the transaction: these are read-only
  // checks, so only the actual mutation sequence below needs to be atomic.
  const { data: original } = await db
    .from('matches')
    .select('*')
    .eq('id', body.match_id)
    .single();
  if (!original) return jsonResponse({ error: 'Match not found' }, 404);
  if (original.is_period_closed) {
    return jsonResponse({ error: 'Cannot correct a match whose week has already closed' }, 400);
  }
  if (original.is_voided) {
    return jsonResponse({ error: 'Cannot correct a match that has already been voided' }, 400);
  }

  const framesA = body.frames_a ?? original.frames_a;
  const framesB = body.frames_b ?? original.frames_b;
  const matchDate = body.match_date ?? original.match_date;
  const winnerId = framesA > framesB ? original.player_a_id : original.player_b_id;

  try {
    const correctedId = await withTransaction(async (sql) => {
      // Lock both players' rating rows in a fixed (ascending id) order, before
      // touching anything else, regardless of which slot (A/B) each occupies,
      // so two concurrent requests naming the same two players in opposite
      // order can never deadlock against each other.
      const [lowId, highId] = [original.player_a_id, original.player_b_id].sort();
      await lockRatingRow(sql, lowId, original.season_id);
      await lockRatingRow(sql, highId, original.season_id);

      // Re-check voided/closed state now that both players' rows are locked
      // (not just the read from before the transaction opened): if another
      // correct-match call for this same match_id ran concurrently and
      // committed while this request was waiting on the locks above, this
      // request must not also insert a second corrected match on top of it.
      // Sequential retries are already safe (the first commit voids the row,
      // so a retry hits the plain is_voided check below) -- this specifically
      // closes the window for two genuinely-overlapping requests.
      const [current] = await sql`select is_voided, is_period_closed from matches where id = ${body.match_id}`;
      if (!current) throw new HttpError(404, 'Match not found');
      if (current.is_period_closed) {
        throw new HttpError(400, 'Cannot correct a match whose week has already closed');
      }
      if (current.is_voided) {
        throw new HttpError(400, 'Cannot correct a match that has already been voided');
      }

      // Insert the corrected match BEFORE voiding the original. This way, if the
      // insert fails (e.g. frames_a === frames_b violates the matches table's
      // check constraint), the function returns an error having changed nothing:
      // the original match is still live and un-voided, so the admin can safely
      // retry correct-match with corrected data. Voiding first (the old order)
      // meant a failed insert could strand the original as voided with no
      // replacement, and a subsequent fresh enter-match call for that pairing
      // would silently double-count the voided match's rating impact.
      const [corrected] = await sql`
        insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id, entered_by)
        values (${original.season_id}, ${matchDate}, ${original.player_a_id}, ${original.player_b_id},
                ${framesA}, ${framesB}, ${winnerId}, ${admin.id})
        returning id
      `;

      await sql`
        insert into match_audit_log (match_id, changed_by, change_type, new_values)
        values (${corrected.id}, ${admin.id}, 'created',
                ${sql.json({ ...body, frames_a: framesA, frames_b: framesB, match_date: matchDate } as unknown as Record<string, unknown>)})
      `;

      await sql`update matches set is_voided = true where id = ${body.match_id}`;

      await sql`
        insert into match_audit_log (match_id, changed_by, change_type, old_values)
        values (${body.match_id}, ${admin.id}, 'voided', ${sql.json(original as unknown as Record<string, unknown>)})
      `;

      await replayOpenWeek(sql, original.season_id, original.player_a_id);
      await replayOpenWeek(sql, original.season_id, original.player_b_id);

      // Recompute player_statistics for BOTH players only after BOTH replays
      // have finished writing their rating_events -- not inside
      // replayOpenWeek itself. player_statistics.avg_opponent_rating is
      // derived by reading the OPPONENT's 'instant' rating_events row for
      // each shared match (see playerStatisticsRecompute.ts), and the
      // corrected match has no such rows until each player's own replay
      // creates them. Recomputing for player A immediately after A's replay
      // (before B has replayed) would find zero opponent-events for the
      // corrected match and silently write avg_opponent_rating = 0 for A.
      // Waiting until both replays are done means both players' 'instant'
      // events already exist by the time either recompute runs.
      await recomputePlayerStatistics(sql, original.player_a_id, original.season_id);
      await recomputePlayerStatistics(sql, original.player_b_id, original.season_id);

      return corrected.id as string;
    });

    return jsonResponse({ corrected_match_id: correctedId }, 200);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});

async function replayOpenWeek(sql: TransactionSql, seasonId: string, playerId: string): Promise<void> {
  // The pre-week baseline: the player's rating/rd as of their last formally
  // closed period (weekly_reconciliation / season_carryover), or the season's
  // starting defaults if no week has ever been closed for them yet -- never
  // the row's *current* rating/rd, since those already include this week's
  // now-being-replaced instant nudges. Extracted into getPriorPeriodBaseline
  // so close-week derives the identical baseline. Volatility isn't touched by
  // the open-week instant nudges, so only rating/rd are read here.
  const baseline = await getPriorPeriodBaseline(sql, playerId, seasonId);
  const rating = baseline.rating;
  const rd = baseline.rd;

  // KNOWN LIMITATION (documented, not fixed): chronological order here is
  // match_date, then created_at as a tiebreaker.
  // The corrected match is a freshly-inserted row, so its created_at is
  // always "now" — later than any other same-day match that existed before
  // this correction. If a player has multiple matches on the same
  // match_date in the open week and this call is correcting an earlier one,
  // the corrected row can sort *after* a later same-day match, producing a
  // different (and technically incorrect) replay order for that edge case.
  // Correction ordering is only guaranteed correct when a player has at
  // most one match per day in the open week, or when correcting the most
  // recent same-day match. A full fix would need a stable same-day
  // tiebreaker independent of row-insertion time (e.g. an explicit
  // sequence/slot number), which is out of scope for this open-week-only
  // correction feature.
  const openMatches = await sql`
    select id, player_a_id, player_b_id, frames_a, frames_b, winner_id, match_date, created_at
    from matches
    where (player_a_id = ${playerId} or player_b_id = ${playerId})
      and season_id = ${seasonId}
      and is_period_closed = false
      and is_voided = false
    order by match_date asc, created_at asc
  `;

  const openMatchIds = openMatches.map((m) => m.id);
  if (openMatchIds.length > 0) {
    await sql`
      delete from rating_events
      where player_id = ${playerId} and season_id = ${seasonId}
        and event_type = 'instant' and match_id in ${sql(openMatchIds)}
    `;
  }

  let currentRating = rating;
  const currentRd = rd;

  // matches_played is cumulative across the whole season (see enter-match's
  // updatePlayerAfterMatch: matchesPlayed = priorMatchesPlayed + 1), exactly
  // like season_points below. Seed it from this player's already-closed
  // matches this season so the replay loop's increments land on top of that
  // baseline instead of resetting to just this open week's count — the
  // original code started this at 0, which reset matches_played down to the
  // open week's count alone for any player who already had a week formally
  // closed for them, flipping is_provisional back to true and ejecting them
  // from leaderboard_view/grade_distribution_view (both gate on
  // matches_played >= MIN_MATCHES_FOR_RANKING). Corrected matches
  // (is_voided = false, is_period_closed = false, i.e. the freshly-inserted
  // replacement row) are never counted as "closed" here, so they aren't
  // double-counted against the open-week loop below.
  const [closedCountRow] = await sql`
    select count(*)::int as count from matches
    where (player_a_id = ${playerId} or player_b_id = ${playerId})
      and season_id = ${seasonId}
      and is_period_closed = true
      and is_voided = false
  `;
  let matchesPlayed = closedCountRow.count;

  // season_points is likewise cumulative across the season (see
  // enter-match: season_points: args.priorSeasonPoints + seasonPointsEarned)
  // and, unlike player_statistics (recomputed in full below), is NOT
  // self-healing: nothing else ever recomputes it. The cumulative
  // season_points value as of this player's last formal close is exactly what
  // close-week writes into weekly_rankings.season_points (see
  // close-week/index.ts:179, which copies player_season_ratings.season_points
  // verbatim at close time) — so the most recent weekly_rankings row for this
  // player/season is the correct baseline to replay this open week's
  // corrected points on top of. If no week has ever been closed for this
  // player, there's no weekly_rankings row yet and the season-long baseline
  // is simply 0.
  const [lastWeeklyRanking] = await sql`
    select season_points from weekly_rankings
    where player_id = ${playerId} and season_id = ${seasonId}
    order by week_ending desc
    limit 1
  `;
  // weekly_rankings.season_points is an integer column, which postgres.js
  // already returns as a JS number (only `numeric` columns come back as
  // strings) — no coercion needed, matching enter-match's treatment.
  let seasonPoints = lastWeeklyRanking?.season_points ?? 0;

  for (const match of openMatches) {
    const isPlayerA = match.player_a_id === playerId;
    const opponentId = isPlayerA ? match.player_b_id : match.player_a_id;
    // KNOWN LIMITATION (documented, not fixed): this reads the opponent's
    // LIVE current rating from
    // player_season_ratings, not their rating at the specific point in time
    // this match is being replayed. If the opponent also played other
    // matches later in the same open week, their current rating already
    // reflects those later matches, and that "future" information leaks
    // backward into recomputing this earlier match's Elo delta — the result
    // can differ from when the match was first entered, even though nothing
    // about this specific match changed. This is accurate when the opponent
    // had no other matches in the same open week, but can drift if they
    // did. A fully correct fix would require replaying all affected
    // players' matches together in true joint chronological order (using
    // each match's actual rating_events snapshots rather than live table
    // state), which edges toward the "full cross-period replay" complexity
    // this plan deliberately scoped out of Phase 2 in favor of
    // open-week-only corrections.
    const [opponentRow] = await sql`
      select rating, rd from player_season_ratings
      where player_id = ${opponentId} and season_id = ${seasonId}
    `;
    // rating/rd are `numeric` columns -> strings from postgres.js; coerce
    // before any arithmetic, and fall back to the baseline defaults if the
    // opponent somehow has no rating row yet.
    const opponentRating = opponentRow ? Number(opponentRow.rating) : 1500;
    const opponentRd = opponentRow ? Number(opponentRow.rd) : 350;

    const nudge = applyInstantNudge({
      ratingA: currentRating,
      rdA: currentRd,
      ratingB: opponentRating,
      rdB: opponentRd,
      framesA: isPlayerA ? match.frames_a : match.frames_b,
      framesB: isPlayerA ? match.frames_b : match.frames_a,
    });

    await sql`
      insert into rating_events (
        match_id, player_id, season_id, rating_before, rd_before,
        rating_after, rd_after, expected_score, actual_score, delta, event_type
      ) values (
        ${match.id}, ${playerId}, ${seasonId}, ${currentRating}, ${currentRd},
        ${nudge.newRatingA}, ${currentRd}, ${nudge.expectedScoreA}, ${nudge.actualScoreA}, ${nudge.deltaA}, 'instant'
      )
    `;

    // Mirrors enter-match's own season_points calculation exactly:
    // ownRating is the rating AFTER this match's nudge (nudge.newRatingA),
    // not the pre-match rating, and opponentRating is the opponent's
    // rating at replay time (see the KNOWN LIMITATION note above the
    // opponentRow query — same live-read caveat applies here as it already
    // does to the rating replay itself).
    const won = match.winner_id === playerId;
    seasonPoints += calculateSeasonPoints({
      won,
      framesFor: isPlayerA ? match.frames_a : match.frames_b,
      framesAgainst: isPlayerA ? match.frames_b : match.frames_a,
      ownRating: nudge.newRatingA,
      opponentRating,
    });

    currentRating = nudge.newRatingA;
    matchesPlayed += 1;
  }

  await sql`
    update player_season_ratings
    set rating = ${currentRating},
        matches_played = ${matchesPlayed},
        is_provisional = ${matchesPlayed < MIN_MATCHES_FOR_RANKING},
        grade = ${gradeForRating(currentRating)},
        season_points = ${seasonPoints}
    where player_id = ${playerId} and season_id = ${seasonId}
  `;
  // player_statistics is recomputed by the caller, once both players' open
  // weeks have been replayed -- see the comment at the call site in
  // Deno.serve for why this can't safely happen per-player, inline here.
}
