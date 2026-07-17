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

  // Regression test: avg_opponent_rating must use each opponent's rating AT THE
  // TIME of the match (their rating_before snapshot in rating_events), not their
  // current/latest rating. A single-match test can't distinguish these two
  // behaviors because a player's first-ever match always has an opponent whose
  // "current" and "at match time" ratings are identical (both 1500, the
  // baseline). This scenario is the minimal case where they diverge: B's rating
  // changes between match 1 (A beats B) and match 3 (B beats A), so if the
  // implementation incorrectly used B's *current* rating to compute A's
  // avg_opponent_rating, it would get a different (wrong) number than using B's
  // rating_before snapshot from match 1.
  it('computes avg_opponent_rating from each opponent\'s rating at match time, not their current rating', async () => {
    const playerA = await createPlayer('Snapshot Player A');
    const playerB = await createPlayer('Snapshot Player B');
    const playerC = await createPlayer('Snapshot Player C');

    async function enterMatch(matchDate: string, pA: string, pB: string, framesA: number, framesB: number) {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: matchDate,
          player_a_id: pA,
          player_b_id: pB,
          frames_a: framesA,
          frames_b: framesB,
        }),
      });
      expect(response.status).toBe(201);
    }

    // 1. A beats B, 5-3 -> A: 1500 -> 1528.125, B: 1500 -> 1471.875
    await enterMatch('2026-02-01', playerA, playerB, 5, 3);
    // 2. A beats C, 5-2 -> A going in at 1528.125, C going in at 1500 (first match)
    await enterMatch('2026-02-02', playerA, playerC, 5, 2);
    // 3. B beats A, 5-1 -> B going in at 1471.875, A going in at whatever it became after match 2
    await enterMatch('2026-02-03', playerB, playerA, 5, 1);

    const statsA = await dbClient.query(
      `select avg_opponent_rating from player_statistics where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );

    // A's opponents at match time: B@1500 (match 1), C@1500 (match 2), B@1471.875 (match 3)
    const expectedAvgOpponentRating = (1500 + 1500 + 1471.875) / 3; // 1490.625
    expect(Number(statsA.rows[0].avg_opponent_rating)).toBeCloseTo(expectedAvgOpponentRating, 2);
  });

  it('rejects a request with frames sent as strings instead of numbers, rather than silently miscomputing the winner', async () => {
    const playerA = await createPlayer('Validation Player A');
    const playerB = await createPlayer('Validation Player B');
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-09',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: '2', frames_b: '10',
      }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects equal frame counts', async () => {
    const playerA = await createPlayer('Tie Player A');
    const playerB = await createPlayer('Tie Player B');
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-09',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 4, frames_b: 4,
      }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent player_id instead of silently creating a phantom rating row', async () => {
    const playerA = await createPlayer('Phantom Check Player A');
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-09',
        player_a_id: playerA, player_b_id: '00000000-0000-0000-0000-000000000000',
        frames_a: 5, frames_b: 2,
      }),
    });
    expect(response.status).toBe(400);
  });

  it('returns the existing match instead of duplicating it when the identical request is retried', async () => {
    const playerA = await createPlayer('Retry Player A');
    const playerB = await createPlayer('Retry Player B');
    const submit = () => fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-10',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 5, frames_b: 3,
      }),
    });

    const first = await submit();
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await submit();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.match_id).toBe(firstBody.match_id);

    const matchCount = await dbClient.query(
      `select count(*)::int as count from matches where player_a_id = $1 and player_b_id = $2`,
      [playerA, playerB],
    );
    expect(matchCount.rows[0].count).toBe(1);
  });

  it('does not lose a rating update when many matches for the same player are entered concurrently', async () => {
    const anchor = await createPlayer('Concurrency Anchor');
    const opponents = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createPlayer(`Concurrency Opponent ${i}`)),
    );

    const responses = await Promise.all(
      opponents.map((opponentId, i) =>
        fetch(`${status.API_URL}/functions/v1/enter-match`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            season_id: seasonId, match_date: '2026-01-11',
            player_a_id: anchor, player_b_id: opponentId,
            frames_a: 5, frames_b: 2 + (i % 2),
          }),
        }),
      ),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);

    const anchorRating = await dbClient.query(
      `select matches_played from player_season_ratings where player_id = $1 and season_id = $2`,
      [anchor, seasonId],
    );
    expect(anchorRating.rows[0].matches_played).toBe(opponents.length);
  });
});
