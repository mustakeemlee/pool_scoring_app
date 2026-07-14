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
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('defines no select policy at all for match_audit_log or rating_events', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = 'public' and tablename in ('match_audit_log', 'rating_events')`,
    );
    expect(result.rows).toEqual([]);
  });
});
