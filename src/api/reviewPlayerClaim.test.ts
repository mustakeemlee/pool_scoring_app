import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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
let admin: TestAdmin;
let dbClient: Client;
const createdPlayerIds: string[] = [];
const createdUserIds: string[] = [];

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

async function submitClaim(userId: string, playerId: string): Promise<string> {
  const result = await dbClient.query(
    `insert into player_claims (user_id, player_id) values ($1, $2) returning id`,
    [userId, playerId],
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  admin = await provisionTestAdmin(status);
  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

afterAll(async () => {
  for (const userId of createdUserIds) {
    await cleanupTestUser(status, userId);
  }
  await deletePlayers(dbClient, createdPlayerIds);
  await cleanupTestAdmin(status, admin.userId);
  await dbClient.end();
}, 30000);

describe('POST /functions/v1/review-player-claim', () => {
  it('approves a claim and links the player to the account', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerId = await createPlayer('Claimant Player');
    const claimId = await submitClaim(user.userId, playerId);

    const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimId, decision: 'approve' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claim_id: claimId, status: 'approved' });

    const profile = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
      user.userId,
    ]);
    expect(profile.rows[0].linked_player_id).toBe(playerId);

    const claim = await dbClient.query(`select status, reviewed_by from player_claims where id = $1`, [claimId]);
    expect(claim.rows[0].status).toBe('approved');
    expect(claim.rows[0].reviewed_by).toBe(admin.userId);
  });

  it('auto-rejects other pending claims on the same player when one is approved', async () => {
    const userA = await provisionTestUser(status);
    createdUserIds.push(userA.userId);
    const userB = await provisionTestUser(status);
    createdUserIds.push(userB.userId);
    const playerId = await createPlayer('Contested Player');
    const claimA = await submitClaim(userA.userId, playerId);
    const claimB = await submitClaim(userB.userId, playerId);

    const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimA, decision: 'approve' }),
    });
    expect(response.status).toBe(200);

    const claimBRow = await dbClient.query(`select status from player_claims where id = $1`, [claimB]);
    expect(claimBRow.rows[0].status).toBe('rejected');

    const profileB = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
      userB.userId,
    ]);
    expect(profileB.rows[0].linked_player_id).toBeNull();
  });

  it('rejects a claim without linking the player', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerId = await createPlayer('Rejected Claimant Player');
    const claimId = await submitClaim(user.userId, playerId);

    const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimId, decision: 'reject' }),
    });
    expect(response.status).toBe(200);

    const profile = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
      user.userId,
    ]);
    expect(profile.rows[0].linked_player_id).toBeNull();
    const claim = await dbClient.query(`select status from player_claims where id = $1`, [claimId]);
    expect(claim.rows[0].status).toBe('rejected');
  });

  it('rejects reviewing an already-decided claim', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerId = await createPlayer('Double Reviewed Player');
    const claimId = await submitClaim(user.userId, playerId);

    await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimId, decision: 'approve' }),
    });

    const secondResponse = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimId, decision: 'reject' }),
    });
    expect(secondResponse.status).toBe(400);
  });

  it('rejects approving a claim for a player already linked to a different account', async () => {
    const userA = await provisionTestUser(status);
    createdUserIds.push(userA.userId);
    const userB = await provisionTestUser(status);
    createdUserIds.push(userB.userId);
    const playerId = await createPlayer('Double Linked Player');
    const claimA = await submitClaim(userA.userId, playerId);

    const firstResponse = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimA, decision: 'approve' }),
    });
    expect(firstResponse.status).toBe(200);

    const claimB = await submitClaim(userB.userId, playerId);
    const secondResponse = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimB, decision: 'approve' }),
    });
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual({
      error: 'This player is already linked to a different account',
    });

    const profileB = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
      userB.userId,
    ]);
    expect(profileB.rows[0].linked_player_id).toBeNull();

    const profileA = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
      userA.userId,
    ]);
    expect(profileA.rows[0].linked_player_id).toBe(playerId);
  });

  it('rejects a non-admin caller', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerId = await createPlayer('Unauthorized Reviewer Player');
    const claimId = await submitClaim(user.userId, playerId);

    const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_id: claimId, decision: 'approve' }),
    });
    expect(response.status).toBe(401);
  });
});
