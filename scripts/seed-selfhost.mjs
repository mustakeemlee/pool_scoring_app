// scripts/seed-selfhost.mjs
//
// Seeds the self-hosted docker-compose stack (Sub-phase A) with realistic
// demo data. Unlike scripts/seed.mjs (which replays the real enter-match/
// close-week Edge Functions), this stack has no Edge Runtime yet -- so this
// script inserts player_season_ratings/matches rows directly via PostgREST.
// It exists to prove the self-hosted wiring works end-to-end with real data,
// not to re-verify the rating math (already covered by Phase 1/2's tests).
//
// Usage: node scripts/seed-selfhost.mjs
// Requires: docker compose --env-file .env.selfhost up -d (see docker/README.md)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadSelfhostEnv() {
  const content = readFileSync('.env.selfhost', 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const API_URL = process.env.SELFHOST_API_URL ?? 'http://localhost:8000';
const env = loadSelfhostEnv();

const FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie'];
const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D'];

async function main() {
  const serviceClient = createClient(API_URL, env.SERVICE_ROLE_KEY);

  const email = `selfhost-seed-admin-${Date.now()}@example.com`;
  const password = 'selfhost-seed-password-123!';
  const { data: userData, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createUserError || !userData?.user) {
    throw new Error(`Failed to create seed admin user: ${createUserError?.message ?? 'no user returned'}`);
  }

  const { error: adminInsertError } = await serviceClient
    .from('admin_users')
    .insert({ id: userData.user.id, display_name: 'Selfhost Seed Admin', role: 'admin' });
  if (adminInsertError) {
    throw new Error(`Failed to insert admin_users row: ${adminInsertError.message}`);
  }

  const { data: season, error: seasonError } = await serviceClient
    .from('seasons')
    .insert({ name: 'Selfhost Seed Season', start_date: '2026-01-01', status: 'active' })
    .select('id')
    .single();
  if (seasonError || !season) {
    throw new Error(`Failed to create seed season: ${seasonError?.message ?? 'no season returned'}`);
  }

  const { data: players, error: playersError } = await serviceClient
    .from('players')
    .insert(FIRST_NAMES.map((name) => ({ full_name: `${name} Selfhost` })))
    .select('id');
  if (playersError || !players) {
    throw new Error(`Failed to create seed players: ${playersError?.message ?? 'no players returned'}`);
  }

  const ratingsRows = players.map((player, index) => ({
    player_id: player.id,
    season_id: season.id,
    rating: 1500 + (players.length - index) * 20,
    matches_played: 3,
    is_provisional: false,
    grade: GRADES[index % GRADES.length],
    season_points: (players.length - index) * 10,
  }));
  const { error: ratingsError } = await serviceClient.from('player_season_ratings').insert(ratingsRows);
  if (ratingsError) {
    throw new Error(`Failed to insert player_season_ratings: ${ratingsError.message}`);
  }

  const matchesRows = [];
  for (let i = 0; i < players.length - 1; i += 2) {
    const [a, b] = [players[i].id, players[i + 1].id];
    matchesRows.push({
      season_id: season.id,
      match_date: '2026-01-08',
      player_a_id: a,
      player_b_id: b,
      frames_a: 5,
      frames_b: 2,
      winner_id: a,
      entered_by: userData.user.id,
    });
  }
  const { error: matchesError } = await serviceClient.from('matches').insert(matchesRows);
  if (matchesError) {
    throw new Error(`Failed to insert matches: ${matchesError.message}`);
  }

  console.log(`Seeded season ${season.id} with ${players.length} players and ${matchesRows.length} matches.`);
  console.log(`Admin login: ${email} / ${password}`);
}

main().catch((error) => {
  console.error('Selfhost seed script failed:', error);
  process.exit(1);
});
