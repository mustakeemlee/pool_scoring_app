// scripts/loadEnv.mjs
//
// Shared root .env loader for the plain-Node scripts in this repo
// (web/scripts/generate-env.mjs, scripts/seed.mjs). See src/testEnv.ts for
// the TypeScript equivalent used by the src/db and src/api test suites.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

export function loadRootEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  let content;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read ${envPath}. Copy .env.example to .env and fill in your Supabase Cloud project's values.`,
    );
  }

  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }

  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing keys in .env: ${missing.join(', ')}. See .env.example.`);
  }
  return env;
}
