# Fixtures Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins schedule upcoming matches ("Fixtures") ahead of time, distinct from the existing played-match history ("Results"), and complete a fixture atomically when its result is entered.

**Architecture:** A new `fixtures` table, kept entirely separate from `matches` (every existing rating-engine/weekly-close invariant on `matches` stays untouched). Admin-only create/void mutations go directly through PostgREST (RLS-gated), not a bespoke Edge Function — there's no rating-engine or multi-row invariant to protect for a simple schedule entry. Completing a fixture is different: it must happen atomically with inserting the resulting `matches` row, so the existing `enter-match` Edge Function's transaction is extended to optionally accept a `fixture_id`. `MatchHistory.tsx` gains a Fixtures/Results pill switcher; the Results side is completely unchanged. This plan does **not** include the match comparison view (side-by-side stats) — that is a separate, later plan that builds on the routes and data this one ships.

**Tech Stack:** PostgreSQL/Supabase migrations, Deno Edge Functions (`postgres.js` transactions), React 18 + TypeScript, TanStack Query v5, React Router v6, Vitest (`src/db`, `src/api`, and `web/`).

## Global Constraints

- `fixtures` is a new table, kept **entirely separate from `matches`** — no existing rating-engine, weekly-close, or statistics code path changes.
- Admin-only, manual, one fixture at a time — no recurring/bulk scheduling.
- A fixture's lifecycle: `'scheduled' → 'completed'` (via `enter-match`, atomically, linking `completed_match_id`) or `'scheduled' → 'voided'` (a direct admin update, no match ever produced).
- A fixture past its `scheduled_date` with `status = 'scheduled'` is flagged "Overdue" in the UI — computed client-side from `scheduled_date < today`, no new column, no background job.
- `MatchHistory.tsx`'s existing `/matches` route gains an in-memory (no URL persistence) Fixtures/Results pill switcher, matching the no-URL-persistence choice already made for season selection. The Results side (today's `MatchTable`) is unchanged.
- Completing a fixture via `enter-match` must be atomic with inserting the match row (same Postgres transaction) — a two-step "insert match, then separately mark the fixture complete" is explicitly rejected; it can leave a fixture stuck `'scheduled'` if the second step fails.
- `EnterMatchPage`'s existing success handler already invalidates six query keys (`leaderboard`, `gradeDistribution`, `matchHistory`, two `playerProfile` calls, `players`) — completing a fixture needs a seventh, `queryKeys.fixtures(seasonId)`, added **only** when a `fixture_id` was actually submitted (the existing 6-call regression test for a plain match entry must keep passing unmodified).
- TanStack Query keys always come from `web/src/lib/queryKeys.ts` — never an inline literal key array.
- `postgres.js` (used inside the Edge Function transaction) returns `numeric` columns as strings — this plan doesn't introduce new numeric arithmetic, but any new SQL touching existing numeric columns must still coerce with `Number(...)` per this codebase's existing discipline.
- Row locks inside `enter-match`'s transaction are acquired in a fixed order to avoid deadlocks: player rating rows in ascending player-id order (already existing, unchanged), and the fixture row (when present) is locked **after** those player-row locks — since no other code path ever locks a `fixtures` row and player rows together in a different order, this ordering can't deadlock against anything else in this codebase.

---

### Task 1: `fixtures` table, RLS, and schema/RLS regression coverage

**Files:**
- Create: `supabase/migrations/20260727000000_fixtures.sql`
- Modify: `src/db/schema.test.ts`
- Modify: `src/db/rls.test.ts`
- Create: `src/api/fixtures.test.ts`

**Interfaces:**
- Consumes: `set_updated_at()` (existing trigger function, already used by `player_season_ratings`/`user_profiles`), `admin_users` table (existing).
- Produces: `fixtures` table with columns `id, season_id, scheduled_date, player_a_id, player_b_id, status ('scheduled'|'completed'|'voided'), completed_match_id, created_at, updated_at`. Consumed by every later task in this plan.

- [ ] **Step 1: Write the failing tests**

Edit `src/db/schema.test.ts` — find the `'creates all required tables'` test and add `'fixtures'` to the expected list:

```ts
    expect(tableNames).toEqual(
      [
        'admin_users',
        'fixtures',
        'match_audit_log',
        'matches',
        'player_claims',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'user_profiles',
        'weekly_rankings',
      ].sort(),
    );
```

Edit `src/db/rls.test.ts` — update **both** hardcoded table lists (the RLS-enabled list and the select-policy list) to add `'fixtures'`:

```ts
  it('enables RLS on all 12 tables', async () => {
    const result = await client.query(
      `select relname from pg_class
       join pg_namespace on pg_namespace.oid = pg_class.relnamespace
       where pg_namespace.nspname = $1 and relrowsecurity = true
       order by relname`,
      [schemaName],
    );
    const tableNames = result.rows.map((r: { relname: string }) => r.relname);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'fixtures',
        'match_audit_log',
        'matches',
        'player_claims',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'user_profiles',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('grants a select policy on every publicly/self-readable table', async () => {
    const result = await client.query(
      `select distinct tablename from pg_policies where schemaname = $1 and cmd = 'SELECT' order by tablename`,
      [schemaName],
    );
    const tableNames = result.rows.map((r: { tablename: string }) => r.tablename);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'fixtures',
        'matches',
        'player_claims',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'user_profiles',
        'weekly_rankings',
      ].sort(),
    );
  });
```

(Note the test title changes from "11 tables" to "12 tables" to stay accurate.)

Also in `src/db/rls.test.ts`, add `fixtures` to the existing `'league data requires login'` describe block's `selects` map (it already tests this exact anon-denied/authenticated-allowed pattern for `seasons`/`matches`/etc.):

```ts
  const selects: Record<string, string> = {
    players: 'select id, full_name, joined_date, is_active, created_at, updated_at, photo_url from players limit 1',
    seasons: 'select * from seasons limit 1',
    player_season_ratings: 'select * from player_season_ratings limit 1',
    matches: 'select * from matches limit 1',
    weekly_rankings: 'select * from weekly_rankings limit 1',
    player_statistics: 'select * from player_statistics limit 1',
    fixtures: 'select * from fixtures limit 1',
  };
```

Create `src/api/fixtures.test.ts`:

```ts
// src/api/fixtures.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import {
  getSupabaseStatus,
  provisionTestAdmin,
  cleanupTestAdmin,
  provisionTestUser,
  cleanupTestUser,
  deletePlayers,
  deleteSeasons,
  type SupabaseStatus,
} from './testSupport';

let status: SupabaseStatus;
let dbClient: Client;
const createdPlayerIds: string[] = [];
const createdSeasonIds: string[] = [];
const createdUserIds: string[] = [];

function asUser(accessToken: string) {
  return createClient(status.API_URL, status.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function createPlayer(name: string): Promise<string> {
  const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

async function createSeason(name: string): Promise<string> {
  const result = await dbClient.query(
    `insert into seasons (name, start_date) values ($1, '2026-01-01') returning id`,
    [name],
  );
  const id = result.rows[0].id;
  createdSeasonIds.push(id);
  return id;
}

beforeAll(async () => {
  status = getSupabaseStatus();
  dbClient = new Client({ connectionString: status.DB_URL });
  await dbClient.connect();
}, 30000);

afterAll(async () => {
  for (const userId of createdUserIds) {
    await cleanupTestUser(status, userId);
  }
  await dbClient.query(`delete from fixtures where season_id = any($1::uuid[])`, [createdSeasonIds]);
  await deletePlayers(dbClient, createdPlayerIds);
  await deleteSeasons(dbClient, createdSeasonIds);
  await dbClient.end();
}, 30000);

describe('fixtures RLS', () => {
  it('lets an admin create a fixture; denies a non-admin authenticated user', async () => {
    const admin = await provisionTestAdmin(status);
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerA = await createPlayer('Fixture RLS Player A');
    const playerB = await createPlayer('Fixture RLS Player B');
    const seasonId = await createSeason('Fixture RLS Season');

    try {
      const adminClient = asUser(admin.accessToken);
      const adminInsert = await adminClient.from('fixtures').insert({
        season_id: seasonId,
        scheduled_date: '2026-02-01',
        player_a_id: playerA,
        player_b_id: playerB,
      });
      expect(adminInsert.error).toBeNull();

      const userClient = asUser(user.accessToken);
      const userInsert = await userClient.from('fixtures').insert({
        season_id: seasonId,
        scheduled_date: '2026-02-02',
        player_a_id: playerA,
        player_b_id: playerB,
      });
      expect(userInsert.error).not.toBeNull();
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('lets an admin void a fixture; denies a non-admin authenticated user', async () => {
    const admin = await provisionTestAdmin(status);
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerA = await createPlayer('Fixture Void RLS Player A');
    const playerB = await createPlayer('Fixture Void RLS Player B');
    const seasonId = await createSeason('Fixture Void RLS Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-02-03', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const userClient = asUser(user.accessToken);
      const userVoid = await userClient.from('fixtures').update({ status: 'voided' }).eq('id', fixtureId).select();
      expect(userVoid.data).toHaveLength(0);

      const adminClient = asUser(admin.accessToken);
      const adminVoid = await adminClient.from('fixtures').update({ status: 'voided' }).eq('id', fixtureId).select();
      expect(adminVoid.data).toHaveLength(1);
      expect(adminVoid.data?.[0].status).toBe('voided');
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('lets any authenticated user read fixtures', async () => {
    const user = await provisionTestUser(status);
    createdUserIds.push(user.userId);
    const playerA = await createPlayer('Fixture Read RLS Player A');
    const playerB = await createPlayer('Fixture Read RLS Player B');
    const seasonId = await createSeason('Fixture Read RLS Season');

    await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id) values ($1, '2026-02-04', $2, $3)`,
      [seasonId, playerA, playerB],
    );

    const userClient = asUser(user.accessToken);
    const result = await userClient.from('fixtures').select('id').eq('season_id', seasonId);
    expect(result.data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration -- src/db/schema.test.ts src/db/rls.test.ts` (from repo root)
Expected: FAIL — `relation "fixtures" does not exist` (the migration doesn't exist yet).

Run: `npm run test:api -- src/api/fixtures.test.ts` (requires the local Supabase stack running — see Step 4 below if it isn't)
Expected: FAIL — `relation "fixtures" does not exist` / `Could not find the table 'public.fixtures'`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260727000000_fixtures.sql`:

```sql
-- supabase/migrations/20260727000000_fixtures.sql
--
-- Scheduled-but-not-yet-played matches ("Fixtures"), kept entirely separate
-- from `matches` -- a `matches` row has always meant "a result was entered"
-- everywhere else in this codebase (rating engine, weekly close, season
-- points, statistics), and this migration doesn't touch any of that. A
-- fixture is completed by linking it to the `matches` row that resulted
-- from it (see the `enter-match` Edge Function extension, a later task in
-- this plan) or voided directly without ever producing a match.

create table fixtures (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  scheduled_date date not null,
  player_a_id uuid not null references players(id),
  player_b_id uuid not null references players(id),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'voided')),
  completed_match_id uuid references matches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fixtures_season_date_idx on fixtures (season_id, scheduled_date);

create trigger fixtures_set_updated_at before update on fixtures
  for each row execute function set_updated_at();

alter table fixtures enable row level security;

-- Same "using (true), access controlled by GRANTs" pattern already
-- established for every other league-data table since
-- 20260724010000_require_login_for_league_data.sql -- authenticated-only
-- read, no anon grant given at all (so no anon revoke is needed either,
-- unlike that migration which had to undo a pre-existing anon grant).
create policy "authenticated read fixtures" on fixtures for select using (true);
grant select on fixtures to authenticated;

-- Admin-only write, enforced by RLS predicate (the table-level GRANT below
-- is necessary but not sufficient -- it lets any authenticated user attempt
-- the statement, and the policy below then restricts which rows/requests
-- actually succeed).
create policy "admin insert fixtures" on fixtures for insert
  with check (exists (select 1 from admin_users a where a.id = auth.uid()));
create policy "admin update fixtures" on fixtures for update
  using (exists (select 1 from admin_users a where a.id = auth.uid()));
grant insert, update on fixtures to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

If the local Supabase stack isn't already running, start it first (from repo root): `npx supabase start`. This picks up new migration files automatically; if it was already running, apply the new migration with `npx supabase db reset` (safe against the local dev stack — this is not the Cloud project).

Run: `npm run test:integration -- src/db/schema.test.ts src/db/rls.test.ts`
Expected: PASS.

Run: `npm run test:api -- src/api/fixtures.test.ts`
Expected: PASS (3/3 tests). If this is flaky on the first run (Docker health-check timing is tight on this machine per this repo's own documented experience), re-run this one file alone before treating it as a real failure.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260727000000_fixtures.sql src/db/schema.test.ts src/db/rls.test.ts src/api/fixtures.test.ts
git commit -m "feat: add fixtures table with admin-only write RLS"
```

---

### Task 2: `useFixtures` hook

**Files:**
- Modify: `web/src/lib/queryKeys.ts`
- Create: `web/src/hooks/useFixtures.ts`
- Test: `web/src/hooks/useFixtures.test.tsx`

**Interfaces:**
- Consumes: `supabase` client, `resolvePlayerPhotoUrls`/`pickResolvedUrl` (`web/src/lib/playerPhotos.ts`).
- Produces: `FixtureStatus = 'scheduled' | 'completed' | 'voided'`, `Fixture` interface (`{ id, season_id, scheduled_date, status: FixtureStatus, completed_match_id: string | null, player_a: { id, full_name, photo_url }, player_b: { id, full_name, photo_url } }`), `useFixtures(seasonId: string | undefined)`. Consumed by Task 5 (`MatchHistory.tsx`) and Task 7 (`EnterMatchPage`).

- [ ] **Step 1: Add the `fixtures` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after the existing `playerOfTheWeek` entry:

```ts
  playerOfTheWeek: (seasonId: string) => ['playerOfTheWeek', seasonId] as const,
  fixtures: (seasonId: string) => ['fixtures', seasonId] as const,
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useFixtures.test.tsx`:

```tsx
// web/src/hooks/useFixtures.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: mockOrder }) }) }),
  },
}));

import { useFixtures } from './useFixtures';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useFixtures', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('returns fixtures for the season, ordered by scheduled date', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'f1',
          season_id: 's1',
          scheduled_date: '2026-08-01',
          status: 'scheduled',
          completed_match_id: null,
          player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
          player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useFixtures('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: 'f1',
        season_id: 's1',
        scheduled_date: '2026-08-01',
        status: 'scheduled',
        completed_match_id: null,
        player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
        player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
      },
    ]);
  });

  it('stays disabled until a seasonId is provided', () => {
    const { result } = renderHook(() => useFixtures(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOrder).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useFixtures('s1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useFixtures.test.tsx`
Expected: FAIL — `Failed to resolve import "./useFixtures"` (module does not exist yet).

- [ ] **Step 4: Implement `useFixtures`**

Create `web/src/hooks/useFixtures.ts`:

```ts
// web/src/hooks/useFixtures.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export type FixtureStatus = 'scheduled' | 'completed' | 'voided';

export interface Fixture {
  id: string;
  season_id: string;
  scheduled_date: string;
  status: FixtureStatus;
  completed_match_id: string | null;
  player_a: { id: string; full_name: string; photo_url: string | null };
  player_b: { id: string; full_name: string; photo_url: string | null };
}

export function useFixtures(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.fixtures(seasonId ?? ''),
    queryFn: async (): Promise<Fixture[]> => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(
          '*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)',
        )
        .eq('season_id', seasonId as string)
        .order('scheduled_date', { ascending: true });
      if (error) throw error;

      const rows = data as unknown as Fixture[];
      const photoUrlByPath = await resolvePlayerPhotoUrls(
        rows.flatMap((row) => [row.player_a.photo_url, row.player_b.photo_url]),
      );
      return rows.map((row) => ({
        ...row,
        player_a: { ...row.player_a, photo_url: pickResolvedUrl(photoUrlByPath, row.player_a.photo_url) },
        player_b: { ...row.player_b, photo_url: pickResolvedUrl(photoUrlByPath, row.player_b.photo_url) },
      }));
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useFixtures.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useFixtures.ts web/src/hooks/useFixtures.test.tsx
git commit -m "feat: add useFixtures hook"
```

---

### Task 3: `useCreateFixture` and `useVoidFixture` mutations

**Files:**
- Create: `web/src/hooks/useCreateFixture.ts`
- Test: `web/src/hooks/useCreateFixture.test.tsx`
- Create: `web/src/hooks/useVoidFixture.ts`
- Test: `web/src/hooks/useVoidFixture.test.tsx`

**Interfaces:**
- Consumes: `supabase` client, `queryKeys.fixtures` (Task 2).
- Produces: `useCreateFixture()` (a `useMutation` taking `{ seasonId, scheduledDate, playerAId, playerBId }`), `useVoidFixture()` (a `useMutation` taking `{ fixtureId, seasonId }`). Both invalidate `queryKeys.fixtures(seasonId)` on success. Consumed by Task 4 (`CreateFixturePage`) and Task 5 (`MatchHistory.tsx`'s void action).

- [ ] **Step 1: Write the failing tests**

Create `web/src/hooks/useCreateFixture.test.tsx`:

```tsx
// web/src/hooks/useCreateFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/lib/queryKeys';

const mockInsert = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }) },
}));

import { useCreateFixture } from './useCreateFixture';

function renderCreateFixture() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateFixture(), { wrapper });
  return { result, invalidateSpy };
}

describe('useCreateFixture', () => {
  beforeEach(() => {
    mockInsert.mockReset();
  });

  it('inserts a fixture and invalidates the fixtures cache for that season', async () => {
    mockInsert.mockResolvedValue({ error: null });
    const { result, invalidateSpy } = renderCreateFixture();

    result.current.mutate({ seasonId: 's1', scheduledDate: '2026-08-01', playerAId: 'p1', playerBId: 'p2' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInsert).toHaveBeenCalledWith({
      season_id: 's1',
      scheduled_date: '2026-08-01',
      player_a_id: 'p1',
      player_b_id: 'p2',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.fixtures('s1') });
  });

  it('surfaces an insert error', async () => {
    mockInsert.mockResolvedValue({ error: new Error('boom') });
    const { result } = renderCreateFixture();

    result.current.mutate({ seasonId: 's1', scheduledDate: '2026-08-01', playerAId: 'p1', playerBId: 'p2' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

Create `web/src/hooks/useVoidFixture.test.tsx`:

```tsx
// web/src/hooks/useVoidFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/lib/queryKeys';

const mockEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ update: () => ({ eq: (...args: unknown[]) => mockEq(...args) }) }) },
}));

import { useVoidFixture } from './useVoidFixture';

function renderVoidFixture() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useVoidFixture(), { wrapper });
  return { result, invalidateSpy };
}

describe('useVoidFixture', () => {
  beforeEach(() => {
    mockEq.mockReset();
  });

  it('voids a fixture and invalidates the fixtures cache for that season', async () => {
    mockEq.mockResolvedValue({ error: null });
    const { result, invalidateSpy } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockEq).toHaveBeenCalledWith('id', 'f1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.fixtures('s1') });
  });

  it('surfaces an update error', async () => {
    mockEq.mockResolvedValue({ error: new Error('boom') });
    const { result } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/hooks/useCreateFixture.test.tsx src/hooks/useVoidFixture.test.tsx`
Expected: FAIL — `Failed to resolve import` for both modules (neither exists yet).

- [ ] **Step 3: Implement both mutations**

Create `web/src/hooks/useCreateFixture.ts`:

```ts
// web/src/hooks/useCreateFixture.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface CreateFixtureArgs {
  seasonId: string;
  scheduledDate: string;
  playerAId: string;
  playerBId: string;
}

export function useCreateFixture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ seasonId, scheduledDate, playerAId, playerBId }: CreateFixtureArgs) => {
      const { error } = await supabase.from('fixtures').insert({
        season_id: seasonId,
        scheduled_date: scheduledDate,
        player_a_id: playerAId,
        player_b_id: playerBId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { seasonId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(seasonId) });
    },
  });
}
```

Create `web/src/hooks/useVoidFixture.ts`:

```ts
// web/src/hooks/useVoidFixture.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface VoidFixtureArgs {
  fixtureId: string;
  seasonId: string;
}

export function useVoidFixture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fixtureId }: VoidFixtureArgs) => {
      const { error } = await supabase.from('fixtures').update({ status: 'voided' }).eq('id', fixtureId);
      if (error) throw error;
    },
    onSuccess: (_data, { seasonId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(seasonId) });
    },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/hooks/useCreateFixture.test.tsx src/hooks/useVoidFixture.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useCreateFixture.ts web/src/hooks/useCreateFixture.test.tsx web/src/hooks/useVoidFixture.ts web/src/hooks/useVoidFixture.test.tsx
git commit -m "feat: add useCreateFixture and useVoidFixture mutations"
```

---

### Task 4: `CreateFixturePage`

**Files:**
- Create: `web/src/pages/admin/CreateFixture.tsx`
- Test: `web/src/pages/admin/CreateFixture.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `useActiveSeason` (`web/src/hooks/useActiveSeason.ts`, unchanged — this is an admin write-flow page, so it correctly keeps requiring a genuinely active season, same as `EnterMatchPage`/`CorrectMatchPage`/`CloseWeekPage`), `usePlayers` (`web/src/hooks/usePlayers.ts`, unchanged), `useCreateFixture` (Task 3).
- Produces: `CreateFixturePage` — no props. Routed at `/admin/create-fixture`.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/admin/CreateFixture.test.tsx`:

```tsx
// web/src/pages/admin/CreateFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseActiveSeason = vi.fn();
vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));

const mockUsePlayers = vi.fn();
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));

const mockMutateAsync = vi.fn();
vi.mock('@/hooks/useCreateFixture', () => ({
  useCreateFixture: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

import { CreateFixturePage } from './CreateFixture';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateFixturePage />
    </QueryClientProvider>,
  );
}

describe('CreateFixturePage', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockToastSuccess.mockReset();
    mockUseActiveSeason.mockReturnValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer', rating: 1600 },
        { id: 'p2', full_name: 'Jordan Testplayer', rating: 1400 },
      ],
      isLoading: false,
      isError: false,
    });
  });

  it('schedules a fixture, shows a success toast, and resets the player selects', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.click(screen.getByRole('button', { name: 'Schedule Fixture' }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ seasonId: 's1', playerAId: 'p1', playerBId: 'p2' }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Fixture scheduled.');
    await waitFor(() => expect(screen.getByLabelText('Player A')).toHaveValue(''));
  });

  it('rejects selecting the same player for both slots without calling the mutation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Alex Testplayer');
    await user.click(screen.getByRole('button', { name: 'Schedule Fixture' }));

    expect(screen.getByText('Player A and Player B must be different.')).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows the mutation error message verbatim on failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('insert or update on table "fixtures" violates foreign key'));
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.click(screen.getByRole('button', { name: 'Schedule Fixture' }));

    await waitFor(() =>
      expect(screen.getByText('insert or update on table "fixtures" violates foreign key')).toBeInTheDocument(),
    );
  });

  it('shows a loading skeleton while the active season or players are still loading', () => {
    mockUsePlayers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Schedule Fixture')).not.toBeInTheDocument();
  });

  it('shows an inline error message when the active season or players fail to load', () => {
    mockUseActiveSeason.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText("Couldn't load the fixture form. Try refreshing.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/CreateFixture.test.tsx`
Expected: FAIL — `Failed to resolve import "./CreateFixture"` (module does not exist yet).

- [ ] **Step 3: Implement `CreateFixturePage`**

Create `web/src/pages/admin/CreateFixture.tsx`:

```tsx
// web/src/pages/admin/CreateFixture.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers } from '@/hooks/usePlayers';
import { useCreateFixture } from '@/hooks/useCreateFixture';

export function CreateFixturePage() {
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);
  const createFixture = useCreateFixture();

  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [playerAId, setPlayerAId] = useState('');
  const [playerBId, setPlayerBId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!playerAId || !playerBId) {
      setError('Select both players.');
      return;
    }
    if (playerAId === playerBId) {
      setError('Player A and Player B must be different.');
      return;
    }
    if (!activeSeason.data) {
      setError('No active season.');
      return;
    }

    try {
      await createFixture.mutateAsync({
        seasonId: activeSeason.data.id,
        scheduledDate,
        playerAId,
        playerBId,
      });
      toast.success('Fixture scheduled.');
      setPlayerAId('');
      setPlayerBId('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to schedule fixture.');
    }
  }

  if (activeSeason.isLoading || players.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || players.isError) {
    return <p className="text-destructive">Couldn't load the fixture form. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Schedule Fixture</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="scheduledDate">Scheduled date</Label>
          <Input
            id="scheduledDate"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="playerA">Player A</Label>
          <select
            id="playerA"
            value={playerAId}
            onChange={(e) => setPlayerAId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player A</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="playerB">Player B</Label>
          <select
            id="playerB"
            value={playerBId}
            onChange={(e) => setPlayerBId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player B</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={createFixture.isPending} className="self-start">
          {createFixture.isPending ? 'Scheduling…' : 'Schedule Fixture'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Register the route and nav link**

Edit `web/src/App.tsx` — add the import and route inside the existing `AdminLayout` block:

```tsx
import { CreateFixturePage } from '@/pages/admin/CreateFixture';
```

```tsx
              <Route path="/admin/create-fixture" element={<CreateFixturePage />} />
```

Edit `web/src/components/AdminSidebar.tsx` — add one entry to the `links` array (right after `'Enter Match'`):

```ts
const links = [
  { to: '/admin/enter-match', label: 'Enter Match' },
  { to: '/admin/create-fixture', label: 'Schedule Fixture' },
  { to: '/admin/correct-match', label: 'Correct a Match' },
  { to: '/admin/close-week', label: 'Close Week' },
  { to: '/admin/start-season', label: 'Start Season' },
  { to: '/admin/players', label: 'Players' },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/CreateFixture.test.tsx`
Expected: PASS (5/5 tests)

- [ ] **Step 6: Update `AdminSidebar.test.tsx`**

The existing `AdminSidebar.test.tsx` asserts an exact count of admin links (`'renders the 5 admin action links and no logout button'`) — this will now render 6. Read `web/src/components/AdminSidebar.test.tsx`, update the test title and any hardcoded count/list to include the new "Schedule Fixture" link, then run:

Run: `cd web && npx vitest run src/components/AdminSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/admin/CreateFixture.tsx web/src/pages/admin/CreateFixture.test.tsx web/src/App.tsx web/src/components/AdminSidebar.tsx web/src/components/AdminSidebar.test.tsx
git commit -m "feat: add the Schedule Fixture admin page"
```

---

### Task 5: Fixtures/Results tabs on `MatchHistory.tsx`

**Files:**
- Modify: `web/src/pages/MatchHistory.tsx`
- Modify: `web/src/pages/MatchHistory.test.tsx`

**Interfaces:**
- Consumes: `useFixtures` (Task 2), `useVoidFixture` (Task 3), `useAuth` (`web/src/hooks/useAuth.ts`, unchanged), `useIsAdmin` (`web/src/hooks/useIsAdmin.ts`, unchanged), `PlayerAvatar` (`web/src/components/PlayerAvatar.tsx`), `Button` (`web/src/components/ui/button.tsx`).
- Produces: no new exports — `MatchHistoryPage`'s signature is unchanged. This is the last task in this plan to touch the Fixtures list UI; the match-comparison click-through (making a fixture or result row link to a detail page) is explicitly **out of scope** for this plan — that's the next, separate plan.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `web/src/pages/MatchHistory.test.tsx`:

```tsx
// web/src/pages/MatchHistory.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

vi.mock('@/hooks/useMatchHistory', () => ({
  useMatchHistory: () => ({
    data: [
      {
        id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2',
        frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: true,
        player_a: { id: 'p1', full_name: 'Alex Testplayer' }, player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

const mockUseFixtures = vi.fn();
vi.mock('@/hooks/useFixtures', () => ({ useFixtures: () => mockUseFixtures() }));

const mockVoidMutateAsync = vi.fn();
vi.mock('@/hooks/useVoidFixture', () => ({
  useVoidFixture: () => ({ mutateAsync: mockVoidMutateAsync, isPending: false }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const mockUseIsAdmin = vi.fn();
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) }, } ));

import { MatchHistoryPage } from './MatchHistory';

const SEASON: Season = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' };

function seasonSelectorReturn(season: Season | null, seasons: Season[]) {
  return {
    selectedSeason: season,
    selectedSeasonId: season?.id,
    seasons,
    isLoading: false,
    isError: false,
    selectSeason: vi.fn(),
    selectPrevious: vi.fn(),
    selectNext: vi.fn(),
    hasPrevious: false,
    hasNext: false,
  };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MatchHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MatchHistoryPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseFixtures.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockVoidMutateAsync.mockReset();
    mockToastSuccess.mockReset();
  });

  it('renders the match table with league-wide results by default, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });

  it('switches to the Fixtures list, showing scheduled players and an Overdue flag for a past-due fixture', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2020-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByText('Sam Newcomer')).toBeInTheDocument();
    expect(screen.getByText('Riley Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('does not flag a future-dated scheduled fixture as overdue', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f2', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('shows admin actions (Enter Result, Void) for a scheduled fixture only when the viewer is an admin', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByRole('link', { name: 'Enter Result' })).toHaveAttribute(
      'href',
      '/admin/enter-match?fixtureId=f1',
    );
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('lets an admin void a fixture', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    mockVoidMutateAsync.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));
    await user.click(screen.getByRole('button', { name: 'Void' }));

    await waitFor(() => expect(mockVoidMutateAsync).toHaveBeenCalledWith({ fixtureId: 'f1', seasonId: 's1' }));
    expect(mockToastSuccess).toHaveBeenCalledWith('Fixture voided.');
  });

  it('shows a "no fixtures scheduled yet" message for an empty Fixtures list', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));
    expect(screen.getByText('No fixtures scheduled yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/MatchHistory.test.tsx`
Expected: FAIL — no "Fixtures"/"Results" buttons exist yet on the current page, so every test past the first two fails (can't find the `'Fixtures'` button).

- [ ] **Step 3: Implement the tabs**

Replace the full contents of `web/src/pages/MatchHistory.tsx`:

```tsx
// web/src/pages/MatchHistory.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useMatchHistory } from '@/hooks/useMatchHistory';
import { useFixtures, type Fixture } from '@/hooks/useFixtures';
import { useVoidFixture } from '@/hooks/useVoidFixture';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';

function isOverdue(fixture: Fixture): boolean {
  return fixture.status === 'scheduled' && fixture.scheduled_date < new Date().toISOString().slice(0, 10);
}

function FixturesList({ seasonId, isAdmin }: { seasonId: string; isAdmin: boolean }) {
  const fixtures = useFixtures(seasonId);
  const voidFixture = useVoidFixture();

  async function handleVoid(fixtureId: string) {
    try {
      await voidFixture.mutateAsync({ fixtureId, seasonId });
      toast.success('Fixture voided.');
    } catch (voidError) {
      toast.error(voidError instanceof Error ? voidError.message : 'Failed to void fixture.');
    }
  }

  if (fixtures.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (fixtures.isError) {
    return <p className="text-destructive text-sm">Couldn't load fixtures. Try refreshing.</p>;
  }

  const rows = fixtures.data ?? [];
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No fixtures scheduled yet.</p>;
  }

  return (
    <ul className="card-surface overflow-hidden">
      {rows.map((fixture) => (
        <li
          key={fixture.id}
          className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
        >
          <span className="text-muted-foreground w-24 text-sm">{fixture.scheduled_date}</span>
          <div className="flex flex-1 items-center gap-2">
            <PlayerAvatar name={fixture.player_a.full_name} photoUrl={fixture.player_a.photo_url} size="sm" />
            <span className="font-semibold">{fixture.player_a.full_name}</span>
            <span className="text-muted-foreground text-xs">vs</span>
            <PlayerAvatar name={fixture.player_b.full_name} photoUrl={fixture.player_b.photo_url} size="sm" />
            <span className="font-semibold">{fixture.player_b.full_name}</span>
          </div>
          {fixture.status === 'voided' && (
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Voided</span>
          )}
          {fixture.status === 'completed' && (
            <span className="text-primary text-xs font-semibold uppercase tracking-wider">Completed</span>
          )}
          {isOverdue(fixture) && (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold uppercase text-destructive">
              Overdue
            </span>
          )}
          {isAdmin && fixture.status === 'scheduled' && (
            <div className="flex gap-3">
              <Link
                to={`/admin/enter-match?fixtureId=${fixture.id}`}
                className="text-primary text-xs font-semibold hover:underline"
              >
                Enter Result
              </Link>
              <button
                type="button"
                onClick={() => handleVoid(fixture.id)}
                className="text-destructive text-xs font-semibold hover:underline"
              >
                Void
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MatchHistoryPage() {
  const seasonSelector = useSeasonSelector();
  const matchHistory = useMatchHistory(seasonSelector.selectedSeasonId);
  const { session } = useAuth();
  const isAdmin = useIsAdmin(session?.user.id);
  const [view, setView] = useState<'fixtures' | 'results'>('results');

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <div className="mb-3 flex justify-center sm:justify-start">
          <SeasonPillSwitcher
            selectedSeason={seasonSelector.selectedSeason}
            seasons={seasonSelector.seasons}
            onSelectSeason={seasonSelector.selectSeason}
            onPrevious={seasonSelector.selectPrevious}
            onNext={seasonSelector.selectNext}
            hasPrevious={seasonSelector.hasPrevious}
            hasNext={seasonSelector.hasNext}
          />
        </div>
        <h1 className="mb-4 text-3xl font-extrabold sm:text-4xl">Matches</h1>
        <div className="flex justify-center gap-2 sm:justify-start">
          <Button
            type="button"
            variant={view === 'fixtures' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('fixtures')}
          >
            Fixtures
          </Button>
          <Button
            type="button"
            variant={view === 'results' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('results')}
          >
            Results
          </Button>
        </div>
      </div>
      {view === 'fixtures' ? (
        <FixturesList seasonId={seasonSelector.selectedSeasonId} isAdmin={isAdmin.data === true} />
      ) : matchHistory.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : matchHistory.isError ? (
        <p className="text-destructive">Couldn't load match history. Try refreshing.</p>
      ) : (
        <MatchTable matches={matchHistory.data ?? []} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/MatchHistory.test.tsx`
Expected: PASS (8/8 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/MatchHistory.tsx web/src/pages/MatchHistory.test.tsx
git commit -m "feat: add Fixtures/Results tabs to Match History"
```

---

### Task 6: Extend `enter-match` to atomically complete a fixture

**Files:**
- Modify: `supabase/functions/enter-match/index.ts`
- Modify: `src/api/fixtures.test.ts`

**Interfaces:**
- Consumes: the `fixtures` table (Task 1).
- Produces: `enter-match` accepts an optional `fixture_id` in its request body. When present and valid, completing the match also atomically sets that fixture's `status = 'completed'` and `completed_match_id` to the new match's id, in the same transaction. Consumed by Task 7 (`EnterMatchPage`).

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/api/fixtures.test.ts` (append this new `describe` block; keep everything already in the file from Task 1):

```ts
describe('enter-match fixture completion', () => {
  it('completes a fixture atomically when its result is entered', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Fixture Completion Player A');
    const playerB = await createPlayer('Fixture Completion Player B');
    const seasonId = await createSeason('Fixture Completion Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-03-01', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-01',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(201);
      const body = await response.json();

      const updatedFixture = await dbClient.query(
        `select status, completed_match_id from fixtures where id = $1`,
        [fixtureId],
      );
      expect(updatedFixture.rows[0].status).toBe('completed');
      expect(updatedFixture.rows[0].completed_match_id).toBe(body.match_id);
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects completing an already-completed fixture', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Double Completion Player A');
    const playerB = await createPlayer('Double Completion Player B');
    const seasonId = await createSeason('Double Completion Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id, status)
       values ($1, '2026-03-02', $2, $3, 'completed') returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-02',
          player_a_id: playerA,
          player_b_id: playerB,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(409);

      const matchCount = await dbClient.query(
        `select count(*)::int as count from matches where player_a_id = $1 and player_b_id = $2`,
        [playerA, playerB],
      );
      expect(matchCount.rows[0].count).toBe(0);
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });

  it('rejects a fixture_id whose players do not match the submitted players', async () => {
    const admin = await provisionTestAdmin(status);
    const playerA = await createPlayer('Mismatch Player A');
    const playerB = await createPlayer('Mismatch Player B');
    const playerC = await createPlayer('Mismatch Player C');
    const seasonId = await createSeason('Mismatch Season');

    const fixture = await dbClient.query(
      `insert into fixtures (season_id, scheduled_date, player_a_id, player_b_id)
       values ($1, '2026-03-03', $2, $3) returning id`,
      [seasonId, playerA, playerB],
    );
    const fixtureId = fixture.rows[0].id;

    try {
      const response = await fetch(`${status.API_URL}/functions/v1/enter-match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          match_date: '2026-03-03',
          player_a_id: playerA,
          player_b_id: playerC,
          frames_a: 5,
          frames_b: 2,
          fixture_id: fixtureId,
        }),
      });
      expect(response.status).toBe(400);
    } finally {
      await cleanupTestAdmin(status, admin.userId);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

If the local Supabase stack isn't already running, start it (`npx supabase start` from repo root), then serve the current Edge Function code: `npx supabase functions serve` (in a separate terminal/background process — it must keep running for the `src/api` suite to hit real, current code).

Run: `npm run test:api -- src/api/fixtures.test.ts`
Expected: FAIL — the completion test fails because `fixtures.status` never changes (the current `enter-match` doesn't know about `fixture_id` at all, and silently ignores the extra field); the "already-completed" test fails because the request succeeds (201) instead of being rejected (409); the "mismatch" test fails the same way (succeeds instead of 400).

- [ ] **Step 3: Extend the Edge Function**

Replace the full contents of `supabase/functions/enter-match/index.ts`:

```ts
// supabase/functions/enter-match/index.ts
import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { jsonResponse } from '../_shared/response.ts';
import { corsPreflightResponse } from '../_shared/cors.ts';
import { withTransaction, type TransactionSql } from '../_shared/dbTransaction.ts';
import { HttpError } from '../_shared/httpError.ts';
import { isUuid, isValidFrameCount, isValidDateString } from '../_shared/validation.ts';
import { applyInstantNudge } from '../_shared/rating/elo.ts';
import { gradeForRating } from '../_shared/rating/grade.ts';
import { calculateSeasonPoints } from '../_shared/rating/seasonPoints.ts';
import { MIN_MATCHES_FOR_RANKING } from '../_shared/rating/constants.ts';
import { recomputePlayerStatistics } from '../_shared/playerStatisticsRecompute.ts';

interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
  fixture_id?: string;
}

async function ensureRatingRow(sql: TransactionSql, playerId: string, seasonId: string) {
  // ON CONFLICT DO UPDATE (a harmless self-assignment) both creates the row
  // if missing AND takes a row lock if it already exists, held until this
  // transaction commits/rolls back -- this closes the brand-new-player race
  // (two concurrent first matches for the same new player) in the same
  // statement that creates the row, rather than needing a separate lock step.
  const [row] = await sql`
    insert into player_season_ratings (player_id, season_id)
    values (${playerId}, ${seasonId})
    on conflict (player_id, season_id) do update set player_id = excluded.player_id
    returning rating, rd, volatility, matches_played, season_points
  `;
  // postgres.js returns `numeric` columns as strings (to avoid float precision
  // loss on arbitrary-precision values), not JS numbers -- but the rating
  // engine (applyInstantNudge et al.) does real arithmetic on these fields,
  // so they must be coerced here. `matches_played`/`season_points` are plain
  // `integer` columns, which postgres.js already returns as JS numbers.
  return {
    rating: Number(row.rating),
    rd: Number(row.rd),
    volatility: Number(row.volatility),
    matches_played: row.matches_played,
    season_points: row.season_points,
  };
}

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

async function updatePlayerAfterMatch(sql: TransactionSql, args: UpdatePlayerArgs): Promise<void> {
  const matchesPlayed = args.priorMatchesPlayed + 1;
  const seasonPointsEarned = calculateSeasonPoints({
    won: args.won,
    framesFor: args.framesFor,
    framesAgainst: args.framesAgainst,
    ownRating: args.newRating,
    opponentRating: args.opponentRating,
  });

  await sql`
    update player_season_ratings
    set rating = ${args.newRating},
        matches_played = ${matchesPlayed},
        is_provisional = ${matchesPlayed < MIN_MATCHES_FOR_RANKING},
        grade = ${gradeForRating(args.newRating)},
        season_points = ${args.priorSeasonPoints + seasonPointsEarned}
    where player_id = ${args.playerId} and season_id = ${args.seasonId}
  `;

  await recomputePlayerStatistics(sql, args.playerId, args.seasonId);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  const authedClient = createAuthedClient(req);
  const db = createServiceRoleClient();
  const admin = await requireAdmin(authedClient, db);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: EnterMatchBody;
  try {
    body = (await req.json()) as EnterMatchBody;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }
  const { season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, fixture_id } = body;

  if (!isUuid(season_id)) return jsonResponse({ error: 'season_id must be a valid UUID' }, 400);
  if (!isUuid(player_a_id)) return jsonResponse({ error: 'player_a_id must be a valid UUID' }, 400);
  if (!isUuid(player_b_id)) return jsonResponse({ error: 'player_b_id must be a valid UUID' }, 400);
  if (player_a_id === player_b_id) {
    return jsonResponse({ error: 'player_a_id and player_b_id must be different players' }, 400);
  }
  if (!isValidDateString(match_date)) {
    return jsonResponse({ error: 'match_date must be a valid YYYY-MM-DD date' }, 400);
  }
  if (!isValidFrameCount(frames_a)) {
    return jsonResponse({ error: 'frames_a must be an integer between 0 and 50' }, 400);
  }
  if (!isValidFrameCount(frames_b)) {
    return jsonResponse({ error: 'frames_b must be an integer between 0 and 50' }, 400);
  }
  if (frames_a === frames_b) {
    return jsonResponse({ error: 'frames_a and frames_b cannot be equal' }, 400);
  }
  if (fixture_id !== undefined && !isUuid(fixture_id)) {
    return jsonResponse({ error: 'fixture_id must be a valid UUID' }, 400);
  }

  try {
    const result = await withTransaction(async (sql) => {
      const [season] = await sql`select id from seasons where id = ${season_id}`;
      if (!season) throw new HttpError(400, 'season_id does not reference an existing season');
      const [playerA] = await sql`select id from players where id = ${player_a_id}`;
      if (!playerA) throw new HttpError(400, 'player_a_id does not reference an existing player');
      const [playerB] = await sql`select id from players where id = ${player_b_id}`;
      if (!playerB) throw new HttpError(400, 'player_b_id does not reference an existing player');

      // Lock both players' rating rows in a fixed (ascending id) order
      // regardless of which request slot (A/B) each occupies, so two
      // concurrent requests naming the same two players in opposite order
      // can never deadlock against each other.
      const [lowId, highId] = [player_a_id, player_b_id].sort();
      const lowRow = await ensureRatingRow(sql, lowId, season_id);
      const highRow = await ensureRatingRow(sql, highId, season_id);
      const ratingA = player_a_id === lowId ? lowRow : highRow;
      const ratingB = player_a_id === lowId ? highRow : lowRow;

      // Soft idempotency: a byte-identical, non-voided match already
      // recorded for this exact submission is returned as-is (200) rather
      // than duplicated -- guards a lost-response network retry from
      // double-counting the same real-world result. Deliberately checked
      // AFTER the row locks above (not before): two genuinely-concurrent
      // identical requests both take the same two locks, so the second one
      // only proceeds past ensureRatingRow once the first has committed (or
      // rolled back) -- by which point this SELECT will actually see the
      // first request's committed match instead of racing it. Checking
      // before the locks would let both requests pass the check
      // simultaneously and insert two identical matches.
      const [existingMatch] = await sql`
        select id from matches
        where season_id = ${season_id} and match_date = ${match_date}
          and player_a_id = ${player_a_id} and player_b_id = ${player_b_id}
          and frames_a = ${frames_a} and frames_b = ${frames_b} and is_voided = false
      `;
      if (existingMatch) {
        return { matchId: existingMatch.id as string, alreadyExisted: true };
      }

      // Fixture completion is validated here -- after the idempotency check
      // above, so a network retry of an already-completed fixture's request
      // hits the idempotency early-return (the fixture was already marked
      // completed by the first, successful call) rather than this fixture
      // check. Locked FOR UPDATE to close the same race a concurrent
      // duplicate completion attempt could otherwise hit; locking it after
      // the player-row locks above can't deadlock against anything else in
      // this codebase, since no other code path locks a fixtures row and
      // player rows together in a different order.
      if (fixture_id) {
        const [fixture] = await sql`
          select id, status, player_a_id, player_b_id from fixtures where id = ${fixture_id} for update
        `;
        if (!fixture) throw new HttpError(400, 'fixture_id does not reference an existing fixture');
        if (fixture.status !== 'scheduled') {
          throw new HttpError(409, `Fixture is already ${fixture.status}, cannot enter a result for it`);
        }
        const samePair =
          (fixture.player_a_id === player_a_id && fixture.player_b_id === player_b_id) ||
          (fixture.player_a_id === player_b_id && fixture.player_b_id === player_a_id);
        if (!samePair) {
          throw new HttpError(400, 'Submitted players do not match this fixture');
        }
      }

      const winnerId = frames_a > frames_b ? player_a_id : player_b_id;

      const [match] = await sql`
        insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id, entered_by)
        values (${season_id}, ${match_date}, ${player_a_id}, ${player_b_id}, ${frames_a}, ${frames_b}, ${winnerId}, ${admin.id})
        returning id
      `;

      if (fixture_id) {
        await sql`update fixtures set status = 'completed', completed_match_id = ${match.id} where id = ${fixture_id}`;
      }

      const nudge = applyInstantNudge({
        ratingA: ratingA.rating,
        rdA: ratingA.rd,
        ratingB: ratingB.rating,
        rdB: ratingB.rd,
        framesA: frames_a,
        framesB: frames_b,
      });

      await sql`
        insert into rating_events (
          match_id, player_id, season_id, rating_before, rd_before,
          rating_after, rd_after, expected_score, actual_score, delta, event_type
        ) values
          (${match.id}, ${player_a_id}, ${season_id}, ${ratingA.rating}, ${ratingA.rd},
           ${nudge.newRatingA}, ${ratingA.rd}, ${nudge.expectedScoreA}, ${nudge.actualScoreA}, ${nudge.deltaA}, 'instant'),
          (${match.id}, ${player_b_id}, ${season_id}, ${ratingB.rating}, ${ratingB.rd},
           ${nudge.newRatingB}, ${ratingB.rd}, ${1 - nudge.expectedScoreA}, ${1 - nudge.actualScoreA}, ${nudge.deltaB}, 'instant')
      `;

      await updatePlayerAfterMatch(sql, {
        playerId: player_a_id, seasonId: season_id, newRating: nudge.newRatingA,
        priorMatchesPlayed: ratingA.matches_played, priorSeasonPoints: ratingA.season_points,
        won: winnerId === player_a_id, framesFor: frames_a, framesAgainst: frames_b, opponentRating: ratingB.rating,
      });
      await updatePlayerAfterMatch(sql, {
        playerId: player_b_id, seasonId: season_id, newRating: nudge.newRatingB,
        priorMatchesPlayed: ratingB.matches_played, priorSeasonPoints: ratingB.season_points,
        won: winnerId === player_b_id, framesFor: frames_b, framesAgainst: frames_a, opponentRating: ratingA.rating,
      });

      await sql`
        insert into match_audit_log (match_id, changed_by, change_type, new_values)
        values (${match.id}, ${admin.id}, 'created', ${sql.json(body as unknown as Record<string, unknown>)})
      `;

      return { matchId: match.id as string, alreadyExisted: false };
    });

    return jsonResponse({ match_id: result.matchId }, result.alreadyExisted ? 200 : 201);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

If you started `supabase functions serve` in Step 2, it auto-reloads on file changes — no restart needed. If not, start it now.

Run: `npm run test:api -- src/api/fixtures.test.ts`
Expected: PASS (6/6 tests total in this file — the 3 from Task 1 plus these 3).

Also re-run the existing `enter-match` suite to confirm nothing regressed:

Run: `npm run test:api -- src/api/enterMatch.test.ts`
Expected: PASS (7/7 tests, all unchanged).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/enter-match/index.ts src/api/fixtures.test.ts
git commit -m "feat: extend enter-match to atomically complete a fixture"
```

---

### Task 7: `EnterMatchPage` fixture pre-fill, final checks

**Files:**
- Modify: `web/src/lib/edgeFunctions.ts`
- Modify: `web/src/pages/admin/EnterMatch.tsx`
- Modify: `web/src/pages/admin/EnterMatch.test.tsx`

**Interfaces:**
- Consumes: `useFixtures` (Task 2), `queryKeys.fixtures` (Task 2).
- Produces: no new exports — `EnterMatchPage`'s signature is unchanged. It now reads an optional `?fixtureId=` query param, pre-fills the form from that fixture, and passes `fixture_id` through to `enterMatch()`.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `web/src/pages/admin/EnterMatch.test.tsx`:

```tsx
// web/src/pages/admin/EnterMatch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

const mockUseActiveSeason = vi.fn();
vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));

const mockUsePlayers = vi.fn();
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));

const mockUseFixtures = vi.fn();
vi.mock('@/hooks/useFixtures', () => ({ useFixtures: () => mockUseFixtures() }));

const mockEnterMatch = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ enterMatch: (body: unknown) => mockEnterMatch(body) }));

import { EnterMatchPage } from './EnterMatch';

function renderPage(initialPath = '/admin/enter-match') {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <EnterMatchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

describe('EnterMatchPage', () => {
  beforeEach(() => {
    mockEnterMatch.mockReset();
    mockToastSuccess.mockReset();
    mockUseActiveSeason.mockReturnValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer', rating: 1600 },
        { id: 'p2', full_name: 'Jordan Testplayer', rating: 1400 },
      ],
      isLoading: false,
      isError: false,
    });
    mockUseFixtures.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('shows a loading skeleton while the active season or players are still loading', () => {
    mockUsePlayers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Enter Match Result')).not.toBeInTheDocument();
  });

  it('shows an inline error message when the active season or players fail to load', () => {
    mockUseActiveSeason.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText("Couldn't load the match entry form. Try refreshing.")).toBeInTheDocument();
    expect(screen.queryByText('Enter Match Result')).not.toBeInTheDocument();
  });

  it('shows the predicted-odds widget once both players are selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    expect(screen.getByText('Predicted odds')).toBeInTheDocument();
  });

  it('rejects a tied frame score client-side without calling enterMatch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '4');
    await user.type(screen.getByLabelText('Frames B'), '4');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    expect(screen.getByText('Frame scores cannot be tied.')).toBeInTheDocument();
    expect(mockEnterMatch).not.toHaveBeenCalled();
  });

  it('submits a valid match, shows a success toast, and resets the form', async () => {
    mockEnterMatch.mockResolvedValue({ match_id: 'm1' });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(mockEnterMatch).toHaveBeenCalledWith(
        expect.objectContaining({ season_id: 's1', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2 }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Alex Testplayer wins 5–2'));
    await waitFor(() => expect((screen.getByLabelText('Frames A') as HTMLInputElement).value).toBe(''));

    // Regression coverage: a plain (non-fixture) submission must invalidate exactly
    // these six caches, in this order -- unchanged from before fixtures existed.
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.leaderboard('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.gradeDistribution('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: queryKeys.matchHistory('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(4, { queryKey: queryKeys.playerProfile('p1', 's1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(5, { queryKey: queryKeys.playerProfile('p2', 's1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(6, { queryKey: queryKeys.players('s1') });
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockEnterMatch.mockRejectedValue(new Error('new row for relation "matches" violates check constraint'));
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(screen.getByText('new row for relation "matches" violates check constraint')).toBeInTheDocument(),
    );
  });

  it('pre-fills the date and both players from the fixture named in ?fixtureId=, and submits its fixture_id', async () => {
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2026-08-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
          player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    mockEnterMatch.mockResolvedValue({ match_id: 'm1' });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage('/admin/enter-match?fixtureId=f1');

    await waitFor(() => expect(screen.getByLabelText('Player A')).toHaveValue('p1'));
    expect(screen.getByLabelText('Player B')).toHaveValue('p2');
    expect(screen.getByLabelText('Match date')).toHaveValue('2026-08-01');

    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(mockEnterMatch).toHaveBeenCalledWith(expect.objectContaining({ fixture_id: 'f1' })),
    );
    // A fixture-completing submission invalidates the six existing caches
    // plus a seventh, the fixtures list for this season.
    expect(invalidateSpy).toHaveBeenCalledTimes(7);
    expect(invalidateSpy).toHaveBeenNthCalledWith(7, { queryKey: queryKeys.fixtures('s1') });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/EnterMatch.test.tsx`
Expected: FAIL — only the new `'pre-fills the date and both players...'` test fails (the current `EnterMatchPage` has no pre-fill logic and never reads a `fixtureId` query param). Every other test still passes against the current code unmodified.

- [ ] **Step 3: Extend `edgeFunctions.ts`**

Edit `web/src/lib/edgeFunctions.ts` — add the optional field to `EnterMatchBody`:

```ts
export interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
  fixture_id?: string;
}
```

- [ ] **Step 4: Add pre-fill and conditional invalidation to `EnterMatchPage`**

Replace the full contents of `web/src/pages/admin/EnterMatch.tsx`:

```tsx
// web/src/pages/admin/EnterMatch.tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { OddsWidget } from '@/components/OddsWidget';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers } from '@/hooks/usePlayers';
import { useFixtures } from '@/hooks/useFixtures';
import { enterMatch } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function EnterMatchPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);
  const fixtures = useFixtures(activeSeason.data?.id);
  const [searchParams] = useSearchParams();
  const fixtureId = searchParams.get('fixtureId') ?? undefined;
  const fixture = fixtureId ? fixtures.data?.find((f) => f.id === fixtureId) : undefined;

  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [playerAId, setPlayerAId] = useState('');
  const [playerBId, setPlayerBId] = useState('');
  const [framesA, setFramesA] = useState('');
  const [framesB, setFramesB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-fill exactly once when the named fixture becomes available -- guarded
  // so a later background refetch of the fixtures list (e.g. on window focus)
  // can't silently reset an admin's in-progress edits back to the fixture's
  // original values.
  const hasPrefilledRef = useRef(false);
  useEffect(() => {
    if (fixture && !hasPrefilledRef.current) {
      hasPrefilledRef.current = true;
      setMatchDate(fixture.scheduled_date);
      setPlayerAId(fixture.player_a.id);
      setPlayerBId(fixture.player_b.id);
    }
  }, [fixture]);

  const playerA = players.data?.find((p) => p.id === playerAId);
  const playerB = players.data?.find((p) => p.id === playerBId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!playerAId || !playerBId) {
      setError('Select both players.');
      return;
    }
    if (playerAId === playerBId) {
      setError('Player A and Player B must be different.');
      return;
    }

    const parsedFramesA = Number(framesA);
    const parsedFramesB = Number(framesB);
    if (Number.isNaN(parsedFramesA) || Number.isNaN(parsedFramesB)) {
      setError('Frames must be numbers.');
      return;
    }
    if (parsedFramesA === parsedFramesB) {
      setError('Frame scores cannot be tied.');
      return;
    }
    if (!activeSeason.data) {
      setError('No active season.');
      return;
    }

    setIsSubmitting(true);
    try {
      await enterMatch({
        season_id: activeSeason.data.id,
        match_date: matchDate,
        player_a_id: playerAId,
        player_b_id: playerBId,
        frames_a: parsedFramesA,
        frames_b: parsedFramesB,
        ...(fixtureId ? { fixture_id: fixtureId } : {}),
      });

      const winnerName = parsedFramesA > parsedFramesB ? playerA?.full_name : playerB?.full_name;
      const winnerFrames = Math.max(parsedFramesA, parsedFramesB);
      const loserFrames = Math.min(parsedFramesA, parsedFramesB);
      toast.success(`${winnerName} wins ${winnerFrames}–${loserFrames}`);

      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(playerAId, activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(playerBId, activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.players(activeSeason.data.id) });
      if (fixtureId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(activeSeason.data.id) });
      }

      setPlayerAId('');
      setPlayerBId('');
      setFramesA('');
      setFramesB('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to record match.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (activeSeason.isLoading || players.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || players.isError) {
    return <p className="text-destructive">Couldn't load the match entry form. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Enter Match Result</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="matchDate">Match date</Label>
          <Input
            id="matchDate"
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="playerA">Player A</Label>
          <select
            id="playerA"
            value={playerAId}
            onChange={(e) => setPlayerAId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player A</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="playerB">Player B</Label>
          <select
            id="playerB"
            value={playerBId}
            onChange={(e) => setPlayerBId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player B</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>

        {playerA && playerB && (
          <OddsWidget
            playerARating={playerA.rating}
            playerBRating={playerB.rating}
            playerAName={playerA.full_name}
            playerBName={playerB.full_name}
          />
        )}

        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="framesA">Frames A</Label>
            <Input
              id="framesA"
              type="number"
              min={0}
              value={framesA}
              onChange={(e) => setFramesA(e.target.value)}
              required
            />
          </div>
          <span className="pb-2">–</span>
          <div>
            <Label htmlFor="framesB">Frames B</Label>
            <Input
              id="framesB"
              type="number"
              min={0}
              value={framesB}
              onChange={(e) => setFramesB(e.target.value)}
              required
            />
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? 'Submitting…' : 'Submit Match'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/EnterMatch.test.tsx`
Expected: PASS (8/8 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/edgeFunctions.ts web/src/pages/admin/EnterMatch.tsx web/src/pages/admin/EnterMatch.test.tsx
git commit -m "feat: pre-fill Enter Match from a fixture and complete it atomically"
```

- [ ] **Step 7: Run the full test suite (frontend, unit, integration, api) and the TypeScript build check**

This plan touches the backend for the first time this session — the full check now spans more than the frontend suite.

If the local Supabase stack isn't already running: `npx supabase start` (from repo root). If `supabase functions serve` isn't already running with current code: start it (needed for the `src/api` suite). Docker health-check timing is tight on this machine — if a container reports unhealthy despite clean logs, it's often worth one retry before treating it as broken (per this repo's own documented experience).

Run (from repo root): `npm test`
Expected: All of `test:unit`, `test:integration`, and `test:api` pass. This branch added one new table (`fixtures`), one new `src/api` test file, and extended `enter-match` — every test across all three suites must still be green.

Run: `cd web && npm test`
Expected: All test files pass (this branch adds/modifies 7 hook/component/page test files across Tasks 2-7).

Run: `cd web && npx tsc -b`
Expected: No output, exit code 0.

If any command reports a failure, fix it directly before considering this task complete. If a failure looks flaky rather than real (a single `src/api` test timing out under load, a Docker health-check blip), re-run that one file alone before concluding it's a genuine regression, per this repo's own documented testing discipline.

- [ ] **Step 8: Commit any fixes from Step 7, if needed**

Only run this if Step 7 required changes:

```bash
git add -A
git commit -m "fix: address full-suite/tsc-b findings from fixtures scheduling final check"
```
