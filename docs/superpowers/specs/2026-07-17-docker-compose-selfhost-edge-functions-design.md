# Self-Hosted Docker Compose Stack, Sub-phase B — Design

Status: Approved by user, 2026-07-17
Scope: Self-host the four Edge Functions (enter-match, correct-match, close-week,
start-season) for the docker-compose self-host stack, completing the admin write
path that Sub-phase A deferred.

Builds directly on Sub-phase A
(`docs/superpowers/specs/2026-07-16-docker-compose-selfhost-design.md`,
`docs/superpowers/plans/2026-07-16-docker-compose-selfhost-implementation.md`),
which is complete and merged to master: self-hosted Postgres, GoTrue, PostgREST,
Kong, and a containerized frontend, running alongside (not replacing) the
`supabase start` CLI workflow used for day-to-day development. Also builds on
Phase 2 (`docs/superpowers/specs/2026-07-14-backend-api-design.md`), which wrote
the four Edge Functions themselves and the Deno-synced copy of the rating engine
under `supabase/functions/_shared/rating/`.

## 1. Purpose

Sub-phase A deliberately left the four admin write actions unavailable on the
self-hosted stack — only public reads and admin login worked. This phase closes
that gap: self-hosting each function via its own `edge-runtime` container, wired
through Kong the same way the CLI's local stack already does it, so the whole
app (public pages *and* the weekly admin workflow) works end-to-end on the
self-hosted stack.

## 2. Scope decisions locked in during brainstorming

- **One `edge-runtime` container per function** (4 total), not one shared
  container with a routing layer. Each of the four functions currently calls
  `Deno.serve(...)` directly at its own top level rather than exporting a
  handler — the alternative (a single container running a thin `main/index.ts`
  router, matching Supabase's own official self-hosting reference) would
  require refactoring all four functions into exported handlers, touching
  already-tested Phase 2 code for no functional gain. Four containers costs a
  little more operational surface area but touches zero existing function code.
- **No mount-path or entrypoint reinvention.** Each container mounts the whole
  `supabase/functions/` directory read-only and points its entrypoint at its own
  `<name>/index.ts`, so the existing `../_shared/...` relative imports (used by
  every function for `requireAdmin`, `response`, `supabaseClients`, and the
  synced rating engine) resolve exactly as they do today. No changes to any
  function or shared helper.
- **Reuse Sub-phase A's secrets, no new ones.** Each container gets
  `SUPABASE_URL=http://kong:8000`, `SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY` from the same `.env.selfhost` Sub-phase A already
  generates.
- **Keep `verifyJWT` enabled** at the edge-runtime level for all four functions,
  matching real hosted Supabase's default and providing defense-in-depth
  alongside each function's own `requireAdmin()` check (which is unaffected —
  every function already requires a valid authenticated admin regardless of
  this gate).
- **Seed script upgraded to use the real functions.** `scripts/seed-selfhost.mjs`
  stops direct-inserting `player_season_ratings`/`matches` rows and instead
  calls `enter-match` then `close-week` over HTTP through Kong — mirroring the
  pattern `scripts/seed.mjs` already uses for the CLI stack — so the self-hosted
  stack's demo data is genuinely produced by the real Elo/Glicko-2 pipeline, not
  hand-picked placeholder numbers.
- **No new automated test suite.** Same testing philosophy as Sub-phase A:
  docker/curl verification with expected output. Phase 2's `src/api/*.test.ts`
  suite already covers the rating math itself against the CLI stack; this phase
  proves the self-hosted wiring works, not the math.
- **Out of scope, unchanged from Sub-phase A:** no TLS/reverse proxy, no changes
  to `supabase/config.toml` or the CLI workflow, no hot-reload (this isn't a
  live-edit dev loop — a one-shot serve mode is enough, matching the more
  stable fallback mode `supabase/functions/README.md` already documents for the
  CLI's own local dev setup).

## 3. Services added

Four new containers, same Compose network as Sub-phase A's `db`/`auth`/`rest`/
`kong`/`frontend`:

| Service | Image | Entrypoint | Kong route |
|---|---|---|---|
| `fn-enter-match` | `supabase/edge-runtime` (version pinned during planning to match the CLI's already-in-use tag) | `enter-match/index.ts` | `/functions/v1/enter-match/*` |
| `fn-correct-match` | same | `correct-match/index.ts` | `/functions/v1/correct-match/*` |
| `fn-close-week` | same | `close-week/index.ts` | `/functions/v1/close-week/*` |
| `fn-start-season` | same | `start-season/index.ts` | `/functions/v1/start-season/*` |

Each container: mounts `./supabase/functions` read-only, env vars
`SUPABASE_URL=http://kong:8000`, `SUPABASE_ANON_KEY=${ANON_KEY}`,
`SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}` (from `.env.selfhost`), no host
port published (internal-only, reached via Kong — consistent with Sub-phase A's
`auth`/`rest` services).

Exact image tag, the edge-runtime's CLI invocation/flags (e.g. `start
--main-service ... --port ...`), and the JWT-verification configuration
mechanism will be confirmed against the actual running image during
implementation planning — the same "prototype against a real disposable stack
before writing the plan" approach Sub-phase A used for Kong/GoTrue/PostgREST,
given how easy this class of config is to get subtly wrong.

## 4. Kong wiring

Four new service/route blocks added to `docker/kong.yml`, following the exact
shape of Sub-phase A's `auth-v1`/`rest-v1` blocks: `strip_path: true`, `cors`
plugin, routing `/functions/v1/<name>/*` to `http://fn-<name>:<port>/`. No
change to the existing `auth-v1*`/`rest-v1` blocks.

## 5. Seed script changes

`scripts/seed-selfhost.mjs` keeps its existing admin-user/season/player setup
(service-role inserts — these have no Edge Function equivalent, matching
`scripts/seed.mjs`'s own split), then replaces the direct
`player_season_ratings`/`matches` inserts with the same `enterMatch`/`closeWeek`
HTTP-call pattern `scripts/seed.mjs` already uses against the CLI stack, pointed
at `http://localhost:8000` instead. Output stays the same shape (prints the
season ID and admin credentials).

## 6. Runbook changes

`docker/README.md`'s manual verification checklist gains no *new* line item —
instead, the existing "seed it with realistic demo data" step in the setup
instructions now doubles as the write-path verification: because the rewritten
seed script calls `enter-match` and `close-week` for real, that step succeeding
is itself proof the admin write path works end-to-end. The checklist's
wording is updated to say so explicitly, so a reader understands why running
the seed script now counts as verifying more than it used to.

## 7. Testing

No new automated test suite, consistent with Sub-phase A. Verification is
docker/curl commands with expected output, run and confirmed during
implementation: bring up all four new containers, confirm each responds
through Kong, run the rewritten seed script against a fresh stack and confirm
it succeeds (proving `enter-match` and `close-week` both work end-to-end
through Kong → edge-runtime → PostgREST/GoTrue → Postgres), then spot-check
`correct-match` and `start-season` directly via curl (since the seed script's
own flow doesn't call them, mirroring `scripts/seed.mjs`'s own scope on the CLI
stack).

## 8. Out of scope for this phase

Same exclusions as Sub-phase A (§8 of that spec): hosting target, TLS/reverse
proxy, Storage/Realtime/Studio, CI/CD. Additionally out of scope here: any
change to the four Edge Functions' own logic (already correct and tested by
Phase 2), and any change to `scripts/seed.mjs` (the CLI-stack seed script,
untouched).
