# Supabase Backend/API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 1 rating engine into a working local Supabase backend:
four admin-only Edge Functions (enter-match, correct-match, close-week,
start-season) orchestrating the exact tested `src/rating/*.ts` math, public
read access via PostgREST + RLS, and seed data — all running on the Supabase
CLI's local Docker stack.

**Architecture:** Supabase CLI (`supabase start`) manages Postgres, Auth,
PostgREST, and the Edge Functions (Deno) runtime locally. Edge Functions never
reimplement rating math — they import a mechanically-synced copy of
`src/rating/*.ts` (Deno requires `.ts`-suffixed relative imports; the
existing source uses `.js`-suffixed imports for Node/Vitest, so a small sync
script vendors the files with only that one substitution, guarded by a test
that fails if the two ever diverge in anything else). All rating-changing
writes happen inside Edge Functions using the Postgres service-role key
(bypassing RLS); the public PostgREST surface is read-only by policy.

**Tech Stack:** Supabase CLI, Deno (Edge Functions runtime), `@supabase/supabase-js`
(both in Edge Functions and in Node-side integration tests), PL/pgSQL (RLS
policies, views), Vitest + `pg` (integration tests, same pattern as Phase 1).

## Global Constraints

Exact values below are copied from
`docs/superpowers/specs/2026-07-14-backend-api-design.md` and apply to every task:

- Corrections are only allowed while `matches.is_period_closed = false` for
  that match. Once `close-week` runs, its matches are locked. (spec §2, §3)
- RLS: `players`, `seasons`, `player_season_ratings`, `matches`,
  `weekly_rankings`, `player_statistics` → public `SELECT`, no public write
  policy (default deny). `admin_users`, `match_audit_log`, `rating_events` →
  no public policy; `admin_users` allows a row's own owner to `SELECT` it
  (`auth.uid() = id`). (spec §4)
- All four Edge Functions require the caller to be authenticated AND have a
  matching row in `admin_users`; unauthenticated → 401, authenticated but not
  an admin → 403. (spec §5)
- `enter-match`, `correct-match`, `close-week`, `start-season` request/response
  shapes and step-by-step algorithms are exactly as specified in spec §5.1–§5.4.
- `leaderboard_view` and `grade_distribution_view` definitions are exactly as
  given in spec §6, including the `matches_played >= 3` eligibility filter
  (mirrors `MIN_MATCHES_FOR_RANKING` from Phase 1's `src/rating/constants.ts`).
- No odds Edge Function — the odds formula is a Phase 3 (frontend) concern,
  not built in this plan. (spec §2)

---

### Task 1: Initialize Supabase CLI project; retire Phase 1's standalone Postgres

**Context this task must resolve:** Supabase's local connection pooler
defaults to host port **54329** — the exact port Phase 1's `docker-compose.yml`
used for its own standalone `postgres:16-alpine` container. Running both
stacks at once would conflict. Since `supabase start` now provides Postgres
with the Phase 1 migrations auto-applied (superseding the standalone
container's purpose), this task retires the Phase 1 container rather than
relocating it to a different port.

**Files:**
- Modify: `package.json`
- Delete: `docker-compose.yml`
- Modify: `src/db/schema.test.ts:6-7`
- Create: `supabase/config.toml` (via `supabase init`)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a running local Supabase stack reachable at `http://127.0.0.1:54321`
  (API) and `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (DB) —
  every later task's manual verification and integration tests connect here.

- [ ] **Step 1: Add the Supabase CLI as a dev dependency**

Run: `npm install supabase --save-dev`
Expected: adds `supabase` to `package.json` devDependencies, installs without
error.

- [ ] **Step 2: Remove the Phase 1 standalone Postgres container**

```bash
git rm docker-compose.yml
```

- [ ] **Step 3: Update `package.json` scripts**

Replace the `db:up`/`db:down` scripts (which referenced the now-removed
`docker-compose.yml`) with Supabase CLI equivalents:

```json
{
  "name": "pool-league-rating-engine",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test:unit": "vitest run src/rating",
    "test:integration": "vitest run src/db",
    "test:api": "vitest run src/api",
    "test": "npm run test:unit && npm run test:integration && npm run test:api",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^20.14.15",
    "@types/pg": "^8.11.6",
    "supabase": "^1.200.3"
  },
  "dependencies": {
    "pg": "^8.12.0",
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

(`@supabase/supabase-js` is added now because Task 6's Node-side test helper
needs it; adding it here avoids a second `npm install` mid-plan.)

- [ ] **Step 4: Run `npm install` to pick up the new dependencies**

Run: `npm install`
Expected: installs `supabase` and `@supabase/supabase-js` without error.

- [ ] **Step 5: Initialize the Supabase project**

Run: `npx supabase init`
Expected: creates `supabase/config.toml`. The existing `supabase/migrations/`
directory (from Phase 1) is left untouched — `init` only adds config, it does
not manage or overwrite migrations.

- [ ] **Step 6: Retarget the Phase 1 schema integration test at Supabase's local Postgres**

`src/db/schema.test.ts` currently defaults to Phase 1's now-removed
standalone container (port 54329). Update the default connection string to
Supabase CLI's standard local DB port (54322), keeping the `TEST_DATABASE_URL`
override mechanism unchanged:

```typescript
// src/db/schema.test.ts — change lines 6-7 from:
const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/postgres';

// to:
const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
```

- [ ] **Step 7: Start the local Supabase stack**

Run: `npx supabase start`
Expected: pulls Docker images (first run only, may take several minutes),
then prints `Started supabase local development setup.` followed by a list of
URLs including `API URL: http://127.0.0.1:54321` and
`DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

- [ ] **Step 8: Confirm the Phase 1 migration auto-applied**

Run: `npx supabase status`
Expected: reports the stack as running. Then verify the Phase 1 tables exist
on the CLI-managed database:

Run: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "\dt"`
(or, if `psql` isn't available locally, this is equivalently verified by Step 9)
Expected: lists `players`, `seasons`, `matches`, `player_season_ratings`, etc.
— the 9 tables from Phase 1's migration.

- [ ] **Step 9: Run the retargeted Phase 1 integration test against the new stack**

Run: `npm run test:integration`
Expected: PASS (6 tests) — same 6 tests from Phase 1, now running against
Supabase's CLI-managed Postgres instead of the retired standalone container.

- [ ] **Step 10: Run the full existing suite to confirm nothing else broke**

Run: `npm run test:unit`
Expected: PASS (55 tests) — unaffected by this task, confirms no collateral damage.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json supabase/config.toml src/db/schema.test.ts
git rm docker-compose.yml
git commit -m "chore: initialize Supabase CLI local stack, retire Phase 1 standalone postgres (port conflict on 54329)"
```

---

### Task 2: Migration — add `is_period_closed` to matches

**Files:**
- Create: `supabase/migrations/20260714010000_add_period_closed.sql`
- Test: extend `src/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `matches.is_period_closed` column, defaulting to `false`. Task 8's
  `correct-match` and Task 9's `close-week` both depend on this column
  existing and behaving as described.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260714010000_add_period_closed.sql
alter table matches add column is_period_closed boolean not null default false;
```

- [ ] **Step 2: Write the failing test**

Add to `src/db/schema.test.ts`, inside the existing `describe('initial schema', ...)` block:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/schema.test.ts`
Expected: FAIL — `column "is_period_closed" of relation "matches" does not exist`

- [ ] **Step 4: Run test to verify it passes**

The migration file from Step 1 is what makes this pass — no further code
changes needed.

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260714010000_add_period_closed.sql src/db/schema.test.ts
git commit -m "feat: add is_period_closed column to matches for week-locking"
```

---

### Task 3: Migration — Row Level Security policies

**Files:**
- Create: `supabase/migrations/20260714020000_rls_policies.sql`
- Test: `src/db/rls.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: RLS enabled on all 9 tables with the policies from Global
  Constraints. Every later task's public-read verification relies on this.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260714020000_rls_policies.sql

-- Public read, admin-only write (writes happen only via service-role Edge Functions)
alter table players enable row level security;
create policy "public read players" on players for select using (true);

alter table seasons enable row level security;
create policy "public read seasons" on seasons for select using (true);

alter table player_season_ratings enable row level security;
create policy "public read player_season_ratings" on player_season_ratings for select using (true);

alter table matches enable row level security;
create policy "public read matches" on matches for select using (true);

alter table weekly_rankings enable row level security;
create policy "public read weekly_rankings" on weekly_rankings for select using (true);

alter table player_statistics enable row level security;
create policy "public read player_statistics" on player_statistics for select using (true);

-- Fully private: no public policy at all, service-role only, except
-- admin_users which lets an authenticated admin read their own row.
alter table admin_users enable row level security;
create policy "self read admin_users" on admin_users for select using (auth.uid() = id);

alter table match_audit_log enable row level security;

alter table rating_events enable row level security;
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/db/rls.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';

const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

let client: Client;

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_CONNECTION_STRING });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pool_league_rls_test');
  await admin.query('CREATE DATABASE pool_league_rls_test');
  await admin.end();

  const testConnectionString = ADMIN_CONNECTION_STRING.replace(/\/[^/]*$/, '/pool_league_rls_test');
  client = new Client({ connectionString: testConnectionString });
  await client.connect();
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
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
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('defines no select policy at all for match_audit_log or rating_events', async () => {
    const result = await client.query(
      `select tablename from pg_policies where schemaname = 'public' and tablename in ('match_audit_log', 'rating_events')`,
    );
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/rls.test.ts`
Expected: FAIL — zero rows returned for the first assertion (no tables have
`relrowsecurity = true` yet)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/rls.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260714020000_rls_policies.sql src/db/rls.test.ts
git commit -m "feat: add row level security policies (public read, service-role-only write)"
```

---

### Task 4: Migration — leaderboard and grade distribution views

**Files:**
- Create: `supabase/migrations/20260714030000_views.sql`
- Test: `src/db/views.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `leaderboard_view` and `grade_distribution_view`, read directly by
  Phase 3's dashboard via PostgREST — no Edge Function or later task depends
  on these for writes.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260714030000_views.sql

create view leaderboard_view as
  select p.id as player_id, p.full_name, psr.season_id, psr.rating, psr.grade,
         psr.season_points,
         rank() over (partition by psr.season_id order by psr.rating desc) as rank
  from player_season_ratings psr
  join players p on p.id = psr.player_id
  where psr.matches_played >= 3;

create view grade_distribution_view as
  select season_id, grade, count(*) as player_count
  from player_season_ratings
  where matches_played >= 3
  group by season_id, grade;
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/db/views.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';

const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

let client: Client;
let seasonId: string;

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_CONNECTION_STRING });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pool_league_views_test');
  await admin.query('CREATE DATABASE pool_league_views_test');
  await admin.end();

  const testConnectionString = ADMIN_CONNECTION_STRING.replace(/\/[^/]*$/, '/pool_league_views_test');
  client = new Client({ connectionString: testConnectionString });
  await client.connect();
  await applyMigrations(client);

  const season = await client.query(
    `insert into seasons (name, start_date) values ('View Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;

  // Player eligible for the leaderboard (matches_played >= 3)
  const eligible = await client.query(`insert into players (full_name) values ('Eligible Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1800, 5, 'A')`,
    [eligible.rows[0].id, seasonId],
  );

  // Player NOT eligible (matches_played < 3)
  const ineligible = await client.query(`insert into players (full_name) values ('New Player') returning id`);
  await client.query(
    `insert into player_season_ratings (player_id, season_id, rating, matches_played, grade)
     values ($1, $2, 1500, 1, 'B')`,
    [ineligible.rows[0].id, seasonId],
  );
}, 30000);

afterAll(async () => {
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/views.test.ts`
Expected: FAIL — `relation "leaderboard_view" does not exist`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/views.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260714030000_views.sql src/db/views.test.ts
git commit -m "feat: add leaderboard_view and grade_distribution_view"
```

---

### Task 5: Sync the rating engine into Deno-importable shared functions code

**Context this task must resolve:** Deno resolves relative import specifiers
literally — it will not silently map a `./constants.js` specifier to an
existing `constants.ts` file the way Vitest's bundler-based resolver does.
Phase 1's `src/rating/*.ts` files use `.js`-suffixed relative imports (the
Node/NodeNext convention). Rather than hand-copying those files into
`supabase/functions/_shared/rating/` (risking silent drift from the tested
originals), this task writes a small sync script that copies them verbatim
except for that one `.js`→`.ts` substitution in import specifiers, and a test
that fails if a synced file and its source ever differ in anything else.

**Files:**
- Create: `scripts/sync-shared-rating.mjs`
- Create (generated by the script, then committed): `supabase/functions/_shared/rating/*.ts`
  (one file per `src/rating/*.ts` file, excluding `*.test.ts` files)
- Test: `src/scripts/syncSharedRating.test.ts`

**Interfaces:**
- Consumes: `src/rating/*.ts` (all 9 non-test files from Phase 1: constants,
  grade, elo, odds, seasonCarryover, seasonPoints, statistics, glicko2, ranking)
- Produces: `supabase/functions/_shared/rating/*.ts`, Deno-importable
  equivalents. Tasks 7-10's Edge Functions import from here (e.g. `import {
  applyInstantNudge } from '../_shared/rating/elo.ts'`).

- [ ] **Step 1: Write the sync script**

```javascript
// scripts/sync-shared-rating.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(__dirname, '..', 'src', 'rating');
const TARGET_DIR = join(__dirname, '..', 'supabase', 'functions', '_shared', 'rating');

export function syncSharedRating() {
  mkdirSync(TARGET_DIR, { recursive: true });

  const sourceFiles = readdirSync(SOURCE_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );

  for (const file of sourceFiles) {
    const content = readFileSync(join(SOURCE_DIR, file), 'utf-8');
    // Deno requires an exact-match relative import extension; rewrite the
    // Node/NodeNext-style ".js" specifiers to ".ts". This is the ONLY
    // transformation applied — everything else is byte-identical.
    const denoContent = content.replace(/from '(\.\/[^']+)\.js'/g, "from '$1.ts'");
    writeFileSync(join(TARGET_DIR, file), denoContent, 'utf-8');
  }

  return sourceFiles;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const synced = syncSharedRating();
  console.log(`Synced ${synced.length} files to ${TARGET_DIR}`);
}
```

- [ ] **Step 2: Write the failing drift-guard test**

```typescript
// src/scripts/syncSharedRating.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncSharedRating } from '../../scripts/sync-shared-rating.mjs';

const SOURCE_DIR = join(__dirname, '..', 'rating');
const TARGET_DIR = join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'rating');

describe('syncSharedRating', () => {
  beforeAll(() => {
    syncSharedRating();
  });

  it('produces a synced file for every non-test source file', () => {
    const sourceFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const targetFiles = readdirSync(TARGET_DIR).filter((f) => f.endsWith('.ts'));
    expect(targetFiles.sort()).toEqual(sourceFiles.sort());
  });

  it('every synced file is identical to its source except .js->.ts import extensions', () => {
    const sourceFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const file of sourceFiles) {
      const sourceContent = readFileSync(join(SOURCE_DIR, file), 'utf-8');
      const targetContent = readFileSync(join(TARGET_DIR, file), 'utf-8');
      const expectedTargetContent = sourceContent.replace(/from '(\.\/[^']+)\.js'/g, "from '$1.ts'");
      expect(targetContent).toBe(expectedTargetContent);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/scripts/syncSharedRating.test.ts`
Expected: FAIL — `ENOENT` reading `TARGET_DIR` (directory doesn't exist yet)

- [ ] **Step 4: Run the sync script and re-run the test**

Run: `node scripts/sync-shared-rating.mjs`
Expected: prints `Synced 9 files to .../supabase/functions/_shared/rating`

Run: `npx vitest run src/scripts/syncSharedRating.test.ts`
Expected: PASS (2 tests) — the test itself also calls `syncSharedRating()` in
`beforeAll`, so this passes even without the manual run above, but running it
manually first lets you eyeball the output directory.

- [ ] **Step 5: Spot-check one synced file by eye**

Run: `cat supabase/functions/_shared/rating/elo.ts` (or open it in an editor)
Confirm: identical to `src/rating/elo.ts` except its `import { ... } from
'./constants.js'` line now reads `from './constants.ts'`.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-shared-rating.mjs supabase/functions/_shared/rating/ src/scripts/syncSharedRating.test.ts
git commit -m "feat: sync rating engine into Deno-importable shared Edge Function code"
```

---

### Task 6: Shared Edge Function helpers (Supabase clients, admin auth check)

**Files:**
- Create: `supabase/functions/_shared/supabaseClients.ts`
- Create: `supabase/functions/_shared/requireAdmin.ts`
- Create: `supabase/functions/_shared/response.ts`
- Create: `src/api/testSupport.ts`

**Interfaces:**
- Consumes: nothing beyond the Deno runtime's injected env vars
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- Produces:
  - `createAuthedClient(req: Request): SupabaseClient` — RLS-scoped to the
    caller, from `supabaseClients.ts`
  - `createServiceRoleClient(): SupabaseClient` — bypasses RLS, from
    `supabaseClients.ts`
  - `requireAdmin(authedClient, serviceRoleClient): Promise<AdminUser | null>`,
    from `requireAdmin.ts` — Tasks 7-10 all call this first in their handler
  - `jsonResponse(body: unknown, status?: number): Response`, from
    `response.ts`
  - `getSupabaseStatus(): SupabaseStatus` and `provisionTestAdmin(status):
    Promise<{ userId: string; accessToken: string }>`, from
    `src/api/testSupport.ts` — every later task's integration test imports
    these to get a real admin JWT for authenticated requests.

This task has no rating logic to TDD against, so it's verified by writing a
throwaway Edge Function that exercises all three shared helpers and confirming
it behaves correctly when called with no auth, non-admin auth, and admin auth
— then deleting the throwaway function. The three helpers' real, permanent
verification happens through Task 7's `enter-match` tests, which are the
first real consumer.

- [ ] **Step 1: Write the Supabase client factories**

```typescript
// supabase/functions/_shared/supabaseClients.ts
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function createAuthedClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
}

export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}
```

- [ ] **Step 2: Write the admin auth check**

```typescript
// supabase/functions/_shared/requireAdmin.ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface AdminUser {
  id: string;
  display_name: string;
  role: string;
}

export async function requireAdmin(
  authedClient: SupabaseClient,
  serviceRoleClient: SupabaseClient,
): Promise<AdminUser | null> {
  const { data: userData } = await authedClient.auth.getUser();
  if (!userData?.user) return null;

  const { data: adminRow } = await serviceRoleClient
    .from('admin_users')
    .select('id, display_name, role')
    .eq('id', userData.user.id)
    .maybeSingle();

  return (adminRow as AdminUser) ?? null;
}
```

- [ ] **Step 3: Write the JSON response helper**

```typescript
// supabase/functions/_shared/response.ts
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Write a throwaway verification function**

```typescript
// supabase/functions/_whoami-check/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const serviceRoleClient = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, serviceRoleClient);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);
  return jsonResponse({ admin });
});
```

- [ ] **Step 5: Write the Node-side test support helpers**

```typescript
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
```

- [ ] **Step 6: Serve functions locally and verify the throwaway function by hand**

Run: `npx supabase functions serve --no-verify-jwt=false` (in a background
terminal/process — leave it running for the rest of this task)

Run (no auth header — expect 401):
```bash
curl -i http://127.0.0.1:54321/functions/v1/_whoami-check
```
Expected: `401` status, body `{"error":"Unauthorized"}` — note: with JWT
verification enabled at the gateway (the default), a request with no
`Authorization` header at all is rejected by the gateway itself before
reaching our code; this confirms JWT verification is on. To exercise the
in-function `requireAdmin` 401 path specifically, retry with the anon key as
a bearer token (an authenticated-but-anonymous-role request still has no
`admin_users` row, so `requireAdmin` should still return `null`):
```bash
STATUS_ANON_KEY=$(npx supabase status -o env | grep ANON_KEY | cut -d'"' -f2)
curl -i http://127.0.0.1:54321/functions/v1/_whoami-check \
  -H "Authorization: Bearer $STATUS_ANON_KEY"
```
Expected: `401`, `{"error":"Unauthorized"}` (the anon key authenticates as no
user, so `auth.getUser()` returns null).

- [ ] **Step 7: Verify the admin-authenticated path with a quick manual script**

```typescript
// scripts/verify-whoami.mjs (temporary, deleted in Step 9)
import { getSupabaseStatus, provisionTestAdmin } from '../src/api/testSupport.ts';
```
(This step is easier done directly in Node via `tsx` or by writing a small
throwaway Vitest test — write it as a temporary test file instead:)

```typescript
// src/api/_whoamiCheck.temp.test.ts (deleted in Step 9)
import { describe, it, expect } from 'vitest';
import { getSupabaseStatus, provisionTestAdmin } from './testSupport';

describe('throwaway whoami check', () => {
  it('returns the admin row for a provisioned admin JWT', async () => {
    const status = getSupabaseStatus();
    const { accessToken } = await provisionTestAdmin(status);

    const response = await fetch(`${status.API_URL}/functions/v1/_whoami-check`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.admin.display_name).toBe('Test Admin');
  });
});
```

Run: `npx vitest run src/api/_whoamiCheck.temp.test.ts`
Expected: PASS (1 test) — confirms `createAuthedClient`, `createServiceRoleClient`,
`requireAdmin`, `jsonResponse`, `getSupabaseStatus`, and `provisionTestAdmin`
all work together correctly end-to-end.

- [ ] **Step 8: Stop the local functions server**

Stop the `supabase functions serve` process started in Step 6 (Ctrl+C, or
kill the background process).

- [ ] **Step 9: Delete the throwaway verification code**

```bash
rm -rf supabase/functions/_whoami-check src/api/_whoamiCheck.temp.test.ts
```

- [ ] **Step 10: Commit the permanent shared helpers**

```bash
git add supabase/functions/_shared/supabaseClients.ts supabase/functions/_shared/requireAdmin.ts supabase/functions/_shared/response.ts src/api/testSupport.ts package.json package-lock.json
git commit -m "feat: add shared Edge Function auth/response helpers, verified end-to-end via a throwaway function"
```

---

### Task 7: Edge Function `enter-match`

**Files:**
- Create: `supabase/functions/enter-match/index.ts`
- Test: `src/api/enterMatch.test.ts`

**Interfaces:**
- Consumes: `createAuthedClient`, `createServiceRoleClient` (Task 6),
  `requireAdmin` (Task 6), `jsonResponse` (Task 6), `applyInstantNudge`,
  `expectedScore` (from `_shared/rating/elo.ts`, Task 5), `gradeForRating`
  (`_shared/rating/grade.ts`), `winPercentage`, `currentStreak`,
  `longestStreak`, `averageOpponentRating`, `formPercentage`, `formScore`
  (`_shared/rating/statistics.ts`), `calculateSeasonPoints`
  (`_shared/rating/seasonPoints.ts`), `MIN_MATCHES_FOR_RANKING`
  (`_shared/rating/constants.ts`), `getSupabaseStatus`, `provisionTestAdmin`
  (`src/api/testSupport.ts`, Task 6)
- Produces: `POST /functions/v1/enter-match` — the primary write path every
  later Edge Function's tests seed match history through.

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/enter-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import {
  winPercentage,
  currentStreak,
  longestStreak,
  averageOpponentRating,
  formScore,
} from '../_shared/rating/statistics.ts';
import { calculateSeasonPoints } from '../_shared/rating/seasonPoints.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';

interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
}

async function ensureRatingRow(db: ReturnType<typeof createServiceRoleClient>, playerId: string, seasonId: string) {
  const { data: existing } = await db
    .from('player_season_ratings')
    .select('rating, rd, volatility, matches_played, season_points')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await db
    .from('player_season_ratings')
    .insert({ player_id: playerId, season_id: seasonId })
    .select('rating, rd, volatility, matches_played, season_points')
    .single();
  if (error) throw new Error(`Failed to create rating row: ${error.message}`);
  return created;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as EnterMatchBody;
  const { season_id, match_date, player_a_id, player_b_id, frames_a, frames_b } = body;

  const ratingA = await ensureRatingRow(db, player_a_id, season_id);
  const ratingB = await ensureRatingRow(db, player_b_id, season_id);

  const winnerId = frames_a > frames_b ? player_a_id : player_b_id;

  const { data: match, error: matchError } = await db
    .from('matches')
    .insert({
      season_id,
      match_date,
      player_a_id,
      player_b_id,
      frames_a,
      frames_b,
      winner_id: winnerId,
      entered_by: admin.id,
    })
    .select('id')
    .single();
  if (matchError) return jsonResponse({ error: matchError.message }, 400);

  const nudge = applyInstantNudge({
    ratingA: ratingA.rating,
    rdA: ratingA.rd,
    ratingB: ratingB.rating,
    rdB: ratingB.rd,
    framesA: frames_a,
    framesB: frames_b,
  });

  await db.from('rating_events').insert([
    {
      match_id: match.id,
      player_id: player_a_id,
      season_id,
      rating_before: ratingA.rating,
      rd_before: ratingA.rd,
      rating_after: nudge.newRatingA,
      rd_after: ratingA.rd,
      expected_score: nudge.expectedScoreA,
      actual_score: nudge.actualScoreA,
      delta: nudge.deltaA,
      event_type: 'instant',
    },
    {
      match_id: match.id,
      player_id: player_b_id,
      season_id,
      rating_before: ratingB.rating,
      rd_before: ratingB.rd,
      rating_after: nudge.newRatingB,
      rd_after: ratingB.rd,
      expected_score: 1 - nudge.expectedScoreA,
      actual_score: 1 - nudge.actualScoreA,
      delta: -nudge.deltaA,
      event_type: 'instant',
    },
  ]);

  await updatePlayerAfterMatch(db, {
    playerId: player_a_id,
    seasonId: season_id,
    newRating: nudge.newRatingA,
    priorMatchesPlayed: ratingA.matches_played,
    priorSeasonPoints: ratingA.season_points,
    won: winnerId === player_a_id,
    framesFor: frames_a,
    framesAgainst: frames_b,
    opponentRating: ratingB.rating,
  });
  await updatePlayerAfterMatch(db, {
    playerId: player_b_id,
    seasonId: season_id,
    newRating: nudge.newRatingB,
    priorMatchesPlayed: ratingB.matches_played,
    priorSeasonPoints: ratingB.season_points,
    won: winnerId === player_b_id,
    framesFor: frames_b,
    framesAgainst: frames_a,
    opponentRating: ratingA.rating,
  });

  await db.from('match_audit_log').insert({
    match_id: match.id,
    changed_by: admin.id,
    change_type: 'created',
    new_values: body,
  });

  return jsonResponse({ match_id: match.id }, 201);
});

interface UpdatePlayerArgs {
  playerId: string;
  seasonId: string;
  newRating: number;
  priorMatchesPlayed: number;
  priorSeasonPoints: number;
  won: boolean;
  framesFor: number;
  framesAgainst: number;
  opponentRating: number;
}

async function updatePlayerAfterMatch(
  db: ReturnType<typeof createServiceRoleClient>,
  args: UpdatePlayerArgs,
) {
  const matchesPlayed = args.priorMatchesPlayed + 1;
  const seasonPointsEarned = calculateSeasonPoints({
    won: args.won,
    framesFor: args.framesFor,
    framesAgainst: args.framesAgainst,
    ownRating: args.newRating,
    opponentRating: args.opponentRating,
  });

  await db
    .from('player_season_ratings')
    .update({
      rating: args.newRating,
      matches_played: matchesPlayed,
      is_provisional: matchesPlayed < MIN_MATCHES_FOR_RANKING,
      grade: gradeForRating(args.newRating),
      season_points: args.priorSeasonPoints + seasonPointsEarned,
    })
    .eq('player_id', args.playerId)
    .eq('season_id', args.seasonId);

  const { data: pastMatches } = await db
    .from('matches')
    .select('id, winner_id, player_a_id, player_b_id, frames_a, frames_b, match_date')
    .or(`player_a_id.eq.${args.playerId},player_b_id.eq.${args.playerId}`)
    .eq('season_id', args.seasonId)
    .eq('is_voided', false)
    .order('match_date', { ascending: true });

  const matches = pastMatches ?? [];
  const outcomes = matches.map((m) => m.winner_id === args.playerId);
  const wins = outcomes.filter(Boolean).length;
  const losses = outcomes.length - wins;
  const framesWon = matches.reduce(
    (sum, m) => sum + (m.player_a_id === args.playerId ? m.frames_a : m.frames_b),
    0,
  );
  const framesLost = matches.reduce(
    (sum, m) => sum + (m.player_a_id === args.playerId ? m.frames_b : m.frames_a),
    0,
  );

  // Opponent's rating AT THE TIME of each historical match: every match writes
  // one 'instant' rating_events row per player, so the opponent's row for the
  // same match_id carries their rating_before at that point in time.
  const matchIds = matches.map((m) => m.id);
  const { data: opponentEvents } = await db
    .from('rating_events')
    .select('match_id, player_id, rating_before')
    .in('match_id', matchIds)
    .eq('event_type', 'instant')
    .neq('player_id', args.playerId);
  const opponentRatingsAtMatchTime = (opponentEvents ?? []).map((e) => e.rating_before);

  const last5 = outcomes.slice(-5);
  const last10 = outcomes.slice(-10);

  await db.from('player_statistics').upsert(
    {
      player_id: args.playerId,
      season_id: args.seasonId,
      wins,
      losses,
      current_streak: currentStreak(outcomes),
      longest_streak: longestStreak(outcomes),
      frames_won: framesWon,
      frames_lost: framesLost,
      avg_opponent_rating: averageOpponentRating(opponentRatingsAtMatchTime),
      form_5: winPercentage(last5.filter(Boolean).length, last5.length - last5.filter(Boolean).length),
      form_10: winPercentage(last10.filter(Boolean).length, last10.length - last10.filter(Boolean).length),
      form_score: formScore(last5, last10),
    },
    { onConflict: 'player_id,season_id' },
  );
}
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// src/api/enterMatch.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;
let seasonId: string;

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('API Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  return result.rows[0].id;
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Serve functions: `npx supabase functions serve` (background, keep running for
this task)

Run: `npx vitest run src/api/enterMatch.test.ts`
Expected: FAIL — `404` (function doesn't exist yet) on both tests

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/enterMatch.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/enter-match/index.ts src/api/enterMatch.test.ts
git commit -m "feat: add enter-match Edge Function"
```

---

### Task 8: Edge Function `correct-match`

**Files:**
- Create: `supabase/functions/correct-match/index.ts`
- Test: `src/api/correctMatch.test.ts`

**Interfaces:**
- Consumes: everything Task 7 consumes, plus reads `matches.is_period_closed`
- Produces: `PATCH /functions/v1/correct-match`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/correct-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';

interface CorrectMatchBody {
  match_id: string;
  match_date?: string;
  frames_a?: number;
  frames_b?: number;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as CorrectMatchBody;

  const { data: original } = await db
    .from('matches')
    .select('*')
    .eq('id', body.match_id)
    .single();
  if (!original) return jsonResponse({ error: 'Match not found' }, 404);
  if (original.is_period_closed) {
    return jsonResponse({ error: 'Cannot correct a match whose week has already closed' }, 400);
  }

  await db.from('matches').update({ is_voided: true }).eq('id', body.match_id);
  await db.from('match_audit_log').insert({
    match_id: body.match_id,
    changed_by: admin.id,
    change_type: 'voided',
    old_values: original,
  });

  const framesA = body.frames_a ?? original.frames_a;
  const framesB = body.frames_b ?? original.frames_b;
  const matchDate = body.match_date ?? original.match_date;
  const winnerId = framesA > framesB ? original.player_a_id : original.player_b_id;

  const { data: corrected, error: insertError } = await db
    .from('matches')
    .insert({
      season_id: original.season_id,
      match_date: matchDate,
      player_a_id: original.player_a_id,
      player_b_id: original.player_b_id,
      frames_a: framesA,
      frames_b: framesB,
      winner_id: winnerId,
      entered_by: admin.id,
    })
    .select('id')
    .single();
  if (insertError) return jsonResponse({ error: insertError.message }, 400);

  await db.from('match_audit_log').insert({
    match_id: corrected.id,
    changed_by: admin.id,
    change_type: 'created',
    new_values: { ...body, frames_a: framesA, frames_b: framesB, match_date: matchDate },
  });

  await replayOpenWeek(db, original.season_id, original.player_a_id);
  await replayOpenWeek(db, original.season_id, original.player_b_id);

  return jsonResponse({ corrected_match_id: corrected.id }, 200);
});

async function replayOpenWeek(
  db: ReturnType<typeof createServiceRoleClient>,
  seasonId: string,
  playerId: string,
) {
  const { data: lastClosedEvent } = await db
    .from('rating_events')
    .select('rating_after, rd_after')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .in('event_type', ['weekly_reconciliation', 'season_carryover'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // If no weekly_reconciliation/season_carryover event exists yet, this
  // player's season began fresh (player_season_ratings always starts at the
  // baseline defaults) and has had no close-week run for them yet, so the
  // pre-week baseline is simply that starting point — never the row's
  // *current* rating/rd, since those already include this week's
  // now-being-replaced instant nudges.
  const rating = lastClosedEvent ? lastClosedEvent.rating_after : 1500;
  const rd = lastClosedEvent ? lastClosedEvent.rd_after : 350;

  const { data: openMatches } = await db
    .from('matches')
    .select('id, player_a_id, player_b_id, frames_a, frames_b, match_date, created_at')
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
    .eq('season_id', seasonId)
    .eq('is_period_closed', false)
    .eq('is_voided', false)
    .order('match_date', { ascending: true })
    .order('created_at', { ascending: true });

  await db
    .from('rating_events')
    .delete()
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .eq('event_type', 'instant')
    .in('match_id', (openMatches ?? []).map((m) => m.id));

  let currentRating = rating;
  const currentRd = rd;
  let matchesPlayed = 0;

  for (const match of openMatches ?? []) {
    const isPlayerA = match.player_a_id === playerId;
    const opponentId = isPlayerA ? match.player_b_id : match.player_a_id;
    const { data: opponentRow } = await db
      .from('player_season_ratings')
      .select('rating, rd')
      .eq('player_id', opponentId)
      .eq('season_id', seasonId)
      .single();

    const nudge = applyInstantNudge({
      ratingA: currentRating,
      rdA: currentRd,
      ratingB: opponentRow?.rating ?? 1500,
      rdB: opponentRow?.rd ?? 350,
      framesA: isPlayerA ? match.frames_a : match.frames_b,
      framesB: isPlayerA ? match.frames_b : match.frames_a,
    });

    await db.from('rating_events').insert({
      match_id: match.id,
      player_id: playerId,
      season_id: seasonId,
      rating_before: currentRating,
      rd_before: currentRd,
      rating_after: nudge.newRatingA,
      rd_after: currentRd,
      expected_score: nudge.expectedScoreA,
      actual_score: nudge.actualScoreA,
      delta: nudge.deltaA,
      event_type: 'instant',
    });

    currentRating = nudge.newRatingA;
    matchesPlayed += 1;
  }

  await db
    .from('player_season_ratings')
    .update({
      rating: currentRating,
      matches_played: matchesPlayed,
      is_provisional: matchesPlayed < MIN_MATCHES_FOR_RANKING,
      grade: gradeForRating(currentRating),
    })
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
}
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// src/api/correctMatch.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;
let seasonId: string;

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

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Correct Match Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

describe('PATCH /functions/v1/correct-match', () => {
  it('rejects correcting a match whose week is already closed', async () => {
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Closed Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Closed Player B') returning id`)).rows[0].id;
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
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Correct Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Correct Player B') returning id`)).rows[0].id;
    const matchId = await enterMatch(playerA, playerB, 5, 0); // whitewash, entered by mistake

    const response = await fetch(`${status.API_URL}/functions/v1/correct-match`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, frames_a: 5, frames_b: 4 }), // actually a narrow win
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
    // A narrower win moves the rating up less than a whitewash would have.
    expect(Number(finalRating.rows[0].rating)).toBeGreaterThan(1500);
    expect(Number(finalRating.rows[0].rating)).toBeLessThan(1525);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Ensure `npx supabase functions serve` is running (from Task 7, or restart it).

Run: `npx vitest run src/api/correctMatch.test.ts`
Expected: FAIL — `404` on both tests

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/correctMatch.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/correct-match/index.ts src/api/correctMatch.test.ts
git commit -m "feat: add correct-match Edge Function (open-week-only, replays that week's instant nudges)"
```

---

### Task 9: Edge Function `close-week`

**Files:**
- Create: `supabase/functions/close-week/index.ts`
- Test: `src/api/closeWeek.test.ts`

**Interfaces:**
- Consumes: `reconcilePeriod` (`_shared/rating/glicko2.ts`),
  `computeLeaderboard` (`_shared/rating/ranking.ts`), `winPercentage`,
  `formScore` (`_shared/rating/statistics.ts`), `gradeForRating`
- Produces: `POST /functions/v1/close-week`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/close-week/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { reconcilePeriod } from '../_shared/rating/glicko2.ts';
import { computeLeaderboard } from '../_shared/rating/ranking.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';

interface CloseWeekBody {
  season_id: string;
  week_ending: string;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { season_id, week_ending } = (await req.json()) as CloseWeekBody;

  const { data: openMatches } = await db
    .from('matches')
    .select('id, player_a_id, player_b_id, winner_id')
    .eq('season_id', season_id)
    .eq('is_period_closed', false)
    .eq('is_voided', false)
    .lte('match_date', week_ending);

  const matches = openMatches ?? [];
  const playerIds = Array.from(
    new Set(matches.flatMap((m) => [m.player_a_id, m.player_b_id])),
  );

  for (const playerId of playerIds) {
    const { data: ratingRow } = await db
      .from('player_season_ratings')
      .select('rating, rd, volatility')
      .eq('player_id', playerId)
      .eq('season_id', season_id)
      .single();
    if (!ratingRow) continue;

    const opponents = [];
    for (const match of matches) {
      if (match.player_a_id !== playerId && match.player_b_id !== playerId) continue;
      const opponentId = match.player_a_id === playerId ? match.player_b_id : match.player_a_id;
      const { data: opponentRating } = await db
        .from('player_season_ratings')
        .select('rating, rd')
        .eq('player_id', opponentId)
        .eq('season_id', season_id)
        .single();
      if (!opponentRating) continue;
      opponents.push({
        rating: opponentRating.rating,
        rd: opponentRating.rd,
        score: (match.winner_id === playerId ? 1 : 0) as 0 | 1,
      });
    }

    const reconciled = reconcilePeriod(
      { rating: ratingRow.rating, rd: ratingRow.rd, volatility: ratingRow.volatility },
      opponents,
    );

    await db.from('rating_events').insert({
      player_id: playerId,
      season_id,
      rating_before: ratingRow.rating,
      rd_before: ratingRow.rd,
      volatility_before: ratingRow.volatility,
      rating_after: reconciled.rating,
      rd_after: reconciled.rd,
      volatility_after: reconciled.volatility,
      delta: reconciled.rating - ratingRow.rating,
      event_type: 'weekly_reconciliation',
      period_end_date: week_ending,
    });

    await db
      .from('player_season_ratings')
      .update({
        rating: reconciled.rating,
        rd: reconciled.rd,
        volatility: reconciled.volatility,
        grade: gradeForRating(reconciled.rating),
      })
      .eq('player_id', playerId)
      .eq('season_id', season_id);
  }

  const { data: allRatings } = await db
    .from('player_season_ratings')
    .select('player_id, rating, rd, matches_played, grade, season_points')
    .eq('season_id', season_id);

  const leaderboard = computeLeaderboard(
    (allRatings ?? []).map((r) => ({
      playerId: r.player_id,
      rating: r.rating,
      matchesPlayed: r.matches_played,
    })),
  );

  for (const entry of leaderboard) {
    const row = (allRatings ?? []).find((r) => r.player_id === entry.playerId);
    if (!row) continue;
    const { data: stats } = await db
      .from('player_statistics')
      .select('wins, losses, form_score')
      .eq('player_id', entry.playerId)
      .eq('season_id', season_id)
      .maybeSingle();

    await db.from('weekly_rankings').insert({
      season_id,
      week_ending,
      player_id: entry.playerId,
      rating: entry.rating,
      rd: row.rd,
      rank: entry.rank,
      grade: row.grade,
      win_pct: stats ? (stats.wins / Math.max(1, stats.wins + stats.losses)) * 100 : 0,
      form_score: stats?.form_score ?? 0,
      season_points: row.season_points,
    });
  }

  await db
    .from('matches')
    .update({ is_period_closed: true })
    .in('id', matches.map((m) => m.id));

  return jsonResponse({ closed_matches: matches.length, players_reconciled: playerIds.length }, 200);
});
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// src/api/closeWeek.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;
let seasonId: string;

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
  return (await response.json()).match_id as string;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();

  const season = await dbClient.query(
    `insert into seasons (name, start_date) values ('Close Week Test Season', '2026-01-01') returning id`,
  );
  seasonId = season.rows[0].id;
}, 30000);

describe('POST /functions/v1/close-week', () => {
  it('reconciles ratings via Glicko-2, writes weekly_rankings, and locks the matches', async () => {
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Close Week Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Close Week Player B') returning id`)).rows[0].id;
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
    // rd must be the real reconciled value (Glicko-2 shrinks it from the 350
    // starting default after one game), not a placeholder.
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
    const playerA = (await dbClient.query(`insert into players (full_name) values ('Locked Player A') returning id`)).rows[0].id;
    const playerB = (await dbClient.query(`insert into players (full_name) values ('Locked Player B') returning id`)).rows[0].id;
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Ensure `npx supabase functions serve` is running.

Run: `npx vitest run src/api/closeWeek.test.ts`
Expected: FAIL — `404` on both tests

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/closeWeek.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/close-week/index.ts src/api/closeWeek.test.ts
git commit -m "feat: add close-week Edge Function (Glicko-2 batch reconciliation)"
```

---

### Task 10: Edge Function `start-season`

**Files:**
- Create: `supabase/functions/start-season/index.ts`
- Test: `src/api/startSeason.test.ts`

**Interfaces:**
- Consumes: `applySeasonCarryover` (`_shared/rating/seasonCarryover.ts`)
- Produces: `POST /functions/v1/start-season`

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/start-season/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { applySeasonCarryover } from '../_shared/rating/seasonCarryover.ts';

interface StartSeasonBody {
  previous_season_id?: string;
  new_season_name: string;
  start_date: string;
}

Deno.serve(async (req: Request) => {
  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as StartSeasonBody;

  const { data: newSeason, error: seasonError } = await db
    .from('seasons')
    .insert({ name: body.new_season_name, start_date: body.start_date, status: 'active' })
    .select('id')
    .single();
  if (seasonError) return jsonResponse({ error: seasonError.message }, 400);

  if (body.previous_season_id) {
    const { data: previousRatings } = await db
      .from('player_season_ratings')
      .select('player_id, rating, rd, volatility')
      .eq('season_id', body.previous_season_id);

    for (const prior of previousRatings ?? []) {
      const carried = applySeasonCarryover({
        rating: prior.rating,
        rd: prior.rd,
        volatility: prior.volatility,
      });

      await db.from('player_season_ratings').insert({
        player_id: prior.player_id,
        season_id: newSeason.id,
        rating: carried.rating,
        rd: carried.rd,
        volatility: carried.volatility,
      });

      await db.from('rating_events').insert({
        player_id: prior.player_id,
        season_id: newSeason.id,
        rating_before: prior.rating,
        rd_before: prior.rd,
        volatility_before: prior.volatility,
        rating_after: carried.rating,
        rd_after: carried.rd,
        volatility_after: carried.volatility,
        delta: carried.rating - prior.rating,
        event_type: 'season_carryover',
      });
    }
  }

  return jsonResponse({ season_id: newSeason.id }, 201);
});
```

- [ ] **Step 2: Write the failing integration test**

```typescript
// src/api/startSeason.test.ts
import { beforeAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { getSupabaseStatus, provisionTestAdmin, type SupabaseStatus } from './testSupport';

let status: SupabaseStatus;
let accessToken: string;
let dbClient: Client;

beforeAll(async () => {
  status = getSupabaseStatus();
  const admin = await provisionTestAdmin(status);
  accessToken = admin.accessToken;

  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

describe('POST /functions/v1/start-season', () => {
  it('creates a new season and carries over ratings with the soft-reset formula', async () => {
    const oldSeason = await dbClient.query(
      `insert into seasons (name, start_date) values ('Old Season', '2025-01-01') returning id`,
    );
    const oldSeasonId = oldSeason.rows[0].id;

    const player = await dbClient.query(`insert into players (full_name) values ('Carryover Player') returning id`);
    const playerId = player.rows[0].id;
    await dbClient.query(
      `insert into player_season_ratings (player_id, season_id, rating, rd, volatility)
       values ($1, $2, 1900, 100, 0.06)`,
      [playerId, oldSeasonId],
    );

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

    const newRating = await dbClient.query(
      `select rating, rd from player_season_ratings where player_id = $1 and season_id = $2`,
      [playerId, newSeasonId],
    );
    // 1500 + 0.75 * (1900 - 1500) = 1800
    expect(Number(newRating.rows[0].rating)).toBeCloseTo(1800, 5);
    // min(350, 100 + 50) = 150
    expect(Number(newRating.rows[0].rd)).toBeCloseTo(150, 5);

    const carryoverEvent = await dbClient.query(
      `select event_type from rating_events where player_id = $1 and season_id = $2`,
      [playerId, newSeasonId],
    );
    expect(carryoverEvent.rows[0].event_type).toBe('season_carryover');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Ensure `npx supabase functions serve` is running.

Run: `npx vitest run src/api/startSeason.test.ts`
Expected: FAIL — `404`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/startSeason.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/start-season/index.ts src/api/startSeason.test.ts
git commit -m "feat: add start-season Edge Function (soft-reset carryover)"
```

---

### Task 11: Seed data script

**Files:**
- Create: `scripts/seed.mjs`
- Test: none (this is a one-shot operational script, verified by manual
  inspection of the resulting data, matching how seed scripts are normally
  validated — there's no meaningful unit to TDD here beyond what Tasks 7-10
  already tested)

**Interfaces:**
- Consumes: `enter-match` and `close-week` Edge Functions (Tasks 7, 9),
  `testSupport.ts`'s `getSupabaseStatus`/`provisionTestAdmin` pattern (reused
  here to get an admin session, not as a test)

- [ ] **Step 1: Write the seed script**

```javascript
// scripts/seed.mjs
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

function getSupabaseStatus() {
  const output = execSync('npx supabase status -o env', { encoding: 'utf-8' });
  const env = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^(\w+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie',
  'Drew', 'Avery', 'Quinn', 'Reese', 'Skyler', 'Rowan', 'Finley', 'Hayden',
  'Emerson', 'Parker', 'Blake', 'Dakota', 'Charlie', 'Sage', 'Kendall', 'Marley',
  'Peyton', 'Shawn', 'Terry', 'Wesley', 'Yael', 'Zion',
];

async function main() {
  const status = getSupabaseStatus();
  const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

  const email = `seed-admin-${Date.now()}@example.com`;
  const password = 'seed-password-123!';
  const { data: userData } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  await serviceClient.from('admin_users').insert({
    id: userData.user.id,
    display_name: 'Seed Admin',
    role: 'admin',
  });

  const anonClient = createClient(status.API_URL, status.ANON_KEY);
  const { data: sessionData } = await anonClient.auth.signInWithPassword({ email, password });
  const accessToken = sessionData.session.access_token;

  const { data: season } = await serviceClient
    .from('seasons')
    .insert({ name: 'Seed Season', start_date: '2026-01-01', status: 'active' })
    .select('id')
    .single();

  const { data: players } = await serviceClient
    .from('players')
    .insert(FIRST_NAMES.map((name) => ({ full_name: `${name} Testplayer` })))
    .select('id');

  async function enterMatch(playerA, playerB, framesA, framesB, matchDate) {
    await fetch(`${status.API_URL}/functions/v1/enter-match`, {
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
  }

  const weeks = ['2026-01-08', '2026-01-15', '2026-01-22'];
  for (const weekEnding of weeks) {
    // Round-robin a handful of pairings each week
    for (let i = 0; i < players.length - 1; i += 2) {
      const framesA = Math.floor(Math.random() * 3) + 3; // 3-5
      const framesB = Math.floor(Math.random() * framesA); // 0..framesA-1, so A always wins
      const [a, b] = Math.random() > 0.5 ? [players[i].id, players[i + 1].id] : [players[i + 1].id, players[i].id];
      await enterMatch(a, b, framesA, framesB, weekEnding);
    }

    await fetch(`${status.API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: season.id, week_ending: weekEnding }),
    });
  }

  console.log(`Seeded season ${season.id} with ${players.length} players across ${weeks.length} closed weeks.`);
}

main().catch((error) => {
  console.error('Seed script failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

Ensure `npx supabase start` and `npx supabase functions serve` are both
running.

Run: `node scripts/seed.mjs`
Expected: prints `Seeded season <uuid> with 30 players across 3 closed weeks.`

- [ ] **Step 3: Manually verify the seeded data looks right**

Run:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c \
  "select full_name, rating, grade, season_points from leaderboard_view order by rank limit 10;"
```
Expected: 10 rows with varied ratings (not all 1500), valid grades, and
positive season points — confirms the whole pipeline (enter-match → instant
nudge → close-week → Glicko-2 reconciliation → leaderboard_view) produced
coherent results.

- [ ] **Step 4: Add a package.json script for convenience**

```json
"seed": "node scripts/seed.mjs"
```
(add this line to the `scripts` block in `package.json`, alongside the
existing entries from Task 1)

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.mjs package.json
git commit -m "feat: add seed data script exercising the full match-entry and week-close pipeline"
```

---

## Final verification

- [ ] Ensure `npx supabase start` is running.
- [ ] Run `npm run test:unit` — expected: 55/55 pass (Phase 1, unaffected).
- [ ] Run `npm run test:integration` — expected: 16/16 pass (7 schema + 3 RLS + 3 views tests, retargeted at Supabase's local Postgres — note the exact count depends on Task 2's added test; verify against what actually landed).
- [ ] Ensure `npx supabase functions serve` is running.
- [ ] Run `npm run test:api` — expected: all Edge Function integration tests pass (2 enter-match + 2 correct-match + 2 close-week + 1 start-season = 7).
- [ ] Run `npx tsc --noEmit` — expected: no errors (Deno files under `supabase/functions/` are not part of `tsconfig.json`'s `include: ["src"]`, so they're unaffected by this check; Deno type-checks its own files independently when served).
- [ ] Run `node scripts/seed.mjs` once more against a clean `supabase db reset` to confirm the seed script is reproducible from scratch.
- [ ] Run `npx supabase stop` to stop the local stack when done.
