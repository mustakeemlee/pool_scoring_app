// src/api/closeWeek.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

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
});
