# Self-hosted Docker Compose stack (Sub-phase A)

A separate, production-shaped stack -- self-hosted Postgres, GoTrue,
PostgREST, Kong, and the containerized frontend -- alongside (not replacing)
the `supabase start` CLI workflow used for day-to-day development. See
`docs/superpowers/specs/2026-07-16-docker-compose-selfhost-design.md` for the
full design.

Edge Functions (the four admin write actions -- enter-match, correct-match,
close-week, start-season) are not part of this stack yet; that's Sub-phase B.
Only the public read-only pages and admin login work here.

## First-time setup

1. Generate secrets (writes `.env.selfhost`, gitignored -- refuses to run if
   the file already exists):
   ```
   node scripts/generate-selfhost-secrets.mjs
   ```
2. Bring up the stack:
   ```
   docker compose --env-file .env.selfhost up -d --build
   ```
3. Seed it with realistic demo data:
   ```
   node scripts/seed-selfhost.mjs
   ```
4. Open http://localhost:8080 -- you should see the seeded players on the
   leaderboard, grade distribution, and match history pages.

## Manual verification checklist

- [ ] `docker compose --env-file .env.selfhost ps` shows all 5 services
      (db, auth, rest, kong, frontend) as `Up`/`healthy`.
- [ ] http://localhost:8080/ shows the seeded leaderboard.
- [ ] http://localhost:8080/players/<a-seeded-player-id> shows that player's
      profile.
- [ ] http://localhost:8080/grades shows the seeded grade distribution.
- [ ] http://localhost:8080/matches shows the seeded matches.
- [ ] Logging in at http://localhost:8080/admin/login with the email/password
      printed by `scripts/seed-selfhost.mjs` succeeds and reaches the admin
      layout.

## Tearing down

```
docker compose --env-file .env.selfhost down -v
```

`-v` also removes the Postgres data volume -- the next `up` starts from a
fresh database and re-applies migrations.

## Security note

`.env.selfhost` holds dev-grade secrets (JWT signing secret, Postgres
password, anon/service-role keys) generated for local use. **Rotate all of
them** before ever pointing this stack at a real, internet-facing host --
this phase deliberately has no TLS or reverse proxy, so it should only run on
a trusted local/private network until a hosting decision is made.
