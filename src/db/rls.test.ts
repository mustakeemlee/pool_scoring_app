// src/db/rls.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';

const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

let client: Client;

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_CONNECTION_STRING });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pool_league_rls_test');
  await admin.query('CREATE DATABASE pool_league_rls_test');
  await admin.end();

  const testConnectionString = ADMIN_CONNECTION_STRING.replace(/\/[^/]*$/, '/pool_league_rls_test');
  client = new Client({ connectionString: testConnectionString });
  await client.connect();
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
  await client.end();
});

describe('row level security', () => {
  it('enables RLS on all 9 tables', async () => {
    const result = await client.query(
      `select relname from pg_class
       join pg_namespace on pg_namespace.oid = pg_class.relnamespace
       where pg_namespace.nspname = 'public' and relrowsecurity = true
       order by relname`,
    );
    const tableNames = result.rows.map((r: { relname: string }) => r.relname);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'match_audit_log',
        'matches',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('grants a select policy on every publicly-readable table', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = 'public' and cmd = 'SELECT' order by tablename`,
    );
    const tableNames = result.rows.map((r: { tablename: string }) => r.tablename);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'matches',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('defines no select policy at all for match_audit_log', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = 'public' and tablename = 'match_audit_log'`,
    );
    expect(result.rows).toEqual([]);
  });
});

// Fix (Phase 3 PlayerProfile dependency, 20260714060000_rating_events_public_read.sql):
// rating_events was previously fully private (no public SELECT policy), grouped
// with admin_users/match_audit_log. Phase 3's PlayerProfile page needs to read it
// directly as an anon user for the rating-history chart and match rating-deltas.
// Confirmed live: querying rating_events with the anon key returned "permission
// denied for table rating_events" before this fix. Decision: grant public SELECT,
// since rating_events exposes nothing more sensitive than the already-public
// current ratings/match scores/season points -- it's just the math behind them.
// admin_users and match_audit_log remain fully private (see tests above/below).
describe('rating_events public read (anon/authenticated, PostgREST access)', () => {
  afterAll(async () => {
    await client.query('reset role');
  });

  it('allows anon to select from rating_events', async () => {
    await client.query('set role anon');
    try {
      const result = await client.query('select * from rating_events limit 1');
      expect(result.rows).toEqual([]);
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
