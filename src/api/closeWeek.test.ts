// src/api/closeWeek.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';
import { reconcilePeriod } from '../rating/glicko2';

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

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Close Week Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

describe('POST /functions/v1/close-week', () => {
  it('reconciles ratings via Glicko-2, writes weekly_rankings, and locks the matches', async () => {
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Close Week Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Close Week Player B') returning id`)).rows[0].id;
    const matchId = await enterMatch(playerA, playerB, 5, 2);

    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });
    expect(response.status).toBe(200);

    const match = await dbClient.query(`select is_period_closed from matches where id = $1`, [matchId]);
    expect(match.rows[0].is_period_closed).toBe(true);

    const weeklyRanking = await dbClient.query(
      `select rank, grade, rd from weekly_rankings where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(weeklyRanking.rows[0].rank).toBe(1);
    // rd must be the real reconciled value (Glicko-2 shrinks it from the 350
    // starting default after one game), not a placeholder.
    expect(Number(weeklyRanking.rows[0].rd)).toBeGreaterThan(0);
    expect(Number(weeklyRanking.rows[0].rd)).toBeLessThan(350);

    const ratingEvent = await dbClient.query(
      `select event_type, volatility_before, volatility_after from rating_events
       where player_id = $1 and season_id = $2 and event_type = 'weekly_reconciliation'`,
      [playerA, seasonId],
    );
    expect(ratingEvent.rows[0].volatility_before).not.toBeNull();
    expect(ratingEvent.rows[0].volatility_after).not.toBeNull();
  });

  it('rejects correcting a match after its week has closed', async () => {
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Locked Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Locked Player B') returning id`)).rows[0].id;
    const matchId = await enterMatch(playerA, playerB, 5, 1);

    await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });

    const correctResponse = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 2 }),
    });
    expect(correctResponse.status).toBe(400);
  });

  it('reconciles every player against opponents\' PRE-period ratings, not opponents\' live-updated mid-loop ratings (opponent-snapshot contamination regression test)', async () => {
    // Regression test for a real bug found & fixed during Task 9's implementation
    // (see .superpowers/sdd/task-9-report.md, Deviation 1): the reconciliation loop
    // in close-week/index.ts must read every opponent's rating/rd from a single
    // frozen pre-period snapshot fetched before the loop starts, not live from
    // player_season_ratings mid-loop while that same loop is writing reconciled
    // results back to that table. A 2-player/1-match scenario (see the first test
    // above) cannot exercise this: there is no second pairing whose "already
    // reconciled" rating could contaminate anyone else's opponent input. This needs
    // a 3rd player who shares an opponent with someone else closed in the same call.
    //
    // P2 beats P1, and P2 beats P3, in the same open week. P3's reconciliation must
    // use P2's rating as it stood BEFORE this close-week call (its pre-period
    // state), never P2's rating AFTER close-week's own loop has already reconciled
    // P2 within this same run.
    const p1 = (await dbClient.query(`insert into players (full_name) values ('Snapshot Test P1') returning id`)).rows[0].id;
    const p2 = (await dbClient.query(`insert into players (full_name) values ('Snapshot Test P2') returning id`)).rows[0].id;
    const p3 = (await dbClient.query(`insert into players (full_name) values ('Snapshot Test P3') returning id`)).rows[0].id;

    await enterMatch(p2, p1, 5, 2); // P2 beats P1
    await enterMatch(p2, p3, 5, 3); // P2 beats P3

    // Capture each player's PRE-close-week state (post enter-match instant nudge,
    // pre-Glicko-2 batch reconciliation) - this is exactly the frozen snapshot
    // close-week's own pre-period query is supposed to read.
    async function preState(playerId: string) {
      const row = (
        await dbClient.query(
          `select rating, rd, volatility from player_season_ratings where player_id = $1 and season_id = $2`,
          [playerId, seasonId],
        )
      ).rows[0];
      return { rating: Number(row.rating), rd: Number(row.rd), volatility: Number(row.volatility) };
    }
    const p1Pre = await preState(p1);
    const p2Pre = await preState(p2);
    const p3Pre = await preState(p3);

    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });
    expect(response.status).toBe(200);

    // "Correct" hypothesis: P3 reconciled against P2's PRE-period rating/rd
    // (P3 lost to P2, so score is 0 from P3's perspective).
    const correct = reconcilePeriod(p3Pre, [{ rating: p2Pre.rating, rd: p2Pre.rd, score: 0 }]);

    // "Contaminated" hypothesis, included only to make the test's intent
    // self-documenting (the tight-tolerance assertion against `correct` below is
    // what actually catches a regression). This is what P3's result would be if
    // the implementation instead read P2's POST-reconciliation rating live
    // mid-loop - the exact bug this test guards against. P2's own reconciliation
    // uses its pre-period state against both of ITS opponents' (P1, P3) pre-period
    // ratings (P2 beat both, so score 1 from P2's perspective both times).
    const p2Reconciled = reconcilePeriod(p2Pre, [
      { rating: p1Pre.rating, rd: p1Pre.rd, score: 1 },
      { rating: p3Pre.rating, rd: p3Pre.rd, score: 1 },
    ]);
    const contaminated = reconcilePeriod(p3Pre, [{ rating: p2Reconciled.rating, rd: p2Reconciled.rd, score: 0 }]);

    const actual = await dbClient.query(
      `select rating_after, rd_after from rating_events
       where player_id = $1 and season_id = $2 and event_type = 'weekly_reconciliation'`,
      [p3, seasonId],
    );
    const actualRatingAfter = Number(actual.rows[0].rating_after);
    const actualRdAfter = Number(actual.rows[0].rd_after);

    // Primary assertion: the actual DB value must match the independently
    // re-derived "correct" (pre-period-snapshot) hypothesis to a tight tolerance,
    // not just a loose range check.
    expect(actualRatingAfter).toBeCloseTo(correct.rating, 6);
    expect(actualRdAfter).toBeCloseTo(correct.rd, 6);

    // Secondary, self-documenting assertion: the two hypotheses are numerically
    // distinguishable (order of tens of rating points apart), so this also
    // confirms the actual result did NOT come from the contaminated code path.
    expect(Math.abs(correct.rating - contaminated.rating)).toBeGreaterThan(1);
    expect(Math.abs(actualRatingAfter - contaminated.rating)).toBeGreaterThan(1);
  });
});
