# Pool League

An FPL-styled pool league scoring app: public leaderboard, match history,
player profiles with photos and rating charts, plus an admin section for
entering matches and managing seasons.

## Project structure — one repo, three layers

```
.
├── src/                  # Rating engine + backend test suites (TypeScript)
│   ├── rating/           #   Glicko-2/Elo, grades, season points, odds (pure logic)
│   ├── db/               #   schema / RLS / view integration tests
│   └── api/              #   edge-function API tests
├── supabase/
│   ├── migrations/       # The database schema — single source of truth
│   ├── functions/        # Edge functions: enter-match, correct-match,
│   │                     #   close-week, start-season
│   └── config.toml       # Supabase CLI config (project_id = pool-scoring-app)
├── web/                  # React + Vite + Tailwind frontend
├── docker/               # Self-hosted stack support files (kong, db-init)
├── docker-compose.yml    # OPTIONAL self-hosted "production-shaped" stack
└── scripts/              # Seeding + secrets helpers
```

There is **one application**. The phases you may see referenced in
`docs/` (rating engine → backend API → frontend → self-hosting) were
development milestones, not separate apps.

## Two ways to run it (pick ONE)

### A. Day-to-day development (recommended)

Uses the Supabase CLI's local stack (Docker project **pool-scoring-app**,
API on port 54321):

```
npm run supabase:start     # start local Supabase (db + auth + rest + storage)
npm run seed               # demo data
cd web && npm run dev      # frontend on http://localhost:5173
```

`web/npm run dev` auto-writes `web/.env.local` from `supabase status`, so the
frontend always points at the CLI stack. Apply new migrations to an
already-created stack with `npx supabase migration up` (or `npx supabase db
reset` to rebuild from scratch).

### B. Self-hosted stack (docker-compose.yml)

A production-shaped stack (Docker project **poolscoringapp**: postgres,
gotrue, postgrest, kong, nginx frontend, 4 edge-function containers).
Frontend on http://localhost:8080. See `docker/README.md` for the full
runbook:

```
node scripts/generate-selfhost-secrets.mjs      # once
docker compose --env-file .env.selfhost up -d --build
node scripts/seed-selfhost.mjs
```

Notes:
- **This is the production stack.** It is LAN-ready: port 8080 binds all
  interfaces, and the frontend proxies the API on the same origin, so league
  members open `http://<your-PC-IP>:8080` and everything works even if the
  PC's IP changes. Set `PUBLIC_APP_URL` in `.env.selfhost` to that URL so
  auth redirects are correct. Windows Firewall may prompt to allow port 8080.
- **Schema updates without data loss:** `node scripts/migrate-selfhost.mjs`
  applies new files from `supabase/migrations/` to the running database and
  records them in `public.selfhost_migrations`. For a database created
  before this script existed, run once with
  `--baseline-through <last-migration-present-at-creation>` first.
- Player photo uploads work here via the bundled `storage` service (files
  persist in the `storage-data` volume).

## Old Docker projects (historical)

Earlier phases left orphaned Docker stacks (`rating-engine-phase-1`,
`backend-api-phase2`, `audit-review-task1/4`). These were removed on
2026-07-19; only `poolscoringapp` (this stack) and the optional
`pool-scoring-app` CLI dev stack should exist.

## Tests

```
npm test                   # rating engine + db + api suites (repo root)
cd web && npm test         # frontend component/page/hook tests
```

## Troubleshooting: "no data is loading"

1. **Which stack is the app pointing at?** `web/.env.local` → port 54321
   means the CLI stack must be running (`npm run supabase:start`).
   http://localhost:8080 is the self-hosted stack.
2. **Is it seeded?** Empty DB = empty pages. Players only appear on the
   leaderboard after **3 completed matches** (`matches_played >= 3`).
3. **Are migrations current?** The 2026-07-19 player-photos migration must be
   applied or profile/match queries that select `photo_url` will error:
   CLI stack → `npx supabase migration up`; self-hosted →
   `node scripts/migrate-selfhost.mjs` (no data loss).
4. **Self-hosted frontend looks stale?** It's baked at build time — rerun
   `docker compose --env-file .env.selfhost up -d --build frontend`.
