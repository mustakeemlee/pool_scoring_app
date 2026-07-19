// src/testEnv.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TEST_DATABASE_URL',
] as const;

export interface RootEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TEST_DATABASE_URL: string;
}

export function loadRootEnv(): RootEnv {
  const envPath = join(process.cwd(), '.env');
  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read ${envPath}. Copy .env.example to .env and fill in your Supabase Cloud project's values.`,
    );
  }

  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }

  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing keys in .env: ${missing.join(', ')}. See .env.example.`);
  }
  return env as RootEnv;
}
