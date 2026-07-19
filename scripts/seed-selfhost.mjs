// scripts/seed-selfhost.mjs
//
// Seeds the self-hosted docker-compose stack with realistic demo data.
// Now that Sub-phase B self-hosts the four Edge Functions, this calls the
// real enter-match/close-week endpoints through Kong -- mirroring exactly
// how scripts/seed.mjs already seeds the CLI stack -- instead of
// direct-inserting player_season_ratings/matches rows.
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

const FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie'];

async function waitForStackReady(apiUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/rest/v1/`, { method: 'GET' });
      if (response.status < 500) return;
      lastError = new Error(`Stack not ready yet (status ${response.status})`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Stack did not become ready within ${timeoutMs}ms: ${lastError?.message ?? 'unknown error'}. ` +
      'Check `docker compose --env-file .env.selfhost ps` for unhealthy services.',
  );
}

async function main() {
  const env = loadSelfhostEnv();
  await waitForStackReady(API_URL);
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

  const anonClient = createClient(API_URL, env.ANON_KEY);
  const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !sessionData?.session) {
    throw new Error(`Failed to sign in seed admin: ${signInError?.message ?? 'no session returned'}`);
  }
  const accessToken = sessionData.session.access_token;

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

  async function enterMatch(playerA, playerB, framesA, framesB, matchDate) {
    const response = await fetch(`${API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: season.id,
        match_date: matchDate,
        player_a_id: playerA,
        player_b_id: playerB,
        frames_a: framesA,
        frames_b: framesB,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `enter-match failed (${response.status}) for ${playerA} vs ${playerB} on ${matchDate}: ${body}`,
      );
    }
  }

  async function closeWeek(weekEnding) {
    const response = await fetch(`${API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: season.id, week_ending: weekEnding }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`close-week failed (${response.status}) for week ${weekEnding}: ${body}`);
    }
  }

  const weeks = ['2026-01-08', '2026-01-15', '2026-01-22'];
  for (const weekEnding of weeks) {
    for (let i = 0; i < players.length - 1; i += 2) {
      const framesA = Math.floor(Math.random() * 3) + 3; // 3-5
      const framesB = Math.floor(Math.random() * framesA); // 0..framesA-1, so A always wins
      const [a, b] = Math.random() > 0.5 ? [players[i].id, players[i + 1].id] : [players[i + 1].id, players[i].id];
      await enterMatch(a, b, framesA, framesB, weekEnding);
    }
    await closeWeek(weekEnding);
  }

  console.log(`Seeded season ${season.id} with ${players.length} players across ${weeks.length} closed weeks.`);
  console.log(`Admin login: ${email} / ${password}`);
}

main().catch((error) => {
  console.error('Selfhost seed script failed:', error);
  process.exit(1);
});
