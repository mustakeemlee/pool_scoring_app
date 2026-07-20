// src/db/scratchSchema.ts
import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';

export function randomSchemaName(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

// Creates the schema and points this client's session at it (search_path =
// <schema>, public) for the rest of its connection lifetime. Callers must
// use a session-mode/direct connection (TEST_DATABASE_URL, not
// SUPABASE_DB_URL's transaction-mode pooler) -- otherwise search_path
// silently won't persist across the individual queries applyMigrations
// issues, since a transaction-mode pooler can hand each unwrapped statement
// a different backend connection.
//
// Unlike `public`, a newly created schema grants no privileges to anon/
// authenticated by default -- confirmed live: without this GRANT, `SET ROLE
// anon; select * from <table>` in rls.test.ts/views.test.ts fails with
// "relation ... does not exist" (Postgres hides objects a role has no
// schema USAGE on, rather than a permission-denied error), even though the
// migrations' own per-table GRANT SELECT statements already ran. This must
// run before applyMigrations, alongside schema creation, not left to the
// migrations themselves (which are append-only and were written assuming
// `public`'s implicit USAGE grant).
export async function createScratchSchema(client: Client, schemaName: string): Promise<void> {
  await client.query(`create schema "${schemaName}"`);
  await client.query(`grant usage on schema "${schemaName}" to anon, authenticated`);
  await client.query(`set search_path to "${schemaName}", public`);
}

export async function dropScratchSchema(client: Client, schemaName: string): Promise<void> {
  await client.query(`drop schema if exists "${schemaName}" cascade`);
}
