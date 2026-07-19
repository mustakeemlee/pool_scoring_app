# Cloud Hosting Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move this app off self-hosted infrastructure entirely — database, auth, REST API, and the four admin Edge Functions move to the already-provisioned Supabase Cloud project (`ictqbqtkvptbjecxvnax`) — leaving only a single frontend Docker container running locally, pointed at that cloud project.

**Architecture:** One shared Supabase Cloud project serves local dev, the automated test suite, and the deployed app. The self-hosted docker-compose stack (`poolscoringapp`) and the local Supabase CLI dev stack (`pool-scoring-app`) are retired outright. `src/db`'s tests move from scratch-database-per-run to scratch-schema-per-run inside the one cloud database; `src/api`'s tests gain explicit, exact-ID teardown since there is no more "reset the whole DB between runs" safety net.

**Tech Stack:** Supabase Cloud (Postgres 17, GoTrue, PostgREST, Edge Functions), Supabase CLI (`supabase db push`, `supabase functions deploy`, `supabase secrets set`), Docker (single `web/Dockerfile` + nginx), Vitest, `pg` (node-postgres), `postgres` (Deno npm specifier, used by `_shared/dbTransaction.ts` — unchanged).

## Global Constraints

- Full replacement, not a third option: after this plan, no local Postgres/Auth/REST/edge-runtime containers run, ever — see design spec `docs/superpowers/specs/2026-07-20-cloud-hosting-migration-design.md` §2.
- Migrations are append-only (`supabase/migrations/`) — never edit a past migration file, including the two files this plan's investigation found real issues in (`20260714000000_initial_schema.sql`'s lack of `ON DELETE CASCADE`, `20260719000000_player_photos.sql`'s non-schema-scoped storage DDL). Both are worked around in test/application code, never by editing the migration.
- Errors surface verbatim, never swallowed or reworded (CLAUDE.md).
- `requireAdmin()` remains the sole authorization gate for admin writes — nothing in this plan touches it.
- A single gitignored root `.env` (already gitignored — see `.gitignore` line 3) is the only source of Supabase Cloud credentials for every script/test/build in this repo. `.env.example` (tracked, no real values) documents the required keys.
- **Deviation from the design spec's exact 4-key `.env` layout, discovered during planning (spec §4 anticipated refinements like this — "implementation detail, decided during planning"):** the spec's single `SUPABASE_DB_URL` (Supavisor **transaction**-mode pooler) is correct for the deployed Edge Functions' secret, but is NOT safe for `src/db`/`src/api` test code and `applyMigrations`, which issue many sequential queries on one `pg.Client` and depend on session state (`SET ROLE`, `SET search_path`) persisting across them. Supavisor's transaction-mode pooler recycles the backend connection after every unwrapped statement, silently dropping that state. A second key, `TEST_DATABASE_URL` (Supavisor **session**-mode pooler, port 5432 — or a true direct connection), is added for exactly this purpose. This reuses a name (`TEST_DATABASE_URL`) that already exists as an env-var override in the three `src/db/*.test.ts` files today, so it's a minimal, non-breaking addition, not a bolt-on.

---

### Task 1: Root `.env` scaffolding + shared env loaders

**Files:**
- Create: `.env.example`
- Create: `scripts/loadEnv.mjs`
- Create: `src/testEnv.ts`
- Modify: `package.json:6-14` (remove `supabase:start`/`supabase:stop`)

**Interfaces:**
- Produces: `loadRootEnv()` from `scripts/loadEnv.mjs` — returns `{ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY }`, throws if `.env` is missing or any required key is empty. Consumed by Task 5/6/7 (`web/scripts/generate-env.mjs`, `scripts/seed.mjs`).
- Produces: `loadRootEnv()` from `src/testEnv.ts` — returns `{ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TEST_DATABASE_URL }`, throws if `.env` is missing or any required key is empty. Consumed by Task 3 (`src/db/*.test.ts`) and Task 4 (`src/api/testSupport.ts`). Deliberately a **separate** implementation from `scripts/loadEnv.mjs` (different module system/runtime: `src/` is TypeScript run under Vitest, `scripts/`/`web/scripts/` are plain Node ESM `.mjs` with no compile step — matches this codebase's existing pattern of small per-runtime duplication rather than adding `allowJs` to `tsconfig.json` just to share one loader).

- [ ] **Step 1: Create `.env.example`**

```
# Copy this file to `.env` (gitignored) and fill in real values from your
# Supabase Cloud project (Project Settings > API, Project Settings > Database).
#
# Everything -- local dev, the automated test suite, and seeding -- points at
# this one Supabase Cloud project. There is no local Postgres/Auth/REST stack
# anymore.

# Project Settings > API > Project URL
SUPABASE_URL=

# Project Settings > API > Project API keys > anon public
SUPABASE_ANON_KEY=

# Project Settings > API > Project API keys > service_role secret
SUPABASE_SERVICE_ROLE_KEY=

# Project Settings > Database > Connection string > Transaction pooler
# (Supavisor, port 6543). Used ONLY as the deployed Edge Functions'
# SUPABASE_DB_URL secret (`supabase secrets set --env-file .env`) -- matches
# Supabase's own guidance for serverless workloads that open many
# short-lived connections.
SUPABASE_DB_URL=

# Project Settings > Database > Connection string > Session pooler
# (Supavisor, port 5432) -- NOT the transaction pooler above. Used by the
# src/db and src/api test suites and by applyMigrations, all of which need a
# stable session (SET ROLE, search_path) across multiple sequential queries
# on one connection; the transaction pooler recycles the backend connection
# between every unwrapped statement and silently breaks that.
TEST_DATABASE_URL=
```

- [ ] **Step 2: Create `scripts/loadEnv.mjs`**

```js
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
```

- [ ] **Step 3: Create `src/testEnv.ts`**

```ts
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
```

- [ ] **Step 4: Remove `supabase:start`/`supabase:stop` from root `package.json`**

In `package.json`, change:

```json
    "test": "npm run test:unit && npm run test:integration && npm run test:api",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "seed": "node scripts/seed.mjs"
```

to:

```json
    "test": "npm run test:unit && npm run test:integration && npm run test:api",
    "seed": "node scripts/seed.mjs"
```

- [ ] **Step 5: Verify the loaders throw clearly with no `.env` present**

Run: `node -e "import('./scripts/loadEnv.mjs').then(m => m.loadRootEnv())"`
Expected: throws `Could not read .../.env. Copy .env.example to .env and fill in your Supabase Cloud project's values.`

Run: `npx tsx -e "import('./src/testEnv').then(m => m.loadRootEnv())"` (or `npx vitest run --run -t nonexistent src/testEnv.ts` if `tsx` isn't installed — any way of executing the module is fine, this is a manual sanity check, not a permanent test file)
Expected: same style of thrown error.

- [ ] **Step 6: Commit**

```bash
git add .env.example scripts/loadEnv.mjs src/testEnv.ts package.json
git commit -m "feat: add root .env scaffolding and shared env loaders for cloud migration"
```

---

### Task 2: Push schema and deploy functions to Supabase Cloud

This is an operator/deployment task, not code — but it must happen early because Tasks 3 and 4's verification steps need a real, reachable cloud project with the current schema and deployed functions. The project (`ictqbqtkvptbjecxvnax`) is already linked (see project memory) and currently empty, so this is a first, safe, additive push — nothing existing to break.

**Files:** none (infrastructure operation against the already-linked Supabase Cloud project)

- [ ] **Step 1: Fill in `.env` from the Supabase dashboard**

Copy `.env.example` to `.env` (gitignored). Go to the Supabase dashboard for project `ictqbqtkvptbjecxvnax` → Project Settings → API, and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Go to Project Settings → Database → Connection string, and fill in `SUPABASE_DB_URL` from the **Transaction pooler** tab and `TEST_DATABASE_URL` from the **Session pooler** tab (both need the database password substituted in — the one set when the project was created, or reset it from that same page if unknown).

- [ ] **Step 2: Push the migration history**

Run: `npx supabase db push`
Expected: lists all 9 files under `supabase/migrations/` as pending and applies them in order, ending "Finished supabase db push." Confirm via the Supabase dashboard's Table Editor that all 9 tables from `20260714000000_initial_schema.sql` now exist, and via Storage that a `player-photos` bucket exists (created by `20260719000000_player_photos.sql`'s `storage.buckets` insert).

- [ ] **Step 3: Deploy the four Edge Functions**

Run: `npx supabase functions deploy enter-match correct-match close-week start-season`
Expected: each function reports a successful deploy with a dashboard URL. Confirm via Supabase dashboard → Edge Functions that all four show status "Deployed".

- [ ] **Step 4: Set the `SUPABASE_DB_URL` function secret**

Run: `npx supabase secrets set SUPABASE_DB_URL="<paste the SUPABASE_DB_URL value from .env>"`

(`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform already — do not set these as secrets, per design spec §4.)

Expected: `Finished supabase secrets set.`

- [ ] **Step 5: Smoke-test one deployed function end-to-end**

Run (replace `<SUPABASE_URL>` and `<SUPABASE_ANON_KEY>` with the real values from `.env`):
```bash
curl -i -X POST "<SUPABASE_URL>/functions/v1/enter-match" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected: `401 Unauthorized` (proves `requireAdmin()` is live and the function is reachable — an empty/anon-keyed request must be rejected, not crash with a 500 from a missing `SUPABASE_DB_URL`).

No commit for this task (no files changed).

---

### Task 3: `src/db` — scratch schema instead of scratch database

**Files:**
- Create: `src/db/scratchSchema.ts`
- Modify: `src/db/applyMigrations.ts` (full rewrite)
- Modify: `src/db/schema.test.ts` (full rewrite)
- Modify: `src/db/rls.test.ts` (full rewrite)
- Modify: `src/db/views.test.ts` (full rewrite)
- Modify: `package.json` (`test:integration` script)

**Interfaces:**
- Consumes: `loadRootEnv()` from `src/testEnv.ts` (Task 1).
- Produces: `randomSchemaName(prefix: string): string`, `createScratchSchema(client: Client, schemaName: string): Promise<void>`, `dropScratchSchema(client: Client, schemaName: string): Promise<void>` from `src/db/scratchSchema.ts`.
- Produces: `applyMigrations(client: Client): Promise<void>` from `src/db/applyMigrations.ts` — same signature as before, but callers must now create the scratch schema and set `search_path` on `client` *before* calling it (previously `applyMigrations` stubbed `auth.uid()` itself; it must not do that anymore — see Step 2's rationale).

**Why this task is correctness-critical, not just plumbing:** the current `applyMigrations.ts` runs `create schema if not exists auth; create or replace function auth.uid() returns uuid ... as $$ select null::uuid $$` — a stub needed because the old scratch-*database* design has no real `auth` schema. Supabase Cloud's real database already has a real `auth` schema with a real `auth.uid()`. If this stub ever ran against it, it would **overwrite Supabase's real auth implementation on the live, shared project**. This stub must be deleted, not merely left inert behind a flag.

The second real finding: `supabase/migrations/20260719000000_player_photos.sql` inserts into `storage.buckets` and creates policies on `storage.objects` — both schema-qualified to the literal `storage` schema, so `search_path`-based scratch-schema isolation does **not** apply to them; every scratch-schema test run touches the *same* shared `storage.objects` policies. The bucket insert is idempotent (`on conflict (id) do nothing`), but the four `drop policy if exists ...; create policy ...` pairs are not concurrency-safe: two test files applying migrations at the same moment can interleave a `create policy` from one run against a `drop policy` from the other and get `ERROR: policy "..." for relation "objects" already exists`. Since migrations are append-only, this cannot be fixed by editing that file — it's fixed by not running `src/db`'s three test files concurrently (Step 6).

- [ ] **Step 1: Create `src/db/scratchSchema.ts`**

```ts
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
export async function createScratchSchema(client: Client, schemaName: string): Promise<void> {
  await client.query(`create schema "${schemaName}"`);
  await client.query(`set search_path to "${schemaName}", public`);
}

export async function dropScratchSchema(client: Client, schemaName: string): Promise<void> {
  await client.query(`drop schema if exists "${schemaName}" cascade`);
}
```

- [ ] **Step 2: Rewrite `src/db/applyMigrations.ts`**

```ts
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
```

- [ ] **Step 3: Rewrite `src/db/schema.test.ts`**

```ts
// src/db/schema.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';
import { createScratchSchema, dropScratchSchema, randomSchemaName } from './scratchSchema';
import { loadRootEnv } from '../testEnv';

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? loadRootEnv().TEST_DATABASE_URL;

let client: Client;
let schemaName: string;

beforeAll(async () => {
  client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  schemaName = randomSchemaName('pool_league_schema_test');
  await createScratchSchema(client, schemaName);
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('initial schema', () => {
  it('creates all required tables', async () => {
    const result = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    const tableNames = result.rows.map((r: { table_name: string }) => r.table_name);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'match_audit_log',
        'matches',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('rejects a match where a player plays against themselves', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 1', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Solo Player') returning id`,
    );
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await expect(
      client.query(
        `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
         values ($1, '2026-01-08', $2, $2, 5, 3, $2)`,
        [seasonId, playerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a match that ends in a tied frame score', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 2', '2026-01-01') returning id`,
    );
    const playerA = await client.query(`insert into players (full_name) values ('Player A') returning id`);
    const playerB = await client.query(`insert into players (full_name) values ('Player B') returning id`);

    await expect(
      client.query(
        `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
         values ($1, '2026-01-08', $2, $3, 4, 4, $2)`,
        [season.rows[0].id, playerA.rows[0].id, playerB.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('enforces one rating row per player per season', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 3', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Dup Player') returning id`,
    );
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await client.query(
      `insert into player_season_ratings (player_id, season_id) values ($1, $2)`,
      [playerId, seasonId],
    );

    await expect(
      client.query(
        `insert into player_season_ratings (player_id, season_id) values ($1, $2)`,
        [playerId, seasonId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid grade value', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 4', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Grade Player') returning id`,
    );

    await expect(
      client.query(
        `insert into player_season_ratings (player_id, season_id, grade) values ($1, $2, 'Z')`,
        [player.rows[0].id, season.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('defaults a new rating row to the baseline rating and matching grade', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 5', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Default Player') returning id`,
    );

    const row = await client.query(
      `insert into player_season_ratings (player_id, season_id) values ($1, $2) returning rating, grade, is_provisional`,
      [player.rows[0].id, season.rows[0].id],
    );

    expect(Number(row.rows[0].rating)).toBe(1500);
    expect(row.rows[0].grade).toBe('B');
    expect(row.rows[0].is_provisional).toBe(true);
  });

  it('defaults is_period_closed to false and allows it to be set true', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 6', '2026-01-01') returning id`,
    );
    const playerA = await client.query(`insert into players (full_name) values ('Period Player A') returning id`);
    const playerB = await client.query(`insert into players (full_name) values ('Period Player B') returning id`);

    const inserted = await client.query(
      `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
       values ($1, '2026-01-08', $2, $3, 5, 3, $2) returning id, is_period_closed`,
      [season.rows[0].id, playerA.rows[0].id, playerB.rows[0].id],
    );
    expect(inserted.rows[0].is_period_closed).toBe(false);

    const updated = await client.query(
      `update matches set is_period_closed = true where id = $1 returning is_period_closed`,
      [inserted.rows[0].id],
    );
    expect(updated.rows[0].is_period_closed).toBe(true);
  });
});
```

- [ ] **Step 4: Rewrite `src/db/rls.test.ts`**

```ts
// src/db/rls.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';
import { createScratchSchema, dropScratchSchema, randomSchemaName } from './scratchSchema';
import { loadRootEnv } from '../testEnv';

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? loadRootEnv().TEST_DATABASE_URL;

let client: Client;
let schemaName: string;

beforeAll(async () => {
  client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  schemaName = randomSchemaName('pool_league_rls_test');
  await createScratchSchema(client, schemaName);
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('row level security', () => {
  it('enables RLS on all 9 tables', async () => {
    const result = await client.query(
      `select relname from pg_class
       join pg_namespace on pg_namespace.oid = pg_class.relnamespace
       where pg_namespace.nspname = 'public' and relrowsecurity = true
       order by relname`,
    );
    const tableNames = result.rows.map((r: { relname: string }) => r.relname);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'match_audit_log',
        'matches',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('grants a select policy on every publicly-readable table', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = 'public' and cmd = 'SELECT' order by tablename`,
    );
    const tableNames = result.rows.map((r: { tablename: string }) => r.tablename);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'matches',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('defines no select policy at all for match_audit_log', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = 'public' and tablename = 'match_audit_log'`,
    );
    expect(result.rows).toEqual([]);
  });
});

describe('rating_events public read (anon/authenticated, PostgREST access)', () => {
  afterAll(async () => {
    await client.query('reset role');
  });

  it('allows anon to select from rating_events', async () => {
    await client.query('set role anon');
    try {
      const result = await client.query('select * from rating_events limit 1');
      expect(result.rows).toEqual([]);
    } finally {
      await client.query('reset role');
    }
  });

  it('allows authenticated to select from rating_events', async () => {
    await client.query('set role authenticated');
    try {
      const result = await client.query('select * from rating_events limit 1');
      expect(result.rows).toEqual([]);
    } finally {
      await client.query('reset role');
    }
  });

  it('still denies anon select on match_audit_log (regression check)', async () => {
    await client.query('set role anon');
    try {
      await expect(client.query('select * from match_audit_log limit 1')).rejects.toThrow(
        /permission denied for table match_audit_log/,
      );
    } finally {
      await client.query('reset role');
    }
  });

  it('still denies anon select on admin_users beyond own row (regression check)', async () => {
    await client.query('set role anon');
    try {
      await expect(client.query('select * from admin_users limit 1')).rejects.toThrow(
        /permission denied for table admin_users/,
      );
    } finally {
      await client.query('reset role');
    }
  });
});
```

- [ ] **Step 5: Rewrite `src/db/views.test.ts`**

```ts
// src/db/views.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';
import { createScratchSchema, dropScratchSchema, randomSchemaName } from './scratchSchema';
import { loadRootEnv } from '../testEnv';

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? loadRootEnv().TEST_DATABASE_URL;

let client: Client;
let schemaName: string;
let seasonId: string;

beforeAll(async () => {
  client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  schemaName = randomSchemaName('pool_league_views_test');
  await createScratchSchema(client, schemaName);
  await applyMigrations(client);

  const season = await client.query(
    `insert into seasons (name, start_date) values ('View Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;

  const eligible = await client.query(`insert into players (full_name) values ('Eligible Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1800, 5, 'A')`,
    [eligible.rows[0].id, seasonId],
  );

  const ineligible = await client.query(`insert into players (full_name) values ('New Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1500, 1, 'B')`,
    [ineligible.rows[0].id, seasonId],
  );
}, 30000);

afterAll(async () => {
  await dropScratchSchema(client, schemaName);
  await client.end();
});

describe('leaderboard_view', () => {
  it('includes only players with matches_played >= 3', async () => {
    const result = await client.query(`select full_name from leaderboard_view where season_id = $1`, [seasonId]);
    expect(result.rows.map((r: { full_name: string }) => r.full_name)).toEqual(['Eligible Player']);
  });

  it('assigns rank 1 to the only eligible player', async () => {
    const result = await client.query(`select rank from leaderboard_view where season_id = $1`, [seasonId]);
    expect(result.rows[0].rank).toBe('1');
  });
});

describe('grade_distribution_view', () => {
  it('counts only eligible players per grade', async () => {
    const result = await client.query(
      `select grade, player_count from grade_distribution_view where season_id = $1`,
      [seasonId],
    );
    expect(result.rows).toEqual([{ grade: 'A', player_count: '1' }]);
  });
});

describe('view grants for anon/authenticated (PostgREST access)', () => {
  afterAll(async () => {
    await client.query('reset role');
  });

  it('allows anon to select from leaderboard_view', async () => {
    await client.query('set role anon');
    try {
      const result = await client.query(
        `select player_id from leaderboard_view where season_id = $1`,
        [seasonId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    } finally {
      await client.query('reset role');
    }
  });

  it('allows anon to select from grade_distribution_view', async () => {
    await client.query('set role anon');
    try {
      const result = await client.query(
        `select grade from grade_distribution_view where season_id = $1`,
        [seasonId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    } finally {
      await client.query('reset role');
    }
  });

  it('allows authenticated to select from leaderboard_view', async () => {
    await client.query('set role authenticated');
    try {
      const result = await client.query(
        `select player_id from leaderboard_view where season_id = $1`,
        [seasonId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    } finally {
      await client.query('reset role');
    }
  });

  it('allows authenticated to select from grade_distribution_view', async () => {
    await client.query('set role authenticated');
    try {
      const result = await client.query(
        `select grade from grade_distribution_view where season_id = $1`,
        [seasonId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    } finally {
      await client.query('reset role');
    }
  });
});
```

- [ ] **Step 6: Disable file-level parallelism for `src/db` (the concurrency fix described above)**

In `package.json`, change:

```json
    "test:integration": "vitest run src/db",
```

to:

```json
    "test:integration": "vitest run src/db --no-file-parallelism",
```

- [ ] **Step 7: Run the suite against the real cloud project**

Run: `npm run test:integration`
Expected: all tests across `schema.test.ts`, `rls.test.ts`, `views.test.ts` pass. Confirm via the Supabase dashboard's SQL editor (`select nspname from pg_namespace where nspname like 'pool_league_%'`) that no scratch schemas remain after the run (each file's `afterAll` drops its own).

- [ ] **Step 8: Commit**

```bash
git add src/db/scratchSchema.ts src/db/applyMigrations.ts src/db/schema.test.ts src/db/rls.test.ts src/db/views.test.ts package.json
git commit -m "feat: redesign src/db tests around scratch schemas for Supabase Cloud"
```

---

### Task 4: `src/api` — explicit teardown and root-env retargeting

**Files:**
- Modify: `src/api/testSupport.ts` (full rewrite)
- Modify: `src/api/enterMatch.test.ts` (full rewrite)
- Modify: `src/api/closeWeek.test.ts` (full rewrite)
- Modify: `src/api/correctMatch.test.ts` (full rewrite)
- Modify: `src/api/startSeason.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `loadRootEnv()` from `src/testEnv.ts` (Task 1).
- Produces: `getSupabaseStatus(): SupabaseStatus`, `provisionTestAdmin(status): Promise<TestAdmin>`, `cleanupTestAdmin(status, userId): Promise<void>`, `cleanupSeasonData(dbClient, seasonId): Promise<void>`, `deletePlayers(dbClient, playerIds): Promise<void>`, `deleteSeasons(dbClient, seasonIds): Promise<void>` from `src/api/testSupport.ts`. Consumed by all four `src/api/*.test.ts` files.

**Two findings from reading the actual test files, both required by design spec §7's "every test that creates data must now explicitly delete everything it created" but not spelled out there:**

1. **Test admin users were never being cleaned up at all**, in any of the four files, under the old model (the whole local DB got wiped between runs, so nobody noticed). Against the shared cloud project, every run would otherwise leave a permanent `auth.users` row and `admin_users` row behind forever. `cleanupTestAdmin` fixes this.
2. **No table in this schema has `ON DELETE CASCADE`** (confirmed by reading `supabase/migrations/20260714000000_initial_schema.sql` — every FK is a plain `references`). Deleting a season or player row while child rows still reference it fails with a foreign-key violation. `cleanupSeasonData` deletes every season-scoped table in dependency order (`match_audit_log` → `rating_events` → `weekly_rankings` → `player_statistics` → `player_season_ratings` → `matches`) before `players`/`seasons` themselves are deleted.

- [ ] **Step 1: Rewrite `src/api/testSupport.ts`**

```ts
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
```

- [ ] **Step 2: Rewrite `src/api/enterMatch.test.ts`**

```ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  cleanupSeasonData,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
  type TestAdmin,
} from './testSupport';

let status: SupabaseStatus;
let admin: TestAdmin;
let accessToken: string;
let dbClient: Client;
let seasonId: string;
const createdPlayerIds: string[] = [];

beforeAll(async () => {
  status = getSupabaseStatus();
  admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('API Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

afterAll(async () => {
  await cleanupSeasonData(dbClient, seasonId);
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, [seasonId]);
  await cleanupTestAdmin(status, admin.userId);
  await dbClient.end();
}, 30000);

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

describe('POST /functions/v1/enter-match', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.ANON_KEY}` },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('creates a match, updates both players ratings, stats, and season points', async () => {
    const playerA = await createPlayer('Enter Match Player A');
    const playerB = await createPlayer('Enter Match Player B');

    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId,
        match_date: '2026-01-08',
        player_a_id: playerA,
        player_b_id: playerB,
        frames_a: 5,
        frames_b: 3,
      }),
    });
    expect(response.status).toBe(201);

    const ratingA = await dbClient.query(
      `select rating, matches_played, season_points from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(Number(ratingA.rows[0].rating)).toBeGreaterThan(1500);
    expect(ratingA.rows[0].matches_played).toBe(1);
    expect(ratingA.rows[0].season_points).toBeGreaterThan(0);

    const ratingB = await dbClient.query(
      `select rating from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerB, seasonId],
    );
    expect(Number(ratingB.rows[0].rating)).toBeLessThan(1500);

    const statsA = await dbClient.query(
      `select wins, losses, current_streak from player_statistics where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(statsA.rows[0]).toEqual({ wins: 1, losses: 0, current_streak: 1 });

    const auditLog = await dbClient.query(`select change_type from match_audit_log where match_id in (select id from matches where player_a_id = $1)`, [playerA]);
    expect(auditLog.rows[0].change_type).toBe('created');
  });

  it('computes avg_opponent_rating from each opponent\'s rating at match time, not their current rating', async () => {
    const playerA = await createPlayer('Snapshot Player A');
    const playerB = await createPlayer('Snapshot Player B');
    const playerC = await createPlayer('Snapshot Player C');

    async function enterMatch(matchDate: string, pA: string, pB: string, framesA: number, framesB: number) {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: matchDate,
          player_a_id: pA,
          player_b_id: pB,
          frames_a: framesA,
          frames_b: framesB,
        }),
      });
      expect(response.status).toBe(201);
    }

    await enterMatch('2026-02-01', playerA, playerB, 5, 3);
    await enterMatch('2026-02-02', playerA, playerC, 5, 2);
    await enterMatch('2026-02-03', playerB, playerA, 5, 1);

    const statsA = await dbClient.query(
      `select avg_opponent_rating from player_statistics where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );

    const expectedAvgOpponentRating = (1500 + 1500 + 1471.875) / 3;
    expect(Number(statsA.rows[0].avg_opponent_rating)).toBeCloseTo(expectedAvgOpponentRating, 2);
  });

  it('rejects a request with frames sent as strings instead of numbers, rather than silently miscomputing the winner', async () => {
    const playerA = await createPlayer('Validation Player A');
    const playerB = await createPlayer('Validation Player B');
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-09',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: '2', frames_b: '10',
      }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects equal frame counts', async () => {
    const playerA = await createPlayer('Tie Player A');
    const playerB = await createPlayer('Tie Player B');
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-09',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 4, frames_b: 4,
      }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent player_id instead of silently creating a phantom rating row', async () => {
    const playerA = await createPlayer('Phantom Check Player A');
    const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-09',
        player_a_id: playerA, player_b_id: '00000000-0000-0000-0000-000000000000',
        frames_a: 5, frames_b: 2,
      }),
    });
    expect(response.status).toBe(400);
  });

  it('returns the existing match instead of duplicating it when the identical request is retried', async () => {
    const playerA = await createPlayer('Retry Player A');
    const playerB = await createPlayer('Retry Player B');
    const submit = () => fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-01-10',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 5, frames_b: 3,
      }),
    });

    const first = await submit();
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await submit();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.match_id).toBe(firstBody.match_id);

    const matchCount = await dbClient.query(
      `select count(*)::int as count from matches where player_a_id = $1 and player_b_id = $2`,
      [playerA, playerB],
    );
    expect(matchCount.rows[0].count).toBe(1);
  });

  it('does not lose a rating update when many matches for the same player are entered concurrently', async () => {
    const anchor = await createPlayer('Concurrency Anchor');
    const opponents = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createPlayer(`Concurrency Opponent ${i}`)),
    );

    const responses = await Promise.all(
      opponents.map((opponentId, i) =>
        fetch(`${status.API_URL}/functions/v1/enter-match`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            season_id: seasonId, match_date: '2026-01-11',
            player_a_id: anchor, player_b_id: opponentId,
            frames_a: 5, frames_b: 2 + (i % 2),
          }),
        }),
      ),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);

    const anchorRating = await dbClient.query(
      `select matches_played from player_season_ratings where player_id = $1 and season_id = $2`,
      [anchor, seasonId],
    );
    expect(anchorRating.rows[0].matches_played).toBe(opponents.length);
  });
});
```

- [ ] **Step 3: Rewrite `src/api/closeWeek.test.ts`**

```ts
// src/api/closeWeek.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  cleanupSeasonData,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
  type TestAdmin,
} from './testSupport';
import { reconcilePeriod } from '../rating/glicko2';
import { BASELINE_RATING, INITIAL_RD, INITIAL_VOLATILITY } from '../rating/constants';

let status: SupabaseStatus;
let admin: TestAdmin;
let accessToken: string;
let dbClient: Client;
let seasonId: string;
const createdPlayerIds: string[] = [];

async function enterMatch(playerA: string, playerB: string, framesA: number, framesB: number) {
  const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      season_id: seasonId,
      match_date: '2026-01-08',
      player_a_id: playerA,
      player_b_id: playerB,
      frames_a: framesA,
      frames_b: framesB,
    }),
  });
  const body = await response.json();
  return body.match_id as string;
}

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Close Week Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

afterAll(async () => {
  await cleanupSeasonData(dbClient, seasonId);
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, [seasonId]);
  await cleanupTestAdmin(status, admin.userId);
  await dbClient.end();
}, 30000);

describe('POST /functions/v1/close-week', () => {
  it('reconciles ratings via Glicko-2, writes weekly_rankings, and locks the matches', async () => {
    const playerA = await createPlayer('Close Week Player A');
    const playerB = await createPlayer('Close Week Player B');
    const matchId = await enterMatch(playerA, playerB, 5, 2);

    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });
    expect(response.status).toBe(200);

    const match = await dbClient.query(`select is_period_closed from matches where id = $1`, [matchId]);
    expect(match.rows[0].is_period_closed).toBe(true);

    const weeklyRanking = await dbClient.query(
      `select rank, grade, rd from weekly_rankings where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(weeklyRanking.rows[0].rank).toBe(1);
    expect(Number(weeklyRanking.rows[0].rd)).toBeGreaterThan(0);
    expect(Number(weeklyRanking.rows[0].rd)).toBeLessThan(350);

    const ratingEvent = await dbClient.query(
      `select event_type, volatility_before, volatility_after from rating_events
       where player_id = $1 and season_id = $2 and event_type = 'weekly_reconciliation'`,
      [playerA, seasonId],
    );
    expect(ratingEvent.rows[0].volatility_before).not.toBeNull();
    expect(ratingEvent.rows[0].volatility_after).not.toBeNull();
  });

  it('rejects correcting a match after its week has closed', async () => {
    const playerA = await createPlayer('Locked Player A');
    const playerB = await createPlayer('Locked Player B');
    const matchId = await enterMatch(playerA, playerB, 5, 1);

    await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });

    const correctResponse = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 2 }),
    });
    expect(correctResponse.status).toBe(400);
  });

  it('reconciles every player against opponents\' PRE-period ratings, not opponents\' live-updated mid-loop ratings (opponent-snapshot contamination regression test)', async () => {
    const p1 = await createPlayer('Snapshot Test P1');
    const p2 = await createPlayer('Snapshot Test P2');
    const p3 = await createPlayer('Snapshot Test P3');

    await enterMatch(p2, p1, 5, 2);
    await enterMatch(p2, p3, 5, 3);

    const baseline = { rating: BASELINE_RATING, rd: INITIAL_RD, volatility: INITIAL_VOLATILITY };

    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-01-11' }),
    });
    expect(response.status).toBe(200);

    const correct = reconcilePeriod(baseline, [{ rating: baseline.rating, rd: baseline.rd, score: 0 }]);

    const p2Reconciled = reconcilePeriod(baseline, [
      { rating: baseline.rating, rd: baseline.rd, score: 1 },
      { rating: baseline.rating, rd: baseline.rd, score: 1 },
    ]);
    const contaminated = reconcilePeriod(baseline, [{ rating: p2Reconciled.rating, rd: p2Reconciled.rd, score: 0 }]);

    const actual = await dbClient.query(
      `select rating_after, rd_after from rating_events
       where player_id = $1 and season_id = $2 and event_type = 'weekly_reconciliation'`,
      [p3, seasonId],
    );
    const actualRatingAfter = Number(actual.rows[0].rating_after);
    const actualRdAfter = Number(actual.rows[0].rd_after);

    expect(actualRatingAfter).toBeCloseTo(correct.rating, 6);
    expect(actualRdAfter).toBeCloseTo(correct.rd, 6);

    expect(Math.abs(correct.rating - contaminated.rating)).toBeGreaterThan(1);
    expect(Math.abs(actualRatingAfter - contaminated.rating)).toBeGreaterThan(1);
  });

  it('reconciles from the true pre-period rating, not the live instant-nudged rating', async () => {
    const playerA = await createPlayer('CloseWeek Baseline Player A');
    const playerB = await createPlayer('CloseWeek Baseline Player B');

    await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-04-01',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 5, frames_b: 2,
      }),
    });

    const instantEvent = await dbClient.query(
      `select rating_before from rating_events where player_id = $1 and season_id = $2 and event_type = 'instant'`,
      [playerA, seasonId],
    );
    const preMatchRating = Number(instantEvent.rows[0].rating_before);

    const closeResponse = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2026-04-01' }),
    });
    expect(closeResponse.status).toBe(200);

    const reconciliationEvent = await dbClient.query(
      `select rating_before from rating_events where player_id = $1 and season_id = $2 and event_type = 'weekly_reconciliation' order by created_at desc limit 1`,
      [playerA, seasonId],
    );
    expect(Number(reconciliationEvent.rows[0].rating_before)).toBeCloseTo(preMatchRating, 5);
  });

  it('rejects a week_ending date before the season started', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: seasonId, week_ending: '2019-01-01' }),
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 4: Rewrite `src/api/correctMatch.test.ts`**

```ts
// src/api/correctMatch.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  cleanupSeasonData,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
  type TestAdmin,
} from './testSupport';
import { calculateSeasonPoints } from '../rating/seasonPoints';

let status: SupabaseStatus;
let admin: TestAdmin;
let accessToken: string;
let dbClient: Client;
let seasonId: string;
const createdPlayerIds: string[] = [];
const createdSeasonIds: string[] = [];

async function enterMatch(playerA: string, playerB: string, framesA: number, framesB: number) {
  const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      season_id: seasonId,
      match_date: '2026-01-08',
      player_a_id: playerA,
      player_b_id: playerB,
      frames_a: framesA,
      frames_b: framesB,
    }),
  });
  const body = await response.json();
  return body.match_id as string;
}

async function enterMatchIn(
  targetSeasonId: string,
  playerA: string,
  playerB: string,
  framesA: number,
  framesB: number,
  matchDate: string,
) {
  const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      season_id: targetSeasonId,
      match_date: matchDate,
      player_a_id: playerA,
      player_b_id: playerB,
      frames_a: framesA,
      frames_b: framesB,
    }),
  });
  const body = await response.json();
  return body.match_id as string;
}

async function closeWeek(targetSeasonId: string, weekEnding: string) {
  return fetch(`${status.API_URL}/functions/v1/close-week`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ season_id: targetSeasonId, week_ending: weekEnding }),
  });
}

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Correct Match Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
  createdSeasonIds.push(seasonId);
}, 30000);

afterAll(async () => {
  for (const id of createdSeasonIds) {
    await cleanupSeasonData(dbClient, id);
  }
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, createdSeasonIds);
  await cleanupTestAdmin(status, admin.userId);
  await dbClient.end();
}, 30000);

describe('PATCH /functions/v1/correct-match', () => {
  it('rejects correcting a match whose week is already closed', async () => {
    const playerA = await createPlayer('Closed Player A');
    const playerB = await createPlayer('Closed Player B');
    const matchId = await enterMatch(playerA, playerB, 5, 3);
    await dbClient.query(`update matches set is_period_closed = true where id = $1`, [matchId]);

    const response = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 4 }),
    });
    expect(response.status).toBe(400);
  });

  it('voids the old match, inserts a corrected one, and replays the open week rating', async () => {
    const playerA = await createPlayer('Correct Player A');
    const playerB = await createPlayer('Correct Player B');
    const matchId = await enterMatch(playerA, playerB, 5, 0);

    const response = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 4 }),
    });
    expect(response.status).toBe(200);

    const oldMatch = await dbClient.query(`select is_voided from matches where id = $1`, [matchId]);
    expect(oldMatch.rows[0].is_voided).toBe(true);

    const correctedMatches = await dbClient.query(
      `select frames_a, frames_b from matches where player_a_id = $1 and is_voided = false`,
      [playerA],
    );
    expect(correctedMatches.rows).toEqual([{ frames_a: 5, frames_b: 4 }]);

    const finalRating = await dbClient.query(
      `select rating from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(Number(finalRating.rows[0].rating)).toBeGreaterThan(1500);
    expect(Number(finalRating.rows[0].rating)).toBeLessThan(1525);
  });

  it('replays matches_played and season_points cumulatively across a closed week plus an open-week correction', async () => {
    const season = await dbClient.query(
      `insert into seasons (name, start_date) values ('Correct Match Cumulative Test Season', '2026-01-01') returning id`,
    );
    const cumSeasonId = season.rows[0].id;
    createdSeasonIds.push(cumSeasonId);

    const playerA = await createPlayer('Cumulative Player A');
    const playerB = await createPlayer('Cumulative Player B');

    await enterMatchIn(cumSeasonId, playerA, playerB, 5, 3, '2026-01-08');
    await enterMatchIn(cumSeasonId, playerA, playerB, 5, 2, '2026-01-09');
    await enterMatchIn(cumSeasonId, playerA, playerB, 5, 4, '2026-01-10');

    const closeResponse = await closeWeek(cumSeasonId, '2026-01-11');
    expect(closeResponse.status).toBe(200);

    const closedWeekRow = await dbClient.query(
      `select season_points from weekly_rankings where player_id = $1 and season_id = $2 and week_ending = '2026-01-11'`,
      [playerA, cumSeasonId],
    );
    const baselineSeasonPoints = Number(closedWeekRow.rows[0].season_points);
    expect(baselineSeasonPoints).toBeGreaterThan(0);

    const openMatchId = await enterMatchIn(cumSeasonId, playerA, playerB, 5, 1, '2026-01-15');

    const opponentBefore = await dbClient.query(
      `select rating from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerB, cumSeasonId],
    );
    const opponentRatingForReplay = Number(opponentBefore.rows[0].rating);

    const correctResponse = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: openMatchId, frames_a: 5, frames_b: 2 }),
    });
    expect(correctResponse.status).toBe(200);
    const { corrected_match_id: correctedMatchId } = await correctResponse.json();

    const finalRow = await dbClient.query(
      `select matches_played, is_provisional, season_points from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerA, cumSeasonId],
    );

    expect(finalRow.rows[0].matches_played).toBe(4);
    expect(finalRow.rows[0].is_provisional).toBe(false);

    const replayedEvent = await dbClient.query(
      `select rating_after from rating_events where match_id = $1 and player_id = $2 and event_type = 'instant'`,
      [correctedMatchId, playerA],
    );
    const ownRatingAfterReplay = Number(replayedEvent.rows[0].rating_after);

    const expectedPointsEarned = calculateSeasonPoints({
      won: true,
      framesFor: 5,
      framesAgainst: 2,
      ownRating: ownRatingAfterReplay,
      opponentRating: opponentRatingForReplay,
    });

    expect(finalRow.rows[0].season_points).toBe(baselineSeasonPoints + expectedPointsEarned);
  });

  it('recomputes player_statistics for both players after a correction, not just rating', async () => {
    const playerA = await createPlayer('Stats Correction Player A');
    const playerB = await createPlayer('Stats Correction Player B');

    const enterResponse = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: seasonId, match_date: '2026-03-01',
        player_a_id: playerA, player_b_id: playerB,
        frames_a: 5, frames_b: 1,
      }),
    });
    const { match_id: matchId } = await enterResponse.json();

    const correctResponse = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 1, frames_b: 5 }),
    });
    expect(correctResponse.status).toBe(200);

    const statsA = await dbClient.query(
      `select wins, losses from player_statistics where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(statsA.rows[0]).toEqual({ wins: 0, losses: 1 });

    const statsB = await dbClient.query(
      `select wins, losses from player_statistics where player_id = $1 and season_id = $2`,
      [playerB, seasonId],
    );
    expect(statsB.rows[0]).toEqual({ wins: 1, losses: 0 });

    const statsAFull = await dbClient.query(
      `select avg_opponent_rating from player_statistics where player_id = $1 and season_id = $2`,
      [playerA, seasonId],
    );
    expect(Number(statsAFull.rows[0].avg_opponent_rating)).toBeCloseTo(1500, 2);
  });
});
```

- [ ] **Step 5: Rewrite `src/api/startSeason.test.ts`**

Note on the last test's `activeSeasons.rows.length === 1` assertion (unscoped by season ID, unlike everything else in this rewrite): it stays valid under the shared-cloud model specifically because (a) this file is the *only* place in the whole test suite that ever sets `status = 'active'` directly (every other file's raw `insert into seasons` defaults to `status = 'draft'` per `20260714000000_initial_schema.sql:20` — confirmed by grep, not assumed), and (b) this file's own `afterAll` now deletes every season it created, so a clean prior run always leaves zero active seasons behind. This is why every season this file creates — including the ones the original version didn't bother capturing an ID for — must be tracked.

```ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  cleanupSeasonData,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
  type TestAdmin,
} from './testSupport';

let status: SupabaseStatus;
let admin: TestAdmin;
let accessToken: string;
let dbClient: Client;
const createdPlayerIds: string[] = [];
const createdSeasonIds: string[] = [];

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

afterAll(async () => {
  for (const id of createdSeasonIds) {
    await cleanupSeasonData(dbClient, id);
  }
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, createdSeasonIds);
  await cleanupTestAdmin(status, admin.userId);
  await dbClient.end();
}, 30000);

describe('POST /functions/v1/start-season', () => {
  it('creates a new season and carries over ratings with the soft-reset formula', async () => {
    const oldSeason = await dbClient.query(
      `insert into seasons (name, start_date) values ('Old Season', '2025-01-01') returning id`,
    );
    const oldSeasonId = oldSeason.rows[0].id;
    createdSeasonIds.push(oldSeasonId);

    const playerId = await createPlayer('Carryover Player');
    await dbClient.query(
      `insert into player_season_ratings (player_id, season_id, rating, rd, volatility)
       values ($1, $2, 1900, 100, 0.06)`,
      [playerId, oldSeasonId],
    );

    const strayPlayerId = await createPlayer('No Prior Row Player');

    const response = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previous_season_id: oldSeasonId,
        new_season_name: 'New Season',
        start_date: '2026-02-01',
      }),
    });
    expect(response.status).toBe(201);
    const { season_id: newSeasonId } = await response.json();
    createdSeasonIds.push(newSeasonId);

    const newRating = await dbClient.query(
      `select rating, rd, grade from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerId, newSeasonId],
    );
    expect(Number(newRating.rows[0].rating)).toBeCloseTo(1800, 5);
    expect(Number(newRating.rows[0].rd)).toBeCloseTo(150, 5);
    expect(newRating.rows[0].grade).toBe('A');

    const carryoverEvent = await dbClient.query(
      `select event_type, rating_before, rd_before, volatility_before, rating_after, rd_after
       from rating_events where player_id = $1 and season_id = $2`,
      [playerId, newSeasonId],
    );
    expect(carryoverEvent.rows[0].event_type).toBe('season_carryover');
    expect(Number(carryoverEvent.rows[0].rating_before)).toBeCloseTo(1900, 5);
    expect(Number(carryoverEvent.rows[0].rd_before)).toBeCloseTo(100, 5);
    expect(Number(carryoverEvent.rows[0].volatility_before)).toBeCloseTo(0.06, 5);
    expect(Number(carryoverEvent.rows[0].rating_after)).toBeCloseTo(1800, 5);
    expect(Number(carryoverEvent.rows[0].rd_after)).toBeCloseTo(150, 5);

    const strayRating = await dbClient.query(
      `select 1 from player_season_ratings where player_id = $1 and season_id = $2`,
      [strayPlayerId, newSeasonId],
    );
    expect(strayRating.rows.length).toBe(0);
    const strayEvent = await dbClient.query(
      `select 1 from rating_events where player_id = $1 and season_id = $2`,
      [strayPlayerId, newSeasonId],
    );
    expect(strayEvent.rows.length).toBe(0);

    const previousSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [oldSeasonId]);
    expect(previousSeasonStatus.rows[0].status).toBe('completed');

    const newSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [newSeasonId]);
    expect(newSeasonStatus.rows[0].status).toBe('active');
  });

  it('creates a new season with no carryover when previous_season_id is omitted', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_season_name: 'Fresh Season With No Predecessor',
        start_date: '2026-03-01',
      }),
    });
    expect(response.status).toBe(201);
    const { season_id: newSeasonId } = await response.json();
    createdSeasonIds.push(newSeasonId);
    expect(newSeasonId).toBeTruthy();

    const rows = await dbClient.query(
      `select 1 from player_season_ratings where season_id = $1`,
      [newSeasonId],
    );
    expect(rows.rows.length).toBe(0);

    const newSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [newSeasonId]);
    expect(newSeasonStatus.rows[0].status).toBe('active');
  });

  it('rejects a previous_season_id that does not reference an existing season', async () => {
    const response = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_season_name: 'Bad Previous Season Test',
        start_date: '2026-05-01',
        previous_season_id: '00000000-0000-0000-0000-000000000000',
      }),
    });
    expect(response.status).toBe(400);

    const orphan = await dbClient.query(`select id from seasons where name = $1`, ['Bad Previous Season Test']);
    expect(orphan.rows.length).toBe(0);
  });

  it('completes any other active season when starting a new one, so only one season is ever active', async () => {
    const first = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_season_name: 'Single Active Season Test 1', start_date: '2026-06-01' }),
    });
    const { season_id: firstSeasonId } = await first.json();
    createdSeasonIds.push(firstSeasonId);

    const second = await fetch(`${status.API_URL}/functions/v1/start-season`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_season_name: 'Single Active Season Test 2', start_date: '2026-06-08' }),
    });
    const { season_id: secondSeasonId } = await second.json();
    createdSeasonIds.push(secondSeasonId);

    const activeSeasons = await dbClient.query(`select id from seasons where status = 'active'`);
    expect(activeSeasons.rows.length).toBe(1);

    const firstSeasonStatus = await dbClient.query(`select status from seasons where id = $1`, [firstSeasonId]);
    expect(firstSeasonStatus.rows[0].status).toBe('completed');
  });
});
```

- [ ] **Step 6: Run the suite against the real deployed cloud functions**

Run: `npm run test:api`
Expected: all tests across the four files pass. Confirm cleanup worked: in the Supabase dashboard SQL editor, run `select count(*) from seasons` and `select count(*) from players` before and after the run — counts should return to their pre-run values. Also confirm in Authentication → Users that no `test-admin-*@example.com` users remain.

- [ ] **Step 7: Commit**

```bash
git add src/api/testSupport.ts src/api/enterMatch.test.ts src/api/closeWeek.test.ts src/api/correctMatch.test.ts src/api/startSeason.test.ts
git commit -m "feat: add explicit teardown to src/api tests for shared Supabase Cloud project"
```

---

### Task 5: Frontend env loading

**Files:**
- Modify: `web/scripts/generate-env.mjs` (full rewrite)
- Modify: `web/src/lib/supabaseClient.ts` (full rewrite)

**Interfaces:**
- Consumes: `loadRootEnv()` from `scripts/loadEnv.mjs` (Task 1).

The self-hosted stack's "bake an empty `VITE_SUPABASE_URL` so the client falls back to `window.location.origin`" trick (`web/src/lib/supabaseClient.ts:7-12` today) only made sense when a same-origin nginx proxy sat in front of Kong. That proxy is retired in Task 6 — the Docker build now always passes a real cloud URL — so the fallback branch has no remaining caller and is removed rather than left dead.

- [ ] **Step 1: Rewrite `web/scripts/generate-env.mjs`**

```js
// web/scripts/generate-env.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRootEnv } from '../../scripts/loadEnv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');

const env = loadRootEnv();
const content = `VITE_SUPABASE_URL=${env.SUPABASE_URL}\nVITE_SUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY}\n`;
writeFileSync(path.join(webDir, '.env.local'), content);
console.log('Wrote web/.env.local');
```

- [ ] **Step 2: Rewrite `web/src/lib/supabaseClient.ts`**

```ts
// web/src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Run `npm run env:generate` (requires a root .env -- see .env.example).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 3: Confirm the existing frontend unit tests still pass unmodified**

`web/src/lib/supabaseClient.test.ts` and `web/src/lib/edgeFunctions.ts`/`edgeFunctions.test.ts` need no changes: `supabaseClient.test.ts`'s "throws a clear error when env vars are missing" test stubs both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `''`, which still throws under the simplified logic (`!supabaseUrl` alone is now `true`, whereas before it was only `!supabaseAnonKey` doing the work under jsdom's `window`-defined environment) — the assertion holds either way. `edgeFunctions.ts` already builds its fetch URL from `import.meta.env.VITE_SUPABASE_URL` directly and was never affected by the origin-fallback branch.

Run: `cd web && npm test -- supabaseClient edgeFunctions`
Expected: all tests in both files pass, no changes needed to either test file.

- [ ] **Step 4: Generate `web/.env.local` from the real root `.env` and confirm dev server boots**

Run: `cd web && npm run env:generate`
Expected: `Wrote web/.env.local`, containing the real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from Task 2's `.env`.

Run: `cd web && npm run dev` (then stop it once confirmed — this is a manual boot check, not left running)
Expected: Vite dev server starts with no "Missing VITE_SUPABASE_URL" crash in the browser console at `http://localhost:5173`.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/generate-env.mjs web/src/lib/supabaseClient.ts
git commit -m "feat: point frontend env generation at the root .env, drop self-host origin fallback"
```

---

### Task 6: Frontend container — single service, cloud-direct networking

**Files:**
- Modify: `docker-compose.yml` (full rewrite)
- Modify: `web/nginx.conf` (full rewrite)

**Interfaces:** none (infra-only; `web/Dockerfile` itself is unchanged — see design spec §5, confirmed by reading it: it already just takes `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` as build args with no Kong-specific logic).

**Finding from reading `web/nginx.conf`:** its `location ~ ^/(rest|auth|storage|functions)/v1/` block does `proxy_pass http://kong:8000`, a Docker Compose service name. Once `docker-compose.yml` drops every service except `frontend` (this task), `kong` no longer resolves on the compose network at all — nginx resolves static `proxy_pass` targets at container startup, so this would make the frontend container **fail to start**, not just leave dead code behind. This file isn't in the design spec's "Modified" list (§5) but must change here.

- [ ] **Step 1: Rewrite `docker-compose.yml`**

```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: web/Dockerfile
      args:
        VITE_SUPABASE_URL: ${SUPABASE_URL}
        VITE_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
    restart: unless-stopped
    ports:
      - "8080:80"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

(Docker Compose automatically reads a `.env` file in the same directory as `docker-compose.yml` for `${VAR}` substitution — this is the same root `.env` from Task 1, no `--env-file` flag needed.)

- [ ] **Step 2: Rewrite `web/nginx.conf`**

```
server {
    listen 80;
    root /usr/share/nginx/html;

    location / {
        try_files $uri /index.html;
    }
}
```

- [ ] **Step 3: Build and run the single-container stack against the real cloud project**

Run: `docker compose up -d --build`
Expected: only one service (`frontend`) builds and starts; `docker compose ps` shows it `Up`.

Run (manual browser check): open `http://localhost:8080` — the public leaderboard/matches/grades pages should load (they may be empty until Task 2's cloud project is seeded — that's expected and checked in Task 11, not here). Open browser devtools Network tab and confirm requests go directly to `https://ictqbqtkvptbjecxvnax.supabase.co/...`, not to `/rest/...` or `/auth/...` on the same origin.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml web/nginx.conf
git commit -m "feat: shrink docker-compose to a single frontend container talking directly to Supabase Cloud"
```

---

### Task 7: Seed script consolidation

**Files:**
- Modify: `scripts/seed.mjs` (full rewrite)
- Delete: `scripts/seed-selfhost.mjs`

**Interfaces:**
- Consumes: `loadRootEnv()` from `scripts/loadEnv.mjs` (Task 1).

- [ ] **Step 1: Rewrite `scripts/seed.mjs`**

```js
// scripts/seed.mjs
//
// One-shot demo-data seed script against the Supabase Cloud project. Exercises
// the real enter-match and close-week Edge Functions (not raw SQL inserts) so
// the resulting data has genuine, internally-consistent rating history,
// statistics, and season points.
//
// Usage: node scripts/seed.mjs
// Requires a filled-in root .env (see .env.example) and the four Edge
// Functions already deployed (`supabase functions deploy`).
import { createClient } from '@supabase/supabase-js';
import { loadRootEnv } from './loadEnv.mjs';

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie',
  'Drew', 'Avery', 'Quinn', 'Reese', 'Skyler', 'Rowan', 'Finley', 'Hayden',
  'Emerson', 'Parker', 'Blake', 'Dakota', 'Charlie', 'Sage', 'Kendall', 'Marley',
  'Peyton', 'Shawn', 'Terry', 'Wesley', 'Yael', 'Zion',
];

async function main() {
  const env = loadRootEnv();
  const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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

  const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
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

  async function enterMatch(playerA, playerB, framesA, framesB, matchDate) {
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/enter-match`, {
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
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/close-week`, {
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
    for (let i = 0; i < players.length - 1; i += 2) {
      const framesA = Math.floor(Math.random() * 3) + 3;
      const framesB = Math.floor(Math.random() * framesA);
      const [a, b] = Math.random() > 0.5 ? [players[i].id, players[i + 1].id] : [players[i + 1].id, players[i].id];
      await enterMatch(a, b, framesA, framesB, weekEnding);
    }

    await closeWeek(weekEnding);
  }

  console.log(`Seeded season ${season.id} with ${players.length} players across ${weeks.length} closed weeks.`);
  console.log(`Admin login: ${email} / ${password}`);
}

main().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Delete `scripts/seed-selfhost.mjs`**

```bash
git rm scripts/seed-selfhost.mjs
```

- [ ] **Step 3: Run the seed script against the real cloud project**

Run: `npm run seed`
Expected: `Seeded season <uuid> with 30 players across 3 closed weeks.` and an admin login line. Confirm via `http://localhost:8080` (Task 6's running frontend container) that the leaderboard now shows seeded players.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.mjs
git commit -m "feat: consolidate seed script onto the root .env, remove seed-selfhost.mjs"
```

---

### Task 8: Delete dead self-host infrastructure

**Files:**
- Delete: `docker/kong.yml`
- Delete: `docker/db-init/zz-set-role-passwords.sh`
- Delete: `docker/README.md`
- Delete: `scripts/generate-selfhost-secrets.mjs`
- Delete: `scripts/migrate-selfhost.mjs`
- Delete: `.env.selfhost.example`
- Modify: `.gitignore` (remove `.env.selfhost` entry)
- Modify: `supabase/functions/README.md` (full rewrite)

**Interfaces:** none.

`supabase/functions/README.md` is not in the design spec's file list either, but reading it in full shows it's now almost entirely wrong: it documents `npx supabase functions serve` auto-injecting `SUPABASE_DB_URL` locally, an OneDrive file-watcher flake specific to that local dev server, and `npx supabase db reset` — none of which apply once functions are deployed to Supabase Cloud instead of served locally. Its "Resolved history" section (real `correct-match` bug history) is still worth keeping.

- [ ] **Step 1: Delete the self-hosted infra files**

```bash
git rm docker/kong.yml docker/README.md .env.selfhost.example
git rm -r docker/db-init
git rm scripts/generate-selfhost-secrets.mjs scripts/migrate-selfhost.mjs
```

- [ ] **Step 2: Remove the now-unused `.gitignore` entry**

In `.gitignore`, remove the line:

```
.env.selfhost
```

(Leave `.env` and the rest of the file untouched.)

- [ ] **Step 3: Rewrite `supabase/functions/README.md`**

```markdown
# Edge Functions

This directory holds the pool-league ranking app's Supabase Edge Functions
(`enter-match`, `correct-match`, `close-week`, `start-season`, plus shared
helpers under `_shared/`). They run on Supabase Cloud, not locally.

## Deploying

```
npx supabase functions deploy enter-match correct-match close-week start-season
```

Each function's `_shared/` imports resolve the same way regardless of which
function is being deployed.

## Direct Postgres access (transactions)

Some Edge Functions need a real, multi-statement Postgres transaction (row
locking plus atomic commit/rollback) instead of separate PostgREST calls via
`db.from(...)` — see `withTransaction` in
`supabase/functions/_shared/dbTransaction.ts`. This requires a
`SUPABASE_DB_URL` env var to be visible to the function at runtime.

Unlike `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` (which
Supabase Cloud auto-injects into every deployed function), `SUPABASE_DB_URL`
is **not** auto-injected and must be set explicitly, once, as a function
secret using the Supavisor **transaction-mode** pooler connection string
(Project Settings → Database → Connection string → Transaction pooler):

```
npx supabase secrets set SUPABASE_DB_URL="<transaction-pooler-connection-string>"
```

## Resolved history (worth knowing about)

Two bugs in `correct-match`'s open-week replay were found and fixed after
Task 9 (`close-week`) landed made them detectable:

- `matches_played` was being reset to just the open week's replayed count
  instead of staying cumulative across the season, which could flip
  `is_provisional` back to `true` and eject an affected player from
  `leaderboard_view`/`grade_distribution_view` after a correction.
- `season_points` was never recomputed at all during a correction, so a
  corrected match's points were never credited and the voided match's
  original points stayed baked in permanently.

Both are fixed in `supabase/functions/correct-match/index.ts`
(`replayOpenWeek`), with permanent regression coverage in
`src/api/correctMatch.test.ts`. See that file's inline comments for the
exact mechanics (baseline-plus-replay: seed from the last closed-week
snapshot, then only accumulate the currently-open week's replayed matches
on top).
```

- [ ] **Step 4: Verify nothing else references the deleted files**

Run: `grep -rn "generate-selfhost-secrets\|migrate-selfhost\|seed-selfhost\|kong.yml\|db-init\|env.selfhost" --include="*.md" --include="*.json" --include="*.ts" --include="*.mjs" --include="*.yml" . --exclude-dir=node_modules --exclude-dir=.git`
Expected: no matches (README.md and docker-compose.yml are rewritten by Tasks 6 and 9 respectively — if this task runs before Task 9, expect remaining references in the not-yet-rewritten `README.md`, which is fine and closed out there).

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore: delete self-hosted docker-compose infrastructure files"
```

---

### Task 9: README.md rewrite

**Files:**
- Modify: `README.md` (full rewrite)

**Interfaces:** none.

- [ ] **Step 1: Rewrite `README.md`**

```markdown
# Pool League

An FPL-styled pool league scoring app: public leaderboard, match history,
player profiles with photos and rating charts, plus an admin section for
entering matches and managing seasons.

## Project structure — one repo, three layers

```
.
├── src/                  # Rating engine + backend test suites (TypeScript)
│   ├── rating/           #   Glicko-2/Elo, grades, season points, odds (pure logic)
│   ├── db/                #   schema / RLS / view integration tests (scratch schema per run)
│   └── api/               #   edge-function API tests (against deployed Supabase Cloud functions)
├── supabase/
│   ├── migrations/       # The database schema — single source of truth
│   ├── functions/        # Edge functions: enter-match, correct-match,
│   │                      #   close-week, start-season
│   └── config.toml        # Supabase CLI config (project_id = pool-scoring-app)
├── web/                  # React + Vite + Tailwind frontend
├── docker-compose.yml    # Single frontend container, talks directly to Supabase Cloud
└── scripts/              # Seeding + shared env loader
```

There is **one application**. The phases you may see referenced in
`docs/` (rating engine → backend API → frontend → cloud hosting) were
development milestones, not separate apps.

## Runtime model

Everything — local dev, the automated test suite, and the deployed app —
points at one Supabase Cloud project. There is no local Postgres/Auth/REST
stack and no self-hosted Kong/edge-runtime containers; the database, auth,
REST API, and all four admin Edge Functions live on Supabase Cloud. The only
thing that runs locally in Docker is the frontend: a single nginx container
serving the built React app, talking to the cloud project directly over
HTTPS.

### First-time setup

1. Copy `.env.example` to `.env` and fill in your Supabase Cloud project's
   values (Project Settings → API and → Database in the Supabase dashboard).
2. Push the schema and deploy the functions (see
   `supabase/functions/README.md` for the `SUPABASE_DB_URL` secret step):
   ```
   npx supabase db push
   npx supabase functions deploy
   ```
3. Seed demo data:
   ```
   npm run seed
   ```
4. Run the frontend:
   ```
   cd web && npm run dev      # http://localhost:5173
   ```
   or as a single Docker container:
   ```
   docker compose up -d --build   # http://localhost:8080
   ```

`web/npm run dev`/`build` auto-write `web/.env.local` from the root `.env`,
so the frontend always points at your Supabase Cloud project.

## Tests

```
npm test                   # rating engine + db + api suites (repo root)
cd web && npm test         # frontend component/page/hook tests
```

`npm test` runs entirely against the Supabase Cloud project in your `.env`:
`src/db` applies the full migration set into a fresh, uniquely-named scratch
*schema* per test file (dropped afterward), and `src/api` calls the real
deployed Edge Functions over HTTPS, deleting everything it creates when each
file finishes. No local database is ever created or reset.

## Troubleshooting: "no data is loading"

1. **Is `.env` filled in?** `web/.env.local` (auto-generated) must contain a
   real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — if the app throws
   "Missing VITE_SUPABASE_URL" in the browser console, re-run
   `npm run env:generate` inside `web/` after fixing the root `.env`.
2. **Is it seeded?** Empty DB = empty pages. Players only appear on the
   leaderboard after **3 completed matches** (`matches_played >= 3`).
3. **Are migrations current?** Run `npx supabase db push` to apply anything
   new in `supabase/migrations/`.
4. **Docker frontend looks stale?** It's baked at build time — rerun
   `docker compose up -d --build frontend`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the single Supabase Cloud runtime model"
```

---

### Task 10: Tear down old Docker stacks

**Files:** none (Docker operations only).

**Interfaces:** none.

This must run after Task 6 has confirmed the new single-container frontend works against the cloud project — don't remove the old stacks until their replacement is proven.

- [ ] **Step 1: Inspect what's actually running before touching anything**

Run: `docker ps -a --filter name=poolscoringapp` and `docker ps -a --filter name=pool-scoring-app`
Expected: shows the actual current containers for both stacks (names/ports may differ slightly from history — verify against what's live, don't assume from old docs, per this project's established practice, CLAUDE.md).

- [ ] **Step 2: Tear down the self-hosted docker-compose stack**

Run: `docker compose --project-name poolscoringapp down -v --rmi all`
Expected: all `poolscoringapp` containers, volumes, and images removed. Verify with `docker ps -a --filter name=poolscoringapp` (empty) and `docker volume ls --filter name=poolscoringapp` (empty).

- [ ] **Step 3: Tear down the local Supabase CLI dev stack**

Run: `npx supabase stop --project-id pool-scoring-app` (if this errors because the CLI's local link state was already fully replaced by Task 2's cloud link, fall back to `docker ps -a --filter name=supabase` to find and `docker rm -f` any remaining `supabase_*_pool-scoring-app` containers directly, then `docker volume ls --filter name=supabase` to remove matching volumes with `docker volume rm`).
Expected: no containers or volumes with `pool-scoring-app` in their name remain.

- [ ] **Step 4: Confirm the end state**

Run: `docker ps -a`
Expected: the only application container is the `frontend` one from Task 6 (plus anything unrelated to this project that was already running on the machine — don't touch those).

No commit for this task (no files changed).

---

### Task 11: Whole-branch verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full backend test suite**

Run: `npm test`
Expected: `test:unit`, `test:integration` (with `--no-file-parallelism`), and `test:api` all pass, entirely against the Supabase Cloud project.

- [ ] **Step 2: Full frontend test suite**

Run: `cd web && npm test`
Expected: all pass, unaffected by this migration (no page/component logic changed).

- [ ] **Step 3: Manual smoke test of the deployed frontend container**

With `docker compose up -d --build` running (Task 6) and `npm run seed` having populated data (Task 7): open `http://localhost:8080` and verify the public leaderboard, a player profile, `/grades`, and `/matches` all show seeded data. Log in at `/admin/login` with the seed script's printed credentials and confirm the admin layout loads. Enter one match through the admin UI and confirm it appears in match history.

- [ ] **Step 4: Confirm the Docker end state**

Run: `docker ps -a`
Expected: matches Task 10 Step 4 — only the single `frontend` container for this project.

- [ ] **Step 5: Confirm GitHub is up to date**

Run: `git status` and `git log --oneline -5`
Expected: working tree clean, all of this plan's commits present. Confirm with the user before pushing (`git push`) — this is the point where the migration becomes visible on the shared `origin/master`.

No commit for this task (verification only — flag any failures found here to the user rather than silently patching around them, per this project's error-transparency convention).
