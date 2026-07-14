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

  const framesA = body.frames_a ?? original.frames_a;
  const framesB = body.frames_b ?? original.frames_b;
  const matchDate = body.match_date ?? original.match_date;
  const winnerId = framesA > framesB ? original.player_a_id : original.player_b_id;

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
  let matchesPlayed = 0;

  for (const match of openMatches ?? []) {
    const isPlayerA = match.player_a_id === playerId;
    const opponentId = isPlayerA ? match.player_b_id : match.player_a_id;
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

  return { error: null };
}
