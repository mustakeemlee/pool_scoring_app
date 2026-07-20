// src/api/closeWeek.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  cleanupSeasonData,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
  type TestAdmin,
} from './testSupport';
import { reconcilePeriod } from '../rating/glicko2';
import { BASELINE_RATING, INITIAL_RD, INITIAL_VOLATILITY } from '../rating/constants';

let status: SupabaseStatus;
let admin: TestAdmin;
let accessToken: string;
let dbClient: Client;
let seasonId: string;
const createdPlayerIds: string[] = [];

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

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Close Week Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

afterAll(async () => {
  await cleanupSeasonData(dbClient, seasonId);
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, [seasonId]);
  await cleanupTestAdmin(status, admin.userId);
  await dbClient.end();
}, 30000);

describe('POST /functions/v1/close-week', () => {
  it('reconciles ratings via Glicko-2, writes weekly_rankings, and locks the matches', async () => {
    const playerA = await createPlayer('Close Week Player A');
    const playerB = await createPlayer('Close Week Player B');
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
    const playerA = await createPlayer('Locked Player A');
    const playerB = await createPlayer('Locked Player B');
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
    // Regression test for a real bug found & fixed in close-week's original
    // implementation: the reconciliation loop in close-week/index.ts must
    // read every opponent's rating/rd from a single
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
    const p1 = await createPlayer('Snapshot Test P1');
    const p2 = await createPlayer('Snapshot Test P2');
    const p3 = await createPlayer('Snapshot Test P3');

    await enterMatch(p2, p1, 5, 2); // P2 beats P1
    await enterMatch(p2, p3, 5, 3); // P2 beats P3

    // After the double-counting fix, close-week reconciles every player from
    // their TRUE pre-period baseline (getPriorPeriodBaseline: their most recent
    // weekly_reconciliation / season_carryover event, or the season's starting
    // defaults when no period has ever been closed for them) - NOT the live,
    // already-instant-nudged rating in player_season_ratings. P1/P2/P3 are all
    // fresh this season with no prior closed period, so every one of them shares
    // the same season-default baseline. The opponent-snapshot-freshness property
    // this test guards is unchanged: opponents are read from a single frozen
    // snapshot taken before the reconciliation loop, so P3 must still see P2's
    // PRE-reconciliation (here: baseline) rating, never P2's rating after
    // close-week's loop has already reconciled it within this same run.
    const baseline = { rating: BASELINE_RATING, rd: INITIAL_RD, volatility: INITIAL_VOLATILITY };

    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });
    expect(response.status).toBe(200);

    // "Correct" hypothesis: P3 reconciled against P2's pre-period (baseline)
    // rating/rd (P3 lost to P2, so score is 0 from P3's perspective).
    const correct = reconcilePeriod(baseline, [{ rating: baseline.rating, rd: baseline.rd, score: 0 }]);

    // "Contaminated" hypothesis, included only to make the test's intent
    // self-documenting (the tight-tolerance assertion against `correct` below is
    // what actually catches a regression). This is what P3's result would be if
    // the implementation instead read P2's POST-reconciliation rating live
    // mid-loop - the exact bug this test guards against. P2's own reconciliation
    // uses its pre-period (baseline) state against both of ITS opponents' (P1, P3)
    // pre-period (baseline) ratings (P2 beat both, so score 1 from P2's
    // perspective both times).
    const p2Reconciled = reconcilePeriod(baseline, [
      { rating: baseline.rating, rd: baseline.rd, score: 1 },
      { rating: baseline.rating, rd: baseline.rd, score: 1 },
    ]);
    const contaminated = reconcilePeriod(baseline, [{ rating: p2Reconciled.rating, rd: p2Reconciled.rd, score: 0 }]);

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

  it('reconciles from the true pre-period rating, not the live instant-nudged rating', async () => {
    const playerA = await createPlayer('CloseWeek Baseline Player A');
    const playerB = await createPlayer('CloseWeek Baseline Player B');

    await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-04-01',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 5, frames_b: 2,
      }),
    });

    const instantEvent = await dbClient.query(
      `select rating_before from rating_events where player_id = $1 and season_id = $2 and event_type = 'instant'`,
      [playerA, seasonId],
    );
    const preMatchRating = Number(instantEvent.rows[0].rating_before);

    const closeResponse = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-04-01' }),
    });
    expect(closeResponse.status).toBe(200);

    const reconciliationEvent = await dbClient.query(
      `select rating_before from rating_events where player_id = $1 and season_id = $2 and event_type = 'weekly_reconciliation' order by created_at desc limit 1`,
      [playerA, seasonId],
    );
    // The reconciliation's rating_before must equal the pre-MATCH baseline
    // (the true pre-period rating), not the post-instant-nudge live rating
    // that player_season_ratings held at close time.
    expect(Number(reconciliationEvent.rows[0].rating_before)).toBeCloseTo(preMatchRating, 5);
  });

  it('rejects a week_ending date before the season started', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2019-01-01' }),
    });
    expect(response.status).toBe(400);
  });
});
