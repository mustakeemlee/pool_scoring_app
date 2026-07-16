# Self-Hosted Docker Compose Stack, Sub-phase A — Design

Status: Approved by user, 2026-07-16
Scope: A separate, production-shaped Docker Compose stack — self-hosted Postgres,
GoTrue (auth), PostgREST, Kong (API gateway), and a containerized frontend build —
that runs alongside (not instead of) the existing `supabase start` CLI workflow used
for day-to-day local development.

Builds on Phase 1 (`docs/superpowers/specs/2026-07-14-rating-engine-design.md`),
Phase 2 (`docs/superpowers/specs/2026-07-14-backend-api-design.md`, the four Edge
Functions, migrations under `supabase/migrations/`), and Phase 3
(`docs/superpowers/specs/2026-07-15-frontend-dashboard-design.md`, the `web/` app).
All three are complete and merged to master.

This is **Sub-phase A** of the "full docker-compose stack" work item. **Sub-phase
B** (self-hosting the four Edge Functions — enter-match, correct-match, close-week,
start-season — via a self-hosted Edge Runtime container) is a distinct follow-up
project, out of scope here; see §8.

## 1. Purpose

Phases 1-3 built the whole app against the Supabase CLI's local dev stack
(`supabase start`), which is explicitly documented as a local-development tool, not
meant for production. This phase is the first concrete step toward being able to
host this app somewhere real: a Docker Compose stack built from Supabase's official
self-hosting components (not the CLI), that can eventually be pointed at an actual
server once a hosting target is chosen. It is *not* that final deployment — no
hosting target, TLS, or domain is decided yet (see §8) — it's the infrastructure
groundwork, verifiable entirely on localhost.

## 2. Scope decisions locked in during brainstorming

- **Separate from daily dev, not a replacement.** `supabase start` remains the way
  you run the app day-to-day (fast, auto-migrations, hot reload, Studio). This
  compose stack is a distinct thing you spin up deliberately to check the app still
  works in something closer to how it'll eventually be hosted.
- **Production-shaped, not yet production-configured.** Self-hosted Postgres/
  GoTrue/PostgREST/Kong (the real self-host architecture), but plain HTTP, no
  reverse proxy or TLS this round — that's a real decision that depends on where
  this actually gets hosted, which isn't chosen yet.
- **Minimal service set (YAGNI).** Supabase's official self-host reference includes
  Storage, Realtime, imgproxy, and an analytics stack (Logflare/Vector). This app
  uses none of them anywhere in Phases 1-3, so all four are dropped entirely.
- **Studio dropped too.** Handy, but not needed for the app to function, and it
  needs its own `postgres-meta` sidecar. You already have Studio via `supabase
  start` for daily-dev data browsing — no need for a second copy here.
- **Edge Functions deferred to Sub-phase B.** Self-hosting the Edge Runtime
  correctly (JWT verification, import maps for the Deno-synced rating engine
  module) is its own scoped problem, comparable in size to the rest of this phase.
  Building it in the same pass would make this phase too large to review well —
  same reasoning that kept Phases 1-3 as separate specs. This means the four admin
  write actions will not work against this stack yet; only the public read-only
  pages and login will.

## 3. Services

Five containers, one Compose network:

| Service | Image | Role |
|---|---|---|
| `db` | `supabase/postgres` (pinned to major version 17, matching `supabase/config.toml`) | Schema, roles (`anon`/`authenticated`/`service_role`), extensions that a vanilla `postgres` image doesn't have |
| `auth` | `supabase/gotrue` | Email/password auth (admin login), same as the CLI's local Auth service |
| `rest` | `postgrest/postgrest` | The data API — public reads (`leaderboard_view`, `player_season_ratings`, etc.) and RLS enforcement, same as today |
| `kong` | `kong` (declarative mode) | Single entry point on port 8000, routes `/auth/v1/*` → `auth`, `/rest/v1/*` → `rest` — the same URL shape `supabase-js` already expects |
| `frontend` | built from `web/Dockerfile` | Production Vite build served as static files via `nginx:alpine` |

Not present: `storage`, `realtime`, `imgproxy`, `studio` + `postgres-meta`,
analytics. See §2 for why.

## 4. Database: image, migrations, seed data

- **Image**: `supabase/postgres`, not vanilla `postgres` — ships the `auth` schema,
  roles, and extensions the existing migrations and RLS policies assume.
- **Migrations**: reuse `supabase/migrations/*.sql` unchanged — no duplication, no
  new migration tool. Filenames are `YYYYMMDDHHMMSS_name.sql`, so alphabetical order
  is chronological order. Mounted straight into
  `/docker-entrypoint-initdb.d/`, which the Postgres image runs automatically, in
  order, against a fresh volume on first boot.
- **Seed data**: the existing `scripts/seed.mjs` (already exercises the full
  match-entry/week-close pipeline) is reused as-is, pointed at this stack via env
  vars instead of the CLI's. Not run automatically — a manual step (`npm run seed`
  with this stack's connection info), same as it is for the CLI stack today.

## 5. Auth, REST, and gateway wiring

- **Kong** is the single entry point (port 8000), using a declarative `kong.yml`
  adapted from Supabase's official self-host template, trimmed to two routes:
  `/auth/v1/*` → `auth`, `/rest/v1/*` → `rest`.
- **Secrets** (`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, Postgres password):
  self-hosting requires generating real values by hand — the CLI's well-known demo
  values (visible in `supabase status`) are not reused here. Generated once, stored
  in a gitignored `.env` at the compose root, consumed by `db`, `auth`, `rest`,
  `kong`, and passed as build args to `frontend` (see §6). The compose file and a
  short README note both state plainly that these are dev-grade values and **must
  be rotated** before this stack is ever pointed at a real, internet-facing host —
  until then it should only run on a trusted local/private network, consistent with
  the no-TLS decision in §2.

## 6. Frontend containerization

- **Multi-stage `web/Dockerfile`**: a `node` build stage running
  `npm ci && tsc -b && vite build`, then a lean `nginx:alpine` runtime stage that
  serves the resulting static `dist/` output.
- **Build context is the repo root, not `web/`.** `web/src/components/OddsWidget.tsx`
  imports directly from `../../../src/rating/odds.ts`, reaching outside `web/` into
  the shared Phase 1 rating engine. `docker-compose.yml`'s `frontend` service sets
  `build: { context: ., dockerfile: web/Dockerfile }` so that import resolves during
  the build.
- **Build-time env vars via Docker `ARG`, not `generate-env.mjs`.** That script
  shells out to `supabase status` to discover the CLI stack's URL/anon key —
  meaningless inside a Docker build, and the wrong target regardless (this stack
  needs its own Kong URL/anon key baked in). The Dockerfile instead takes
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as build `ARG`s, supplied via
  `docker-compose.yml`'s `build.args` from the same `.env` as §5.
  `scripts/generate-env.mjs` itself is untouched — still used for the CLI-based dev
  workflow.
- **The baked-in URL must be browser-reachable**, not a Docker-internal service
  name — it ends up in a static JS bundle loaded by the browser, so it has to be
  `http://localhost:8000` (Kong's host-mapped port), not `http://kong:8000`.
- **SPA fallback routing**: the nginx config includes a catch-all
  (`try_files $uri /index.html`) so direct navigation to client-routed paths like
  `/players/:id` or `/matches` doesn't 404 — the Vite dev server handles this
  automatically today; a plain static nginx server needs it spelled out.

## 7. Networking, ports, verification

- **Ports**: `kong` on `8000`, `frontend` on `8080` — both distinct from the CLI
  stack's `54321`-range ports, so the two stacks don't collide if both happen to be
  running.
- **Internal networking**: one Compose network; `kong` reaches `auth`/`rest` by
  service name. `frontend` is fully static (nginx serving pre-built files) and needs
  no internal network access.
- **Verification for this phase**: infrastructure, not application logic — no new
  automated tests (consistent with how Phase 2/3 didn't re-test already-tested rating
  math). "Done" means, verified manually: `docker compose up` brings up a healthy
  stack; migrations apply cleanly to a fresh volume; `npm run seed` (pointed at this
  stack) succeeds; the frontend at `localhost:8080` shows real seeded data on the
  leaderboard and player-profile pages; admin login works against self-hosted
  GoTrue. These steps are written up as a short runbook in the implementation.

## 8. Out of scope for this phase

Deferred to **Sub-phase B**: self-hosting the four Edge Functions (enter-match,
correct-match, close-week, start-season) via a self-hosted Edge Runtime container —
until then, admin write actions don't work against this stack, only against the CLI
stack. Deferred indefinitely / not yet decided: the actual hosting target (cloud VM,
on-prem, etc.), reverse proxy and TLS, a real domain, Storage/Realtime (only if the
app ever needs them), Supabase Studio for this stack, and CI/CD.
