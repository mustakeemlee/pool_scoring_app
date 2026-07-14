// supabase/functions/correct-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';

interface CorrectMatchBody {
  match_id: string;
  match_date?: string;
  frames_a?: number;
  frames_b?: number;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as CorrectMatchBody;

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

  // Insert the corrected match BEFORE voiding the original. This way, if the
  // insert fails (e.g. frames_a === frames_b violates the matches table's
  // check constraint), the function returns an error having changed nothing:
  // the original match is still live and un-voided, so the admin can safely
  // retry correct-match with corrected data. Voiding first (the old order)
  // meant a failed insert could strand the original as voided with no
  // replacement, and a subsequent fresh enter-match call for that pairing
  // would silently double-count the voided match's rating impact.
  const { data: corrected, error: insertError } = await db
    .from('matches')
    .insert({
      season_id: original.season_id,
      match_date: matchDate,
      player_a_id: original.player_a_id,
      player_b_id: original.player_b_id,
      frames_a: framesA,
      frames_b: framesB,
      winner_id: winnerId,
      entered_by: admin.id,
    })
    .select('id')
    .single();
  if (insertError) return jsonResponse({ error: insertError.message }, 400);

  const { error: createdAuditError } = await db.from('match_audit_log').insert({
    match_id: corrected.id,
    changed_by: admin.id,
    change_type: 'created',
    new_values: { ...body, frames_a: framesA, frames_b: framesB, match_date: matchDate },
  });
  if (createdAuditError) return jsonResponse({ error: createdAuditError.message }, 500);

  const { error: voidError } = await db
    .from('matches')
    .update({ is_voided: true })
    .eq('id', body.match_id);
  if (voidError) return jsonResponse({ error: voidError.message }, 500);

  const { error: voidAuditError } = await db.from('match_audit_log').insert({
    match_id: body.match_id,
    changed_by: admin.id,
    change_type: 'voided',
    old_values: original,
  });
  if (voidAuditError) return jsonResponse({ error: voidAuditError.message }, 500);

  const replayAResult = await replayOpenWeek(db, original.season_id, original.player_a_id);
  if (replayAResult.error) return jsonResponse({ error: replayAResult.error }, 500);

  const replayBResult = await replayOpenWeek(db, original.season_id, original.player_b_id);
  if (replayBResult.error) return jsonResponse({ error: replayBResult.error }, 500);

  return jsonResponse({ corrected_match_id: corrected.id }, 200);
});

async function replayOpenWeek(
  db: ReturnType<typeof createServiceRoleClient>,
  seasonId: string,
  playerId: string,
): Promise<{ error: string | null }> {
  const { data: lastClosedEvent } = await db
    .from('rating_events')
    .select('rating_after, rd_after')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .in('event_type', ['weekly_reconciliation', 'season_carryover'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // If no weekly_reconciliation/season_carryover event exists yet, this
  // player's season began fresh (player_season_ratings always starts at the
  // baseline defaults) and has had no close-week run for them yet, so the
  // pre-week baseline is simply that starting point — never the row's
  // *current* rating/rd, since those already include this week's
  // now-being-replaced instant nudges.
  const rating = lastClosedEvent ? lastClosedEvent.rating_after : 1500;
  const rd = lastClosedEvent ? lastClosedEvent.rd_after : 350;

  // KNOWN LIMITATION (documented, not fixed — see task-8 review finding 1):
  // chronological order here is match_date, then created_at as a tiebreaker.
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
  const { data: openMatches } = await db
    .from('matches')
    .select('id, player_a_id, player_b_id, frames_a, frames_b, match_date, created_at')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
    .eq('season_id', seasonId)
    .eq('is_period_closed', false)
    .eq('is_voided', false)
    .order('match_date', { ascending: true })
    .order('created_at', { ascending: true });

  const openMatchIds = (openMatches ?? []).map((m) => m.id);
  if (openMatchIds.length > 0) {
    const { error: deleteError } = await db
      .from('rating_events')
      .delete()
      .eq('player_id', playerId)
      .eq('season_id', seasonId)
      .eq('event_type', 'instant')
      .in('match_id', openMatchIds);
    if (deleteError) {
      return { error: `Failed to delete stale instant rating_events: ${deleteError.message}` };
    }
  }

  let currentRating = rating;
  const currentRd = rd;
  // TODO(Task 9): verify matches_played semantics once close-week exists —
  // see task-8 review finding 4. This starts the count at 0 and counts only
  // this open week's matches, so the update below writes matches_played as
  // just the open week's count rather than prior-closed-weeks' count plus
  // this week's on top. enter-match treats matches_played as cumulative
  // across the season, so this may be resetting it incorrectly — but that
  // depends on how close-week (not yet built) is expected to interact with
  // matches_played at period boundaries, so it isn't safe to change here yet.
  let matchesPlayed = 0;

  for (const match of openMatches ?? []) {
    const isPlayerA = match.player_a_id === playerId;
    const opponentId = isPlayerA ? match.player_b_id : match.player_a_id;
    // KNOWN LIMITATION (documented, not fixed — see task-8 review finding 2):
    // this reads the opponent's LIVE current rating from
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
    const { data: opponentRow } = await db
      .from('player_season_ratings')
      .select('rating, rd')
      .eq('player_id', opponentId)
      .eq('season_id', seasonId)
      .single();

    const nudge = applyInstantNudge({
      ratingA: currentRating,
      rdA: currentRd,
      ratingB: opponentRow?.rating ?? 1500,
      rdB: opponentRow?.rd ?? 350,
      framesA: isPlayerA ? match.frames_a : match.frames_b,
      framesB: isPlayerA ? match.frames_b : match.frames_a,
    });

    const { error: ratingEventError } = await db.from('rating_events').insert({
      match_id: match.id,
      player_id: playerId,
      season_id: seasonId,
      rating_before: currentRating,
      rd_before: currentRd,
      rating_after: nudge.newRatingA,
      rd_after: currentRd,
      expected_score: nudge.expectedScoreA,
      actual_score: nudge.actualScoreA,
      delta: nudge.deltaA,
      event_type: 'instant',
    });
    if (ratingEventError) {
      return { error: `Failed to insert replay rating_events: ${ratingEventError.message}` };
    }

    currentRating = nudge.newRatingA;
    matchesPlayed += 1;
  }

  const { error: updateError } = await db
    .from('player_season_ratings')
    .update({
      rating: currentRating,
      matches_played: matchesPlayed,
      is_provisional: matchesPlayed < MIN_MATCHES_FOR_RANKING,
      grade: gradeForRating(currentRating),
    })
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
  if (updateError) {
    return { error: `Failed to update player_season_ratings: ${updateError.message}` };
  }

  // KNOWN LIMITATION (documented, not fixed — see task-8 review finding 3):
  // this function updates rating_events and player_season_ratings but never
  // recomputes player_statistics (wins, losses, streaks, frames_won/lost,
  // form_5/10, form_score) for either player. Those fields still reflect
  // the voided match's original numbers until the player's next fresh
  // enter-match call, since enter-match's updatePlayerAfterMatch
  // recomputes player_statistics from the full match history each time —
  // so a subsequent match will self-correct these fields, but they're
  // stale in the interim between a correction and that player's next
  // match. Correctly recomputing player_statistics here would mean reusing
  // the same aggregation logic enter-match's updatePlayerAfterMatch already
  // performs — worth extracting into a shared helper in a future task
  // rather than duplicating that logic inline in this replay.
  return { error: null };
}
