// supabase/functions/enter-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { corsPreflightResponse } from '../_shared/cors.ts';
import { withTransaction, type TransactionSql } from '../_shared/dbTransaction.ts';
import { HttpError } from '../_shared/httpError.ts';
import { isUuid, isValidFrameCount, isValidDateString } from '../_shared/validation.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import { calculateSeasonPoints } from '../_shared/rating/seasonPoints.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';
import { recomputePlayerStatistics } from '../_shared/playerStatisticsRecompute.ts';

interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
  fixture_id?: string;
}

async function ensureRatingRow(sql: TransactionSql, playerId: string, seasonId: string) {
  // ON CONFLICT DO UPDATE (a harmless self-assignment) both creates the row
  // if missing AND takes a row lock if it already exists, held until this
  // transaction commits/rolls back -- this closes the brand-new-player race
  // (two concurrent first matches for the same new player) in the same
  // statement that creates the row, rather than needing a separate lock step.
  const [row] = await sql`
    insert into player_season_ratings (player_id, season_id)
    values (${playerId}, ${seasonId})
    on conflict (player_id, season_id) do update set player_id = excluded.player_id
    returning rating, rd, volatility, matches_played, season_points
  `;
  // postgres.js returns `numeric` columns as strings (to avoid float precision
  // loss on arbitrary-precision values), not JS numbers -- but the rating
  // engine (applyInstantNudge et al.) does real arithmetic on these fields,
  // so they must be coerced here. `matches_played`/`season_points` are plain
  // `integer` columns, which postgres.js already returns as JS numbers.
  return {
    rating: Number(row.rating),
    rd: Number(row.rd),
    volatility: Number(row.volatility),
    matches_played: row.matches_played,
    season_points: row.season_points,
  };
}

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

async function updatePlayerAfterMatch(sql: TransactionSql, args: UpdatePlayerArgs): Promise<void> {
  const matchesPlayed = args.priorMatchesPlayed + 1;
  const seasonPointsEarned = calculateSeasonPoints({
    won: args.won,
    framesFor: args.framesFor,
    framesAgainst: args.framesAgainst,
    ownRating: args.newRating,
    opponentRating: args.opponentRating,
  });

  await sql`
    update player_season_ratings
    set rating = ${args.newRating},
        matches_played = ${matchesPlayed},
        is_provisional = ${matchesPlayed < MIN_MATCHES_FOR_RANKING},
        grade = ${gradeForRating(args.newRating)},
        season_points = ${args.priorSeasonPoints + seasonPointsEarned}
    where player_id = ${args.playerId} and season_id = ${args.seasonId}
  `;

  await recomputePlayerStatistics(sql, args.playerId, args.seasonId);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: EnterMatchBody;
  try {
    body = (await req.json()) as EnterMatchBody;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }
  const { season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, fixture_id } = body;

  if (!isUuid(season_id)) return jsonResponse({ error: 'season_id must be a valid UUID' }, 400);
  if (!isUuid(player_a_id)) return jsonResponse({ error: 'player_a_id must be a valid UUID' }, 400);
  if (!isUuid(player_b_id)) return jsonResponse({ error: 'player_b_id must be a valid UUID' }, 400);
  if (player_a_id === player_b_id) {
    return jsonResponse({ error: 'player_a_id and player_b_id must be different players' }, 400);
  }
  if (!isValidDateString(match_date)) {
    return jsonResponse({ error: 'match_date must be a valid YYYY-MM-DD date' }, 400);
  }
  if (!isValidFrameCount(frames_a)) {
    return jsonResponse({ error: 'frames_a must be an integer between 0 and 50' }, 400);
  }
  if (!isValidFrameCount(frames_b)) {
    return jsonResponse({ error: 'frames_b must be an integer between 0 and 50' }, 400);
  }
  if (frames_a === frames_b) {
    return jsonResponse({ error: 'frames_a and frames_b cannot be equal' }, 400);
  }
  if (fixture_id !== undefined && !isUuid(fixture_id)) {
    return jsonResponse({ error: 'fixture_id must be a valid UUID' }, 400);
  }

  try {
    const result = await withTransaction(async (sql) => {
      const [season] = await sql`select id from seasons where id = ${season_id}`;
      if (!season) throw new HttpError(400, 'season_id does not reference an existing season');
      const [playerA] = await sql`select id from players where id = ${player_a_id}`;
      if (!playerA) throw new HttpError(400, 'player_a_id does not reference an existing player');
      const [playerB] = await sql`select id from players where id = ${player_b_id}`;
      if (!playerB) throw new HttpError(400, 'player_b_id does not reference an existing player');

      // Lock both players' rating rows in a fixed (ascending id) order
      // regardless of which request slot (A/B) each occupies, so two
      // concurrent requests naming the same two players in opposite order
      // can never deadlock against each other.
      const [lowId, highId] = [player_a_id, player_b_id].sort();
      const lowRow = await ensureRatingRow(sql, lowId, season_id);
      const highRow = await ensureRatingRow(sql, highId, season_id);
      const ratingA = player_a_id === lowId ? lowRow : highRow;
      const ratingB = player_a_id === lowId ? highRow : lowRow;

      // Soft idempotency: a byte-identical, non-voided match already
      // recorded for this exact submission is returned as-is (200) rather
      // than duplicated -- guards a lost-response network retry from
      // double-counting the same real-world result. Deliberately checked
      // AFTER the row locks above (not before): two genuinely-concurrent
      // identical requests both take the same two locks, so the second one
      // only proceeds past ensureRatingRow once the first has committed (or
      // rolled back) -- by which point this SELECT will actually see the
      // first request's committed match instead of racing it. Checking
      // before the locks would let both requests pass the check
      // simultaneously and insert two identical matches.
      const [existingMatch] = await sql`
        select id from matches
        where season_id = ${season_id} and match_date = ${match_date}
          and player_a_id = ${player_a_id} and player_b_id = ${player_b_id}
          and frames_a = ${frames_a} and frames_b = ${frames_b} and is_voided = false
      `;
      if (existingMatch) {
        return { matchId: existingMatch.id as string, alreadyExisted: true };
      }

      // Fixture completion is validated here -- after the idempotency check
      // above, so a network retry of an already-completed fixture's request
      // hits the idempotency early-return (the fixture was already marked
      // completed by the first, successful call) rather than this fixture
      // check. Locked FOR UPDATE to close the same race a concurrent
      // duplicate completion attempt could otherwise hit; locking it after
      // the player-row locks above can't deadlock against anything else in
      // this codebase, since no other code path locks a fixtures row and
      // player rows together in a different order.
      if (fixture_id) {
        const [fixture] = await sql`
          select id, status, player_a_id, player_b_id from fixtures where id = ${fixture_id} for update
        `;
        if (!fixture) throw new HttpError(400, 'fixture_id does not reference an existing fixture');
        if (fixture.status !== 'scheduled') {
          throw new HttpError(409, `Fixture is already ${fixture.status}, cannot enter a result for it`);
        }
        const samePair =
          (fixture.player_a_id === player_a_id && fixture.player_b_id === player_b_id) ||
          (fixture.player_a_id === player_b_id && fixture.player_b_id === player_a_id);
        if (!samePair) {
          throw new HttpError(400, 'Submitted players do not match this fixture');
        }
      }

      const winnerId = frames_a > frames_b ? player_a_id : player_b_id;

      const [match] = await sql`
        insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id, entered_by)
        values (${season_id}, ${match_date}, ${player_a_id}, ${player_b_id}, ${frames_a}, ${frames_b}, ${winnerId}, ${admin.id})
        returning id
      `;

      if (fixture_id) {
        await sql`update fixtures set status = 'completed', completed_match_id = ${match.id} where id = ${fixture_id}`;
      }

      const nudge = applyInstantNudge({
        ratingA: ratingA.rating,
        rdA: ratingA.rd,
        ratingB: ratingB.rating,
        rdB: ratingB.rd,
        framesA: frames_a,
        framesB: frames_b,
      });

      await sql`
        insert into rating_events (
          match_id, player_id, season_id, rating_before, rd_before,
          rating_after, rd_after, expected_score, actual_score, delta, event_type
        ) values
          (${match.id}, ${player_a_id}, ${season_id}, ${ratingA.rating}, ${ratingA.rd},
           ${nudge.newRatingA}, ${ratingA.rd}, ${nudge.expectedScoreA}, ${nudge.actualScoreA}, ${nudge.deltaA}, 'instant'),
          (${match.id}, ${player_b_id}, ${season_id}, ${ratingB.rating}, ${ratingB.rd},
           ${nudge.newRatingB}, ${ratingB.rd}, ${1 - nudge.expectedScoreA}, ${1 - nudge.actualScoreA}, ${nudge.deltaB}, 'instant')
      `;

      await updatePlayerAfterMatch(sql, {
        playerId: player_a_id, seasonId: season_id, newRating: nudge.newRatingA,
        priorMatchesPlayed: ratingA.matches_played, priorSeasonPoints: ratingA.season_points,
        won: winnerId === player_a_id, framesFor: frames_a, framesAgainst: frames_b, opponentRating: ratingB.rating,
      });
      await updatePlayerAfterMatch(sql, {
        playerId: player_b_id, seasonId: season_id, newRating: nudge.newRatingB,
        priorMatchesPlayed: ratingB.matches_played, priorSeasonPoints: ratingB.season_points,
        won: winnerId === player_b_id, framesFor: frames_b, framesAgainst: frames_a, opponentRating: ratingA.rating,
      });

      await sql`
        insert into match_audit_log (match_id, changed_by, change_type, new_values)
        values (${match.id}, ${admin.id}, 'created', ${sql.json(body as unknown as Record<string, unknown>)})
      `;

      return { matchId: match.id as string, alreadyExisted: false };
    });

    return jsonResponse({ match_id: result.matchId }, result.alreadyExisted ? 200 : 201);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
