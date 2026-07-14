// src/db/applyMigrations.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export async function applyMigrations(client: Client): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    await client.query(sql);
  }
}
