// src/api/correctMatch.test.ts
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
});
