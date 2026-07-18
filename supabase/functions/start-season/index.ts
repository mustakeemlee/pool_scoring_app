// supabase/functions/start-season/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { withTransaction } from '../_shared/dbTransaction.ts';
import { HttpError } from '../_shared/httpError.ts';
import { isUuid, isNonEmptyString, isValidDateString } from '../_shared/validation.ts';
import { applySeasonCarryover } from '../_shared/rating/seasonCarryover.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';

interface StartSeasonBody {
  previous_season_id?: string;
  new_season_name: string;
  start_date: string;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: StartSeasonBody;
  try {
    body = (await req.json()) as StartSeasonBody;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }
  const { previous_season_id, new_season_name, start_date } = body;

  if (!isNonEmptyString(new_season_name)) {
    return jsonResponse({ error: 'new_season_name must be a non-empty string' }, 400);
  }
  if (!isValidDateString(start_date)) {
    return jsonResponse({ error: 'start_date must be a valid YYYY-MM-DD date' }, 400);
  }
  if (previous_season_id !== undefined && !isUuid(previous_season_id)) {
    return jsonResponse({ error: 'previous_season_id must be a valid UUID' }, 400);
  }

  try {
    const result = await withTransaction(async (sql) => {
      // If a previous season was named it must reference a real row -- verify
      // this BEFORE any writes, so a bogus previous_season_id aborts the entire
      // transaction and no orphaned 'active' season is ever left behind (fixes
      // the reproduced "nonexistent previous_season_id silently produced a new
      // season with zero carryover" bug).
      if (previous_season_id) {
        const [prev] = await sql`select id from seasons where id = ${previous_season_id}`;
        if (!prev) {
          throw new HttpError(400, 'previous_season_id does not reference an existing season');
        }
      }

      // Complete every currently-active season before creating the new active
      // one, so at most one season is ever 'active'. This is the application
      // half of the single-active-season guarantee; the database half is the
      // seasons_single_active_idx partial unique index added by the audit-fixes
      // migration. This upfront step replaces (and subsumes) the old code's
      // separate "mark previous season completed" step that used to run at the
      // very end. When a previous_season_id is explicitly named it is completed
      // here too even if it is not currently 'active' (e.g. a 'draft'
      // predecessor being wound down), so the season being superseded is always
      // closed out before its ratings are carried forward.
      if (previous_season_id) {
        await sql`
          update seasons set status = 'completed'
          where status = 'active' or id = ${previous_season_id}
        `;
      } else {
        await sql`update seasons set status = 'completed' where status = 'active'`;
      }

      const [newSeason] = await sql`
        insert into seasons (name, start_date, status)
        values (${new_season_name}, ${start_date}, 'active')
        returning id
      `;

      if (previous_season_id) {
        // Read every prior-season rating row once, up front, before any writes
        // this run performs. Unlike close-week's Glicko-2 batch reconciliation
        // (which reads OPPONENTS' live state mid-loop and can therefore be
        // contaminated by earlier iterations' writes to the same table/season),
        // each iteration here only ever reads its own player's row from this
        // frozen snapshot and only ever writes rows scoped to the brand-new
        // `newSeason.id` (a fresh row in player_season_ratings, a fresh row in
        // rating_events) - never back into `previous_season_id`, and never a
        // row another iteration could read. There is no cross-player dependency
        // in the carryover formula at all (it's a pure function of that one
        // player's own prior rating/rd/volatility), so there's no snapshot-
        // freshness concern to guard against here the way there was in
        // close-week: reading once up front is not just sufficient, it's
        // equivalent to reading fresh on every iteration.
        const previousRatings = await sql`
          select player_id, rating, rd, volatility
          from player_season_ratings
          where season_id = ${previous_season_id}
        `;

        for (const prior of previousRatings) {
          // postgres.js returns `numeric` columns (rating/rd/volatility) as
          // JS strings, not numbers. Coerce every one with Number(...) before
          // any arithmetic, or the carryover formula silently string-
          // concatenates (e.g. rd "100" + 50 -> "10050") instead of adding.
          const priorRating = Number(prior.rating);
          const priorRd = Number(prior.rd);
          const priorVolatility = Number(prior.volatility);

          const carried = applySeasonCarryover({
            rating: priorRating,
            rd: priorRd,
            volatility: priorVolatility,
          });

          await sql`
            insert into player_season_ratings (player_id, season_id, rating, rd, volatility, grade)
            values (
              ${prior.player_id}, ${newSeason.id}, ${carried.rating}, ${carried.rd},
              ${carried.volatility}, ${gradeForRating(carried.rating)}
            )
          `;

          await sql`
            insert into rating_events (
              player_id, season_id, rating_before, rd_before, volatility_before,
              rating_after, rd_after, volatility_after, delta, event_type
            ) values (
              ${prior.player_id}, ${newSeason.id}, ${priorRating}, ${priorRd}, ${priorVolatility},
              ${carried.rating}, ${carried.rd}, ${carried.volatility}, ${carried.rating - priorRating},
              'season_carryover'
            )
          `;
        }
      }

      return { seasonId: newSeason.id as string };
    });

    return jsonResponse({ season_id: result.seasonId }, 201);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
