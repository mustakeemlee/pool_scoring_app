// src/api/fixtures.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  provisionTestUser,
  cleanupTestUser,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
} from './testSupport';

let status: SupabaseStatus;
let dbClient: Client;
const createdPlayerIds: string[] = [];
const createdSeasonIds: string[] = [];
const createdUserIds: string[] = [];

function asUser(accessToken: string) {
  return createClient(status.API_URL, status.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

async function createSeason(name: string): Promise<string> {
  const result = await dbClient.query(
    `insert into seasons (name, start_date) values ($1, '2026-01-01') returning id`,
    [name],
  );
  const id = result.rows[0].id;
  createdSeasonIds.push(id);
  return id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

afterAll(async () => {
  for (const userId of createdUserIds) {
    await cleanupTestUser(status, userId);
  }
  await dbClient.query(`delete from fixtures where season_id = any($1::uuid[])`, [createdSeasonIds]);
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, createdSeasonIds);
  await dbClient.end();
}, 30000);

describe('fixtures RLS', () => {
  it('lets an admin create a fixture; denies a non-admin authenticated user', async () => {
    const admin = await provisionTestAdmin(status);
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerA = await createPlayer('Fixture RLS Player A');
    const playerB = await createPlayer('Fixture RLS Player B');
    const seasonId = await createSeason('Fixture RLS Season');

    try {
      const adminClient = asUser(admin.accessToken);
      const adminInsert = await adminClient.from('fixtures').insert({
        season_id: seasonId,
        scheduled_date: '2026-02-01',
        player_a_id: playerA,
        player_b_id: playerB,
      });
      expect(adminInsert.error).toBeNull();

      const userClient = asUser(user.accessToken);
      const userInsert = await userClient.from('fixtures').insert({
        season_id: seasonId,
        scheduled_date: '2026-02-02',
        player_a_id: playerA,
        player_b_id: playerB,
      });
      expect(userInsert.error).not.toBeNull();
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('lets an admin void a fixture; denies a non-admin authenticated user', async () => {
    const admin = await provisionTestAdmin(status);
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerA = await createPlayer('Fixture Void RLS Player A');
    const playerB = await createPlayer('Fixture Void RLS Player B');
    const seasonId = await createSeason('Fixture Void RLS Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-02-03', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const userClient = asUser(user.accessToken);
      const userVoid = await userClient.from('fixtures').update({ status: 'voided' }).eq('id', fixtureId).select();
      expect(userVoid.data).toHaveLength(0);

      const adminClient = asUser(admin.accessToken);
      const adminVoid = await adminClient.from('fixtures').update({ status: 'voided' }).eq('id', fixtureId).select();
      expect(adminVoid.data).toHaveLength(1);
      expect(adminVoid.data?.[0].status).toBe('voided');
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('lets any authenticated user read fixtures', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerA = await createPlayer('Fixture Read RLS Player A');
    const playerB = await createPlayer('Fixture Read RLS Player B');
    const seasonId = await createSeason('Fixture Read RLS Season');

    await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id) values ($1, '2026-02-04', $2, $3)`,
      [seasonId, playerA, playerB],
    );

    const userClient = asUser(user.accessToken);
    const result = await userClient.from('fixtures').select('id').eq('season_id', seasonId);
    expect(result.data).toHaveLength(1);
  });
});
