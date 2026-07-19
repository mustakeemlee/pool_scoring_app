# Cloud Hosting Migration — Design

Status: Approved by user, 2026-07-20

## 1. Purpose

Move this app off self-hosted infrastructure entirely: the database, auth, REST API, and the four admin Edge Functions move to Supabase Cloud (a managed, hosted Supabase project already created by the user). Only the frontend keeps running in Docker — a single container, built against the cloud project's public URL/anon key, with no Kong/Postgres/GoTrue/PostgREST/edge-runtime containers to run or maintain ourselves. The project's git history also moves to the user's own GitHub, replacing local-only version control.

This replaces, not supplements, both existing runtime models: the self-hosted docker-compose stack (Sub-phases A/B) and the local `supabase start` CLI dev/test stack. Going forward there is exactly one place data lives — the Supabase Cloud project — for development, testing, and the deployed app alike.

## 2. Scope decisions locked in during brainstorming

- **GitHub**: new repository at `https://github.com/mustakeemlee/pool_scoring_app`, already created and pushed (`master`, tracking `origin/master`).
- **Supabase Cloud project**: already exists (ref `ictqbqtkvptbjecxvnax`), already linked via `supabase link` (authenticated non-interactively with a user-generated Personal Access Token, since this environment has no interactive TTY for the normal browser-based `supabase login` flow).
- **Full replacement, not a third option.** The self-hosted docker-compose stack and the local CLI dev stack are both retired outright, not kept alongside the cloud setup.
- **Edge Functions deploy to Supabase Cloud itself** (`supabase functions deploy <name>`), not self-hosted edge-runtime containers. This is what makes "single container, just the frontend" true — no function containers to run ourselves at all.
- **Frontend**: single Docker container. Supabase Cloud already provides the REST/Auth/Functions gateway at the project's own URL, so no Kong or equivalent reverse proxy is needed in front of it. The existing multi-stage `web/Dockerfile` (Node build → nginx serve) carries over essentially unchanged, just pointed at the cloud project's URL/anon key as build args instead of a local Kong URL.
- **Migrations and function deploys use Supabase's standard hosted workflow** (`supabase db push`, `supabase functions deploy`), replacing the custom self-host scripts built for the old self-hosted stack's non-standard migration tracking.
- **Everything — local dev, the test suite, and seeding — points at the cloud project exclusively.** No local Postgres/Auth/REST containers run at all, ever, going forward. This was chosen deliberately, in full knowledge of two concrete consequences it creates (both addressed in this spec, §7):
  1. `src/db`'s tests currently create and drop **scratch Postgres databases** per run; Supabase Cloud does not support creating additional databases on a hosted project, so these tests must be redesigned around scratch **schemas** within the one cloud database instead.
  2. `src/api`'s tests currently rely on being able to wipe/reset a disposable local database; against a real shared cloud project they must instead clean up everything they create, every run.
- **Full Docker cleanup is part of this migration, not a follow-up.** End state: the *only* Docker container running for this app is the new single frontend container. Both the `poolscoringapp` (self-hosted) and `pool-scoring-app` (CLI dev) Docker projects — their containers, volumes, and images — are torn down and removed.
- **Files deleted outright** (not deprecated in place): `docker/kong.yml`, `docker/db-init/` (whole directory), `docker/README.md`, `scripts/generate-selfhost-secrets.mjs`, `scripts/seed-selfhost.mjs`, `scripts/migrate-selfhost.mjs`, `.env.selfhost.example`, and the `supabase:start`/`supabase:stop` scripts in the root `package.json`.
- **Out of scope for this spec** (separate spec, per user agreement): the dashboard homepage, the settings page, and the brand logo. Also unchanged/still deferred: TLS/a reverse proxy in front of the frontend container, and CI/CD automation (none exists today; not being added here).

## 3. Architecture

**Before:** three possible runtimes — local CLI stack (`supabase start`, for dev/test), self-hosted docker-compose stack (`poolscoringapp`, a from-scratch mirror of Supabase's own services), and nothing hosted anywhere real.

**After:** one runtime. Supabase Cloud (project `ictqbqtkvptbjecxvnax`) is the database, auth provider, REST API, and Edge Function host — for local development, for the automated test suite, and for whatever's actually deployed. The only thing that runs locally in Docker is the frontend, built once and served by nginx, talking directly to the cloud project's public URL over HTTPS.

```
                     ┌─────────────────────────────┐
                     │   Supabase Cloud project     │
                     │   (ictqbqtkvptbjecxvnax)      │
                     │                               │
                     │  Postgres · Auth · REST API   │
                     │  4 deployed Edge Functions     │
                     └───────────────▲───────────────┘
                                     │ HTTPS
              ┌──────────────────────┼──────────────────────┐
              │                      │                       │
   ┌──────────┴─────────┐  ┌─────────┴─────────┐  ┌──────────┴─────────┐
   │ Frontend container  │  │  npm test          │  │  npm run seed       │
   │ (nginx, built once) │  │  (src/db, src/api) │  │  (data seeding)     │
   └──────────────────────┘  └────────────────────┘  └──────────────────────┘
```

## 4. Secrets and environment variables

A single gitignored root `.env` file replaces every prior mechanism (`supabase status -o env`, `.env.selfhost`) for reaching the backend:

```
SUPABASE_URL=https://ictqbqtkvptbjecxvnax.supabase.co
SUPABASE_ANON_KEY=<project's anon/public key>
SUPABASE_SERVICE_ROLE_KEY=<project's service_role key>
SUPABASE_DB_URL=<Supavisor pooler connection string, transaction mode>
```

The first three come straight from the project's API settings page (Project Settings > API). `SUPABASE_DB_URL` is the one thing Supabase Cloud does not auto-provide to deployed Edge Functions — it must be set explicitly as a function secret (`supabase secrets set --env-file .env`, or individually) using the **Supavisor pooler in transaction mode** (not a direct connection), matching Supabase's own guidance for serverless/Edge Function workloads that open many short-lived connections. `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` ARE auto-injected into every deployed function by the platform already — they don't need to be set as secrets, only read via `Deno.env.get(...)` as the code already does.

A `.env.example` (tracked, no real values) documents the four keys, replacing `.env.selfhost.example`.

## 5. What changes, file by file

**Deleted:**
- `docker/kong.yml`, `docker/db-init/` (entire directory), `docker/README.md`
- `scripts/generate-selfhost-secrets.mjs`, `scripts/seed-selfhost.mjs`, `scripts/migrate-selfhost.mjs`
- `.env.selfhost.example`
- `supabase:start`/`supabase:stop` entries in root `package.json`

**Modified:**
- `docker-compose.yml` — shrinks to one service, `frontend`, built from `web/Dockerfile` with `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` build args sourced from the root `.env`. Keeps the restart policy and log rotation already established for it.
- `web/Dockerfile` — unchanged in structure; only the build-arg values it receives change (cloud URL/anon key instead of a local Kong URL).
- `web/scripts/generate-env.mjs` — currently shells out to `npx supabase status -o env`; changes to read `SUPABASE_URL`/`SUPABASE_ANON_KEY` from the root `.env` instead, writing the same `web/.env.local` output shape so nothing downstream (Vite, the frontend code) needs to change.
- `scripts/seed.mjs` and `scripts/seed-selfhost.mjs` — **consolidated into one script** (`scripts/seed.mjs`) that reads the four keys from the root `.env` instead of `supabase status`. Behavior (the round-robin match/close-week seeding pattern, calling the real Edge Functions) is unchanged, just retargeted.
- `src/api/testSupport.ts` — `getSupabaseStatus()`'s `execSync('npx supabase status -o env')` is replaced with reading the same root `.env` file. Every `src/api/*.test.ts` file keeps working against this same helper, unaware of the change underneath it.
- `src/db/applyMigrations.ts` and all three `src/db/*.test.ts` files — redesigned per §7 below to use scratch schemas instead of scratch databases.
- Root `package.json` — `seed` script stays; `supabase:start`/`supabase:stop` removed; a new `env:check` or similar convenience script may be added to validate the root `.env` has all four keys before other scripts run (implementation detail, decided during planning).
- `supabase/config.toml` — stays (the CLI still needs it for `db push`/`functions deploy`/the project link), unchanged beyond what `supabase link` already touched.
- `README.md` — rewritten to describe the single runtime model (this is largely a rewrite of the "Two ways to run it" section down to one way, plus the new `.env`-based setup).

**Created:**
- Root `.env.example` (documents the four required keys, no real values).

## 6. Deployment workflow

One-time and ongoing operator steps (not automated by CI, since none exists):

1. **Schema**: `supabase db push` applies any new migrations in `supabase/migrations/` to the cloud project. Standard Supabase workflow — no custom tracking table needed (unlike the old self-host `migrate-selfhost.mjs`, which existed only because the self-hosted stack had no equivalent to Supabase's own hosted migration history).
2. **Edge Functions**: `supabase functions deploy enter-match`, `correct-match`, `close-week`, `start-season` (or `supabase functions deploy` for all of them at once). Each function's `_shared/` imports resolve the same way they do today — nothing about the function code itself changes.
3. **Function secrets**: `supabase secrets set SUPABASE_DB_URL=<pooler-url>` once (and again if it's ever rotated).
4. **Frontend**: `docker compose up -d --build` builds and runs the single frontend container locally, pointed at whatever `.env` currently has in it.

## 7. Testing adaptation

**`src/db` — scratch schema instead of scratch database.**

Today: each test file creates a fresh Postgres *database*, applies all migrations into it, asserts, then drops the database (`applyMigrations.ts` also stubs `auth.uid()` since a fresh scratch database has no `auth` schema).

Cloud-compatible replacement: each test run creates a uniquely-named Postgres *schema* (e.g. `test_<random>`) inside the one cloud database, sets `search_path` to `<scratch_schema>, public` for the duration of the test, applies migrations (which create their tables/views/policies unqualified, so they land in the scratch schema by `search_path` resolution), asserts, then `DROP SCHEMA <scratch_schema> CASCADE`. Two things this needs to get right, confirmed during planning against the real migrations before being treated as settled:
- Migrations that reference `auth.uid()` must keep resolving to the *real* `auth` schema (already present and populated on a real Supabase Cloud project — no stubbing needed there, unlike the old scratch-database approach), not a schema-qualified copy.
- The `pgcrypto` extension (`gen_random_uuid()`) is typically installed once per database, not per schema — confirm it's already enabled on the cloud project (Supabase enables it by default) rather than trying to re-create it per test run.

**`src/api` — explicit teardown, no more "just reset the database."**

Every test file that creates data (players, seasons, matches, admin users) must delete everything it created, in every test (not just on failure) — an `afterEach`/`afterAll` hook per file, deleting by the exact IDs the test created, not a blanket wipe (since other real, or other tests', data may coexist in the same project). No test may assume it can start from an empty table.

## 8. Docker cleanup

Once the migration is verified working end-to-end:
```
docker compose --project-name poolscoringapp down -v --rmi all
npx supabase stop --project-id pool-scoring-app   # or the equivalent stop-and-remove for the CLI dev stack
docker system prune  # only after confirming nothing else on the machine still needs the removed images
```
Exact commands get finalized during planning once each is verified against what's actually running on the machine at that time — this section states intent (full teardown of both stacks, verified empty afterward), not final scripted steps.

## 9. Out of scope

Dashboard homepage, settings page, and brand logo — a separate spec, per user agreement (kept out specifically to keep this spec's risk/review surface focused on infrastructure, matching this project's established practice of one spec per independent concern). TLS/reverse proxy in front of the frontend container and CI/CD automation remain explicitly deferred, unchanged from every prior phase.
