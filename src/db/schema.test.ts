// src/db/schema.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';
import { createScratchSchema, dropScratchSchema, randomSchemaName } from './scratchSchema';
import { loadRootEnv } from '../testEnv';

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? loadRootEnv().TEST_DATABASE_URL;

let client: Client;
let schemaName: string;

beforeAll(async () => {
  client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  schemaName = randomSchemaName('pool_league_schema_test');
  await createScratchSchema(client, schemaName);
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('initial schema', () => {
  it('creates all required tables', async () => {
    const result = await client.query(
      `select table_name from information_schema.tables
       where table_schema = $1 and table_type = 'BASE TABLE'
       order by table_name`,
      [schemaName],
    );
    const tableNames = result.rows.map((r: { table_name: string }) => r.table_name);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'fixtures',
        'match_audit_log',
        'matches',
        'player_claims',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'user_profiles',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('rejects a match where a player plays against themselves', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 1', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Solo Player') returning id`,
    );
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await expect(
      client.query(
        `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
         values ($1, '2026-01-08', $2, $2, 5, 3, $2)`,
        [seasonId, playerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a match that ends in a tied frame score', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 2', '2026-01-01') returning id`,
    );
    const playerA = await client.query(`insert into players (full_name) values ('Player A') returning id`);
    const playerB = await client.query(`insert into players (full_name) values ('Player B') returning id`);

    await expect(
      client.query(
        `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
         values ($1, '2026-01-08', $2, $3, 4, 4, $2)`,
        [season.rows[0].id, playerA.rows[0].id, playerB.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('enforces one rating row per player per season', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 3', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Dup Player') returning id`,
    );
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await client.query(
      `insert into player_season_ratings (player_id, season_id) values ($1, $2)`,
      [playerId, seasonId],
    );

    await expect(
      client.query(
        `insert into player_season_ratings (player_id, season_id) values ($1, $2)`,
        [playerId, seasonId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid grade value', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 4', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Grade Player') returning id`,
    );

    await expect(
      client.query(
        `insert into player_season_ratings (player_id, season_id, grade) values ($1, $2, 'Z')`,
        [player.rows[0].id, season.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('defaults a new rating row to the baseline rating and matching grade', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 5', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Default Player') returning id`,
    );

    const row = await client.query(
      `insert into player_season_ratings (player_id, season_id) values ($1, $2) returning rating, grade, is_provisional`,
      [player.rows[0].id, season.rows[0].id],
    );

    expect(Number(row.rows[0].rating)).toBe(1500);
    expect(row.rows[0].grade).toBe('B');
    expect(row.rows[0].is_provisional).toBe(true);
  });

  it('defaults is_period_closed to false and allows it to be set true', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 6', '2026-01-01') returning id`,
    );
    const playerA = await client.query(`insert into players (full_name) values ('Period Player A') returning id`);
    const playerB = await client.query(`insert into players (full_name) values ('Period Player B') returning id`);

    const inserted = await client.query(
      `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
       values ($1, '2026-01-08', $2, $3, 5, 3, $2) returning id, is_period_closed`,
      [season.rows[0].id, playerA.rows[0].id, playerB.rows[0].id],
    );
    expect(inserted.rows[0].is_period_closed).toBe(false);

    const updated = await client.query(
      `update matches set is_period_closed = true where id = $1 returning is_period_closed`,
      [inserted.rows[0].id],
    );
    expect(updated.rows[0].is_period_closed).toBe(true);
  });

  it('rejects a fixture where a player plays against themselves', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 7', '2026-01-01') returning id`,
    );
    const player = await client.query(`insert into players (full_name) values ('Solo Fixture Player') returning id`);
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await expect(
      client.query(
        `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
         values ($1, '2026-02-01', $2, $2)`,
        [seasonId, playerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a fixture marked completed with no completed_match_id', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 8', '2026-01-01') returning id`,
    );
    const playerA = await client.query(`insert into players (full_name) values ('Completed Fixture Player A') returning id`);
    const playerB = await client.query(`insert into players (full_name) values ('Completed Fixture Player B') returning id`);

    await expect(
      client.query(
        `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id, status)
         values ($1, '2026-02-01', $2, $3, 'completed')`,
        [season.rows[0].id, playerA.rows[0].id, playerB.rows[0].id],
      ),
    ).rejects.toThrow();
  });
});
