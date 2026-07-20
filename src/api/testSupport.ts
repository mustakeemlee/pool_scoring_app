// src/api/testSupport.ts
import { createClient } from '@supabase/supabase-js';
import type { Client } from 'pg';
import { loadRootEnv } from '../testEnv';

export interface SupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  DB_URL: string;
}

export function getSupabaseStatus(): SupabaseStatus {
  const env = loadRootEnv();
  return {
    API_URL: env.SUPABASE_URL,
    ANON_KEY: env.SUPABASE_ANON_KEY,
    SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    DB_URL: env.TEST_DATABASE_URL,
  };
}

export interface TestAdmin {
  userId: string;
  accessToken: string;
}

export async function provisionTestAdmin(status: SupabaseStatus): Promise<TestAdmin> {
  const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

  const email = `test-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'test-password-123!';

  const { data: userData, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !userData.user) {
    throw new Error(`Failed to create test admin user: ${createError?.message}`);
  }

  const { error: insertError } = await serviceClient
    .from('admin_users')
    .insert({ id: userData.user.id, display_name: 'Test Admin', role: 'admin' });
  if (insertError) {
    throw new Error(`Failed to insert admin_users row: ${insertError.message}`);
  }

  const anonClient = createClient(status.API_URL, status.ANON_KEY);
  const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !sessionData.session) {
    throw new Error(`Failed to sign in test admin: ${signInError?.message}`);
  }

  return { userId: userData.user.id, accessToken: sessionData.session.access_token };
}

// Deletes the admin_users row and the underlying Supabase Auth user
// provisionTestAdmin created. Against the old, disposable local stack this
// was unnecessary -- the whole database got reset between runs. Against the
// shared Supabase Cloud project it's required: without it, every test run
// leaves a permanent auth.users + admin_users row behind forever.
export async function cleanupTestAdmin(status: SupabaseStatus, userId: string): Promise<void> {
  const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);
  await serviceClient.from('admin_users').delete().eq('id', userId);
  const { error } = await serviceClient.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`Failed to delete test admin auth user ${userId}: ${error.message}`);
  }
}

// Deletes everything a test can have created under one season_id, in
// FK-safe order -- no table in this schema has ON DELETE CASCADE (see
// supabase/migrations/20260714000000_initial_schema.sql). Safe to call for
// a season that only ever had some of these row types.
export async function cleanupSeasonData(dbClient: Client, seasonId: string): Promise<void> {
  await dbClient.query(
    `delete from match_audit_log where match_id in (select id from matches where season_id = $1)`,
    [seasonId],
  );
  await dbClient.query(`delete from rating_events where season_id = $1`, [seasonId]);
  await dbClient.query(`delete from weekly_rankings where season_id = $1`, [seasonId]);
  await dbClient.query(`delete from player_statistics where season_id = $1`, [seasonId]);
  await dbClient.query(`delete from player_season_ratings where season_id = $1`, [seasonId]);
  await dbClient.query(`delete from matches where season_id = $1`, [seasonId]);
}

export async function deletePlayers(dbClient: Client, playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) return;
  await dbClient.query(`delete from players where id = any($1::uuid[])`, [playerIds]);
}

export async function deleteSeasons(dbClient: Client, seasonIds: string[]): Promise<void> {
  if (seasonIds.length === 0) return;
  await dbClient.query(`delete from seasons where id = any($1::uuid[])`, [seasonIds]);
}
