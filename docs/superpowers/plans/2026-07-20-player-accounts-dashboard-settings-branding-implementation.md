# Player Accounts, Dashboard, Settings & Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public player-signup/admin-approved account-linking system, a role-aware `/dashboard` and `/settings`, and the "Crossed Cues" brand logo, per `docs/superpowers/specs/2026-07-20-player-accounts-dashboard-settings-branding-design.md`.

**Architecture:** Two new tables (`user_profiles`, `player_claims`) additive to the existing schema — `admin_users`/`requireAdmin()` untouched. A Postgres trigger on `auth.users` auto-provisions a `user_profiles` row for every signup. A 5th Edge Function (`review-player-claim`) is the one transactional write (admin approve/reject). Everything else — claim submission, photo self-service, password/email changes — is a direct RLS-gated client write, mirroring the existing photo-upload feature's precedent. Frontend: `/login`, `/signup`, `/forgot-password`, `/reset-password` (renamed from `/admin/...`), a new `AuthRouteGuard` (any session) guarding `/dashboard` and `/settings`, and a `TopNav` account menu.

**Tech Stack:** Same as the rest of this repo — Deno Edge Functions + `postgres.js` transactions (backend), React 18 + TanStack Query v5 + React Router v6 + Tailwind + shadcn/ui (frontend), Vitest everywhere.

## Global Constraints

- `admin_users` and `requireAdmin()` are never modified in shape or semantics — every new table/policy is additive.
- No table in this schema uses `ON DELETE CASCADE` (existing, deliberate convention — see `src/api/testSupport.ts`'s comment on `cleanupSeasonData`); all test cleanup is explicit, FK-safe, ordered.
- Every `numeric` column read via `postgres.js` must be coerced with `Number(...)` before arithmetic — not applicable to this feature's new tables (no `numeric` columns), but any code touching existing rating tables must still follow it.
- Every new TanStack Query key goes through `web/src/lib/queryKeys.ts` — no inline literal key arrays.
- Errors surface verbatim to the client everywhere (existing convention) — never catch-and-reword.
- Migrations are append-only — this feature is one new migration file, never edits to an existing one.
- `supabase/functions/_shared/rating/**` is a generated, hand-off-limits copy of `src/rating/**` — this feature touches neither.

---

### Task 1: Player-accounts schema & RLS foundation

**Files:**
- Create: `supabase/migrations/20260720000000_player_accounts.sql`
- Modify: `src/db/schema.test.ts`
- Modify: `src/db/rls.test.ts`
- Modify: `src/api/testSupport.ts`
- Create: `src/api/userAccounts.test.ts`

**Interfaces:**
- Produces: tables `user_profiles(id, linked_player_id, created_at, updated_at)`, `player_claims(id, user_id, player_id, status, created_at, reviewed_by, reviewed_at)`; a `public.handle_new_user()` trigger function wired to `auth.users` that inserts an unlinked `user_profiles` row on every signup; RLS policies `"self read user_profiles"`, `"self read own claims"`, `"admin read all claims"`, `"self insert own claim"`, `"linked player update own photo"` (on `players`), `"self update admin_users"`; storage policies `"linked player insert/update/delete own photo"`.
- Produces (test helpers, `src/api/testSupport.ts`): `provisionTestUser(status): Promise<TestAdmin>` (reuses the existing `TestAdmin` shape — `{ userId, accessToken }` — for a plain, non-admin signed-up account), `cleanupTestUser(status, userId): Promise<void>`.
- Modifies: `cleanupTestAdmin` now also deletes the `user_profiles` row the new trigger creates, before deleting the auth user — every existing `src/api/*.test.ts` file's `afterAll` keeps working unchanged, but will start failing on a foreign-key violation without this fix (the trigger this task adds makes `provisionTestAdmin` create a `user_profiles` row that nothing previously deleted).

- [ ] **Step 1: Write the failing schema test**

  In `src/db/schema.test.ts`, update the `'creates all required tables'` test's expected list:

  ```ts
      expect(tableNames).toEqual(
        [
          'admin_users',
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

- [ ] **Step 2: Write the failing RLS tests**

  In `src/db/rls.test.ts`, update both hardcoded lists in the `'row level security'` describe block:

  ```ts
    it('enables RLS on all 11 tables', async () => {
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
        `select tablename from pg_policies where schemaname = $1 and cmd = 'SELECT' order by tablename`,
        [schemaName],
      );
      const tableNames = result.rows.map((r: { tablename: string }) => r.tablename);
      expect(tableNames).toEqual(
        [
          'admin_users',
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

  (Renamed from `'enables RLS on all 9 tables'` / `'grants a select policy on every publicly-readable table'` — the numbers and the second title change because `user_profiles`/`player_claims` are self-readable, not public.)

- [ ] **Step 3: Run the tests, confirm they fail**

  ```
  cd "web/.." && npm test -- src/db/schema.test.ts src/db/rls.test.ts
  ```

  Expected: both fail — the new table names aren't in the actual list yet.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260720000000_player_accounts.sql`:

  ```sql
  -- supabase/migrations/20260720000000_player_accounts.sql
  --
  -- Public player-signup and admin-approved account-linking:
  -- 1. user_profiles: one row per signed-up auth account, holding an optional
  --    link to a `players` row. Auto-created by a trigger on auth.users insert.
  -- 2. player_claims: a user's request to link their account to a player,
  --    reviewed (approved/rejected) by an admin via the review-player-claim
  --    Edge Function (added in Task 2 of this feature's implementation plan).
  -- 3. Linked players get a self-service photo-write RLS policy, mirroring the
  --    existing admin-only one from 20260719000000_player_photos.sql.
  -- 4. Admins can now update their own admin_users.display_name (previously
  --    read-only).
  --
  -- IMPORTANT (see src/db/applyMigrations.ts's own warning about the `auth`
  -- schema): this migration attaches a trigger to the real, shared
  -- `auth.users` table. Every src/db test run re-applies every migration
  -- file against a fresh scratch SCHEMA (never a scratch DATABASE --
  -- Supabase Cloud only has the one), but `auth.users` itself is NOT
  -- schema-scoped -- there is exactly one, shared by every scratch schema
  -- and the real `public` schema alike. If the trigger function or its
  -- INSERT target were left unqualified (as every other object in this
  -- migration deliberately is, so it resolves via `search_path` into
  -- whichever scratch schema is active), CREATE FUNCTION would obey
  -- `search_path` too and the shared trigger would end up pointing at a
  -- function living inside a scratch schema -- one that a later
  -- `drop schema ... cascade` (see src/db/scratchSchema.ts) deletes,
  -- cascade-dropping the trigger along with it and silently breaking real
  -- signups against the live cloud project between test runs. The function
  -- and its INSERT target are therefore explicitly qualified to `public` --
  -- never left to resolve via search_path -- so every src/db test run
  -- harmlessly re-installs the exact same real trigger pointing at the
  -- exact same real function, no matter which scratch schema is active.

  create table user_profiles (
    id uuid primary key references auth.users(id),
    linked_player_id uuid references players(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create trigger user_profiles_set_updated_at before update on user_profiles
    for each row execute function set_updated_at();

  create or replace function public.handle_new_user() returns trigger
    language plpgsql security definer as $$
  begin
    insert into public.user_profiles (id) values (new.id);
    return new;
  end;
  $$;

  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

  create table player_claims (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id),
    player_id uuid not null references players(id),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    reviewed_by uuid references admin_users(id),
    reviewed_at timestamptz
  );

  create index player_claims_player_idx on player_claims (player_id);
  create index player_claims_user_idx on player_claims (user_id);

  alter table user_profiles enable row level security;
  create policy "self read user_profiles" on user_profiles for select using (auth.uid() = id);
  grant select on user_profiles to authenticated;

  alter table player_claims enable row level security;
  create policy "self read own claims" on player_claims for select using (auth.uid() = user_id);
  create policy "admin read all claims" on player_claims for select
    using (exists (select 1 from admin_users a where a.id = auth.uid()));
  create policy "self insert own claim" on player_claims for insert
    with check (auth.uid() = user_id and status = 'pending');
  grant select, insert on player_claims to authenticated;

  -- Linked-player self-service photo write, additive alongside the existing
  -- admin-only "admin update players" policy from 20260719000000_player_photos.sql
  -- (multiple permissive policies for the same command are OR'd together --
  -- an admin OR a linked player satisfies at least one, either is allowed).
  create policy "linked player update own photo" on players
    for update
    using (exists (select 1 from user_profiles up where up.id = auth.uid() and up.linked_player_id = players.id))
    with check (exists (select 1 from user_profiles up where up.id = auth.uid() and up.linked_player_id = players.id));

  create policy "self update admin_users" on admin_users
    for update using (auth.uid() = id) with check (auth.uid() = id);
  grant update (display_name) on admin_users to authenticated;

  -- Storage: linked-player self-service photo write, mirroring the existing
  -- admin-only storage policies exactly. Skipped when the storage schema
  -- isn't installed (self-host stack), matching 20260719000000_player_photos.sql.
  do $$
  begin
    if to_regclass('storage.buckets') is null then
      raise notice 'storage schema not present; skipping player photo self-service storage policies';
      return;
    end if;

    drop policy if exists "linked player insert own photo" on storage.objects;
    create policy "linked player insert own photo" on storage.objects
      for insert
      with check (
        bucket_id = 'player-photos'
        and exists (
          select 1 from user_profiles up
          where up.id = auth.uid() and name like (up.linked_player_id::text || '-%')
        )
      );

    drop policy if exists "linked player update own photo storage" on storage.objects;
    create policy "linked player update own photo storage" on storage.objects
      for update
      using (
        bucket_id = 'player-photos'
        and exists (
          select 1 from user_profiles up
          where up.id = auth.uid() and name like (up.linked_player_id::text || '-%')
        )
      );

    drop policy if exists "linked player delete own photo" on storage.objects;
    create policy "linked player delete own photo" on storage.objects
      for delete
      using (
        bucket_id = 'player-photos'
        and exists (
          select 1 from user_profiles up
          where up.id = auth.uid() and name like (up.linked_player_id::text || '-%')
        )
      );
  end
  $$;
  ```

- [ ] **Step 5: Run the schema/RLS tests again, confirm they pass**

  ```
  npm test -- src/db/schema.test.ts src/db/rls.test.ts
  ```

  Expected: PASS.

- [ ] **Step 6: Fix `cleanupTestAdmin` and add the plain-user test helpers**

  In `src/api/testSupport.ts`, modify `cleanupTestAdmin`:

  ```ts
  export async function cleanupTestAdmin(status: SupabaseStatus, userId: string): Promise<void> {
    const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);
    const { error: adminDeleteError } = await serviceClient.from('admin_users').delete().eq('id', userId);
    if (adminDeleteError) {
      throw new Error(`Failed to delete admin_users row for ${userId}: ${adminDeleteError.message}`);
    }
    const { error: profileDeleteError } = await serviceClient.from('user_profiles').delete().eq('id', userId);
    if (profileDeleteError) {
      throw new Error(`Failed to delete user_profiles row for ${userId}: ${profileDeleteError.message}`);
    }
    const { error } = await serviceClient.auth.admin.deleteUser(userId);
    if (error) {
      throw new Error(`Failed to delete test admin auth user ${userId}: ${error.message}`);
    }
  }
  ```

  Then add, below it:

  ```ts
  // A plain signed-up account, no admin_users row -- the on_auth_user_created
  // trigger (20260720000000_player_accounts.sql) still gives it a
  // user_profiles row automatically, same as provisionTestAdmin's account.
  export async function provisionTestUser(status: SupabaseStatus): Promise<TestAdmin> {
    const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

    const email = `test-user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const password = 'test-password-123!';

    const { data: userData, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !userData.user) {
      throw new Error(`Failed to create test user: ${createError?.message}`);
    }

    const anonClient = createClient(status.API_URL, status.ANON_KEY);
    const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !sessionData.session) {
      throw new Error(`Failed to sign in test user: ${signInError?.message}`);
    }

    return { userId: userData.user.id, accessToken: sessionData.session.access_token };
  }

  // FK-safe order: player_claims references both auth.users and players,
  // so it must go before either is touched; user_profiles before the auth
  // user itself, same reasoning as cleanupTestAdmin above.
  export async function cleanupTestUser(status: SupabaseStatus, userId: string): Promise<void> {
    const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);
    const { error: claimsDeleteError } = await serviceClient.from('player_claims').delete().eq('user_id', userId);
    if (claimsDeleteError) {
      throw new Error(`Failed to delete player_claims rows for ${userId}: ${claimsDeleteError.message}`);
    }
    const { error: profileDeleteError } = await serviceClient.from('user_profiles').delete().eq('id', userId);
    if (profileDeleteError) {
      throw new Error(`Failed to delete user_profiles row for ${userId}: ${profileDeleteError.message}`);
    }
    const { error } = await serviceClient.auth.admin.deleteUser(userId);
    if (error) {
      throw new Error(`Failed to delete test user auth user ${userId}: ${error.message}`);
    }
  }
  ```

- [ ] **Step 7: Run the full `src/api` suite to confirm the `cleanupTestAdmin` fix doesn't break anything existing**

  ```
  npm test -- src/api
  ```

  Expected: PASS (every existing `*.test.ts` file's `afterAll` now also deletes the `user_profiles` row the trigger creates; this must be run for real against the shared cloud project, so it also proves the trigger itself fires correctly for every existing test admin).

- [ ] **Step 8: Write the new account/RLS behavior tests**

  Create `src/api/userAccounts.test.ts`:

  ```ts
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
    type SupabaseStatus,
    type TestAdmin,
  } from './testSupport';

  let status: SupabaseStatus;
  let dbClient: Client;
  const createdPlayerIds: string[] = [];
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

  beforeAll(async () => {
    status = getSupabaseStatus();
    dbClient = new Client({ connectionString: status.DB_URL });
    await dbClient.connect();
  }, 30000);

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await cleanupTestUser(status, userId);
    }
    await deletePlayers(dbClient, createdPlayerIds);
    await dbClient.end();
  }, 30000);

  describe('signup trigger', () => {
    it('creates an unlinked user_profiles row automatically for a new signup', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);

      const row = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [user.userId]);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].linked_player_id).toBeNull();
    });
  });

  describe('user_profiles RLS', () => {
    it('lets a user read only their own profile row, not another user\'s', async () => {
      const userA = await provisionTestUser(status);
      createdUserIds.push(userA.userId);
      const userB = await provisionTestUser(status);
      createdUserIds.push(userB.userId);

      const clientA = asUser(userA.accessToken);
      const ownRow = await clientA.from('user_profiles').select('id').eq('id', userA.userId).maybeSingle();
      expect(ownRow.data).not.toBeNull();

      const otherRow = await clientA.from('user_profiles').select('id').eq('id', userB.userId).maybeSingle();
      expect(otherRow.data).toBeNull();
    });
  });

  describe('player_claims RLS', () => {
    it('lets a user insert only their own pending claim', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);
      const otherUser = await provisionTestUser(status);
      createdUserIds.push(otherUser.userId);
      const playerId = await createPlayer('RLS Claim Player');

      const client = asUser(user.accessToken);
      const ownInsert = await client.from('player_claims').insert({ user_id: user.userId, player_id: playerId });
      expect(ownInsert.error).toBeNull();

      const spoofedInsert = await client
        .from('player_claims')
        .insert({ user_id: otherUser.userId, player_id: playerId });
      expect(spoofedInsert.error).not.toBeNull();
    });

    it('lets a user read only their own claims; lets an admin read all pending claims', async () => {
      const admin = await provisionTestAdmin(status);
      const userA = await provisionTestUser(status);
      createdUserIds.push(userA.userId);
      const userB = await provisionTestUser(status);
      createdUserIds.push(userB.userId);
      const playerA = await createPlayer('Claims Visibility Player A');
      const playerB = await createPlayer('Claims Visibility Player B');

      await dbClient.query(`insert into player_claims (user_id, player_id) values ($1, $2)`, [
        userA.userId,
        playerA,
      ]);
      await dbClient.query(`insert into player_claims (user_id, player_id) values ($1, $2)`, [
        userB.userId,
        playerB,
      ]);

      const clientA = asUser(userA.accessToken);
      const ownClaims = await clientA.from('player_claims').select('id, user_id');
      expect(ownClaims.data).toHaveLength(1);
      expect(ownClaims.data?.[0].user_id).toBe(userA.userId);

      const adminClient = asUser(admin.accessToken);
      const allClaims = await adminClient
        .from('player_claims')
        .select('id')
        .in('player_id', [playerA, playerB]);
      expect(allClaims.data).toHaveLength(2);

      await cleanupTestAdmin(status, admin.userId);
    });
  });

  describe('linked-player photo self-service RLS', () => {
    it('lets a linked player update only their own player\'s photo_url', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);
      const ownPlayerId = await createPlayer('Linked Photo Player');
      const otherPlayerId = await createPlayer('Other Photo Player');

      // Link directly via service role for this test's setup -- the approval
      // workflow itself (review-player-claim) is covered in Task 2.
      await dbClient.query(`update user_profiles set linked_player_id = $1 where id = $2`, [
        ownPlayerId,
        user.userId,
      ]);

      const client = asUser(user.accessToken);
      const ownUpdate = await client
        .from('players')
        .update({ photo_url: 'https://example.com/own.jpg' })
        .eq('id', ownPlayerId)
        .select();
      expect(ownUpdate.data).toHaveLength(1);

      const otherUpdate = await client
        .from('players')
        .update({ photo_url: 'https://example.com/other.jpg' })
        .eq('id', otherPlayerId)
        .select();
      expect(otherUpdate.data).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 9: Run the new test file**

  ```
  npm test -- src/api/userAccounts.test.ts
  ```

  Expected: PASS.

- [ ] **Step 10: Commit**

  ```bash
  git add supabase/migrations/20260720000000_player_accounts.sql src/db/schema.test.ts src/db/rls.test.ts src/api/testSupport.ts src/api/userAccounts.test.ts
  git commit -m "feat: add user_profiles/player_claims schema, RLS, and signup trigger"
  ```

---

### Task 2: `review-player-claim` Edge Function

**Files:**
- Create: `supabase/functions/review-player-claim/index.ts`
- Create: `src/api/reviewPlayerClaim.test.ts`

**Interfaces:**
- Consumes: `withTransaction` from `supabase/functions/_shared/dbTransaction.ts`; `requireAdmin`, `createAuthedClient`, `createServiceRoleClient` from `_shared`; `isUuid` from `_shared/validation.ts`; `provisionTestAdmin`/`cleanupTestAdmin`/`provisionTestUser`/`cleanupTestUser`/`deletePlayers`/`getSupabaseStatus` from `src/api/testSupport.ts` (Task 1).
- Produces: `POST /functions/v1/review-player-claim` — body `{ claim_id: string, decision: 'approve' | 'reject' }`, response `{ claim_id: string, status: 'approved' | 'rejected' }` (200), `{ error: string }` (400/401/404).

- [ ] **Step 1: Write the failing test**

  Create `src/api/reviewPlayerClaim.test.ts`:

  ```ts
  import { beforeAll, afterAll, describe, it, expect } from 'vitest';
  import { Client } from 'pg';
  import {
    getSupabaseStatus,
    provisionTestAdmin,
    cleanupTestAdmin,
    provisionTestUser,
    cleanupTestUser,
    deletePlayers,
    type SupabaseStatus,
    type TestAdmin,
  } from './testSupport';

  let status: SupabaseStatus;
  let admin: TestAdmin;
  let dbClient: Client;
  const createdPlayerIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createPlayer(name: string): Promise<string> {
    const result = await dbClient.query(`insert into players (full_name) values ($1) returning id`, [name]);
    const id = result.rows[0].id;
    createdPlayerIds.push(id);
    return id;
  }

  async function submitClaim(userId: string, playerId: string): Promise<string> {
    const result = await dbClient.query(
      `insert into player_claims (user_id, player_id) values ($1, $2) returning id`,
      [userId, playerId],
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    status = getSupabaseStatus();
    admin = await provisionTestAdmin(status);
    dbClient = new Client({ connectionString: status.DB_URL });
    await dbClient.connect();
  }, 30000);

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await cleanupTestUser(status, userId);
    }
    await deletePlayers(dbClient, createdPlayerIds);
    await cleanupTestAdmin(status, admin.userId);
    await dbClient.end();
  }, 30000);

  describe('POST /functions/v1/review-player-claim', () => {
    it('approves a claim and links the player to the account', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);
      const playerId = await createPlayer('Claimant Player');
      const claimId = await submitClaim(user.userId, playerId);

      const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, decision: 'approve' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ claim_id: claimId, status: 'approved' });

      const profile = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
        user.userId,
      ]);
      expect(profile.rows[0].linked_player_id).toBe(playerId);

      const claim = await dbClient.query(`select status, reviewed_by from player_claims where id = $1`, [claimId]);
      expect(claim.rows[0].status).toBe('approved');
      expect(claim.rows[0].reviewed_by).toBe(admin.userId);
    });

    it('auto-rejects other pending claims on the same player when one is approved', async () => {
      const userA = await provisionTestUser(status);
      createdUserIds.push(userA.userId);
      const userB = await provisionTestUser(status);
      createdUserIds.push(userB.userId);
      const playerId = await createPlayer('Contested Player');
      const claimA = await submitClaim(userA.userId, playerId);
      const claimB = await submitClaim(userB.userId, playerId);

      const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimA, decision: 'approve' }),
      });
      expect(response.status).toBe(200);

      const claimBRow = await dbClient.query(`select status from player_claims where id = $1`, [claimB]);
      expect(claimBRow.rows[0].status).toBe('rejected');

      const profileB = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
        userB.userId,
      ]);
      expect(profileB.rows[0].linked_player_id).toBeNull();
    });

    it('rejects a claim without linking the player', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);
      const playerId = await createPlayer('Rejected Claimant Player');
      const claimId = await submitClaim(user.userId, playerId);

      const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, decision: 'reject' }),
      });
      expect(response.status).toBe(200);

      const profile = await dbClient.query(`select linked_player_id from user_profiles where id = $1`, [
        user.userId,
      ]);
      expect(profile.rows[0].linked_player_id).toBeNull();
      const claim = await dbClient.query(`select status from player_claims where id = $1`, [claimId]);
      expect(claim.rows[0].status).toBe('rejected');
    });

    it('rejects reviewing an already-decided claim', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);
      const playerId = await createPlayer('Double Reviewed Player');
      const claimId = await submitClaim(user.userId, playerId);

      await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, decision: 'approve' }),
      });

      const secondResponse = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, decision: 'reject' }),
      });
      expect(secondResponse.status).toBe(400);
    });

    it('rejects a non-admin caller', async () => {
      const user = await provisionTestUser(status);
      createdUserIds.push(user.userId);
      const playerId = await createPlayer('Unauthorized Reviewer Player');
      const claimId = await submitClaim(user.userId, playerId);

      const response = await fetch(`${status.API_URL}/functions/v1/review-player-claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, decision: 'approve' }),
      });
      expect(response.status).toBe(401);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm every test fails**

  ```
  npm test -- src/api/reviewPlayerClaim.test.ts
  ```

  Expected: every request fails (connection refused / 404) — the function doesn't exist yet. Make sure `supabase functions serve` (or the deployed cloud function set) is running for whichever backend this repo's `src/api` suite is currently pointed at, per `CLAUDE.md`'s testing-discipline note.

- [ ] **Step 3: Write the Edge Function**

  Create `supabase/functions/review-player-claim/index.ts`:

  ```ts
  // supabase/functions/review-player-claim/index.ts
  import { createAuthedClient, createServiceRoleClient } from '../_shared/supabaseClients.ts';
  import { requireAdmin } from '../_shared/requireAdmin.ts';
  import { jsonResponse } from '../_shared/response.ts';
  import { withTransaction } from '../_shared/dbTransaction.ts';
  import { HttpError } from '../_shared/httpError.ts';
  import { isUuid } from '../_shared/validation.ts';

  interface ReviewPlayerClaimBody {
    claim_id: string;
    decision: 'approve' | 'reject';
  }

  Deno.serve(async (req: Request) => {
    const authedClient = createAuthedClient(req);
    const db = createServiceRoleClient();
    const admin = await requireAdmin(authedClient, db);
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

    let body: ReviewPlayerClaimBody;
    try {
      body = (await req.json()) as ReviewPlayerClaimBody;
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
    }

    if (!isUuid(body.claim_id)) {
      return jsonResponse({ error: 'claim_id must be a valid UUID' }, 400);
    }
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      return jsonResponse({ error: "decision must be 'approve' or 'reject'" }, 400);
    }

    try {
      await withTransaction(async (sql) => {
        // Lock the target claim row before re-checking its status -- if two
        // reviews of the same claim raced, only the first to acquire this
        // lock proceeds; the second sees the now-committed 'approved'/
        // 'rejected' status and errors instead of double-processing.
        const [claim] = await sql`
          select id, user_id, player_id, status from player_claims where id = ${body.claim_id} for update
        `;
        if (!claim) throw new HttpError(404, 'Claim not found');
        if (claim.status !== 'pending') {
          throw new HttpError(400, 'This claim has already been reviewed');
        }

        const newStatus = body.decision === 'approve' ? 'approved' : 'rejected';
        await sql`
          update player_claims set status = ${newStatus}, reviewed_by = ${admin.id}, reviewed_at = now()
          where id = ${body.claim_id}
        `;

        if (body.decision === 'approve') {
          await sql`
            update user_profiles set linked_player_id = ${claim.player_id}
            where id = ${claim.user_id}
          `;

          // A player row can only ever be linked to one account -- auto-reject
          // any other still-pending claim on this same player so the admin
          // never has to clean those up by hand.
          await sql`
            update player_claims set status = 'rejected', reviewed_by = ${admin.id}, reviewed_at = now()
            where player_id = ${claim.player_id} and status = 'pending' and id <> ${body.claim_id}
          `;
        }
      });

      return jsonResponse(
        { claim_id: body.claim_id, status: body.decision === 'approve' ? 'approved' : 'rejected' },
        200,
      );
    } catch (err) {
      if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status);
      return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
    }
  });
  ```

- [ ] **Step 4: Deploy/serve the function locally per this repo's normal workflow, then run the test again**

  ```
  npm test -- src/api/reviewPlayerClaim.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/review-player-claim/index.ts src/api/reviewPlayerClaim.test.ts
  git commit -m "feat: add review-player-claim edge function"
  ```

---

### Task 3: Frontend types, query keys, and account hooks

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/queryKeys.ts`
- Create: `web/src/hooks/useUserProfile.ts`
- Create: `web/src/hooks/useUserProfile.test.tsx`
- Create: `web/src/hooks/usePendingClaims.ts`
- Create: `web/src/hooks/usePendingClaims.test.tsx`
- Create: `web/src/hooks/useSubmitPlayerClaim.ts`
- Create: `web/src/hooks/useSubmitPlayerClaim.test.tsx`

**Interfaces:**
- Consumes: `queryKeys` from `web/src/lib/queryKeys.ts`; `supabase` from `web/src/lib/supabaseClient.ts`; `PlayerOption` shape from `usePlayers.ts` (unchanged).
- Produces: `queryKeys.userProfile(userId: string)`, `queryKeys.pendingClaims()`; types `ClaimStatus`, `PlayerClaim`; hook `useUserProfile(userId: string | undefined)` returning a query of `{ linkedPlayerId: string | null; pendingClaim: PlayerClaim | null }`; hook `usePendingClaims()` returning a query of `PendingClaimWithPlayer[]` (`{ id, user_id, player_id, player_name, created_at }`); hook `useSubmitPlayerClaim()` returning a TanStack `useMutation` accepting `{ userId: string; playerId: string }`.

- [ ] **Step 1: Add the new types**

  In `web/src/lib/types.ts`, append:

  ```ts
  export type ClaimStatus = 'pending' | 'approved' | 'rejected';

  export interface PlayerClaim {
    id: string;
    user_id: string;
    player_id: string;
    status: ClaimStatus;
    created_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
  }
  ```

- [ ] **Step 2: Add the two new query keys**

  In `web/src/lib/queryKeys.ts`, add to the `queryKeys` object:

  ```ts
    userProfile: (userId: string) => ['userProfile', userId] as const,
    pendingClaims: () => ['pendingClaims'] as const,
  ```

- [ ] **Step 3: Write the failing test for `useUserProfile`**

  Create `web/src/hooks/useUserProfile.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { renderHook, waitFor } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import type { ReactNode } from 'react';

  const mockProfileSingle = vi.fn();
  const mockClaimMaybeSingle = vi.fn();

  vi.mock('@/lib/supabaseClient', () => ({
    supabase: {
      from: (table: string) => {
        if (table === 'user_profiles') {
          return { select: () => ({ eq: () => ({ single: mockProfileSingle }) }) };
        }
        if (table === 'player_claims') {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockClaimMaybeSingle }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  }));

  import { useUserProfile } from './useUserProfile';

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  describe('useUserProfile', () => {
    beforeEach(() => {
      mockProfileSingle.mockReset();
      mockClaimMaybeSingle.mockReset();
    });

    it('returns the linked player id and any pending claim', async () => {
      mockProfileSingle.mockResolvedValue({ data: { linked_player_id: 'p1' }, error: null });
      mockClaimMaybeSingle.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useUserProfile('u1'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({ linkedPlayerId: 'p1', pendingClaim: null });
    });

    it('does not run when userId is undefined', () => {
      const { result } = renderHook(() => useUserProfile(undefined), { wrapper });
      expect(result.current.fetchStatus).toBe('idle');
    });
  });
  ```

- [ ] **Step 4: Run it, confirm it fails**

  ```
  cd web && npm test -- src/hooks/useUserProfile.test.tsx
  ```

  Expected: FAIL — `./useUserProfile` module not found.

- [ ] **Step 5: Implement `useUserProfile`**

  Create `web/src/hooks/useUserProfile.ts`:

  ```ts
  // web/src/hooks/useUserProfile.ts
  import { useQuery } from '@tanstack/react-query';
  import { supabase } from '@/lib/supabaseClient';
  import { queryKeys } from '@/lib/queryKeys';
  import type { PlayerClaim } from '@/lib/types';

  export interface UserAccountState {
    linkedPlayerId: string | null;
    pendingClaim: PlayerClaim | null;
  }

  export function useUserProfile(userId: string | undefined) {
    return useQuery({
      queryKey: queryKeys.userProfile(userId ?? ''),
      queryFn: async (): Promise<UserAccountState> => {
        const [profileRes, claimRes] = await Promise.all([
          supabase.from('user_profiles').select('linked_player_id').eq('id', userId as string).single(),
          supabase
            .from('player_claims')
            .select('*')
            .eq('user_id', userId as string)
            .eq('status', 'pending')
            .maybeSingle(),
        ]);
        if (profileRes.error) throw profileRes.error;
        if (claimRes.error) throw claimRes.error;

        return {
          linkedPlayerId: (profileRes.data as { linked_player_id: string | null }).linked_player_id,
          pendingClaim: claimRes.data as PlayerClaim | null,
        };
      },
      enabled: userId !== undefined,
    });
  }
  ```

- [ ] **Step 6: Run it again, confirm it passes**

  ```
  npm test -- src/hooks/useUserProfile.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 7: Write the failing test for `usePendingClaims`**

  Create `web/src/hooks/usePendingClaims.test.tsx`:

  ```tsx
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

  import { usePendingClaims } from './usePendingClaims';

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  describe('usePendingClaims', () => {
    beforeEach(() => {
      mockOrder.mockReset();
    });

    it('maps joined player names onto each pending claim', async () => {
      mockOrder.mockResolvedValue({
        data: [
          { id: 'c1', user_id: 'u1', created_at: '2026-07-20', player_id: 'p1', players: { full_name: 'Alex' } },
        ],
        error: null,
      });

      const { result } = renderHook(() => usePendingClaims(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([
        { id: 'c1', user_id: 'u1', created_at: '2026-07-20', player_id: 'p1', player_name: 'Alex' },
      ]);
    });
  });
  ```

- [ ] **Step 8: Run it, confirm it fails, then implement `usePendingClaims`**

  Create `web/src/hooks/usePendingClaims.ts`:

  ```ts
  // web/src/hooks/usePendingClaims.ts
  import { useQuery } from '@tanstack/react-query';
  import { supabase } from '@/lib/supabaseClient';
  import { queryKeys } from '@/lib/queryKeys';

  export interface PendingClaimWithPlayer {
    id: string;
    user_id: string;
    player_id: string;
    player_name: string;
    created_at: string;
  }

  interface PendingClaimRow {
    id: string;
    user_id: string;
    created_at: string;
    player_id: string;
    players: { full_name: string } | null;
  }

  export function usePendingClaims() {
    return useQuery({
      queryKey: queryKeys.pendingClaims(),
      queryFn: async (): Promise<PendingClaimWithPlayer[]> => {
        const { data, error } = await supabase
          .from('player_claims')
          .select('id, user_id, created_at, player_id, players(full_name)')
          .eq('status', 'pending')
          .order('created_at', { ascending: true });
        if (error) throw error;

        return (data as unknown as PendingClaimRow[]).map((row) => ({
          id: row.id,
          user_id: row.user_id,
          player_id: row.player_id,
          created_at: row.created_at,
          player_name: row.players?.full_name ?? 'Unknown player',
        }));
      },
    });
  }
  ```

  Run: `npm test -- src/hooks/usePendingClaims.test.tsx` — expected PASS.

- [ ] **Step 9: Write the failing test for `useSubmitPlayerClaim`**

  Create `web/src/hooks/useSubmitPlayerClaim.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { renderHook, waitFor } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import type { ReactNode } from 'react';

  const mockInsert = vi.fn();

  vi.mock('@/lib/supabaseClient', () => ({
    supabase: { from: () => ({ insert: mockInsert }) },
  }));

  import { useSubmitPlayerClaim } from './useSubmitPlayerClaim';

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  describe('useSubmitPlayerClaim', () => {
    beforeEach(() => {
      mockInsert.mockReset();
    });

    it('inserts a pending claim row for the given user and player', async () => {
      mockInsert.mockResolvedValue({ error: null });
      const { result } = renderHook(() => useSubmitPlayerClaim(), { wrapper });

      result.current.mutate({ userId: 'u1', playerId: 'p1' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockInsert).toHaveBeenCalledWith({ user_id: 'u1', player_id: 'p1' });
    });
  });
  ```

- [ ] **Step 10: Run it, confirm it fails, then implement `useSubmitPlayerClaim`**

  Create `web/src/hooks/useSubmitPlayerClaim.ts`:

  ```ts
  // web/src/hooks/useSubmitPlayerClaim.ts
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { supabase } from '@/lib/supabaseClient';
  import { queryKeys } from '@/lib/queryKeys';

  export function useSubmitPlayerClaim() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ userId, playerId }: { userId: string; playerId: string }) => {
        const { error } = await supabase.from('player_claims').insert({ user_id: userId, player_id: playerId });
        if (error) throw error;
      },
      onSuccess: (_data, { userId }) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(userId) });
      },
    });
  }
  ```

  Run: `npm test -- src/hooks/useSubmitPlayerClaim.test.tsx` — expected PASS.

- [ ] **Step 11: Run the whole frontend suite, then commit**

  ```
  npm test
  ```

  Expected: PASS (all pre-existing tests unaffected — this task only added files and appended to `types.ts`/`queryKeys.ts`).

  ```bash
  git add web/src/lib/types.ts web/src/lib/queryKeys.ts web/src/hooks/useUserProfile.ts web/src/hooks/useUserProfile.test.tsx web/src/hooks/usePendingClaims.ts web/src/hooks/usePendingClaims.test.tsx web/src/hooks/useSubmitPlayerClaim.ts web/src/hooks/useSubmitPlayerClaim.test.tsx
  git commit -m "feat: add account/claim query and mutation hooks"
  ```

---

### Task 4: Routing overhaul — `/login`, `/signup`, `AuthRouteGuard`

**Files:**
- Modify (move): `web/src/pages/admin/Login.tsx` → `web/src/pages/Login.tsx`
- Modify (move): `web/src/pages/admin/Login.test.tsx` → `web/src/pages/Login.test.tsx`
- Modify (move): `web/src/pages/admin/ForgotPassword.tsx` → `web/src/pages/ForgotPassword.tsx`
- Modify (move): `web/src/pages/admin/ForgotPassword.test.tsx` → `web/src/pages/ForgotPassword.test.tsx`
- Modify (move): `web/src/pages/admin/ResetPassword.tsx` → `web/src/pages/ResetPassword.tsx`
- Modify (move): `web/src/pages/admin/ResetPassword.test.tsx` → `web/src/pages/ResetPassword.test.tsx`
- Create: `web/src/pages/Signup.tsx`
- Create: `web/src/pages/Signup.test.tsx`
- Create: `web/src/components/AuthRouteGuard.tsx`
- Create: `web/src/components/AuthRouteGuard.test.tsx`
- Modify: `web/src/components/AdminRouteGuard.tsx`
- Modify: `web/src/components/AdminRouteGuard.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth` from `web/src/hooks/useAuth.tsx` (existing, unchanged).
- Produces: `AuthRouteGuard` component (same shape as `AdminRouteGuard` minus the admin check) for Task 9's `/dashboard` and Task 7's `/settings` routes to mount under.

- [ ] **Step 1: Move the three page files and their tests**

  ```bash
  git mv web/src/pages/admin/Login.tsx web/src/pages/Login.tsx
  git mv web/src/pages/admin/Login.test.tsx web/src/pages/Login.test.tsx
  git mv web/src/pages/admin/ForgotPassword.tsx web/src/pages/ForgotPassword.tsx
  git mv web/src/pages/admin/ForgotPassword.test.tsx web/src/pages/ForgotPassword.test.tsx
  git mv web/src/pages/admin/ResetPassword.tsx web/src/pages/ResetPassword.tsx
  git mv web/src/pages/admin/ResetPassword.test.tsx web/src/pages/ResetPassword.test.tsx
  ```

- [ ] **Step 2: Update the moved files' route references**

  In `web/src/pages/Login.tsx`, change the two `/admin/...` references:
  - `navigate('/admin/enter-match')` → `navigate('/dashboard')`
  - `to="/admin/forgot-password"` → `to="/forgot-password"`

  In `web/src/pages/ForgotPassword.tsx`, change:
  - `redirectTo: \`${window.location.origin}/admin/reset-password\`` → `redirectTo: \`${window.location.origin}/reset-password\``

  In `web/src/pages/ResetPassword.tsx`, change:
  - `navigate('/admin/login')` → `navigate('/login')`

- [ ] **Step 3: Update the moved test files to match**

  In `web/src/pages/Login.test.tsx`:
  - `expect(mockNavigate).toHaveBeenCalledWith('/admin/enter-match');` → `expect(mockNavigate).toHaveBeenCalledWith('/dashboard');`
  - `expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/admin/forgot-password');` → `.toHaveAttribute('href', '/forgot-password');`
  - `import { LoginPage } from './Login';` → `import { LoginPage } from './Login';` (unchanged — path is now correct after the move).

  In `web/src/pages/ForgotPassword.test.tsx`, change the test title and its `redirectTo` assertion:
  ```ts
    it('sends a reset email with a redirect to /reset-password', async () => {
  ```
  ```ts
      expect(mockReset).toHaveBeenCalledWith('admin@example.com', {
        redirectTo: `${window.location.origin}/reset-password`,
      }),
  ```

  In `web/src/pages/ResetPassword.test.tsx`, change:
  ```ts
      expect(mockNavigate).toHaveBeenCalledWith('/admin/login');
  ```
  to:
  ```ts
      expect(mockNavigate).toHaveBeenCalledWith('/login');
  ```

- [ ] **Step 4: Write the failing test for the new Signup page**

  Create `web/src/pages/Signup.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter } from 'react-router-dom';

  const mockSignUp = vi.fn();
  const mockNavigate = vi.fn();

  vi.mock('@/lib/supabaseClient', () => ({
    supabase: { auth: { signUp: (args: unknown) => mockSignUp(args) } },
  }));
  vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
  });

  import { SignupPage } from './Signup';

  describe('SignupPage', () => {
    beforeEach(() => {
      mockSignUp.mockReset();
      mockNavigate.mockReset();
    });

    it('signs up and navigates to the dashboard on success', async () => {
      mockSignUp.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <SignupPage />
        </MemoryRouter>,
      );

      await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
      await user.type(screen.getByLabelText('Password'), 'hunter22');
      await user.click(screen.getByRole('button', { name: 'Sign up' }));

      await waitFor(() =>
        expect(mockSignUp).toHaveBeenCalledWith({ email: 'newuser@example.com', password: 'hunter22' }),
      );
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('shows the error message verbatim on a failed signup', async () => {
      mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Email already registered' } });
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <SignupPage />
        </MemoryRouter>,
      );

      await user.type(screen.getByLabelText('Email'), 'dupe@example.com');
      await user.type(screen.getByLabelText('Password'), 'hunter22');
      await user.click(screen.getByRole('button', { name: 'Sign up' }));

      await waitFor(() => expect(screen.getByText('Email already registered')).toBeInTheDocument());
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('links to the login page', () => {
      render(
        <MemoryRouter>
          <SignupPage />
        </MemoryRouter>,
      );
      expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login');
    });
  });
  ```

- [ ] **Step 5: Run it, confirm it fails, then implement the Signup page**

  Create `web/src/pages/Signup.tsx`:

  ```tsx
  // web/src/pages/Signup.tsx
  import { useState, type FormEvent } from 'react';
  import { Link, useNavigate } from 'react-router-dom';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { supabase } from '@/lib/supabaseClient';

  export function SignupPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent) {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      setIsSubmitting(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      navigate('/dashboard');
    }

    return (
      <div className="card-surface mx-auto mt-8 max-w-sm p-8">
        <div className="fpl-gradient mb-6 h-1 w-12 rounded-full" />
        <h1 className="mb-6 text-2xl font-extrabold">Sign Up</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing up…' : 'Sign up'}
          </Button>
          <Link to="/login" className="text-muted-foreground text-sm hover:underline">
            Already have an account? Log in
          </Link>
        </form>
      </div>
    );
  }
  ```

  Run: `npm test -- src/pages/Signup.test.tsx` — expected PASS.

- [ ] **Step 6: Write the failing test for `AuthRouteGuard`**

  Create `web/src/components/AuthRouteGuard.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';

  const mockUseAuth = vi.fn();
  vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

  import { AuthRouteGuard } from './AuthRouteGuard';

  function renderGuarded() {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route element={<AuthRouteGuard />}>
            <Route path="/dashboard" element={<p>dashboard page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('AuthRouteGuard', () => {
    it('redirects to /login when there is no session', () => {
      mockUseAuth.mockReturnValue({ session: null, isLoading: false });
      renderGuarded();
      expect(screen.getByText('login page')).toBeInTheDocument();
    });

    it('renders the nested route for any signed-in session', () => {
      mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
      renderGuarded();
      expect(screen.getByText('dashboard page')).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 7: Run it, confirm it fails, then implement `AuthRouteGuard`**

  Create `web/src/components/AuthRouteGuard.tsx`:

  ```tsx
  // web/src/components/AuthRouteGuard.tsx
  import { Navigate, Outlet } from 'react-router-dom';
  import { Skeleton } from '@/components/ui/skeleton';
  import { useAuth } from '@/hooks/useAuth';

  export function AuthRouteGuard() {
    const { session, isLoading } = useAuth();

    if (isLoading) {
      return <Skeleton className="h-64 w-full" />;
    }

    if (!session) {
      return <Navigate to="/login" replace />;
    }

    return <Outlet />;
  }
  ```

  Run: `npm test -- src/components/AuthRouteGuard.test.tsx` — expected PASS.

- [ ] **Step 8: Update `AdminRouteGuard`'s redirect target and its test**

  In `web/src/components/AdminRouteGuard.tsx`, change:
  ```tsx
    if (!session) {
      return <Navigate to="/admin/login" replace />;
    }
  ```
  to:
  ```tsx
    if (!session) {
      return <Navigate to="/login" replace />;
    }
  ```

  In `web/src/components/AdminRouteGuard.test.tsx`, update the route path and assertion:
  ```tsx
        <Route path="/login" element={<p>login page</p>} />
  ```
  (was `/admin/login`) — the rest of the file (the render/mocks) is unchanged.

  Run: `npm test -- src/components/AdminRouteGuard.test.tsx` — expected PASS.

- [ ] **Step 9: Update `App.tsx`'s public auth routes**

  `AuthRouteGuard` is created in this task but **not yet wired into `App.tsx`** — `/dashboard` and `/settings` don't exist until Tasks 7 and 9, and wiring them in now would leave the app unable to build until those land. That wiring is deferred to Task 9 (Step 3 there), once both pages exist. For now, only rename the public auth routes and repoint the two page imports that moved:

  In `web/src/App.tsx`, replace the imports and route list:

  ```tsx
  import { BrowserRouter, Routes, Route } from 'react-router-dom';
  import { TopNav } from '@/components/TopNav';
  import { AdminRouteGuard } from '@/components/AdminRouteGuard';
  import { AdminLayout } from '@/components/AdminLayout';
  import { LeaderboardPage } from '@/pages/Leaderboard';
  import { PlayerProfilePage } from '@/pages/PlayerProfile';
  import { GradeDistributionPage } from '@/pages/GradeDistribution';
  import { MatchHistoryPage } from '@/pages/MatchHistory';
  import { NotFoundPage } from '@/pages/NotFound';
  import { LoginPage } from '@/pages/Login';
  import { SignupPage } from '@/pages/Signup';
  import { ForgotPasswordPage } from '@/pages/ForgotPassword';
  import { ResetPasswordPage } from '@/pages/ResetPassword';
  import { EnterMatchPage } from '@/pages/admin/EnterMatch';
  import { CorrectMatchPage } from '@/pages/admin/CorrectMatch';
  import { CloseWeekPage } from '@/pages/admin/CloseWeek';
  import { StartSeasonPage } from '@/pages/admin/StartSeason';
  import { ManagePlayersPage } from '@/pages/admin/ManagePlayers';

  export function App() {
    return (
      <BrowserRouter>
        <TopNav />
        <main className="container py-8">
          <Routes>
            <Route path="/" element={<LeaderboardPage />} />
            <Route path="/players/:playerId" element={<PlayerProfilePage />} />
            <Route path="/grades" element={<GradeDistributionPage />} />
            <Route path="/matches" element={<MatchHistoryPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<AdminRouteGuard />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin/enter-match" element={<EnterMatchPage />} />
                <Route path="/admin/correct-match" element={<CorrectMatchPage />} />
                <Route path="/admin/close-week" element={<CloseWeekPage />} />
                <Route path="/admin/start-season" element={<StartSeasonPage />} />
                <Route path="/admin/players" element={<ManagePlayersPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    );
  }
  ```

- [ ] **Step 10: Run the whole frontend suite**

  ```
  npm test
  ```

  Expected: PASS — this task leaves the app in a fully working, buildable state (it only renamed routes and added a not-yet-mounted `AuthRouteGuard`).

- [ ] **Step 11: Commit**

  ```bash
  git add -A web/src/pages web/src/components/AuthRouteGuard.tsx web/src/components/AuthRouteGuard.test.tsx web/src/components/AdminRouteGuard.tsx web/src/components/AdminRouteGuard.test.tsx web/src/App.tsx
  git commit -m "feat: rename auth routes out from under /admin, add signup and AuthRouteGuard"
  ```

---

### Task 5: `AccountMenu` in `TopNav`, `AdminSidebar` cleanup

**Files:**
- Create: `web/src/components/AccountMenu.tsx`
- Create: `web/src/components/AccountMenu.test.tsx`
- Modify: `web/src/components/TopNav.tsx`
- Modify: `web/src/components/TopNav.test.tsx`
- Modify: `web/src/components/AdminSidebar.tsx`
- Create: `web/src/components/AdminSidebar.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (existing), `useIsAdmin` (existing), `supabase.auth.signOut` (existing).
- Produces: `<AccountMenu />` component, self-contained, mounted once inside `TopNav`.

- [ ] **Step 1: Write the failing test for `AccountMenu`**

  Create `web/src/components/AccountMenu.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter } from 'react-router-dom';

  const mockUseAuth = vi.fn();
  const mockUseIsAdmin = vi.fn();
  const mockSignOut = vi.fn();
  const mockNavigate = vi.fn();

  vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
  vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
  vi.mock('@/lib/supabaseClient', () => ({
    supabase: { auth: { signOut: () => mockSignOut() } },
  }));
  vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
  });

  import { AccountMenu } from './AccountMenu';

  describe('AccountMenu', () => {
    it('shows Log in / Sign up links when logged out', () => {
      mockUseAuth.mockReturnValue({ session: null, isLoading: false });
      mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });

      render(
        <MemoryRouter>
          <AccountMenu />
        </MemoryRouter>,
      );

      expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
      expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
    });

    it('shows Dashboard/Settings/Log out but not Admin for a non-admin session', async () => {
      mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <AccountMenu />
        </MemoryRouter>,
      );

      await user.click(screen.getByRole('button', { name: 'Account' }));
      expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
      expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    });

    it('shows the Admin link for an admin session and signs out on click', async () => {
      mockSignOut.mockResolvedValue({ error: null });
      mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
      mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <AccountMenu />
        </MemoryRouter>,
      );

      await user.click(screen.getByRole('button', { name: 'Account' }));
      expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin/enter-match');

      await user.click(screen.getByRole('button', { name: 'Log out' }));
      expect(mockSignOut).toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails, then implement `AccountMenu`**

  Create `web/src/components/AccountMenu.tsx`:

  ```tsx
  // web/src/components/AccountMenu.tsx
  import { useEffect, useRef, useState } from 'react';
  import { NavLink, useNavigate } from 'react-router-dom';
  import { supabase } from '@/lib/supabaseClient';
  import { useAuth } from '@/hooks/useAuth';
  import { useIsAdmin } from '@/hooks/useIsAdmin';

  export function AccountMenu() {
    const navigate = useNavigate();
    const { session } = useAuth();
    const isAdmin = useIsAdmin(session?.user.id);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
          setOpen(false);
        }
      }
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!session) {
      return (
        <div className="flex items-center gap-1.5">
          <NavLink
            to="/login"
            className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            Log in
          </NavLink>
          <NavLink
            to="/signup"
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
          >
            Sign up
          </NavLink>
        </div>
      );
    }

    return (
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
        >
          Account
        </button>
        {open && (
          <div className="card-surface absolute right-0 top-full z-50 mt-2 flex w-44 flex-col gap-1 p-2">
            <NavLink
              to="/dashboard"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-white/10"
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/settings"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-white/10"
            >
              Settings
            </NavLink>
            {isAdmin.data === true && (
              <NavLink
                to="/admin/enter-match"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-white/10"
              >
                Admin
              </NavLink>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void supabase.auth.signOut().then(() => navigate('/'));
              }}
              className="rounded-lg px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-white/10"
            >
              Log out
            </button>
          </div>
        )}
      </div>
    );
  }
  ```

  Run: `npm test -- src/components/AccountMenu.test.tsx` — expected PASS.

- [ ] **Step 3: Wire `AccountMenu` into `TopNav`, removing the old "Admin login" link**

  In `web/src/components/TopNav.tsx`, replace the closing `<NavLink to="/admin/login" ...>Admin login</NavLink>` element with `<AccountMenu />`, and add the import:

  ```tsx
  import { AccountMenu } from '@/components/AccountMenu';
  ```

  ```tsx
            ))}
            <AccountMenu />
          </div>
        </div>
      </nav>
    </header>
  );
  ```

- [ ] **Step 4: Update `TopNav.test.tsx`**

  ```tsx
  // web/src/components/TopNav.test.tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter } from 'react-router-dom';
  import { TopNav } from './TopNav';

  const mockUseAuth = vi.fn();
  const mockUseIsAdmin = vi.fn();
  vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
  vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

  describe('TopNav', () => {
    it('renders links to every public page plus the logged-out account links', () => {
      mockUseAuth.mockReturnValue({ session: null, isLoading: false });
      mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });

      render(
        <MemoryRouter>
          <TopNav />
        </MemoryRouter>,
      );
      expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('link', { name: 'Grades' })).toHaveAttribute('href', '/grades');
      expect(screen.getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/matches');
      expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
      expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
    });
  });
  ```

  Run: `npm test -- src/components/TopNav.test.tsx` — expected PASS.

- [ ] **Step 5: Remove the Logout button from `AdminSidebar`, add a test**

  In `web/src/components/AdminSidebar.tsx`, remove the `import { supabase } from '@/lib/supabaseClient';` import and the trailing `<button ... onClick={() => supabase.auth.signOut()}>Logout</button>` element — the sidebar becomes:

  ```tsx
  // web/src/components/AdminSidebar.tsx
  import { NavLink } from 'react-router-dom';
  import { cn } from '@/lib/utils';

  const links = [
    { to: '/admin/enter-match', label: 'Enter Match' },
    { to: '/admin/correct-match', label: 'Correct a Match' },
    { to: '/admin/close-week', label: 'Close Week' },
    { to: '/admin/start-season', label: 'Start Season' },
    { to: '/admin/players', label: 'Players' },
  ];

  export function AdminSidebar() {
    return (
      <aside className="card-surface h-fit w-52 shrink-0 p-4">
        <p className="text-accent mb-3 text-xs font-bold uppercase tracking-widest">Admin</p>
        <nav className="flex flex-col gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10',
                  isActive && 'bg-primary text-primary-foreground hover:bg-primary',
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    );
  }
  ```

  Create `web/src/components/AdminSidebar.test.tsx`:

  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter } from 'react-router-dom';
  import { AdminSidebar } from './AdminSidebar';

  describe('AdminSidebar', () => {
    it('renders the 5 admin action links and no logout button', () => {
      render(
        <MemoryRouter>
          <AdminSidebar />
        </MemoryRouter>,
      );
      expect(screen.getByRole('link', { name: 'Enter Match' })).toHaveAttribute('href', '/admin/enter-match');
      expect(screen.getByRole('link', { name: 'Correct a Match' })).toHaveAttribute('href', '/admin/correct-match');
      expect(screen.getByRole('link', { name: 'Close Week' })).toHaveAttribute('href', '/admin/close-week');
      expect(screen.getByRole('link', { name: 'Start Season' })).toHaveAttribute('href', '/admin/start-season');
      expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/admin/players');
      expect(screen.queryByRole('button', { name: /logout/i })).not.toBeInTheDocument();
    });
  });
  ```

  Run: `npm test -- src/components/AdminSidebar.test.tsx` — expected PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/components/AccountMenu.tsx web/src/components/AccountMenu.test.tsx web/src/components/TopNav.tsx web/src/components/TopNav.test.tsx web/src/components/AdminSidebar.tsx web/src/components/AdminSidebar.test.tsx
  git commit -m "feat: add TopNav account menu, remove duplicate logout from AdminSidebar"
  ```

---

### Task 6: Extract `usePlayerPhotoUpload` from `ManagePlayers`

**Files:**
- Create: `web/src/hooks/usePlayerPhotoUpload.ts`
- Create: `web/src/hooks/usePlayerPhotoUpload.test.tsx`
- Modify: `web/src/pages/admin/ManagePlayers.tsx`

**Interfaces:**
- Produces: `usePlayerPhotoUpload(player: { id: string; full_name: string }, seasonId: string)` returning `{ inputRef: RefObject<HTMLInputElement>; isUploading: boolean; handleFile(file: File): Promise<void>; handleRemove(): Promise<void> }` — used by both `ManagePlayers.tsx` (this task) and `Settings.tsx` (Task 7).

- [ ] **Step 1: Write the failing test**

  Create `web/src/hooks/usePlayerPhotoUpload.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { renderHook, waitFor, act } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import type { ReactNode } from 'react';

  const mockUpload = vi.fn();
  const mockGetPublicUrl = vi.fn();
  const mockUpdate = vi.fn();
  const mockToastError = vi.fn();
  const mockToastSuccess = vi.fn();

  vi.mock('sonner', () => ({ toast: { error: mockToastError, success: mockToastSuccess } }));
  vi.mock('@/lib/supabaseClient', () => ({
    supabase: {
      storage: { from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }) },
      from: () => ({ update: () => ({ eq: mockUpdate }) }),
    },
  }));

  import { usePlayerPhotoUpload } from './usePlayerPhotoUpload';

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient();
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const player = { id: 'p1', full_name: 'Alex Testplayer', photo_url: null };

  describe('usePlayerPhotoUpload', () => {
    beforeEach(() => {
      mockUpload.mockReset();
      mockGetPublicUrl.mockReset();
      mockUpdate.mockReset();
      mockToastError.mockReset();
      mockToastSuccess.mockReset();
    });

    it('rejects a non-image file without calling storage', async () => {
      const { result } = renderHook(() => usePlayerPhotoUpload(player, 's1'), { wrapper });
      const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFile(file);
      });

      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith('Please choose an image file.');
    });

    it('uploads an image, updates photo_url, and toasts success', async () => {
      mockUpload.mockResolvedValue({ error: null });
      mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.com/p1.jpg' } });
      mockUpdate.mockResolvedValue({ error: null });
      const { result } = renderHook(() => usePlayerPhotoUpload(player, 's1'), { wrapper });
      const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

      await act(async () => {
        await result.current.handleFile(file);
      });

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Photo updated for Alex Testplayer'));
      expect(mockUpload).toHaveBeenCalled();
    });

    it('removes the photo and toasts success', async () => {
      mockUpdate.mockResolvedValue({ error: null });
      const { result } = renderHook(() => usePlayerPhotoUpload(player, 's1'), { wrapper });

      await act(async () => {
        await result.current.handleRemove();
      });

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Photo removed for Alex Testplayer'));
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails, then implement the hook**

  Create `web/src/hooks/usePlayerPhotoUpload.ts`:

  ```ts
  // web/src/hooks/usePlayerPhotoUpload.ts
  import { useRef, useState } from 'react';
  import { toast } from 'sonner';
  import { useQueryClient } from '@tanstack/react-query';
  import { supabase } from '@/lib/supabaseClient';
  import { queryKeys } from '@/lib/queryKeys';

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

  export interface PhotoUploadTarget {
    id: string;
    full_name: string;
  }

  export function usePlayerPhotoUpload(player: PhotoUploadTarget, seasonId: string) {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);

    function invalidate() {
      queryClient.invalidateQueries({ queryKey: queryKeys.players(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(player.id, seasonId) });
    }

    async function handleFile(file: File) {
      if (!file.type.startsWith('image/')) {
        toast.error('Please choose an image file.');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        toast.error('Photo must be 5MB or smaller.');
        return;
      }

      setIsUploading(true);
      try {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const path = `${player.id}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('player-photos')
          .upload(path, file, { upsert: true, cacheControl: '3600' });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('player-photos').getPublicUrl(path);
        const { error: updateError } = await supabase
          .from('players')
          .update({ photo_url: urlData.publicUrl })
          .eq('id', player.id);
        if (updateError) throw updateError;

        toast.success(`Photo updated for ${player.full_name}`);
        invalidate();
      } catch (uploadError) {
        toast.error(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
      } finally {
        setIsUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    }

    async function handleRemove() {
      setIsUploading(true);
      try {
        const { error: updateError } = await supabase
          .from('players')
          .update({ photo_url: null })
          .eq('id', player.id);
        if (updateError) throw updateError;
        toast.success(`Photo removed for ${player.full_name}`);
        invalidate();
      } catch (removeError) {
        toast.error(removeError instanceof Error ? removeError.message : 'Failed to remove photo.');
      } finally {
        setIsUploading(false);
      }
    }

    return { inputRef, isUploading, handleFile, handleRemove };
  }
  ```

  Run: `npm test -- src/hooks/usePlayerPhotoUpload.test.tsx` — expected PASS.

- [ ] **Step 3: Update `ManagePlayers.tsx`'s `PlayerPhotoRow` to use the extracted hook**

  In `web/src/pages/admin/ManagePlayers.tsx`, delete the inline `MAX_PHOTO_BYTES` constant and replace the body of `PlayerPhotoRow` (everything from `const queryClient = ...` through the two `async function` definitions) with:

  ```tsx
  function PlayerPhotoRow({ player, seasonId }: { player: PlayerOption; seasonId: string }) {
    const { inputRef, isUploading, handleFile, handleRemove } = usePlayerPhotoUpload(player, seasonId);

    return (
      <li className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
  ```

  and replace this file's import block with:
  ```tsx
  // web/src/pages/admin/ManagePlayers.tsx
  import { Skeleton } from '@/components/ui/skeleton';
  import { PlayerAvatar } from '@/components/PlayerAvatar';
  import { useActiveSeason } from '@/hooks/useActiveSeason';
  import { usePlayers, type PlayerOption } from '@/hooks/usePlayers';
  import { usePlayerPhotoUpload } from '@/hooks/usePlayerPhotoUpload';
  ```

  `useRef`/`useState` (react), `toast` (sonner), `useQueryClient` (tanstack), `supabase`, and `queryKeys` were only ever used inside `PlayerPhotoRow`'s old body, now moved into the hook — `ManagePlayersPage` itself never used them, so all five imports are dropped here, not kept.

- [ ] **Step 4: Run the frontend suite, confirm nothing broke**

  ```
  npm test
  ```

  Expected: PASS. (`ManagePlayers.tsx` has no existing test file, per this repo's current coverage — this task doesn't add one since Task 7 exercises the same extracted hook from the Settings page, and this step's full-suite run is the regression guard for the admin page's continued compileability.)

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/hooks/usePlayerPhotoUpload.ts web/src/hooks/usePlayerPhotoUpload.test.tsx web/src/pages/admin/ManagePlayers.tsx
  git commit -m "refactor: extract usePlayerPhotoUpload for reuse by the Settings page"
  ```

---

### Task 7: Settings page

**Files:**
- Create: `web/src/pages/Settings.tsx`
- Create: `web/src/pages/Settings.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (existing), `useIsAdmin` (existing), `useUserProfile` (Task 3), `useSubmitPlayerClaim` (Task 3), `usePlayerPhotoUpload` (Task 6), `useActiveSeason`/`usePlayers` (existing), `ui/select` components (existing), `supabase.auth.updateUser` (existing SDK API, first use in this codebase outside `ResetPassword.tsx`'s password-only call).
- Produces: `SettingsPage`, mounted at `/settings` under `AuthRouteGuard` (Task 4).

- [ ] **Step 1: Write the failing test**

  Create `web/src/pages/Settings.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

  const mockUseAuth = vi.fn();
  const mockUseIsAdmin = vi.fn();
  const mockUseUserProfile = vi.fn();
  const mockUsePlayers = vi.fn();
  const mockUseActiveSeason = vi.fn();
  const mockSubmitClaimMutate = vi.fn();
  const mockUpdateUser = vi.fn();

  vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
  vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
  vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
  vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
  vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));
  vi.mock('@/hooks/useSubmitPlayerClaim', () => ({
    useSubmitPlayerClaim: () => ({ mutate: mockSubmitClaimMutate, isPending: false }),
  }));
  vi.mock('@/hooks/usePlayerPhotoUpload', () => ({
    usePlayerPhotoUpload: () => ({ inputRef: { current: null }, isUploading: false, handleFile: vi.fn(), handleRemove: vi.fn() }),
  }));
  vi.mock('@/lib/supabaseClient', () => ({
    supabase: { auth: { updateUser: (args: unknown) => mockUpdateUser(args) } },
  }));

  import { SettingsPage } from './Settings';

  function renderSettings() {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  describe('SettingsPage', () => {
    beforeEach(() => {
      mockSubmitClaimMutate.mockReset();
      mockUpdateUser.mockReset();
      mockUseAuth.mockReturnValue({ session: { user: { id: 'u1', email: 'u1@example.com' } }, isLoading: false });
      mockUseActiveSeason.mockReturnValue({ data: { id: 's1', name: 'Season 2026' }, isLoading: false, isError: false });
    });

    it('shows the claim picker for an unlinked, non-admin account', async () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({
        data: { linkedPlayerId: null, pendingClaim: null },
        isLoading: false,
        isError: false,
      });
      mockUsePlayers.mockReturnValue({
        data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
        isLoading: false,
        isError: false,
      });

      renderSettings();
      expect(screen.getByText(/claim your player profile/i)).toBeInTheDocument();
    });

    it('shows a pending-review status instead of the picker when a claim is outstanding', () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({
        data: { linkedPlayerId: null, pendingClaim: { id: 'c1', player_id: 'p1', status: 'pending' } },
        isLoading: false,
        isError: false,
      });
      mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });

      renderSettings();
      expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    });

    it('shows the linked player name read-only and the photo manager for a linked account', () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({
        data: { linkedPlayerId: 'p1', pendingClaim: null },
        isLoading: false,
        isError: false,
      });
      mockUsePlayers.mockReturnValue({
        data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
        isLoading: false,
        isError: false,
      });

      renderSettings();
      expect(screen.getByText(/linked to: alex testplayer/i)).toBeInTheDocument();
    });

    it('updates the password on submit', async () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({
        data: { linkedPlayerId: null, pendingClaim: null },
        isLoading: false,
        isError: false,
      });
      mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });
      mockUpdateUser.mockResolvedValue({ error: null });
      const user = userEvent.setup();

      renderSettings();
      await user.type(screen.getByLabelText('New password'), 'newpassword1');
      await user.click(screen.getByRole('button', { name: 'Update password' }));

      await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newpassword1' }));
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails, then implement the Settings page**

  Create `web/src/pages/Settings.tsx`:

  ```tsx
  // web/src/pages/Settings.tsx
  import { useState, type FormEvent } from 'react';
  import { toast } from 'sonner';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { Skeleton } from '@/components/ui/skeleton';
  import { PlayerAvatar } from '@/components/PlayerAvatar';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
  import { useAuth } from '@/hooks/useAuth';
  import { useIsAdmin } from '@/hooks/useIsAdmin';
  import { useUserProfile } from '@/hooks/useUserProfile';
  import { useSubmitPlayerClaim } from '@/hooks/useSubmitPlayerClaim';
  import { usePlayerPhotoUpload } from '@/hooks/usePlayerPhotoUpload';
  import { useActiveSeason } from '@/hooks/useActiveSeason';
  import { usePlayers } from '@/hooks/usePlayers';
  import { supabase } from '@/lib/supabaseClient';

  function AccountSection() {
    const { session } = useAuth();
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');
    const [isSavingPassword, setIsSavingPassword] = useState(false);
    const [isSavingEmail, setIsSavingEmail] = useState(false);

    async function handlePasswordSubmit(event: FormEvent) {
      event.preventDefault();
      setIsSavingPassword(true);
      const { error } = await supabase.auth.updateUser({ password });
      setIsSavingPassword(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setPassword('');
      toast.success('Password updated.');
    }

    async function handleEmailSubmit(event: FormEvent) {
      event.preventDefault();
      setIsSavingEmail(true);
      const { error } = await supabase.auth.updateUser({ email });
      setIsSavingEmail(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('Check your new email address for a confirmation link.');
    }

    return (
      <div className="card-surface mb-6 p-6">
        <h2 className="mb-4 text-lg font-bold">Account</h2>
        <form onSubmit={handlePasswordSubmit} className="mb-6 flex flex-col gap-3">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <Button type="submit" disabled={isSavingPassword} className="self-start">
            {isSavingPassword ? 'Saving…' : 'Update password'}
          </Button>
        </form>
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
          <Label htmlFor="email">Change email</Label>
          <Input
            id="email"
            type="email"
            placeholder={session?.user.email ?? ''}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" disabled={isSavingEmail} className="self-start">
            {isSavingEmail ? 'Saving…' : 'Update email'}
          </Button>
        </form>
      </div>
    );
  }

  function AdminDisplayNameSection({ userId }: { userId: string }) {
    const [displayName, setDisplayName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    async function handleSubmit(event: FormEvent) {
      event.preventDefault();
      setIsSaving(true);
      const { error } = await supabase.from('admin_users').update({ display_name: displayName }).eq('id', userId);
      setIsSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('Display name updated.');
    }

    return (
      <div className="card-surface mb-6 p-6">
        <h2 className="mb-4 text-lg font-bold">Admin profile</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          <Button type="submit" disabled={isSaving} className="self-start">
            {isSaving ? 'Saving…' : 'Update display name'}
          </Button>
        </form>
      </div>
    );
  }

  function LinkedPlayerSection({ playerId, seasonId }: { playerId: string; seasonId: string }) {
    const players = usePlayers(seasonId);
    const player = players.data?.find((p) => p.id === playerId);
    const { inputRef, isUploading, handleFile, handleRemove } = usePlayerPhotoUpload(
      { id: playerId, full_name: player?.full_name ?? '' },
      seasonId,
    );

    if (!player) return null;

    return (
      <div className="card-surface mb-6 p-6">
        <h2 className="mb-4 text-lg font-bold">Player profile</h2>
        <p className="mb-4 text-sm">
          Linked to: <span className="font-semibold">{player.full_name}</span>
        </p>
        <div className="flex items-center gap-4">
          <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="lg" />
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button type="button" disabled={isUploading} onClick={() => inputRef.current?.click()}>
            {isUploading ? 'Working…' : player.photo_url ? 'Replace photo' : 'Upload photo'}
          </Button>
          {player.photo_url && (
            <button
              type="button"
              disabled={isUploading}
              onClick={() => void handleRemove()}
              className="text-muted-foreground hover:text-destructive text-xs font-medium transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  function ClaimSection({ userId, seasonId }: { userId: string; seasonId: string }) {
    const players = usePlayers(seasonId);
    const submitClaim = useSubmitPlayerClaim();
    const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');

    function handleSubmit() {
      if (!selectedPlayerId) return;
      submitClaim.mutate(
        { userId, playerId: selectedPlayerId },
        {
          onSuccess: () => toast.success('Claim submitted — an admin will review it.'),
          onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to submit claim.'),
        },
      );
    }

    return (
      <div className="card-surface mb-6 p-6">
        <h2 className="mb-2 text-lg font-bold">Claim your player profile</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Pick your name from the league roster. An admin will review and approve the link.
        </p>
        <div className="flex gap-3">
          <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Select your name…" />
            </SelectTrigger>
            <SelectContent>
              {players.data?.map((player) => (
                <SelectItem key={player.id} value={player.id}>
                  {player.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" disabled={!selectedPlayerId || submitClaim.isPending} onClick={handleSubmit}>
            {submitClaim.isPending ? 'Submitting…' : 'Submit claim'}
          </Button>
        </div>
      </div>
    );
  }

  export function SettingsPage() {
    const { session } = useAuth();
    const userId = session?.user.id;
    const isAdmin = useIsAdmin(userId);
    const userProfile = useUserProfile(userId);
    const activeSeason = useActiveSeason();

    if (isAdmin.isLoading || userProfile.isLoading || activeSeason.isLoading) {
      return <Skeleton className="h-64 w-full rounded-xl" />;
    }

    if (userProfile.isError || activeSeason.isError || !userId) {
      return <p className="text-destructive">Couldn't load your account. Try refreshing.</p>;
    }

    const seasonId = activeSeason.data?.id ?? '';

    return (
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-extrabold">Settings</h1>
        <AccountSection />
        {isAdmin.data === true && <AdminDisplayNameSection userId={userId} />}
        {userProfile.data?.linkedPlayerId ? (
          <LinkedPlayerSection playerId={userProfile.data.linkedPlayerId} seasonId={seasonId} />
        ) : userProfile.data?.pendingClaim ? (
          <div className="card-surface mb-6 p-6">
            <h2 className="mb-2 text-lg font-bold">Player profile</h2>
            <p className="text-muted-foreground text-sm">Your claim is pending review by an admin.</p>
          </div>
        ) : (
          <ClaimSection userId={userId} seasonId={seasonId} />
        )}
      </div>
    );
  }
  ```

  Run: `npm test -- src/pages/Settings.test.tsx` — expected PASS.

- [ ] **Step 3: Run the frontend suite**

  ```
  npm test
  ```

  Expected: PASS. `Settings.tsx` isn't wired into `App.tsx` yet (that happens in Task 9, once `Dashboard.tsx` also exists, so both new routes land together) — this task's own test exercises `SettingsPage` standalone via `Settings.test.tsx`, so the rest of the suite is unaffected.

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/pages/Settings.tsx web/src/pages/Settings.test.tsx
  git commit -m "feat: add role-aware Settings page"
  ```

---

### Task 8: Admin Players page — Pending Claims section

**Files:**
- Modify: `web/src/lib/edgeFunctions.ts`
- Modify: `web/src/pages/admin/ManagePlayers.tsx`
- Create: `web/src/pages/admin/ManagePlayers.test.tsx`

**Interfaces:**
- Consumes: `usePendingClaims` (Task 3), `ConfirmDialog` (existing).
- Produces: `reviewPlayerClaim(body: { claim_id: string; decision: 'approve' | 'reject' })` in `edgeFunctions.ts`, following the existing `closeWeek`/`startSeason` wrapper pattern.

- [ ] **Step 1: Add the `reviewPlayerClaim` wrapper**

  In `web/src/lib/edgeFunctions.ts`, append:

  ```ts
  export interface ReviewPlayerClaimBody {
    claim_id: string;
    decision: 'approve' | 'reject';
  }
  export interface ReviewPlayerClaimResponse {
    claim_id: string;
    status: 'approved' | 'rejected';
  }
  export function reviewPlayerClaim(body: ReviewPlayerClaimBody) {
    return callEdgeFunction<ReviewPlayerClaimBody, ReviewPlayerClaimResponse>('review-player-claim', 'POST', body);
  }
  ```

- [ ] **Step 2: Write the failing test for the new section**

  Create `web/src/pages/admin/ManagePlayers.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

  const mockUseActiveSeason = vi.fn();
  const mockUsePlayers = vi.fn();
  const mockUsePendingClaims = vi.fn();
  const mockReviewPlayerClaim = vi.fn();

  vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));
  vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
  vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
  vi.mock('@/lib/edgeFunctions', () => ({ reviewPlayerClaim: (args: unknown) => mockReviewPlayerClaim(args) }));

  import { ManagePlayersPage } from './ManagePlayers';

  function renderPage() {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ManagePlayersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  describe('ManagePlayersPage pending claims', () => {
    beforeEach(() => {
      mockReviewPlayerClaim.mockReset();
      mockUseActiveSeason.mockReturnValue({ data: { id: 's1' }, isLoading: false, isError: false });
      mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });
    });

    it('lists pending claims and approves one on confirm', async () => {
      mockUsePendingClaims.mockReturnValue({
        data: [{ id: 'c1', user_id: 'u1', player_id: 'p1', player_name: 'Alex Testplayer', created_at: '2026-07-20' }],
        isLoading: false,
        isError: false,
      });
      mockReviewPlayerClaim.mockResolvedValue({ claim_id: 'c1', status: 'approved' });
      const user = userEvent.setup();

      renderPage();
      expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Approve' }));
      await user.click(screen.getByRole('button', { name: 'Confirm Approve' }));

      await waitFor(() =>
        expect(mockReviewPlayerClaim).toHaveBeenCalledWith({ claim_id: 'c1', decision: 'approve' }),
      );
    });

    it('shows nothing when there are no pending claims', () => {
      mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
      renderPage();
      expect(screen.queryByText(/pending claims/i)).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 3: Run it, confirm it fails**

  ```
  npm test -- src/pages/admin/ManagePlayers.test.tsx
  ```

  Expected: FAIL — no "Pending claims" UI exists yet.

- [ ] **Step 4: Add the Pending Claims section to `ManagePlayers.tsx`**

  Add these imports to `web/src/pages/admin/ManagePlayers.tsx` (none of them are present after Task 6's edit, which dropped `toast`/`useQueryClient` along with the other now-unused imports — see Task 6 Step 3):

  ```tsx
  import { useState } from 'react';
  import { toast } from 'sonner';
  import { useQueryClient } from '@tanstack/react-query';
  import { ConfirmDialog } from '@/components/ConfirmDialog';
  import { usePendingClaims } from '@/hooks/usePendingClaims';
  import { reviewPlayerClaim } from '@/lib/edgeFunctions';
  import { queryKeys } from '@/lib/queryKeys';
  ```

  Add this component above `ManagePlayersPage`:

  ```tsx
  function PendingClaimsSection() {
    const queryClient = useQueryClient();
    const pendingClaims = usePendingClaims();
    const [isReviewing, setIsReviewing] = useState(false);

    async function handleReview(claimId: string, decision: 'approve' | 'reject') {
      setIsReviewing(true);
      try {
        await reviewPlayerClaim({ claim_id: claimId, decision });
        toast.success(decision === 'approve' ? 'Claim approved.' : 'Claim rejected.');
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingClaims() });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to review claim.');
      } finally {
        setIsReviewing(false);
      }
    }

    if (!pendingClaims.data || pendingClaims.data.length === 0) return null;

    return (
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Pending claims</h2>
        <ul className="card-surface overflow-hidden">
          {pendingClaims.data.map((claim) => (
            <li key={claim.id} className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
              <p className="flex-1 font-semibold">{claim.player_name}</p>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    disabled={isReviewing}
                    className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                  >
                    Approve
                  </button>
                }
                title={`Approve this claim for ${claim.player_name}?`}
                description="This links the account to this player and rejects any other pending claim on the same player."
                confirmLabel="Confirm Approve"
                onConfirm={() => void handleReview(claim.id, 'approve')}
                isConfirming={isReviewing}
              />
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    disabled={isReviewing}
                    className="text-muted-foreground hover:text-destructive text-xs font-medium disabled:opacity-50"
                  >
                    Reject
                  </button>
                }
                title={`Reject this claim for ${claim.player_name}?`}
                description="The account stays unlinked and can submit a new claim later."
                confirmLabel="Confirm Reject"
                onConfirm={() => void handleReview(claim.id, 'reject')}
                isConfirming={isReviewing}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```

  Finally, render `<PendingClaimsSection />` at the top of `ManagePlayersPage`'s returned JSX, just inside the wrapping `<div className="max-w-2xl">`, before the existing `<h1>Players</h1>`.

- [ ] **Step 5: Run the test again, confirm it passes**

  ```
  npm test -- src/pages/admin/ManagePlayers.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/lib/edgeFunctions.ts web/src/pages/admin/ManagePlayers.tsx web/src/pages/admin/ManagePlayers.test.tsx
  git commit -m "feat: add pending player-claim review to the admin Players page"
  ```

---

### Task 9: Dashboard page

**Files:**
- Create: `web/src/pages/Dashboard.tsx`
- Create: `web/src/pages/Dashboard.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth`, `useIsAdmin` (existing), `useUserProfile`, `usePendingClaims` (Task 3), `useActiveSeason`, `useLeaderboard`, `useMatchHistory`, `usePlayerProfile` (existing), `MatchTable`, `GradeBadge`, `RatingChart` (existing), `AuthRouteGuard` (Task 4), `SettingsPage` (Task 7).
- Produces: `DashboardPage`; this task also wires both `/dashboard` and `/settings` into `App.tsx` under `AuthRouteGuard`, now that both pages exist.

- [ ] **Step 1: Write the failing test**

  Create `web/src/pages/Dashboard.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter } from 'react-router-dom';

  const mockUseAuth = vi.fn();
  const mockUseIsAdmin = vi.fn();
  const mockUseUserProfile = vi.fn();
  const mockUsePendingClaims = vi.fn();
  const mockUseActiveSeason = vi.fn();
  const mockUseLeaderboard = vi.fn();
  const mockUseMatchHistory = vi.fn();
  const mockUsePlayerProfile = vi.fn();

  vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
  vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
  vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
  vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
  vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));
  vi.mock('@/hooks/useLeaderboard', () => ({ useLeaderboard: () => mockUseLeaderboard() }));
  vi.mock('@/hooks/useMatchHistory', () => ({ useMatchHistory: () => mockUseMatchHistory() }));
  vi.mock('@/hooks/usePlayerProfile', () => ({ usePlayerProfile: () => mockUsePlayerProfile() }));

  import { DashboardPage } from './Dashboard';

  function renderDashboard() {
    return render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
  }

  describe('DashboardPage', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
      mockUseActiveSeason.mockReturnValue({ data: { id: 's1', name: 'Season 2026', status: 'active' }, isLoading: false, isError: false });
      mockUseLeaderboard.mockReturnValue({ data: [], isLoading: false, isError: false });
    });

    it('shows the admin panel for an admin account', () => {
      mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({ data: { linkedPlayerId: null, pendingClaim: null }, isLoading: false, isError: false });
      mockUsePendingClaims.mockReturnValue({ data: [{ id: 'c1' }], isLoading: false, isError: false });
      mockUseMatchHistory.mockReturnValue({ data: [], isLoading: false, isError: false });

      renderDashboard();
      expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('shows the player panel for a linked, non-admin account', () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({ data: { linkedPlayerId: 'p1', pendingClaim: null }, isLoading: false, isError: false });
      mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
      mockUsePlayerProfile.mockReturnValue({
        data: {
          player: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
          seasonRating: { grade: 'A', rating: 1800, season_points: 12 },
          statistics: null,
          ratingEvents: [],
          matches: [],
        },
        isLoading: false,
        isError: false,
      });

      renderDashboard();
      expect(screen.getByRole('heading', { name: 'Alex Testplayer' })).toBeInTheDocument();
    });

    it('shows the claim CTA for an unlinked account', () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({ data: { linkedPlayerId: null, pendingClaim: null }, isLoading: false, isError: false });
      mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

      renderDashboard();
      expect(screen.getByText(/claim your player profile/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /go to settings/i })).toHaveAttribute('href', '/settings');
    });

    it('shows a pending-review message for an unlinked account with an outstanding claim', () => {
      mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
      mockUseUserProfile.mockReturnValue({
        data: { linkedPlayerId: null, pendingClaim: { id: 'c1', player_id: 'p1', status: 'pending' } },
        isLoading: false,
        isError: false,
      });
      mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

      renderDashboard();
      expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails, then implement the Dashboard page**

  Create `web/src/pages/Dashboard.tsx`:

  ```tsx
  // web/src/pages/Dashboard.tsx
  import { lazy, Suspense } from 'react';
  import { Link } from 'react-router-dom';
  import { Skeleton } from '@/components/ui/skeleton';
  import { GradeBadge } from '@/components/GradeBadge';
  import { MatchTable } from '@/components/MatchTable';
  import { useAuth } from '@/hooks/useAuth';
  import { useIsAdmin } from '@/hooks/useIsAdmin';
  import { useUserProfile } from '@/hooks/useUserProfile';
  import { usePendingClaims } from '@/hooks/usePendingClaims';
  import { useActiveSeason } from '@/hooks/useActiveSeason';
  import { useLeaderboard } from '@/hooks/useLeaderboard';
  import { useMatchHistory } from '@/hooks/useMatchHistory';
  import { usePlayerProfile } from '@/hooks/usePlayerProfile';
  import { toRatingHistoryPoints } from '@/lib/ratingHistory';
  import type { PlayerClaim } from '@/lib/types';

  const RatingChart = lazy(() => import('@/components/RatingChart').then((m) => ({ default: m.RatingChart })));

  const ADMIN_ACTIONS = [
    { to: '/admin/enter-match', label: 'Enter Match' },
    { to: '/admin/correct-match', label: 'Correct a Match' },
    { to: '/admin/close-week', label: 'Close Week' },
    { to: '/admin/start-season', label: 'Start Season' },
    { to: '/admin/players', label: 'Players' },
  ];

  function AdminDashboard({ seasonId, seasonName }: { seasonId: string; seasonName: string }) {
    const pendingClaims = usePendingClaims();
    const matchHistory = useMatchHistory(seasonId);
    const recentMatches = (matchHistory.data ?? []).slice(0, 5);

    return (
      <div>
        <h1 className="mb-1 text-2xl font-extrabold">Admin Dashboard</h1>
        <p className="text-muted-foreground mb-6 text-sm">{seasonName}</p>
        <Link to="/admin/players" className="card-surface mb-6 block p-4 hover:border-accent">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Pending claims</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{pendingClaims.data?.length ?? 0}</p>
        </Link>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ADMIN_ACTIONS.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className="card-surface p-4 text-center text-sm font-semibold hover:border-accent"
            >
              {action.label}
            </Link>
          ))}
        </div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Recent matches</h2>
        <MatchTable matches={recentMatches} />
      </div>
    );
  }

  function LinkedPlayerDashboard({ playerId, seasonId }: { playerId: string; seasonId: string }) {
    const profile = usePlayerProfile(playerId, seasonId);
    const leaderboard = useLeaderboard(seasonId);

    if (profile.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
    if (profile.isError || !profile.data) {
      return <p className="text-destructive">Couldn't load your profile. Try refreshing.</p>;
    }

    const { player, seasonRating, matches } = profile.data;
    const rank = leaderboard.data?.find((entry) => entry.player_id === playerId)?.rank;
    const chartPoints = toRatingHistoryPoints(profile.data.ratingEvents);

    return (
      <div>
        <h1 className="mb-1 text-2xl font-extrabold">{player.full_name}</h1>
        <div className="mb-6 flex items-center gap-3">
          {seasonRating && <GradeBadge grade={seasonRating.grade} />}
          {rank !== undefined && <span className="text-muted-foreground text-sm">Rank #{rank}</span>}
        </div>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="card-surface p-4">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Rating</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{seasonRating?.rating ?? '—'}</p>
          </div>
          <div className="card-surface p-4">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Season Pts</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{seasonRating?.season_points ?? '—'}</p>
          </div>
          <Link to={`/players/${playerId}`} className="card-surface p-4 hover:border-accent">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Full profile</p>
            <p className="mt-1 text-sm font-semibold">View →</p>
          </Link>
        </div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Rating history</h2>
        <div className="card-surface mb-6 p-4">
          <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
            <RatingChart points={chartPoints} />
          </Suspense>
        </div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Recent matches</h2>
        <MatchTable matches={matches} />
      </div>
    );
  }

  function UnlinkedDashboard({ pendingClaim, seasonId }: { pendingClaim: PlayerClaim | null; seasonId: string }) {
    const leaderboard = useLeaderboard(seasonId);
    const top5 = (leaderboard.data ?? []).slice(0, 5);

    return (
      <div>
        <h1 className="mb-1 text-2xl font-extrabold">Welcome</h1>
        {pendingClaim ? (
          <p className="text-muted-foreground mb-6 text-sm">Your player claim is pending review by an admin.</p>
        ) : (
          <div className="card-surface mb-6 p-6">
            <h2 className="mb-2 text-lg font-bold">Claim your player profile</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              If you're a league player, link your account to see your own rating, rank, and match history here.
            </p>
            <Link to="/settings" className="text-primary text-sm font-semibold hover:underline">
              Go to Settings →
            </Link>
          </div>
        )}
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Leaderboard</h2>
        <ul className="card-surface overflow-hidden">
          {top5.map((entry) => (
            <li key={entry.player_id} className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0">
              <span className="font-medium">
                #{entry.rank} {entry.full_name}
              </span>
              <GradeBadge grade={entry.grade} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  export function DashboardPage() {
    const { session } = useAuth();
    const userId = session?.user.id;
    const isAdmin = useIsAdmin(userId);
    const userProfile = useUserProfile(userId);
    const activeSeason = useActiveSeason();

    if (isAdmin.isLoading || userProfile.isLoading || activeSeason.isLoading) {
      return <Skeleton className="h-64 w-full rounded-xl" />;
    }

    if (userProfile.isError || activeSeason.isError || !activeSeason.data) {
      return <p className="text-destructive">Couldn't load your dashboard. Try refreshing.</p>;
    }

    const seasonId = activeSeason.data.id;

    if (isAdmin.data === true) {
      return <AdminDashboard seasonId={seasonId} seasonName={activeSeason.data.name} />;
    }
    if (userProfile.data?.linkedPlayerId) {
      return <LinkedPlayerDashboard playerId={userProfile.data.linkedPlayerId} seasonId={seasonId} />;
    }
    return <UnlinkedDashboard pendingClaim={userProfile.data?.pendingClaim ?? null} seasonId={seasonId} />;
  }
  ```

  Run: `npm test -- src/pages/Dashboard.test.tsx` — expected PASS.

- [ ] **Step 3: Wire `/dashboard` and `/settings` into `App.tsx`**

  In `web/src/App.tsx`, add two imports:

  ```tsx
  import { AuthRouteGuard } from '@/components/AuthRouteGuard';
  import { DashboardPage } from '@/pages/Dashboard';
  import { SettingsPage } from '@/pages/Settings';
  ```

  and add a new guarded route block, right before the existing `<Route element={<AdminRouteGuard />}>` block:

  ```tsx
            <Route element={<AuthRouteGuard />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
  ```

- [ ] **Step 4: Run the whole frontend suite**

  ```
  npm test
  ```

  Expected: PASS across the board, including `App.test.tsx` unmodified from Task 4 (it doesn't render any authenticated route, so it's unaffected by `/dashboard`/`/settings` existing).

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/pages/Dashboard.tsx web/src/pages/Dashboard.test.tsx web/src/App.tsx
  git commit -m "feat: add role-aware Dashboard page, wire /dashboard and /settings into App"
  ```

---

### Task 10: "Crossed Cues" logo and favicon

**Files:**
- Create: `web/src/components/Logo.tsx`
- Create: `web/src/components/Logo.test.tsx`
- Create: `web/public/favicon.svg`
- Modify: `web/index.html`
- Modify: `web/src/components/TopNav.tsx`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/pages/Login.tsx`
- Modify: `web/src/pages/Signup.tsx`

**Interfaces:**
- Produces: `<Logo size={number} className={string} />` — an inline SVG React component, no other component depends on its internals.

- [ ] **Step 1: Write the failing test**

  Create `web/src/components/Logo.test.tsx`:

  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render } from '@testing-library/react';
  import { Logo } from './Logo';

  describe('Logo', () => {
    it('renders an svg with the given size', () => {
      const { container } = render(<Logo size={32} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '32');
      expect(svg).toHaveAttribute('height', '32');
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails, then implement `Logo`**

  Create `web/src/components/Logo.tsx`:

  ```tsx
  // web/src/components/Logo.tsx — "Crossed Cues": two crossed cue strokes over
  // a ball, chosen during brainstorming (docs/superpowers/specs/2026-07-20-
  // player-accounts-dashboard-settings-branding-design.md, §9) from four
  // options reviewed visually. Inline SVG (not a static asset) so size/color
  // can be controlled via props wherever it's used.
  export function Logo({ size = 36, className }: { size?: number; className?: string }) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
        <defs>
          <linearGradient id="logo-gradient-a" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00ff87" />
            <stop offset="100%" stopColor="#04f5ff" />
          </linearGradient>
          <linearGradient id="logo-gradient-b" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#963cff" />
            <stop offset="100%" stopColor="#ff2882" />
          </linearGradient>
        </defs>
        <rect
          x="45"
          y="10"
          width="10"
          height="60"
          rx="5"
          fill="url(#logo-gradient-a)"
          transform="rotate(-28 50 50)"
        />
        <rect
          x="45"
          y="10"
          width="10"
          height="60"
          rx="5"
          fill="url(#logo-gradient-b)"
          transform="rotate(28 50 50)"
        />
        <circle cx="50" cy="72" r="11" fill="#1a0d1f" stroke="#fff" strokeWidth="3" />
      </svg>
    );
  }
  ```

  Run: `npm test -- src/components/Logo.test.tsx` — expected PASS.

- [ ] **Step 3: Create the favicon and wire it into `index.html`**

  Create `web/public/favicon.svg` with the same mark, standalone (not React — a plain static SVG file):

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="a" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#00ff87"/>
        <stop offset="100%" stop-color="#04f5ff"/>
      </linearGradient>
      <linearGradient id="b" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#963cff"/>
        <stop offset="100%" stop-color="#ff2882"/>
      </linearGradient>
    </defs>
    <rect x="43" y="8" width="14" height="62" rx="6" fill="url(#a)" transform="rotate(-28 50 50)"/>
    <rect x="43" y="8" width="14" height="62" rx="6" fill="url(#b)" transform="rotate(28 50 50)"/>
    <circle cx="50" cy="72" r="13" fill="#1a0d1f" stroke="#fff" stroke-width="4"/>
  </svg>
  ```

  In `web/index.html`, add inside `<head>`, right after the `<meta name="theme-color" ...>` line:

  ```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  ```

- [ ] **Step 4: Replace the 🎱 emoji in `TopNav`**

  In `web/src/components/TopNav.tsx`, replace:

  ```tsx
            <span aria-hidden className="fpl-gradient flex h-9 w-9 items-center justify-center rounded-xl text-lg shadow-lg">
              🎱
            </span>
            <span aria-hidden className="text-lg font-extrabold tracking-tight">
              Pool League
            </span>
            <span className="sr-only">🎱 Pool League</span>
  ```

  with:

  ```tsx
            <Logo size={36} />
            <span className="text-lg font-extrabold tracking-tight">Pool League</span>
  ```

  and add the import: `import { Logo } from '@/components/Logo';`

- [ ] **Step 5: Update `App.test.tsx`'s assertion**

  In `web/src/App.test.tsx`, `App.test.tsx` also now renders `TopNav` (which calls `useAuth`/`useIsAdmin` via `AccountMenu`, added in Task 5) — add the same mocks Task 5 added to `TopNav.test.tsx`, and update the emoji assertion:

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { App } from './App';

  const mockUseAuth = vi.fn();
  const mockUseIsAdmin = vi.fn();
  vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
  vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

  vi.mock('@/hooks/useActiveSeason', () => ({
    useActiveSeason: () => ({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      isLoading: false,
      isError: false,
    }),
  }));

  vi.mock('@/hooks/useLeaderboard', () => ({
    useLeaderboard: () => ({
      data: [],
      isLoading: false,
      isError: false,
    }),
  }));

  function renderApp() {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
  }

  describe('App', () => {
    it('renders the top nav and the leaderboard page at the root route', () => {
      renderApp();
      expect(screen.getByText('Pool League')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 6: Add the logo to `Login.tsx` and `Signup.tsx`**

  In both `web/src/pages/Login.tsx` and `web/src/pages/Signup.tsx`, replace the `<div className="fpl-gradient mb-6 h-1 w-12 rounded-full" />` line with:

  ```tsx
  <Logo size={40} className="mb-6" />
  ```

  and add `import { Logo } from '@/components/Logo';` to each file's imports.

- [ ] **Step 7: Run the whole frontend suite**

  ```
  npm test
  ```

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add web/src/components/Logo.tsx web/src/components/Logo.test.tsx web/public/favicon.svg web/index.html web/src/components/TopNav.tsx web/src/App.test.tsx web/src/pages/Login.tsx web/src/pages/Signup.tsx
  git commit -m "feat: add Crossed Cues logo, favicon, and wire into nav/auth pages"
  ```

---

### Task 11: Full-repo verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend + rating-engine + db + api suite**

  ```
  npm test
  ```

  Expected: PASS. (Requires the local Supabase stack and `supabase functions serve` running per `CLAUDE.md`'s testing discipline; per that same doc, re-run any single failing file in isolation before treating a failure as real — this suite is Docker/HTTP-heavy and flaky-under-load failures are common on this machine.)

- [ ] **Step 2: Run the full frontend suite**

  ```
  cd web && npm test
  ```

  Expected: PASS.

- [ ] **Step 3: Manually verify the new flows in a running dev server**

  ```
  npm run dev   # from web/
  ```

  - Sign up a brand-new account at `/signup` → redirected to `/dashboard`, sees the "claim your player profile" prompt.
  - From `/settings`, submit a claim against a real seeded player.
  - Log in as the seed admin, go to `/admin/players`, approve the claim.
  - Log back in as the claimant → `/dashboard` now shows their own rating/rank/matches; `/settings` shows "Linked to: <name>" and the photo upload widget; upload a photo and confirm it appears on the public leaderboard too.
  - Confirm the favicon and `TopNav` show the new Crossed Cues mark, not the 🎱 emoji.

- [ ] **Step 4: Report to the user for the whole-branch review step of `subagent-driven-development` / `finishing-a-development-branch`, per this project's standard workflow.**
