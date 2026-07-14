import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;
let seasonId: string;

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('API Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  return result.rows[0].id;
}

describe('POST /functions/v1/enter-match', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.ANON_KEY}` },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('creates a match, updates both players ratings, stats, and season points', async () => {
    const playerA = await createPlayer('Enter Match Player A');
    const playerB = await createPlayer('Enter Match Player B');

    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId,
        match_date: '2026-01-08',
        player_a_id: playerA,
        player_b_id: playerB,
        frames_a: 5,
        frames_b: 3,
      }),
    });
    expect(response.status).toBe(201);

    const ratingA = await dbClient.query(
      `select rating, matches_played, season_points from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(Number(ratingA.rows[0].rating)).toBeGreaterThan(1500);
    expect(ratingA.rows[0].matches_played).toBe(1);
    expect(ratingA.rows[0].season_points).toBeGreaterThan(0);

    const ratingB = await dbClient.query(
      `select rating from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerB, seasonId],
    );
    expect(Number(ratingB.rows[0].rating)).toBeLessThan(1500);

    const statsA = await dbClient.query(
      `select wins, losses, current_streak from player_statistics where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(statsA.rows[0]).toEqual({ wins: 1, losses: 0, current_streak: 1 });

    const auditLog = await dbClient.query(`select change_type from match_audit_log where match_id in (select id from matches where player_a_id = $1)`, [playerA]);
    expect(auditLog.rows[0].change_type).toBe('created');
  });
});
