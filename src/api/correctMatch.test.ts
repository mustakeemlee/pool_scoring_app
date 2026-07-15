// src/api/correctMatch.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';
import { calculateSeasonPoints } from '../rating/seasonPoints';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;
let seasonId: string;

async function enterMatch(playerA: string, playerB: string, framesA: number, framesB: number) {
  const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      season_id: seasonId,
      match_date: '2026-01-08',
      player_a_id: playerA,
      player_b_id: playerB,
      frames_a: framesA,
      frames_b: framesB,
    }),
  });
  const body = await response.json();
  return body.match_id as string;
}

// Like enterMatch, but for a caller-chosen season_id/match_date - needed by
// the cumulative matches_played/season_points regression test below, which
// deliberately uses its own dedicated season (so close-week's open-matches
// sweep can't pick up unrelated matches from this file's other tests) and
// two distinct match_date periods (a closed week, then a later open week).
async function enterMatchIn(
  targetSeasonId: string,
  playerA: string,
  playerB: string,
  framesA: number,
  framesB: number,
  matchDate: string,
) {
  const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      season_id: targetSeasonId,
      match_date: matchDate,
      player_a_id: playerA,
      player_b_id: playerB,
      frames_a: framesA,
      frames_b: framesB,
    }),
  });
  const body = await response.json();
  return body.match_id as string;
}

async function closeWeek(targetSeasonId: string, weekEnding: string) {
  return fetch(`${status.API_URL}/functions/v1/close-week`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ season_id: targetSeasonId, week_ending: weekEnding }),
  });
}

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Correct Match Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

describe('PATCH /functions/v1/correct-match', () => {
  it('rejects correcting a match whose week is already closed', async () => {
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Closed Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Closed Player B') returning id`)).rows[0].id;
    const matchId = await enterMatch(playerA, playerB, 5, 3);
    await dbClient.query(`update matches set is_period_closed = true where id = $1`, [matchId]);

    const response = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 4 }),
    });
    expect(response.status).toBe(400);
  });

  it('voids the old match, inserts a corrected one, and replays the open week rating', async () => {
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Correct Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Correct Player B') returning id`)).rows[0].id;
    const matchId = await enterMatch(playerA, playerB, 5, 0); // whitewash, entered by mistake

    const response = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 4 }), // actually a narrow win
    });
    expect(response.status).toBe(200);

    const oldMatch = await dbClient.query(`select is_voided from matches where id = $1`, [matchId]);
    expect(oldMatch.rows[0].is_voided).toBe(true);

    const correctedMatches = await dbClient.query(
      `select frames_a, frames_b from matches where player_a_id = $1 and is_voided = false`,
      [playerA],
    );
    expect(correctedMatches.rows).toEqual([{ frames_a: 5, frames_b: 4 }]);

    const finalRating = await dbClient.query(
      `select rating from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    // A narrower win moves the rating up less than a whitewash would have.
    expect(Number(finalRating.rows[0].rating)).toBeGreaterThan(1500);
    expect(Number(finalRating.rows[0].rating)).toBeLessThan(1525);
  });

  // Regression test for the whole-branch review's Fix 2 + Fix 3: correcting
  // an open-week match for a player who already has a formally closed week
  // must NOT reset matches_played to just the open week's count (Fix 2), and
  // must recompute season_points cumulatively rather than silently dropping
  // it (Fix 3). Both bugs live in the same replayOpenWeek loop in
  // correct-match/index.ts, so both are proven by one scenario: 3 matches
  // across a week that gets formally closed via close-week, then 1 more
  // match in a brand-new open week that gets corrected.
  it('replays matches_played and season_points cumulatively across a closed week plus an open-week correction', async () => {
    // Dedicated season, isolated from this file's other tests, so
    // close-week's open-matches sweep (which operates on the whole season,
    // not just one match) can't accidentally pick up unrelated open matches
    // left behind by the tests above.
    const season = await dbClient.query(
      `insert into seasons (name, start_date) values ('Correct Match Cumulative Test Season', '2026-01-01') returning id`,
    );
    const cumSeasonId = season.rows[0].id;

    const playerA = (await dbClient.query(`insert into players (full_name) values ('Cumulative Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Cumulative Player B') returning id`)).rows[0].id;

    // 3 matches in what will become a closed week; player A wins all 3.
    await enterMatchIn(cumSeasonId, playerA, playerB, 5, 3, '2026-01-08');
    await enterMatchIn(cumSeasonId, playerA, playerB, 5, 2, '2026-01-09');
    await enterMatchIn(cumSeasonId, playerA, playerB, 5, 4, '2026-01-10');

    const closeResponse = await closeWeek(cumSeasonId, '2026-01-11');
    expect(closeResponse.status).toBe(200);

    // Baseline: the cumulative season_points value as of the close, read
    // from weekly_rankings (close-week/index.ts:179 writes this as the
    // player's cumulative player_season_ratings.season_points at close
    // time) - this is exactly the baseline the fix is supposed to read.
    const closedWeekRow = await dbClient.query(
      `select season_points from weekly_rankings where player_id = $1 and season_id = $2 and week_ending = '2026-01-11'`,
      [playerA, cumSeasonId],
    );
    const baselineSeasonPoints = Number(closedWeekRow.rows[0].season_points);
    expect(baselineSeasonPoints).toBeGreaterThan(0);

    // One more match in a NEW open week (dated after the closed week_ending).
    const openMatchId = await enterMatchIn(cumSeasonId, playerA, playerB, 5, 1, '2026-01-15');

    // Capture player B's rating immediately before correcting: this is
    // exactly the opponent input correct-match's replay for player A will
    // read (replayOpenWeek(playerA) runs before replayOpenWeek(playerB)
    // within the same request, so B's row is still untouched by this
    // correction at the moment A is replayed).
    const opponentBefore = await dbClient.query(
      `select rating from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerB, cumSeasonId],
    );
    const opponentRatingForReplay = Number(opponentBefore.rows[0].rating);

    // Correct the open-week match's frame score (still a win for A: 5-2
    // instead of the original 5-1).
    const correctResponse = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: openMatchId, frames_a: 5, frames_b: 2 }),
    });
    expect(correctResponse.status).toBe(200);
    const { corrected_match_id: correctedMatchId } = await correctResponse.json();

    const finalRow = await dbClient.query(
      `select matches_played, is_provisional, season_points from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerA, cumSeasonId],
    );

    // Fix 2: 3 already-closed matches + 1 replayed open-week match = 4, not
    // reset to just the open week's replayed count of 1 (the bug).
    expect(finalRow.rows[0].matches_played).toBe(4);
    // Fix 2 knock-on effect: matches_played >= MIN_MATCHES_FOR_RANKING (3)
    // must keep is_provisional false, not flip it back to true (which would
    // eject this player from leaderboard_view/grade_distribution_view).
    expect(finalRow.rows[0].is_provisional).toBe(false);

    // Fix 3: independently re-derive the expected season_points as
    // baseline + calculateSeasonPoints for the corrected match, using the
    // REAL rating_after the replay produced for this match (ground truth of
    // what the instant nudge actually computed, read from rating_events -
    // not a re-derived Elo calculation, which would risk transcribing the
    // nudge math wrong in the test itself) and player B's rating exactly as
    // it stood immediately before this correction (the exact opponent input
    // the replay used).
    const replayedEvent = await dbClient.query(
      `select rating_after from rating_events where match_id = $1 and player_id = $2 and event_type = 'instant'`,
      [correctedMatchId, playerA],
    );
    const ownRatingAfterReplay = Number(replayedEvent.rows[0].rating_after);

    const expectedPointsEarned = calculateSeasonPoints({
      won: true, // corrected 5-2 is still a win for player A
      framesFor: 5,
      framesAgainst: 2,
      ownRating: ownRatingAfterReplay,
      opponentRating: opponentRatingForReplay,
    });

    // Tight equality, not a loose range check: proves season_points is
    // specifically baseline + this correction's earned points, not just
    // "some positive number" and not the pre-fix value (which would have
    // been the ORIGINAL 5-1 match's now-voided points still baked in, with
    // nothing added for the correction).
    expect(finalRow.rows[0].season_points).toBe(baselineSeasonPoints + expectedPointsEarned);
  });
});
