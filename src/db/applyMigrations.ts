// src/db/applyMigrations.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export async function applyMigrations(client: Client): Promise<void> {
  // Callers point this at freshly-created, isolated scratch databases (see
  // src/db/*.test.ts), not at the Supabase-managed `postgres` database — so
  // they don't have GoTrue's `auth` schema that Supabase provisions there.
  // Migrations that write RLS policies referencing `auth.uid()` need at
  // least that function to exist for the `create policy` DDL to succeed.
  // Stubbing it here (idempotent, harmless if already present) keeps every
  // test's scratch database able to apply the full migration set.
  await client.query('create schema if not exists auth');
  await client.query(
    'create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$',
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    await client.query(sql);
  }
}
