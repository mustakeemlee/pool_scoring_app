// supabase/functions/close-week/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { withTransaction, type TransactionSql } from '../_shared/dbTransaction.ts';
import { HttpError } from '../_shared/httpError.ts';
import { isUuid, isValidDateString } from '../_shared/validation.ts';
import { reconcilePeriod, type Glicko2Opponent } from '../_shared/rating/glicko2.ts';
import { computeLeaderboard } from '../_shared/rating/ranking.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import { getPriorPeriodBaseline } from '../_shared/priorPeriodBaseline.ts';

interface CloseWeekBody {
  season_id: string;
  week_ending: string;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: CloseWeekBody;
  try {
    body = (await req.json()) as CloseWeekBody;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }
  const { season_id, week_ending } = body;

  // Pure-format validation before opening the transaction (matches enter-match):
  // a malformed season_id/week_ending can never reach any DB work.
  if (!isUuid(season_id)) return jsonResponse({ error: 'season_id must be a valid UUID' }, 400);
  if (!isValidDateString(week_ending)) {
    return jsonResponse({ error: 'week_ending must be a valid YYYY-MM-DD date' }, 400);
  }

  try {
    const result = await withTransaction(async (sql: TransactionSql) => {
      // Load the season and reject a week_ending that predates the season's
      // start_date: closing a "week" before the season even began would write
      // a bogus historical weekly_rankings snapshot for a period that never
      // existed (a finding reproduced during the audit). start_date is a
      // `date` column; to_char pins it to a 'YYYY-MM-DD' string so comparing
      // it against the already-format-validated ISO week_ending is a plain
      // lexical (== chronological, for zero-padded ISO dates) string compare.
      const [season] = await sql`
        select id, to_char(start_date, 'YYYY-MM-DD') as start_date
        from seasons where id = ${season_id}
      `;
      if (!season) throw new HttpError(400, 'season_id does not reference an existing season');
      if (week_ending < (season.start_date as string)) {
        throw new HttpError(400, 'week_ending cannot be before the season start_date');
      }

      const openMatchesQuery = () => sql`
        select id, player_a_id, player_b_id, winner_id from matches
        where season_id = ${season_id}
          and is_period_closed = false
          and is_voided = false
          and match_date <= ${week_ending}
      `;
      const playerIdsOf = (rows: Awaited<ReturnType<typeof openMatchesQuery>>) =>
        Array.from(new Set(rows.flatMap((m) => [m.player_a_id as string, m.player_b_id as string])));

      let matches = await openMatchesQuery();
      let playerIds = playerIdsOf(matches);
      const lockedPlayerIds = new Set<string>();

      // Lock every involved player's rating row, in ascending id order, BEFORE
      // reading the pre-period snapshot below -- and re-read the open-matches
      // set immediately after, using it (not the pre-lock read) for the rest
      // of the function. The lock alone protects the baseline READ, but not
      // WHICH matches get reconciled: two concurrent close-week calls for the
      // same week both see the same pre-lock open-matches list, then serialize
      // on these locks -- the second call's stale list would otherwise still
      // get reconciled a second time on top of the first call's already-
      // committed weekly_reconciliation, double-counting the same games via a
      // different path than the original bug. Re-querying after the locks
      // means the second call sees is_period_closed = true (committed by the
      // first call before its locks released) and reconciles nothing.
      //
      // Bounded to two passes: if the post-lock re-query reveals a brand-new
      // match for players never yet locked (a new enter-match landing for an
      // entirely different pairing in the same instant), lock those too and
      // re-query once more. Two passes covers this without an unbounded loop;
      // a third concurrent write racing the exact same narrow window on top
      // of that is not a realistic scenario for this app's admin workflow.
      for (let pass = 0; pass < 2; pass++) {
        const lockOrderedPlayerIds = [...playerIds].filter((id) => !lockedPlayerIds.has(id)).sort();
        for (const playerId of lockOrderedPlayerIds) {
          await sql`
            insert into player_season_ratings (player_id, season_id)
            values (${playerId}, ${season_id})
            on conflict (player_id, season_id) do update set player_id = excluded.player_id
          `;
          lockedPlayerIds.add(playerId);
        }

        matches = await openMatchesQuery();
        playerIds = playerIdsOf(matches);
        if (playerIds.every((id) => lockedPlayerIds.has(id))) break;
      }

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
      //
      // CRITICAL FIX (the audit's headline close-week bug): the baseline is the
      // player's rating/rd/volatility as of their last formally closed period
      // (getPriorPeriodBaseline: the most recent weekly_reconciliation /
      // season_carryover event, or the season's starting defaults if none) --
      // NOT the live player_season_ratings row. The live row already includes
      // this open period's instant Elo nudges, so reconciling from it (what the
      // old code did by reading player_season_ratings directly) counted every
      // week's results twice: once via the instant nudge at enter-match time,
      // then again when Glicko-2 reconciled on top of the already-nudged rating.
      const preRatings = new Map<string, { rating: number; rd: number; volatility: number }>();
      for (const playerId of playerIds) {
        preRatings.set(playerId, await getPriorPeriodBaseline(sql, playerId, season_id));
      }

      for (const playerId of playerIds) {
        const ratingRow = preRatings.get(playerId);
        if (!ratingRow) continue;

        const opponents: Glicko2Opponent[] = [];
        for (const match of matches) {
          if (match.player_a_id !== playerId && match.player_b_id !== playerId) continue;
          const opponentId = match.player_a_id === playerId ? match.player_b_id : match.player_a_id;
          const opponentRating = preRatings.get(opponentId as string);
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

        await sql`
          insert into rating_events (
            player_id, season_id, rating_before, rd_before, volatility_before,
            rating_after, rd_after, volatility_after, delta, event_type, period_end_date
          ) values (
            ${playerId}, ${season_id}, ${ratingRow.rating}, ${ratingRow.rd}, ${ratingRow.volatility},
            ${reconciled.rating}, ${reconciled.rd}, ${reconciled.volatility},
            ${reconciled.rating - ratingRow.rating}, 'weekly_reconciliation', ${week_ending}
          )
        `;

        await sql`
          update player_season_ratings
          set rating = ${reconciled.rating},
              rd = ${reconciled.rd},
              volatility = ${reconciled.volatility},
              grade = ${gradeForRating(reconciled.rating)}
          where player_id = ${playerId} and season_id = ${season_id}
        `;
      }

      const allRatings = await sql`
        select player_id, rating, rd, volatility, matches_played, grade, season_points
        from player_season_ratings
        where season_id = ${season_id}
      `;

      // weekly_rankings is meant as a full historical snapshot of every player
      // carrying a rating this season, not just players who currently clear the
      // MIN_MATCHES_FOR_RANKING eligibility bar that gates the *live*
      // leaderboard_view (design spec sec 6) - so rank every player who has a
      // player_season_ratings row this season, overriding
      // computeLeaderboard's default minMatches filter with 0.
      const leaderboard = computeLeaderboard(
        allRatings.map((r) => ({
          playerId: r.player_id as string,
          // rating is a `numeric` column -> string from postgres.js; coerce
          // before it reaches computeLeaderboard's rating comparisons.
          rating: Number(r.rating),
          matchesPlayed: r.matches_played as number,
        })),
        0,
      );

      for (const entry of leaderboard) {
        const row = allRatings.find((r) => r.player_id === entry.playerId);
        if (!row) continue;
        const [stats] = await sql`
          select wins, losses, form_score from player_statistics
          where player_id = ${entry.playerId} and season_id = ${season_id}
        `;

        // wins/losses are `integer` columns (postgres.js already returns those
        // as JS numbers), but coerce defensively so the win_pct arithmetic can
        // never silently become string concatenation.
        const wins = stats ? Number(stats.wins) : 0;
        const losses = stats ? Number(stats.losses) : 0;

        // Upsert rather than a plain insert: close-week can legitimately run
        // again for the same (season_id, week_ending) pair later - e.g. an
        // admin closes out a second batch of matches under the same
        // week_ending - and weekly_rankings has a (season_id, week_ending,
        // player_id) unique constraint. A plain insert would hit a duplicate
        // key error (and fail the whole request) for every player who already
        // has a row for this week, even though nothing about their own
        // reconciliation changed this call. Upserting keeps every player's
        // snapshot in sync with the latest leaderboard/rank numbers instead of
        // erroring out.
        await sql`
          insert into weekly_rankings (
            season_id, week_ending, player_id, rating, rd, volatility, rank, grade,
            win_pct, form_score, season_points
          ) values (
            ${season_id}, ${week_ending}, ${entry.playerId}, ${entry.rating}, ${Number(row.rd)},
            ${Number(row.volatility)}, ${entry.rank}, ${row.grade as string},
            ${stats ? (wins / Math.max(1, wins + losses)) * 100 : 0},
            ${stats ? Number(stats.form_score ?? 0) : 0},
            ${row.season_points as number}
          )
          on conflict (season_id, week_ending, player_id) do update set
            rating = excluded.rating,
            rd = excluded.rd,
            volatility = excluded.volatility,
            rank = excluded.rank,
            grade = excluded.grade,
            win_pct = excluded.win_pct,
            form_score = excluded.form_score,
            season_points = excluded.season_points
        `;
      }

      if (matches.length > 0) {
        await sql`
          update matches set is_period_closed = true
          where id in ${sql(matches.map((m) => m.id as string))}
        `;
      }

      return { closed_matches: matches.length, players_reconciled: playerIds.length };
    });

    return jsonResponse(result, 200);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
