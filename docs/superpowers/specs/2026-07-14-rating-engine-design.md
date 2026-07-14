# Pool League Rating & Grading Engine — Design (Phase 1)

Status: Approved by user, 2026-07-14
Scope: Rating/grading mathematics and database schema only. Backend/API (Phase 2) and
frontend dashboard (Phase 3) are separate specs, built after this one.

## 1. Purpose

Automatically rank and grade amateur pool league players from manually-entered weekly
match results. Not a gambling application — the "odds engine" produces statistical
probabilities only, no wagering. Must scale to 20–500 players, preserve full history,
and carry skill signal across seasons.

## 2. Scope decisions locked in during brainstorming

- Singles only (no doubles/teams).
- A "match" = one weekly fixture between two players, played as a race-to-N frames.
  The frame score (e.g. 5-3) is stored as two integer tallies (`frames_a`, `frames_b`)
  on the match row — no per-frame child table, since nothing in scope needs per-frame
  order or identity (only the aggregate tally, for stats and the margin-of-victory
  multiplier). Can be extended with a `frames` child table later without breaking
  this schema if frame-level detail is ever needed.
- Rating updates happen **once per fixture** (not once per frame), with the frame
  margin scaling the size of the rating change.
- Deployment: full docker-compose stack — Supabase's local Docker services plus a
  containerized React frontend, all launched with `docker compose up` (Phase 2/3).

## 3. Rating Algorithm

A two-layer hybrid: instant Elo-style feedback per match, reconciled weekly by the
real Glicko-2 batch algorithm. This satisfies "ratings change after every match"
(instant layer) while keeping the rating mathematically sound and capturing
uncertainty/consistency over time (weekly layer) — one displayed "Current Rating"
per player, not two competing numbers.

### 3.1 Player rating state

Stored per player per season in `player_season_ratings`, carried into the next
season via the soft-reset described in §5.

| Field | Start value | Meaning |
|---|---|---|
| `rating` (r) | 1500 | Current skill estimate |
| `rd` (RD) | 350, floor 50 | Rating deviation — uncertainty in the estimate |
| `volatility` (σ) | 0.06 | Glicko-2 volatility — how erratic a player's results are |

A new player starts at the baseline rating with maximum RD. No separate
"provisional" rating rule is needed — the high initial RD naturally produces large
early swings that settle as the system learns the player's real level. (Ranking
*eligibility* still requires 3 matches — see §4.2 — but that's a display rule, not a
rating rule.)

### 3.2 Layer 1 — Instant Elo nudge (applied immediately on match entry)

```
E_A = 1 / (1 + 10^(-(R_A - R_B) / 400))        # expected win probability for A
S_A = 1 if A won the fixture, else 0            # no draws in race-to-N pool

K_effective = K_min + (K_max - K_min) × (RD_A - RD_min) / (RD_max - RD_min)
    where K_min = 10, K_max = 50, RD_min = 50, RD_max = 350
    # higher current RD (new/returning player) → larger K → bigger rating swings

MoV_multiplier = 1 + 0.5 × (margin - 1) / (race_length - 1)
    where margin = |frames_a - frames_b|, race_length = max(frames_a, frames_b)
    # narrowest possible win (e.g. 5-4) → ×1.0
    # whitewash (e.g. 5-0) → ×1.5

ΔR_A = K_effective × MoV_multiplier × (S_A - E_A)
R_A_new = R_A + ΔR_A
R_B_new = R_B - ΔR_A         # zero-sum at this layer
```

Why this satisfies the business rules:
- **Upsets cause larger adjustments**: when a lower-rated player wins, `E_A` is
  small, so `(S_A - E_A)` is large.
- **Expected wins cause smaller adjustments**: when the favorite wins as expected,
  `E_A` is already close to 1, so `(S_A - E_A)` is small.
- **New/uncertain players move faster**: `K_effective` scales directly with RD.

This layer writes one row to `rating_events` (`event_type = 'instant'`) per player
per match, and updates `player_season_ratings.rating` immediately so the leaderboard
reflects the result the moment it's entered.

### 3.3 Layer 2 — Weekly Glicko-2 reconciliation (runs once per rating period close)

Standard Glicko-2 batch algorithm (Glickman, 2001/2012), applied at the end of each
week using each player's **pre-period** `(r, RD, σ)` and the full set of results from
matches played that week. This is the authoritative update — it supersedes the
cumulative effect of that week's instant nudges.

```
# Convert to Glicko-2 internal scale
μ = (r - 1500) / 173.7178
φ = RD / 173.7178

# For each opponent j faced this period:
g(φ_j) = 1 / sqrt(1 + 3φ_j² / π²)
E(μ, μ_j, φ_j) = 1 / (1 + exp(-g(φ_j) · (μ - μ_j)))

# Estimated variance and improvement
v = [ Σ_j g(φ_j)² · E_j · (1 - E_j) ]⁻¹
Δ = v · Σ_j g(φ_j) · (S_j - E_j)

# Solve for new volatility σ' — standard Glicko-2 Illinois-algorithm root-find:
τ = 0.5                                    # system constant, controls how fast
                                            # volatility itself is allowed to change
a = ln(σ²)
f(x) = [ e^x · (Δ² - φ² - v - e^x) ] / [ 2 · (φ² + v + e^x)² ]  -  (x - a) / τ²

A = a
if Δ² > φ² + v:
    B = ln(Δ² - φ² - v)
else:
    k = 1
    while f(a - k·τ) < 0: k += 1
    B = a - k·τ

fA, fB = f(A), f(B)
while |B - A| > 0.000001:
    C = A + (A - B) · fA / (fB - fA)
    fC = f(C)
    if fC · fB < 0: (A, fA) = (B, fB)
    else: fA = fA / 2
    (B, fB) = (C, fC)

σ' = e^(A / 2)

φ* = sqrt(φ² + σ'²)
φ' = 1 / sqrt(1/φ*² + 1/v)
μ' = μ + φ'² · Σ_j g(φ_j) · (S_j - E_j)

# Convert back to rating scale
r' = 173.7178 · μ' + 1500
RD' = 173.7178 · φ'
```

If a player faced no opponents in the period, only RD grows (per the Glicko-2
"no games" case: `φ' = sqrt(φ² + σ²)`), reflecting reduced confidence in an
inactive player's rating. σ is otherwise the mechanism that captures **long-term
consistency**: a player whose results closely track their expected outcomes keeps a
low, stable σ; one who alternates big upsets and upset losses accumulates a higher
σ, which in turn keeps their RD (and thus `K_effective` next period) from settling
down — directly implementing "long-term consistency should matter more than
short-term streaks."

This layer writes one `rating_events` row per player per period
(`event_type = 'weekly_reconciliation'`), overwrites `player_season_ratings`
with the reconciled `(r, RD, σ)`, and writes a `weekly_rankings` snapshot row per
player (§6).

### 3.4 Editing a past match

Because both layers are path-dependent, correcting a match requires replaying
forward. The match is voided (not deleted) and a corrected match is entered;
`rating_events` from the voided match's period onward are recomputed by re-running
Layer 1 for the corrected week and re-running Layer 2 for every subsequent period
already closed. This is expensive only in the rare correction case, not in normal
operation.

## 4. Grading & Ranking

### 4.1 Grade (pure lookup, not stored state)

```
A+  rating ≥ 2000
A   1800 ≤ rating < 2000
B+  1600 ≤ rating < 1800
B   1400 ≤ rating < 1600
C+  1200 ≤ rating < 1400
C   1000 ≤ rating < 1200
D   rating < 1000
```

Recomputed and written to `player_season_ratings.grade` every time `rating`
changes (both layers). Storing it (rather than computing at read time) keeps grade
filters and the grade-distribution chart cheap.

### 4.2 Ranking

- Eligibility: `matches_played ≥ 3` this season (carryover from a previous season,
  per §5, counts toward this).
- Rank is **not stored** — it's the row position of
  `ORDER BY rating DESC` among eligible players, computed at read time. It changes
  whenever *any* player's rating changes, not just the row in question, so storing
  it would mean rewriting the whole table on every match; a read-time query is both
  simpler and cheap at this scale (≤500 rows).
- Players below the threshold appear on their own profile, marked **Provisional**,
  with their live rating — excluded from the public leaderboard and the grade
  distribution chart until eligible.

## 5. Season Transition (soft reset)

At the start of a new season, each player's rating regresses partway toward the
baseline, and uncertainty increases slightly to reflect a fresh season:

```
new_rating = 1500 + 0.75 × (old_rating - 1500)
new_rd     = min(350, old_rd + 50)
new_volatility = old_volatility        # unchanged; σ reflects a durable trait
```

A `rating_events` row (`event_type = 'season_carryover'`) is written for every
player at this transition, so the rating history chart shows the adjustment
explicitly rather than an unexplained jump. This satisfies "grading should include
results of previous seasons" (skill persists, regressed toward the mean) while
preventing one dominant season from permanently locking in a rating and giving
under-performers a path back.

## 6. Player Statistics

Maintained in `player_statistics`, updated transactionally whenever a match is
entered (or replayed after a correction):

```
win_pct              = wins / (wins + losses) × 100
current_streak       = signed count of consecutive most-recent same-result matches
                        (e.g. +3 = won last 3 in a row, -2 = lost last 2 in a row)
longest_streak       = max historical consecutive-win count
frames_won / frames_lost = running sum of frame tallies across all matches
avg_opponent_rating  = mean of opponent's rating-at-time-of-match, across all matches
form_5               = win % over the last 5 matches
form_10              = win % over the last 10 matches
form_score           = 0.65 × form_5 + 0.35 × form_10       # headline 0–100 number
```

## 7. Season Points (Fantasy-Premier-League-inspired performance ladder)

A second, complementary leaderboard to Rating. Rating measures underlying skill
(Elo/Glicko — can rise on a narrow loss to a stronger opponent). Season Points
measures accumulated in-season performance (monotonically non-negative, resets
each season):

```
Win              = 3 pts
Loss             = 0 pts
Frame bonus      = +1 pt per frame won                (rewards competitive losses too)
Upset bonus      = if won AND opponent's rating > own rating:
                     + min(5, round((R_opponent - R_self) / 100))
Whitewash bonus  = +2 pts for winning by the maximum possible margin (e.g. 5-0)
```

## 8. Odds Engine (statistical only — no betting features)

```
P(A beats B)          = 1 / (1 + 10^(-(R_A - R_B) / 400))
Implied decimal odds  = 1 / P(A beats B)
```

Example: R_A = 1700, R_B = 1500 → P(A wins) = 1/(1+10^-0.5) ≈ 76.0%, implied odds
≈ 1.32. Always labeled as a statistical estimate in any UI that surfaces it; no
wagering functionality is implemented anywhere in this system.

## 9. Database Schema

```
players
  id (uuid, pk), full_name, email (nullable), joined_date, is_active,
  created_at, updated_at

seasons
  id (uuid, pk), name, start_date, end_date (nullable),
  status (draft | active | completed), created_at, updated_at

player_season_ratings                 -- "Ratings" table: one row per player per season
  id (pk), player_id (fk players), season_id (fk seasons),
  rating, rd, volatility, matches_played, is_provisional (bool),
  grade (derived, recomputed on every rating change), season_points,
  created_at, updated_at
  unique(player_id, season_id)
  -- current "rank" is intentionally NOT a column here; see §4.2

matches                               -- "Matches" table: one row per weekly fixture
  id (pk), season_id (fk), match_date,
  player_a_id (fk players), player_b_id (fk players),
  frames_a (int), frames_b (int), winner_id (fk players),
  entered_by (fk admin_users), is_voided (bool, default false),
  created_at, updated_at
  -- corrections void + re-enter rather than hard delete, preserving history

match_audit_log                       -- edit accountability
  id (pk), match_id (fk), changed_by (fk admin_users),
  change_type (created | updated | voided),
  old_values (jsonb), new_values (jsonb), changed_at

rating_events                         -- append-only ledger of every rating change
  id (pk), match_id (fk, nullable for season-carryover events),
  player_id (fk), season_id (fk),
  rating_before, rd_before, rating_after, rd_after,
  expected_score, actual_score, delta,
  event_type (instant | weekly_reconciliation | season_carryover),
  period_end_date (nullable), created_at
  -- source of truth for the Rating History Chart and for replaying a
  -- correction forward from the affected match

weekly_rankings                       -- "Weekly Rankings" table: period-close snapshot
  id (pk), season_id (fk), week_ending (date), player_id (fk),
  rating, rd, rank, grade, win_pct, form_score, season_points, created_at
  unique(season_id, week_ending, player_id)
  -- drives Top Movers, Most Improved, and weekly-resolution chart points

player_statistics                     -- "Statistics" table: aggregated, updated on entry
  id (pk), player_id (fk), season_id (fk),
  wins, losses, win_pct (generated), current_streak, longest_streak,
  frames_won, frames_lost, avg_opponent_rating,
  form_5, form_10, form_score, updated_at
  unique(player_id, season_id)

admin_users                           -- minimal here; fleshed out in Phase 2 with Supabase Auth
  id (uuid, pk = auth.users.id), display_name, role, created_at
```

**Data flow:** entering a `match` writes one `rating_events` (instant) row per
player, updates `player_season_ratings` and `player_statistics` immediately. The
weekly reconciliation job reads all of a period's `matches`, writes one
`rating_events` (weekly_reconciliation) row per player, updates
`player_season_ratings`, and writes the `weekly_rankings` snapshot. Editing a match
voids it and replays `rating_events` forward from that point (§3.4).

## 10. Out of scope for this spec

Deferred to Phase 2 (backend/API, Supabase local Docker) and Phase 3 (frontend
dashboard): Supabase Auth/RLS design, the weekly-reconciliation job's execution
mechanism (edge function vs. scheduled job), REST/RPC API shape, seed data,
docker-compose wiring, and all UI/UX.
