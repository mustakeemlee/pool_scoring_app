import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

describe('POST /functions/v1/start-season', () => {
  it('creates a new season and carries over ratings with the soft-reset formula', async () => {
    const oldSeason = await dbClient.query(
      `insert into seasons (name, start_date) values ('Old Season', '2025-01-01') returning id`,
    );
    const oldSeasonId = oldSeason.rows[0].id;

    const player = await dbClient.query(`insert into players (full_name) values ('Carryover Player') returning id`);
    const playerId = player.rows[0].id;
    await dbClient.query(
      `insert into player_season_ratings (player_id, season_id, rating, rd, volatility)
       values ($1, $2, 1900, 100, 0.06)`,
      [playerId, oldSeasonId],
    );

    // A second player with NO row in the old season - must NOT receive a
    // spurious carryover event in the new season (self-review checklist
    // item 5).
    const strayPlayer = await dbClient.query(`insert into players (full_name) values ('No Prior Row Player') returning id`);
    const strayPlayerId = strayPlayer.rows[0].id;

    const response = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previous_season_id: oldSeasonId,
        new_season_name: 'New Season',
        start_date: '2026-02-01',
      }),
    });
    expect(response.status).toBe(201);
    const { season_id: newSeasonId } = await response.json();

    const newRating = await dbClient.query(
      `select rating, rd, grade from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerId, newSeasonId],
    );
    // 1500 + 0.75 * (1900 - 1500) = 1800
    expect(Number(newRating.rows[0].rating)).toBeCloseTo(1800, 5);
    // min(350, 100 + 50) = 150
    expect(Number(newRating.rows[0].rd)).toBeCloseTo(150, 5);
    // gradeForRating(1800) = 'A' - must reflect the CARRIED-OVER rating, not
    // the player_season_ratings table's default grade of 'B'.
    expect(newRating.rows[0].grade).toBe('A');

    const carryoverEvent = await dbClient.query(
      `select event_type, rating_before, rd_before, volatility_before, rating_after, rd_after
       from rating_events where player_id = $1 and season_id = $2`,
      [playerId, newSeasonId],
    );
    expect(carryoverEvent.rows[0].event_type).toBe('season_carryover');
    // before/after values must reflect the PRIOR season's state and the
    // new season's carried-over state, not some intermediate value.
    expect(Number(carryoverEvent.rows[0].rating_before)).toBeCloseTo(1900, 5);
    expect(Number(carryoverEvent.rows[0].rd_before)).toBeCloseTo(100, 5);
    expect(Number(carryoverEvent.rows[0].volatility_before)).toBeCloseTo(0.06, 5);
    expect(Number(carryoverEvent.rows[0].rating_after)).toBeCloseTo(1800, 5);
    expect(Number(carryoverEvent.rows[0].rd_after)).toBeCloseTo(150, 5);

    // The stray player (no row in the old season) must not get a
    // player_season_ratings row or a rating_events row in the new season.
    const strayRating = await dbClient.query(
      `select 1 from player_season_ratings where player_id = $1 and season_id = $2`,
      [strayPlayerId, newSeasonId],
    );
    expect(strayRating.rows.length).toBe(0);
    const strayEvent = await dbClient.query(
      `select 1 from rating_events where player_id = $1 and season_id = $2`,
      [strayPlayerId, newSeasonId],
    );
    expect(strayEvent.rows.length).toBe(0);

    // Fix 4 (whole-branch review): the previous season must be marked
    // 'completed' once the new season has been successfully created and
    // carried over - otherwise both seasons could sit at status='active'
    // simultaneously (flagged as a spec-level gap during Task 10's review,
    // confirmed real and fixed as part of the whole-branch review's fix
    // round).
    const previousSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [oldSeasonId]);
    expect(previousSeasonStatus.rows[0].status).toBe('completed');

    // The brand-new season itself must be unaffected by this update - still
    // 'active', not accidentally overwritten too.
    const newSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [newSeasonId]);
    expect(newSeasonStatus.rows[0].status).toBe('active');
  });

  it('creates a new season with no carryover when previous_season_id is omitted', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_season_name: 'Fresh Season With No Predecessor',
        start_date: '2026-03-01',
      }),
    });
    expect(response.status).toBe(201);
    const { season_id: newSeasonId } = await response.json();
    expect(newSeasonId).toBeTruthy();

    const rows = await dbClient.query(
      `select 1 from player_season_ratings where season_id = $1`,
      [newSeasonId],
    );
    expect(rows.rows.length).toBe(0);

    // Fix 4's previous-season-completion update lives entirely inside the
    // `if (body.previous_season_id)` block, so with no previous_season_id
    // it must be skipped outright - nothing else in the database should be
    // touched by it. There's no previous season to check here (that's the
    // point), but this call succeeding at all (201, no crash) confirms the
    // guard correctly no-ops rather than erroring on a missing id.
    const newSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [newSeasonId]);
    expect(newSeasonStatus.rows[0].status).toBe('active');
  });

  it('rejects a previous_season_id that does not reference an existing season', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_season_name: 'Bad Previous Season Test',
        start_date: '2026-05-01',
        previous_season_id: '00000000-0000-0000-0000-000000000000',
      }),
    });
    expect(response.status).toBe(400);

    const orphan = await dbClient.query(`select id from seasons where name = $1`, ['Bad Previous Season Test']);
    expect(orphan.rows.length).toBe(0);
  });

  it('completes any other active season when starting a new one, so only one season is ever active', async () => {
    const first = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_season_name: 'Single Active Season Test 1', start_date: '2026-06-01' }),
    });
    const { season_id: firstSeasonId } = await first.json();

    await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_season_name: 'Single Active Season Test 2', start_date: '2026-06-08' }),
    });

    const activeSeasons = await dbClient.query(`select id from seasons where status = 'active'`);
    expect(activeSeasons.rows.length).toBe(1);

    const firstSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [firstSeasonId]);
    expect(firstSeasonStatus.rows[0].status).toBe('completed');
  });
});
