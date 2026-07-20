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

Supabase Cloud auto-injects `SUPABASE_DB_URL` into every deployed function
today, alongside `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
— confirmed via `npx supabase secrets list`, which shows it as a
platform-managed secret. The CLI actively refuses to let you set it yourself
(`npx supabase secrets set SUPABASE_DB_URL=...` fails with "Env name cannot
start with SUPABASE_, skipping"), so there's no manual step here. If a future
platform change ever stops auto-injecting it, the value to set would be the
Supavisor **transaction-mode** pooler connection string (Project Settings →
Database → Connection string → Transaction pooler).

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
