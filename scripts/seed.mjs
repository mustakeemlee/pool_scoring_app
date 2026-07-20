// scripts/seed.mjs
//
// One-shot demo-data seed script against the Supabase Cloud project. Exercises
// the real enter-match and close-week Edge Functions (not raw SQL inserts) so
// the resulting data has genuine, internally-consistent rating history,
// statistics, and season points.
//
// Usage: node scripts/seed.mjs
// Requires a filled-in root .env (see .env.example) and the four Edge
// Functions already deployed (`supabase functions deploy`).
import { createClient } from '@supabase/supabase-js';
import { loadRootEnv } from './loadEnv.mjs';

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie',
  'Drew', 'Avery', 'Quinn', 'Reese', 'Skyler', 'Rowan', 'Finley', 'Hayden',
  'Emerson', 'Parker', 'Blake', 'Dakota', 'Charlie', 'Sage', 'Kendall', 'Marley',
  'Peyton', 'Shawn', 'Terry', 'Wesley', 'Yael', 'Zion',
];

async function main() {
  const env = loadRootEnv();
  const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const email = `seed-admin-${Date.now()}@example.com`;
  const password = 'seed-password-123!';
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
    .insert({ id: userData.user.id, display_name: 'Seed Admin', role: 'admin' });
  if (adminInsertError) {
    throw new Error(`Failed to insert admin_users row: ${adminInsertError.message}`);
  }

  const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
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
    .insert({ name: 'Seed Season', start_date: '2026-01-01', status: 'active' })
    .select('id')
    .single();
  if (seasonError || !season) {
    throw new Error(`Failed to create seed season: ${seasonError?.message ?? 'no season returned'}`);
  }

  const { data: players, error: playersError } = await serviceClient
    .from('players')
    .insert(FIRST_NAMES.map((name) => ({ full_name: `${name} Testplayer` })))
    .select('id');
  if (playersError || !players) {
    throw new Error(`Failed to create seed players: ${playersError?.message ?? 'no players returned'}`);
  }

  async function enterMatch(playerA, playerB, framesA, framesB, matchDate) {
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/enter-match`, {
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
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/close-week`, {
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
      const framesA = Math.floor(Math.random() * 3) + 3;
      const framesB = Math.floor(Math.random() * framesA);
      const [a, b] = Math.random() > 0.5 ? [players[i].id, players[i + 1].id] : [players[i + 1].id, players[i].id];
      await enterMatch(a, b, framesA, framesB, weekEnding);
    }

    await closeWeek(weekEnding);
  }

  console.log(`Seeded season ${season.id} with ${players.length} players across ${weeks.length} closed weeks.`);
  console.log(`Admin login: ${email} / ${password}`);
}

main().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
