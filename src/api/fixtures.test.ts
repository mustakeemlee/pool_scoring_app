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
  cleanupSeasonData,
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

describe('enter-match fixture completion', () => {
  it('completes a fixture atomically when its result is entered', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Fixture Completion Player A');
    const playerB = await createPlayer('Fixture Completion Player B');
    const seasonId = await createSeason('Fixture Completion Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-03-01', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-01',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(201);
      const body = await response.json();

      const updatedFixture = await dbClient.query(
        `select status, completed_match_id from fixtures where id = $1`,
        [fixtureId],
      );
      expect(updatedFixture.rows[0].status).toBe('completed');
      expect(updatedFixture.rows[0].completed_match_id).toBe(body.match_id);
    } finally {
      // This test is the only one in this file that actually creates a real
      // `matches` row (via a successful enter-match call), so cleanup order
      // matters here in a way it doesn't for the other tests:
      // 1. This fixture now references that match via completed_match_id,
      //    so the fixture row must go first (or matches' delete below hits
      //    fixtures_completed_match_id_fkey).
      // 2. cleanupSeasonData deletes match_audit_log then matches for the
      //    season -- must happen before cleanupTestAdmin, or the admin
      //    delete hits matches.entered_by's FK (exactly like
      //    enterMatch.test.ts's own afterAll already has to sequence).
      await dbClient.query(`delete from fixtures where id = $1`, [fixtureId]);
      await cleanupSeasonData(dbClient, seasonId);
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects completing an already-completed fixture', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Double Completion Player A');
    const playerB = await createPlayer('Double Completion Player B');
    const seasonId = await createSeason('Double Completion Season');

    // A real prior match is required here: the fixtures_completed_has_match
    // CHECK constraint (see supabase/migrations/20260728000000_fixtures_constraints.sql)
    // rejects a 'completed' fixture with no completed_match_id, matching the
    // real invariant enter-match itself always maintains. Its match_date is
    // deliberately a day earlier than what this test resubmits below, so
    // enter-match's own idempotency lookup (season/date/players/frames)
    // doesn't find it and treat this as a harmless retry of an
    // already-completed submission -- this test is specifically about
    // rejecting a genuinely new result for an already-completed fixture.
    const priorMatch = await dbClient.query(
      `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
       values ($1, '2026-03-01', $2, $3, 5, 2, $2) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id, status, completed_match_id)
       values ($1, '2026-03-02', $2, $3, 'completed', $4) returning id`,
      [seasonId, playerA, playerB, priorMatch.rows[0].id],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-02',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(409);

      // Still just the one prior match -- the rejected request created no
      // additional (duplicate) match row.
      const matchCount = await dbClient.query(
        `select count(*)::int as count from matches where player_a_id = $1 and player_b_id = $2`,
        [playerA, playerB],
      );
      expect(matchCount.rows[0].count).toBe(1);
    } finally {
      await dbClient.query(`delete from fixtures where id = $1`, [fixtureId]);
      await cleanupSeasonData(dbClient, seasonId);
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects a fixture_id whose players do not match the submitted players', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Mismatch Player A');
    const playerB = await createPlayer('Mismatch Player B');
    const playerC = await createPlayer('Mismatch Player C');
    const seasonId = await createSeason('Mismatch Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-03-03', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-03',
          player_a_id: playerA,
          player_b_id: playerC,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects a fixture_id whose season does not match the submitted season_id', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Season Mismatch Player A');
    const playerB = await createPlayer('Season Mismatch Player B');
    const fixtureSeasonId = await createSeason('Season Mismatch Fixture Season');
    const submittedSeasonId = await createSeason('Season Mismatch Submitted Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-03-04', $2, $3) returning id`,
      [fixtureSeasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: submittedSeasonId,
          match_date: '2026-03-04',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects completing an already-voided fixture', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Voided Completion Player A');
    const playerB = await createPlayer('Voided Completion Player B');
    const seasonId = await createSeason('Voided Completion Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id, status)
       values ($1, '2026-03-05', $2, $3, 'voided') returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-05',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(409);
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('still completes a scheduled fixture when an unrelated match already matches its date/players/score', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Collision Player A');
    const playerB = await createPlayer('Collision Player B');
    const seasonId = await createSeason('Collision Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-03-06', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      // An unrelated match with the exact same (season, date, players, score)
      // shape the fixture will be completed with, entered without ever
      // touching this fixture -- simulating a coincidental collision, not a
      // retry of this fixture's own completion.
      const unrelatedResponse = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-06',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
        }),
      });
      const unrelatedBody = await unrelatedResponse.json();
      const unrelatedMatchId = unrelatedBody.match_id as string;

      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-06',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.match_id).toBe(unrelatedMatchId);

      const updatedFixture = await dbClient.query(
        `select status, completed_match_id from fixtures where id = $1`,
        [fixtureId],
      );
      expect(updatedFixture.rows[0].status).toBe('completed');
      expect(updatedFixture.rows[0].completed_match_id).toBe(unrelatedMatchId);
    } finally {
      // This test creates a real `matches` row (the "unrelated" one), now
      // referenced by this fixture via completed_match_id -- same FK-safe
      // cleanup order as the "completes a fixture atomically" test above.
      await dbClient.query(`delete from fixtures where id = $1`, [fixtureId]);
      await cleanupSeasonData(dbClient, seasonId);
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects a voided fixture even when an unrelated match already matches its date/players/score', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Voided Collision Player A');
    const playerB = await createPlayer('Voided Collision Player B');
    const seasonId = await createSeason('Voided Collision Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id, status)
       values ($1, '2026-03-07', $2, $3, 'voided') returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      // An unrelated match with the exact same (season, date, players, score)
      // shape as what's resubmitted below -- entered without ever touching
      // this (already-voided) fixture.
      await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-07',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
        }),
      });

      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-07',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(409);

      const updatedFixture = await dbClient.query(`select status, completed_match_id from fixtures where id = $1`, [
        fixtureId,
      ]);
      expect(updatedFixture.rows[0].status).toBe('voided');
      expect(updatedFixture.rows[0].completed_match_id).toBeNull();
    } finally {
      await cleanupSeasonData(dbClient, seasonId);
      await cleanupTestAdmin(status, admin.userId);
    }
  });
});

describe('correct-match fixture completion', () => {
  it("re-points a fixture's completed_match_id to the corrected match when its result is corrected", async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Correction Fixture Player A');
    const playerB = await createPlayer('Correction Fixture Player B');
    const seasonId = await createSeason('Correction Fixture Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-04-01', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const enterResponse = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-04-01',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      const enterBody = await enterResponse.json();
      const originalMatchId = enterBody.match_id as string;

      const correctResponse = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: originalMatchId, frames_a: 5, frames_b: 3 }),
      });
      expect(correctResponse.status).toBe(200);
      const correctBody = await correctResponse.json();
      const correctedMatchId = correctBody.corrected_match_id as string;
      expect(correctedMatchId).not.toBe(originalMatchId);

      const updatedFixture = await dbClient.query(`select completed_match_id from fixtures where id = $1`, [
        fixtureId,
      ]);
      expect(updatedFixture.rows[0].completed_match_id).toBe(correctedMatchId);
    } finally {
      await dbClient.query(`delete from fixtures where id = $1`, [fixtureId]);
      await cleanupSeasonData(dbClient, seasonId);
      await cleanupTestAdmin(status, admin.userId);
    }
  });
});
