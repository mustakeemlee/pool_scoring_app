// scripts/seed.mjs
//
// One-shot local dev seed script. Exercises the real enter-match and
// close-week Edge Functions (not raw SQL inserts) so the resulting data has
// genuine, internally-consistent rating history, statistics, and season
// points -- per design spec section 7.
//
// Usage: node scripts/seed.mjs
// Requires `npx supabase start` and `npx supabase functions serve` running.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

function getSupabaseStatus() {
  const output = execSync('npx supabase status -o env', { encoding: 'utf-8' });
  const env = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^(\w+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie',
  'Drew', 'Avery', 'Quinn', 'Reese', 'Skyler', 'Rowan', 'Finley', 'Hayden',
  'Emerson', 'Parker', 'Blake', 'Dakota', 'Charlie', 'Sage', 'Kendall', 'Marley',
  'Peyton', 'Shawn', 'Terry', 'Wesley', 'Yael', 'Zion',
];

async function main() {
  const status = getSupabaseStatus();
  const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

  // --- One-shot admin/season/player setup. Each call is checked and throws
  // on failure -- this is a human-run CLI script (not an Edge Function with
  // an HTTP response to fail through), so failing loudly here means the
  // script exits non-zero with a clear message instead of silently
  // continuing with undefined data (e.g. `userData.user` being undefined
  // would otherwise surface much later as a confusing "cannot read
  // property 'id' of undefined").
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

  const anonClient = createClient(status.API_URL, status.ANON_KEY);
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

  // --- Pipeline calls. Unlike the setup calls above, these go through HTTP
  // (the enter-match/close-week Edge Functions) so a failure surfaces as a
  // non-2xx response rather than a Supabase client `error` field. Checking
  // response.ok and throwing with the response body mirrors the "fail
  // loudly" discipline every Edge Function in this plan applies to its own
  // writes -- a silently-swallowed enter-match failure here would leave a
  // player under-matched (breaking the MIN_MATCHES_FOR_RANKING=3 leaderboard
  // eligibility gate) without any indication in the script's output, and a
  // silently-swallowed close-week failure would leave that week's matches
  // unlocked and unreconciled while the script happily moves on to the next
  // week.
  async function enterMatch(playerA, playerB, framesA, framesB, matchDate) {
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
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
    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
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
    // Round-robin a handful of pairings each week
    for (let i = 0; i < players.length - 1; i += 2) {
      const framesA = Math.floor(Math.random() * 3) + 3; // 3-5
      const framesB = Math.floor(Math.random() * framesA); // 0..framesA-1, so A always wins
      const [a, b] = Math.random() > 0.5 ? [players[i].id, players[i + 1].id] : [players[i + 1].id, players[i].id];
      await enterMatch(a, b, framesA, framesB, weekEnding);
    }

    await closeWeek(weekEnding);
  }

  console.log(`Seeded season ${season.id} with ${players.length} players across ${weeks.length} closed weeks.`);
}

main().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
