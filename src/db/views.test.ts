// src/db/views.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';

const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

let client: Client;
let seasonId: string;

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_CONNECTION_STRING });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pool_league_views_test');
  await admin.query('CREATE DATABASE pool_league_views_test');
  await admin.end();

  const testConnectionString = ADMIN_CONNECTION_STRING.replace(/\/[^/]*$/, '/pool_league_views_test');
  client = new Client({ connectionString: testConnectionString });
  await client.connect();
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
