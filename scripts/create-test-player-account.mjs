// scripts/create-test-player-account.mjs
//
// One-shot, idempotent helper that creates (or resets) a single non-admin
// login, linked to a dedicated test player row, for exercising the
// player/normal-user experience against the Supabase Cloud project. Safe to
// re-run -- re-running just resets the same account's password and
// (re-)confirms its link, rather than minting duplicates.
//
// Usage: node scripts/create-test-player-account.mjs
// Optional overrides: TEST_PLAYER_EMAIL, TEST_PLAYER_PASSWORD env vars.
import { createClient } from '@supabase/supabase-js';
import { loadRootEnv } from './loadEnv.mjs';

const TEST_PLAYER_NAME = 'Test Testplayer';
const DEFAULT_EMAIL = 'testplayer@poolscoring.local';
const DEFAULT_PASSWORD = 'test-player-123!';

// Mirrors seed.mjs's getOrCreateAdmin: find-or-create so re-running this
// script always leaves the same, known login working.
async function getOrCreateUser(serviceClient, email, password) {
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createError && created?.user) {
    return created.user;
  }

  const { data: listData, error: listError } = await serviceClient.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to look up existing test user: ${listError.message}`);
  }
  const existing = listData.users.find((u) => u.email === email);
  if (!existing) {
    throw new Error(`Failed to create test user: ${createError?.message ?? 'unknown error'}`);
  }

  const { data: updated, error: updateError } = await serviceClient.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (updateError || !updated?.user) {
    throw new Error(`Failed to reset existing test user's password: ${updateError?.message ?? 'no user returned'}`);
  }
  return updated.user;
}

async function main() {
  const env = loadRootEnv();
  const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const email = process.env.TEST_PLAYER_EMAIL || DEFAULT_EMAIL;
  const password = process.env.TEST_PLAYER_PASSWORD || DEFAULT_PASSWORD;
  const user = await getOrCreateUser(serviceClient, email, password);

  const { data: existingPlayer, error: playerLookupError } = await serviceClient
    .from('players')
    .select('id')
    .eq('full_name', TEST_PLAYER_NAME)
    .maybeSingle();
  if (playerLookupError) {
    throw new Error(`Failed to look up test player: ${playerLookupError.message}`);
  }

  let playerId = existingPlayer?.id;
  if (!playerId) {
    const { data: newPlayer, error: playerInsertError } = await serviceClient
      .from('players')
      .insert({ full_name: TEST_PLAYER_NAME })
      .select('id')
      .single();
    if (playerInsertError || !newPlayer) {
      throw new Error(`Failed to create test player: ${playerInsertError?.message ?? 'no player returned'}`);
    }
    playerId = newPlayer.id;
  }

  // handle_new_user() (20260720000000_player_accounts.sql) already inserted
  // this user's user_profiles row when createUser fired the auth.users
  // trigger -- this just (re-)points its link at the test player.
  const { error: linkError } = await serviceClient
    .from('user_profiles')
    .update({ linked_player_id: playerId })
    .eq('id', user.id);
  if (linkError) {
    throw new Error(`Failed to link test user to test player: ${linkError.message}`);
  }

  console.log(`Test player login: ${email} / ${password}`);
  console.log(`Linked to player "${TEST_PLAYER_NAME}" (${playerId}).`);
}

main().catch((error) => {
  console.error('create-test-player-account failed:', error);
  process.exit(1);
});
