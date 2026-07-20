// src/db/applyMigrations.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

// Callers point this at a scratch SCHEMA within the one shared Supabase
// Cloud database (see src/db/*.test.ts and src/db/scratchSchema.ts), with
// `search_path` already set to `<scratch_schema>, public` on `client`. This
// real cloud database already has a real `auth` schema provisioned by
// Supabase itself -- migrations' `auth.uid()` references resolve there
// directly. NEVER create or replace anything in the `auth` schema from
// here: doing so would overwrite Supabase's real auth implementation on a
// live, shared project (this file used to stub `auth.uid()` for the old
// scratch-DATABASE design, which had no real `auth` schema at all -- that
// stub must never come back).
export async function applyMigrations(client: Client): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    await client.query(sql);
  }
}
