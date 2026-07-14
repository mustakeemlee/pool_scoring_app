# Supabase Backend / API — Design (Phase 2)

Status: Approved by user, 2026-07-14
Scope: Orchestration layer (Supabase Edge Functions + PostgREST + RLS) that turns
the Phase 1 rating engine into a working weekly match-entry system, running on
the Supabase CLI's local Docker stack. Frontend (Phase 3) is a separate spec.

Builds directly on Phase 1: `docs/superpowers/specs/2026-07-14-rating-engine-design.md`
and its implementation at `src/rating/*.ts` + `supabase/migrations/20260714000000_initial_schema.sql`.

## 1. Purpose

Wire the Phase 1 rating/grading math (already implemented and tested) into an
actual weekly admin workflow: enter a match, watch ratings update immediately,
correct a mistake before the week closes, close the week to run the formal
Glicko-2 reconciliation, and start a new season with the carryover soft reset.
Reads (leaderboard, profiles, history) must be publicly viewable with no login;
writes are admin-only.

## 2. Scope decisions locked in during brainstorming

- **No math is reimplemented.** Every write operation that changes a rating
  calls the exact tested `src/rating/*.ts` functions from Phase 1 (imported
  directly into Deno Edge Functions), never a second SQL/plpgsql port of the
  same formulas.
- **Supabase CLI, not self-hosted.** `supabase start` manages Postgres, Auth,
  PostgREST, the Edge Functions runtime, and Studio locally. This project's own
  `docker-compose.yml` (from Phase 1) is extended in Phase 3 to add the
  frontend container only — it does not vendor Supabase's own services.
- **Week-close is admin-triggered**, not cron-driven — an explicit "Close Week"
  action, not a scheduled job, so an admin controls exactly when a period's
  Glicko-2 reconciliation runs.
- **Corrections are scoped to the open week only.** Once `close-week` has run
  for a period, its matches are locked (`matches.is_period_closed = true`) and
  cannot be corrected. Full cross-period replay (spec §3.4 of the Phase 1
  design) is explicitly deferred — the `volatility_before`/`volatility_after`
  columns added in Phase 1's final review remain in place for a future phase
  to build that on top of, but Phase 2 does not implement it.
- **Reads go through PostgREST directly** (Supabase's auto-generated REST API
  over tables/views, gated by Row Level Security), not custom read endpoints.
  Only the four write operations that need orchestration get Edge Functions.
- **No odds endpoint.** The win-probability formula (`src/rating/odds.ts`) is
  one line of pure math with no DB access — Phase 3's frontend imports it
  directly rather than Phase 2 exposing a network round-trip for it.

## 3. Schema addition

Phase 1's schema had no way to know whether a match's week has already been
reconciled. One new migration (`supabase/migrations/<timestamp>_add_period_closed.sql`),
additive only, no changes to the Phase 1 migration file:

```sql
alter table matches add column is_period_closed boolean not null default false;
```

Set to `true` by `close-week` for every match it reconciles. `correct-match`
refuses to modify any match where `is_period_closed = true`.

## 4. Row Level Security

All writes to rating/match tables happen exclusively through Edge Functions
using the Postgres **service role** (which bypasses RLS) — the public
PostgREST surface is read-only for these tables by policy, not just by
convention.

```sql
-- Public read, no public write, on:
--   players, seasons, player_season_ratings, matches, weekly_rankings,
--   player_statistics
alter table <table> enable row level security;
create policy "public read" on <table> for select using (true);
-- no insert/update/delete policy defined => default deny for anon/authenticated

-- Fully private (no public policy at all), on:
--   admin_users, match_audit_log, rating_events
alter table <table> enable row level security;
-- admin_users: authenticated admin may read their own row
create policy "self read" on admin_users for select
  using (auth.uid() = id);
```

Admin identity: Supabase Auth (email/password), `admin_users.id = auth.users.id`
exactly as designed in Phase 1's schema. Provisioning an admin account is a
manual Supabase CLI/Studio step, not something a migration can do (Auth owns
its own user table).

## 5. Write API — four Edge Functions

All four require an authenticated request whose `auth.uid()` has a matching
row in `admin_users`; all run their DB work inside a single transaction so a
partial failure never leaves inconsistent state.

### 5.1 `enter-match`

`POST { season_id, match_date, player_a_id, player_b_id, frames_a, frames_b }`

1. For either player with no `player_season_ratings` row this season, insert
   one at the table's own baseline defaults (rating 1500, RD 350, volatility
   0.06 — Phase 1 migration's column defaults).
2. Insert the `matches` row (`winner_id` derived from the frame comparison,
   `entered_by` = calling admin's id, `is_period_closed = false`).
3. Call `applyInstantNudge` (Phase 1 Task 3) with both players' current
   `rating`/`rd` and the frame score.
4. Write two `rating_events` rows (`event_type = 'instant'`), one per player —
   player B's row derived per `applyInstantNudge`'s documented A-centric
   output: `expectedScoreB = 1 - expectedScoreA`, `actualScoreB = 1 -
   actualScoreA`, `deltaB = -deltaA`.
5. Update both players' `player_season_ratings.rating`, `matches_played`
   (+1), `is_provisional` (set to `matches_played < MIN_MATCHES_FOR_RANKING`,
   i.e. `false` once the player reaches the eligibility threshold), and
   `grade` (`gradeForRating`).
6. Recompute both players' `player_statistics` row using `winPercentage`,
   `currentStreak`, `longestStreak`, running frame totals,
   `averageOpponentRating`, `form_5`/`form_10`/`formScore` (Phase 1 Task 7),
   and add `calculateSeasonPoints` (Phase 1 Task 6) to
   `player_season_ratings.season_points`.
7. Write a `match_audit_log` row (`change_type = 'created'`,
   `changed_by` = calling admin).

### 5.2 `correct-match`

`PATCH { match_id, match_date?, frames_a?, frames_b? }`

1. Reject (400) if the target match's `is_period_closed = true`.
2. Set `is_voided = true` on the old row; write `match_audit_log`
   (`change_type = 'voided'`, `old_values`/`new_values` capturing the diff).
3. Insert the corrected match as a new row (same season/players unless
   explicitly changed).
4. **Replay this week only:** for each affected player, reset to their
   pre-week baseline — the `rating_after` of their most recent
   `weekly_reconciliation` or `season_carryover` `rating_events` row, or the
   season's baseline defaults if neither exists yet — then re-run
   `applyInstantNudge` for every non-voided match that player played this
   week, in original chronological order, with the correction taking the
   voided match's place in that order.
5. Overwrite that week's `instant` `rating_events` rows and the current
   `player_season_ratings`/`player_statistics` state with the replayed
   result.

### 5.3 `close-week`

`POST { season_id, week_ending }`

1. Gather every non-voided, `is_period_closed = false` match in `season_id`
   with `match_date <= week_ending`.
2. Per player who appears in that set: call `reconcilePeriod` (Phase 1 Task
   8) with their pre-period `(rating, rd, volatility)` and the list of
   opponents/results from step 1.
3. Update `player_season_ratings` with the reconciled `rating`/`rd`/
   `volatility` and recomputed `grade`.
4. Write one `rating_events` row per player (`event_type =
   'weekly_reconciliation'`, populating `volatility_before`/
   `volatility_after`).
5. Write one `weekly_rankings` row per player, using `computeLeaderboard`
   (Phase 1 Task 9) across all eligible players in the season for `rank`.
6. Set `is_period_closed = true` on every match gathered in step 1.

### 5.4 `start-season`

`POST { previous_season_id, new_season_name, start_date }`

1. Insert the new `seasons` row (`status = 'active'`).
2. For every player with a `player_season_ratings` row in
   `previous_season_id`: call `applySeasonCarryover` (Phase 1 Task 5) and
   insert their new-season `player_season_ratings` row from the result;
   write a `rating_events` row (`event_type = 'season_carryover'`).

## 6. Read API

Direct PostgREST queries cover most reads (e.g. `GET
/rest/v1/player_season_ratings?season_id=eq.<id>&order=rating.desc`). Two
views handle the joins/window-function logic PostgREST alone can't express:

```sql
create view leaderboard_view as
  select p.id as player_id, p.full_name, psr.season_id, psr.rating, psr.grade,
         psr.season_points,
         rank() over (partition by psr.season_id order by psr.rating desc) as rank
  from player_season_ratings psr
  join players p on p.id = psr.player_id
  where psr.matches_played >= 3; -- MIN_MATCHES_FOR_RANKING

create view grade_distribution_view as
  select season_id, grade, count(*) as player_count
  from player_season_ratings
  where matches_played >= 3
  group by season_id, grade;
```

`leaderboard_view` is the *live* leaderboard between weekly snapshots;
`weekly_rankings` rows remain the historical source of truth for past weeks
(rating history charts, "top movers this week", etc. — Phase 3 concerns).

## 7. Seed data

A script that calls `enter-match` repeatedly (not raw SQL inserts) to create
one season, ~30 players, and several weeks of matches, closing 2-3 weeks along
the way via `close-week`. This exercises the real pipeline so seeded data has
genuine, internally-consistent rating history, statistics, and season points
— and gives Phase 3 real `weekly_rankings` snapshots to chart.

## 8. Testing

Edge Functions stay thin (request parsing + calling already-tested
`src/rating/*.ts` functions + DB writes) — no new tests are needed for the
rating math itself (Phase 1's 55 unit tests already cover it). Phase 2 adds
integration tests that start the real local Supabase stack (`supabase
start`), call each Edge Function over HTTP, and assert on resulting database
state — the same real-database-over-mocks approach as Phase 1's
`schema.test.ts`.

## 9. Out of scope for this spec

Deferred to Phase 3 (frontend): all UI/UX, the odds display, rating history
charts, admin match-entry forms, and the frontend's own docker-compose
service. Deferred indefinitely (not part of any current phase): cross-period
match-correction replay (Phase 1 spec §3.4's full mechanism), cron-based
automatic week close, doubles/team matches.
