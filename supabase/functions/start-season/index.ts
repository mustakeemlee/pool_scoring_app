// supabase/functions/start-season/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
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

  const body = (await req.json()) as StartSeasonBody;

  const { data: newSeason, error: seasonError } = await db
    .from('seasons')
    .insert({ name: body.new_season_name, start_date: body.start_date, status: 'active' })
    .select('id')
    .single();
  if (seasonError) return jsonResponse({ error: seasonError.message }, 400);

  if (body.previous_season_id) {
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
    const { data: previousRatings, error: previousRatingsError } = await db
      .from('player_season_ratings')
      .select('player_id, rating, rd, volatility')
      .eq('season_id', body.previous_season_id);
    if (previousRatingsError) {
      return jsonResponse(
        { error: `Failed to load previous season ratings: ${previousRatingsError.message}` },
        500,
      );
    }

    for (const prior of previousRatings ?? []) {
      const carried = applySeasonCarryover({
        rating: prior.rating,
        rd: prior.rd,
        volatility: prior.volatility,
      });

      const { error: newRatingError } = await db.from('player_season_ratings').insert({
        player_id: prior.player_id,
        season_id: newSeason.id,
        rating: carried.rating,
        rd: carried.rd,
        volatility: carried.volatility,
        grade: gradeForRating(carried.rating),
      });
      if (newRatingError) {
        return jsonResponse(
          {
            error: `Failed to insert carried-over player_season_ratings for player ${prior.player_id}: ${newRatingError.message}`,
          },
          500,
        );
      }

      const { error: ratingEventError } = await db.from('rating_events').insert({
        player_id: prior.player_id,
        season_id: newSeason.id,
        rating_before: prior.rating,
        rd_before: prior.rd,
        volatility_before: prior.volatility,
        rating_after: carried.rating,
        rd_after: carried.rd,
        volatility_after: carried.volatility,
        delta: carried.rating - prior.rating,
        event_type: 'season_carryover',
      });
      if (ratingEventError) {
        return jsonResponse(
          {
            error: `Failed to insert season_carryover rating_events for player ${prior.player_id}: ${ratingEventError.message}`,
          },
          500,
        );
      }
    }
  }

  return jsonResponse({ season_id: newSeason.id }, 201);
});
