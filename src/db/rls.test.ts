// src/db/rls.test.ts
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
  schemaName = randomSchemaName('pool_league_rls_test');
  await createScratchSchema(client, schemaName);
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('row level security', () => {
  it('enables RLS on all 11 tables', async () => {
    const result = await client.query(
      `select relname from pg_class
       join pg_namespace on pg_namespace.oid = pg_class.relnamespace
       where pg_namespace.nspname = $1 and relrowsecurity = true
       order by relname`,
      [schemaName],
    );
    const tableNames = result.rows.map((r: { relname: string }) => r.relname);
    expect(tableNames).toEqual(
      [
        'admin_users',
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

  it('grants a select policy on every publicly/self-readable table', async () => {
    const result = await client.query(
      `select distinct tablename from pg_policies where schemaname = $1 and cmd = 'SELECT' order by tablename`,
      [schemaName],
    );
    const tableNames = result.rows.map((r: { tablename: string }) => r.tablename);
    expect(tableNames).toEqual(
      [
        'admin_users',
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

  it('defines no select policy at all for match_audit_log', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = $1 and tablename = 'match_audit_log'`,
      [schemaName],
    );
    expect(result.rows).toEqual([]);
  });
});

// Fix (Phase 3 PlayerProfile dependency, 20260714060000_rating_events_public_read.sql;
// later revoked from anon by 20260724010000_require_login_for_league_data.sql):
// rating_events was previously fully private (no public SELECT policy), grouped
// with admin_users/match_audit_log. Phase 3's PlayerProfile page needs to read it
// as an authenticated user for the rating-history chart and match rating-deltas.
// admin_users and match_audit_log remain fully private (see tests above/below).
describe('rating_events read access (authenticated only, PostgREST access)', () => {
  afterAll(async () => {
    await client.query('reset role');
  });

  it('denies anon select on rating_events (login now required for league data)', async () => {
    await client.query('set role anon');
    try {
      await expect(client.query('select * from rating_events limit 1')).rejects.toThrow(
        /permission denied for table rating_events/,
      );
    } finally {
      await client.query('reset role');
    }
  });

  it('allows authenticated to select from rating_events', async () => {
    await client.query('set role authenticated');
    try {
      const result = await client.query('select * from rating_events limit 1');
      expect(result.rows).toEqual([]);
    } finally {
      await client.query('reset role');
    }
  });

  it('still denies anon select on match_audit_log (regression check)', async () => {
    await client.query('set role anon');
    try {
      await expect(client.query('select * from match_audit_log limit 1')).rejects.toThrow(
        /permission denied for table match_audit_log/,
      );
    } finally {
      await client.query('reset role');
    }
  });

  it('still denies anon select on admin_users beyond own row (regression check)', async () => {
    // admin_users retains table-level GRANT SELECT for authenticated only (not anon);
    // anon has no table-level grant at all, so it fails at the GRANT layer.
    await client.query('set role anon');
    try {
      await expect(client.query('select * from admin_users limit 1')).rejects.toThrow(
        /permission denied for table admin_users/,
      );
    } finally {
      await client.query('reset role');
    }
  });
});

// 20260724010000_require_login_for_league_data.sql: league data (players,
// seasons, ratings, matches, rankings, statistics) is no longer readable by
// anon -- the frontend now requires login before showing any of it. RLS
// policies stay `using (true)` (still correct for authenticated); only the
// anon GRANTs were revoked, so authenticated keeps exactly the access it had
// before.
describe('league data requires login (anon denied, authenticated allowed)', () => {
  afterAll(async () => {
    await client.query('reset role');
  });

  // players only has column-level grants (id, full_name, joined_date,
  // is_active, created_at, updated_at, photo_url -- email is never granted,
  // see 20260717000000_audit_fixes.sql), so `select *` fails for
  // authenticated too; every other table here keeps its blanket table grant.
  const selects: Record<string, string> = {
    players: 'select id, full_name, joined_date, is_active, created_at, updated_at, photo_url from players limit 1',
    seasons: 'select * from seasons limit 1',
    player_season_ratings: 'select * from player_season_ratings limit 1',
    matches: 'select * from matches limit 1',
    weekly_rankings: 'select * from weekly_rankings limit 1',
    player_statistics: 'select * from player_statistics limit 1',
  };

  for (const [table, query] of Object.entries(selects)) {
    it(`denies anon select on ${table}`, async () => {
      await client.query('set role anon');
      try {
        await expect(client.query(query)).rejects.toThrow(new RegExp(`permission denied for table ${table}`));
      } finally {
        await client.query('reset role');
      }
    });

    it(`allows authenticated to select from ${table}`, async () => {
      await client.query('set role authenticated');
      try {
        const result = await client.query(query);
        expect(result.rows).toEqual([]);
      } finally {
        await client.query('reset role');
      }
    });
  }
});
