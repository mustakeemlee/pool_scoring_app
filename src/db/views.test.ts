// src/db/views.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';
import { createScratchSchema, dropScratchSchema, randomSchemaName } from './scratchSchema';
import { loadRootEnv } from '../testEnv';

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? loadRootEnv().TEST_DATABASE_URL;

let client: Client;
let schemaName: string;
let seasonId: string;

beforeAll(async () => {
  client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  schemaName = randomSchemaName('pool_league_views_test');
  await createScratchSchema(client, schemaName);
  await applyMigrations(client);

  const season = await client.query(
    `insert into seasons (name, start_date) values ('View Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;

  // Played several matches, high rating -- should rank first.
  const veteran = await client.query(`insert into players (full_name) values ('Veteran Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1800, 5, 'A')`,
    [veteran.rows[0].id, seasonId],
  );

  // Played one match -- ranks below the veteran (lower rating) but above
  // anyone who hasn't played at all.
  const newcomer = await client.query(`insert into players (full_name) values ('Newcomer Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1500, 1, 'B')`,
    [newcomer.rows[0].id, seasonId],
  );

  // Never played this season -- no player_season_ratings row at all.
  await client.query(`insert into players (full_name) values ('Never Played')`);
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('leaderboard_view', () => {
  it('includes every active player regardless of matches played', async () => {
    const result = await client.query(
      `select full_name from leaderboard_view where season_id = $1 order by rank`,
      [seasonId],
    );
    expect(result.rows.map((r: { full_name: string }) => r.full_name)).toEqual([
      'Veteran Player',
      'Newcomer Player',
      'Never Played',
    ]);
  });

  it('ranks every player who has played above every player who has not, regardless of rating', async () => {
    const result = await client.query(
      `select full_name, rank, matches_played from leaderboard_view where season_id = $1 order by rank`,
      [seasonId],
    );
    expect(result.rows).toEqual([
      { full_name: 'Veteran Player', rank: '1', matches_played: 5 },
      { full_name: 'Newcomer Player', rank: '2', matches_played: 1 },
      { full_name: 'Never Played', rank: '3', matches_played: 0 },
    ]);
  });

  it('defaults an unplayed player to the baseline rating and the worst grade', async () => {
    const result = await client.query(
      `select rating, grade from leaderboard_view where season_id = $1 and full_name = 'Never Played'`,
      [seasonId],
    );
    expect(result.rows[0].rating).toBe('1500');
    expect(result.rows[0].grade).toBe('D');
  });

  it("does not override a played player's earned grade", async () => {
    const result = await client.query(
      `select grade from leaderboard_view where season_id = $1 and full_name = 'Newcomer Player'`,
      [seasonId],
    );
    expect(result.rows[0].grade).toBe('B');
  });
});

describe('grade_distribution_view', () => {
  it('counts every active player, defaulting unplayed players to grade D', async () => {
    const result = await client.query(
      `select grade, player_count from grade_distribution_view where season_id = $1 order by grade`,
      [seasonId],
    );
    expect(result.rows).toEqual([
      { grade: 'A', player_count: '1' },
      { grade: 'B', player_count: '1' },
      { grade: 'D', player_count: '1' },
    ]);
  });
});

// Fix 1 (whole-branch review): leaderboard_view/grade_distribution_view had
// no PostgREST grants for anon/authenticated, confirmed live during the
// whole-branch review ("set role anon; select * from leaderboard_view" ->
// ERROR 42501 permission denied for view leaderboard_view). Design spec
// section 6 says Phase 3's frontend reads these views directly via
// PostgREST as a public/authenticated user, so this is a real in-scope gap,
// not a future concern. Postgres roles are cluster-wide (not per-database),
// so the anon/authenticated roles Supabase provisions already exist in this
// scratch database's cluster - SET ROLE lets a superuser connection assume
// them directly without a separate PostgREST round-trip.
//
// Fix 2 (20260724010000_require_login_for_league_data.sql): anon's grant
// was later revoked -- viewing the league now requires login -- so anon is
// asserted denied below and authenticated keeps the access it always had.
describe('view grants for anon/authenticated (PostgREST access)', () => {
  afterAll(async () => {
    await client.query('reset role');
  });

  it('denies anon select on leaderboard_view (login now required for league data)', async () => {
    await client.query('set role anon');
    try {
      await expect(
        client.query(`select player_id from leaderboard_view where season_id = $1`, [seasonId]),
      ).rejects.toThrow(/permission denied for view leaderboard_view/);
    } finally {
      await client.query('reset role');
    }
  });

  it('denies anon select on grade_distribution_view (login now required for league data)', async () => {
    await client.query('set role anon');
    try {
      await expect(
        client.query(`select grade from grade_distribution_view where season_id = $1`, [seasonId]),
      ).rejects.toThrow(/permission denied for view grade_distribution_view/);
    } finally {
      await client.query('reset role');
    }
  });

  it('allows authenticated to select from leaderboard_view', async () => {
    await client.query('set role authenticated');
    try {
      const result = await client.query(
        `select player_id from leaderboard_view where season_id = $1`,
        [seasonId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    } finally {
      await client.query('reset role');
    }
  });

  it('allows authenticated to select from grade_distribution_view', async () => {
    await client.query('set role authenticated');
    try {
      const result = await client.query(
        `select grade from grade_distribution_view where season_id = $1`,
        [seasonId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    } finally {
      await client.query('reset role');
    }
  });
});
