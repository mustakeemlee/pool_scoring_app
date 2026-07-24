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

  // Player eligible for the leaderboard (matches_played >= 3)
  const eligible = await client.query(`insert into players (full_name) values ('Eligible Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1800, 5, 'A')`,
    [eligible.rows[0].id, seasonId],
  );

  // Player NOT eligible (matches_played < 3)
  const ineligible = await client.query(`insert into players (full_name) values ('New Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1500, 1, 'B')`,
    [ineligible.rows[0].id, seasonId],
  );
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('leaderboard_view', () => {
  it('includes only players with matches_played >= 3', async () => {
    const result = await client.query(`select full_name from leaderboard_view where season_id = $1`, [seasonId]);
    expect(result.rows.map((r: { full_name: string }) => r.full_name)).toEqual(['Eligible Player']);
  });

  it('assigns rank 1 to the only eligible player', async () => {
    const result = await client.query(`select rank from leaderboard_view where season_id = $1`, [seasonId]);
    expect(result.rows[0].rank).toBe('1');
  });
});

describe('grade_distribution_view', () => {
  it('counts only eligible players per grade', async () => {
    const result = await client.query(
      `select grade, player_count from grade_distribution_view where season_id = $1`,
      [seasonId],
    );
    expect(result.rows).toEqual([{ grade: 'A', player_count: '1' }]);
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
