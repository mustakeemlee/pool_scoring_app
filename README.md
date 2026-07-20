# Pool League

An FPL-styled pool league scoring app: public leaderboard, match history,
player profiles with photos and rating charts, plus an admin section for
entering matches and managing seasons.

## Project structure — one repo, three layers

```
.
├── src/                  # Rating engine + backend test suites (TypeScript)
│   ├── rating/           #   Glicko-2/Elo, grades, season points, odds (pure logic)
│   ├── db/                #   schema / RLS / view integration tests (scratch schema per run)
│   └── api/               #   edge-function API tests (against deployed Supabase Cloud functions)
├── supabase/
│   ├── migrations/       # The database schema — single source of truth
│   ├── functions/        # Edge functions: enter-match, correct-match,
│   │                      #   close-week, start-season
│   └── config.toml        # Supabase CLI config (project_id = pool-scoring-app)
├── web/                  # React + Vite + Tailwind frontend
├── docker-compose.yml    # Single frontend container, talks directly to Supabase Cloud
└── scripts/              # Seeding + shared env loader
```

There is **one application**. The phases you may see referenced in
`docs/` (rating engine → backend API → frontend → cloud hosting) were
development milestones, not separate apps.

## Runtime model

Everything — local dev, the automated test suite, and the deployed app —
points at one Supabase Cloud project. There is no local Postgres/Auth/REST
stack and no self-hosted Kong/edge-runtime containers; the database, auth,
REST API, and all four admin Edge Functions live on Supabase Cloud. The only
thing that runs locally in Docker is the frontend: a single nginx container
serving the built React app, talking to the cloud project directly over
HTTPS.

### First-time setup

1. Copy `.env.example` to `.env` and fill in your Supabase Cloud project's
   values (Project Settings → API and → Database in the Supabase dashboard).
2. Push the schema and deploy the functions (see
   `supabase/functions/README.md` for the `SUPABASE_DB_URL` secret step):
   ```
   npx supabase db push
   npx supabase functions deploy
   ```
3. Seed demo data:
   ```
   npm run seed
   ```
4. Run the frontend:
   ```
   cd web && npm run dev      # http://localhost:5173
   ```
   or as a single Docker container:
   ```
   docker compose up -d --build   # http://localhost:8081
   ```

`web/npm run dev`/`build` auto-write `web/.env.local` from the root `.env`,
so the frontend always points at your Supabase Cloud project.

## Tests

```
npm test                   # rating engine + db + api suites (repo root)
cd web && npm test         # frontend component/page/hook tests
```

`npm test` runs entirely against the Supabase Cloud project in your `.env`:
`src/db` applies the full migration set into a fresh, uniquely-named scratch
*schema* per test file (dropped afterward), and `src/api` calls the real
deployed Edge Functions over HTTPS, deleting everything it creates when each
file finishes. No local database is ever created or reset.

## Troubleshooting: "no data is loading"

1. **Is `.env` filled in?** `web/.env.local` (auto-generated) must contain a
   real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — if the app throws
   "Missing VITE_SUPABASE_URL" in the browser console, re-run
   `npm run env:generate` inside `web/` after fixing the root `.env`.
2. **Is it seeded?** Empty DB = empty pages. Players only appear on the
   leaderboard after **3 completed matches** (`matches_played >= 3`).
3. **Are migrations current?** Run `npx supabase db push` to apply anything
   new in `supabase/migrations/`.
4. **Docker frontend looks stale?** It's baked at build time — rerun
   `docker compose up -d --build frontend`.
