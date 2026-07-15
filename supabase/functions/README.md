# Edge Functions — local dev notes

This directory holds the pool-league ranking app's Supabase Edge Functions
(`enter-match`, `correct-match`, `close-week`, `start-season`, plus shared
helpers under `_shared/`). This file covers local-dev quirks worth knowing
before you spend time debugging something that isn't actually your code.

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
