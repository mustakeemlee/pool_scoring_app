// src/api/testSupport.ts
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

export interface SupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  DB_URL: string;
}

export function getSupabaseStatus(): SupabaseStatus {
  const output = execSync('npx supabase status -o env', { encoding: 'utf-8' });
  const env: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^(\w+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  return {
    API_URL: env.API_URL,
    ANON_KEY: env.ANON_KEY,
    SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
    DB_URL: env.DB_URL,
  };
}

export async function provisionTestAdmin(
  status: SupabaseStatus,
): Promise<{ userId: string; accessToken: string }> {
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
