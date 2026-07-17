# Edge Functions — local dev notes

This directory holds the pool-league ranking app's Supabase Edge Functions
(`enter-match`, `correct-match`, `close-week`, `start-season`, plus shared
helpers under `_shared/`). This file covers local-dev quirks worth knowing
before you spend time debugging something that isn't actually your code.

## Direct Postgres access (transactions)

Some Edge Functions need a real, multi-statement Postgres transaction (row
locking plus atomic commit/rollback) instead of separate PostgREST calls via
`db.from(...)` — see `withTransaction` in
`supabase/functions/_shared/dbTransaction.ts`. This requires a
`SUPABASE_DB_URL` env var to be visible to the function at runtime.

**Locally, no extra configuration is needed.** `npx supabase functions serve`
already injects `SUPABASE_DB_URL` automatically. This was confirmed
empirically (not assumed): a temporary `console.log('DB_URL:',
Deno.env.get('SUPABASE_DB_URL'))` added to the top of
`supabase/functions/enter-match/index.ts`, with `npx supabase functions
serve` restarted and the function hit once, printed a real connection
string in the served function's logs:

```
postgresql://postgres:postgres@db:5432/postgres
```

Note this is **not** the same connection string `npx supabase status -o env`
prints (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, the one
`src/api/testSupport.ts` and other host-side tooling use). The edge runtime
container reaches Postgres over the internal Docker network at hostname
`db`, port 5432 (Postgres's real port inside its own container), while the
host machine reaches the same database via the mapped port
`127.0.0.1:54322`. Both connection strings point at the same database —
only the hostname/port differ depending on which side of the Docker network
the caller is on. `withTransaction` simply reads whatever `SUPABASE_DB_URL`
the environment provides, so no code needs to know or care which form it is.

Because of this, **no `supabase/functions/.env` file exists or is needed**
for local dev — `SUPABASE_DB_URL` arrives for free. If some future
environment (e.g. a self-hosted docker-compose deployment) doesn't inject it
automatically, that environment's function containers/config will need to
set `SUPABASE_DB_URL` explicitly instead.

## Known issues / local dev

### OneDrive file-watcher flake (transient 502/503 right after boot/reload)

**Symptom:** immediately after `npx supabase functions serve` boots (or
after it hot-reloads a function), the very next request to that function
sometimes returns a transient `502`/`503` instead of a real response.

**Cause:** this repo lives inside a OneDrive-synced folder. OneDrive's
background sync process touches file mtimes as it syncs, which the edge
runtime's file watcher (`edge_runtime.policy = "per_worker"` in
`supabase/config.toml`, which enables hot reload) picks up as a change and
triggers a spurious reload mid-request, even when nothing you actually
edited changed.

**Workaround:** just retry the request once the reload settles (usually
sub-second). This has been hit repeatedly across this project's
implementation tasks and is never a real code defect — if a single request
fails right after a `functions serve` boot/reload and a retry succeeds,
it's this flake, not a regression. If a function's behavior looks stale
after an edit (old code still running), force a clean rebuild:

```sh
docker rm -f supabase_edge_runtime_<project-name>
npx supabase functions serve
```

(`<project-name>` is the suffix on your local containers, e.g.
`supabase_edge_runtime_backend-api-phase2` — check with
`docker ps -a --filter name=supabase_edge_runtime`.)

### Clean local database baseline

The local dev database accumulates seasons/players/matches across many
manual test and `npm run seed` runs. If you want a clean baseline (e.g.
before a final verification pass), reset it:

```sh
npx supabase db reset
```

This re-runs every migration in `supabase/migrations/` against a fresh
database. It does not reset the `pool_league_*_test` scratch databases
`src/db/*.test.ts` creates for themselves — those are dropped and
recreated automatically on every test run.

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
