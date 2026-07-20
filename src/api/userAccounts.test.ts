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
  type SupabaseStatus,
  type TestAdmin,
} from './testSupport';

let status: SupabaseStatus;
let dbClient: Client;
const createdPlayerIds: string[] = [];
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

beforeAll(async () => {
  status = getSupabaseStatus();
  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

afterAll(async () => {
  for (const userId of createdUserIds) {
    await cleanupTestUser(status, userId);
  }
  await deletePlayers(dbClient, createdPlayerIds);
  await dbClient.end();
}, 30000);

describe('signup trigger', () => {
  it('creates an unlinked user_profiles row automatically for a new signup', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);

    const row = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [user.userId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].linked_player_id).toBeNull();
  });
});

describe('user_profiles RLS', () => {
  it('lets a user read only their own profile row, not another user\'s', async () => {
    const userA = await provisionTestUser(status);
    createdUserIds.push(userA.userId);
    const userB = await provisionTestUser(status);
    createdUserIds.push(userB.userId);

    const clientA = asUser(userA.accessToken);
    const ownRow = await clientA.from('user_profiles').select('id').eq('id', userA.userId).maybeSingle();
    expect(ownRow.data).not.toBeNull();

    const otherRow = await clientA.from('user_profiles').select('id').eq('id', userB.userId).maybeSingle();
    expect(otherRow.data).toBeNull();
  });
});

describe('player_claims RLS', () => {
  it('lets a user insert only their own pending claim', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const otherUser = await provisionTestUser(status);
    createdUserIds.push(otherUser.userId);
    const playerId = await createPlayer('RLS Claim Player');

    const client = asUser(user.accessToken);
    const ownInsert = await client.from('player_claims').insert({ user_id: user.userId, player_id: playerId });
    expect(ownInsert.error).toBeNull();

    const spoofedInsert = await client
      .from('player_claims')
      .insert({ user_id: otherUser.userId, player_id: playerId });
    expect(spoofedInsert.error).not.toBeNull();
  });

  it('lets a user read only their own claims; lets an admin read all pending claims', async () => {
    const admin = await provisionTestAdmin(status);
    const userA = await provisionTestUser(status);
    createdUserIds.push(userA.userId);
    const userB = await provisionTestUser(status);
    createdUserIds.push(userB.userId);
    const playerA = await createPlayer('Claims Visibility Player A');
    const playerB = await createPlayer('Claims Visibility Player B');

    await dbClient.query(`insert into player_claims (user_id, player_id) values ($1, $2)`, [
      userA.userId,
      playerA,
    ]);
    await dbClient.query(`insert into player_claims (user_id, player_id) values ($1, $2)`, [
      userB.userId,
      playerB,
    ]);

    const clientA = asUser(userA.accessToken);
    const ownClaims = await clientA.from('player_claims').select('id, user_id');
    expect(ownClaims.data).toHaveLength(1);
    expect(ownClaims.data?.[0].user_id).toBe(userA.userId);

    const adminClient = asUser(admin.accessToken);
    const allClaims = await adminClient
      .from('player_claims')
      .select('id')
      .in('player_id', [playerA, playerB]);
    expect(allClaims.data).toHaveLength(2);

    await cleanupTestAdmin(status, admin.userId);
  });
});

describe('linked-player photo self-service RLS', () => {
  it('lets a linked player update only their own player\'s photo_url', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const ownPlayerId = await createPlayer('Linked Photo Player');
    const otherPlayerId = await createPlayer('Other Photo Player');

    // Link directly via service role for this test's setup -- the approval
    // workflow itself (review-player-claim) is covered in Task 2.
    await dbClient.query(`update user_profiles set linked_player_id = $1 where id = $2`, [
      ownPlayerId,
      user.userId,
    ]);

    // Explicit column list, not a bare .select() (-> select=*): `players.email`
    // has no SELECT grant at all for anon/authenticated (deliberate privacy
    // restriction, 20260717000000_audit_fixes.sql) and a wildcard select
    // would fail on that column for every non-admin/non-service-role client,
    // unrelated to the photo_url RLS behavior this test is actually checking.
    const client = asUser(user.accessToken);
    const ownUpdate = await client
      .from('players')
      .update({ photo_url: 'https://example.com/own.jpg' })
      .eq('id', ownPlayerId)
      .select('id, photo_url');
    expect(ownUpdate.data).toHaveLength(1);

    const otherUpdate = await client
      .from('players')
      .update({ photo_url: 'https://example.com/other.jpg' })
      .eq('id', otherPlayerId)
      .select('id, photo_url');
    expect(otherUpdate.data).toHaveLength(0);
  });
});
