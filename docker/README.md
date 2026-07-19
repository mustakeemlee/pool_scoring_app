# Self-hosted Docker Compose stack (Sub-phase A)

A separate, production-shaped stack -- self-hosted Postgres, GoTrue,
PostgREST, Kong, and the containerized frontend -- alongside (not replacing)
the `supabase start` CLI workflow used for day-to-day development. See
`docs/superpowers/specs/2026-07-16-docker-compose-selfhost-design.md` for the
full design.

The four admin write actions (enter-match, correct-match, close-week,
start-season) are self-hosted here too, one `edge-runtime` container per
function -- the whole app, public pages and the admin workflow, works
end-to-end on this stack.

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
3. Seed it with realistic demo data -- this now calls the real `enter-match`
   and `close-week` functions through Kong, so a successful run also proves
   the admin write path works end-to-end (not just the public read path):
   ```
   node scripts/seed-selfhost.mjs
   ```
4. Open http://localhost:8080 -- you should see the seeded players on the
   leaderboard, grade distribution, and match history pages.

**Ports in use:** if `up` fails with a "port is already allocated" error for
8080 or 8000, something else on your machine is already using that port --
edit the host-port field of the corresponding `ports:` mapping in
`docker-compose.yml` (e.g. `"127.0.0.1:8081:80"`) and adjust the URLs above to
match.

**Network exposure:** both published ports bind to `127.0.0.1` only, so the
stack is reachable from this machine but not from other devices on the same
network -- a deliberate default for a single-trusted-machine dev stack that
has no TLS or reverse proxy. If you genuinely want LAN access, drop the
`127.0.0.1:` prefix from the `ports:` mapping (e.g. `"8080:80"`) so it binds
all interfaces again.

**Re-seeding:** `scripts/seed-selfhost.mjs` always inserts new rows -- running
it twice against the same stack duplicates the demo data (you'll see doubled
leaderboard ranks). Tear down with `-v` (see below) before re-seeding.

## Manual verification checklist

- [ ] `docker compose --env-file .env.selfhost ps` shows all 9 services
      (db, auth, rest, kong, frontend, fn-enter-match, fn-correct-match,
      fn-close-week, fn-start-season) as `Up`. Only `db` and `kong` have
      healthchecks, so only those two additionally show `healthy`; the other
      seven have no healthcheck and stay at plain `Up`.
- [ ] http://localhost:8080/ shows the seeded leaderboard.
- [ ] http://localhost:8080/players/<a-seeded-player-id> shows that player's
      profile.
- [ ] http://localhost:8080/grades shows the seeded grade distribution.
- [ ] http://localhost:8080/matches shows the seeded matches.
- [ ] Logging in at http://localhost:8080/admin/login with the email/password
      printed by `scripts/seed-selfhost.mjs` succeeds and reaches the admin
      layout.

## Tearing down

Stop the stack but keep its data -- the named `pgdata` volume persists, so the
next `up` resumes from the same database:

```
docker compose --env-file .env.selfhost down
```

Stop the stack **and** wipe its data -- `-v` removes the `pgdata` volume, so
the next `up` starts from a fresh database and re-applies migrations:

```
docker compose --env-file .env.selfhost down -v
```

## Security note

`.env.selfhost` holds dev-grade secrets (JWT signing secret, Postgres
superuser password, the `supabase_auth_admin` (`AUTH_DB_PASSWORD`),
`authenticator` (`AUTHENTICATOR_DB_PASSWORD`) and `service_role`
(`SERVICE_ROLE_DB_PASSWORD`, used by the function containers' direct Postgres
connection) per-role database passwords, and anon/service-role keys) generated
for local use. **Rotate all of
them** before ever pointing this stack at a real, internet-facing host --
this phase deliberately has no TLS or reverse proxy, so it should only run on
a trusted local/private network until a hosting decision is made.

**Rotating secrets (or upgrading an existing stack onto this version) requires
a full reset, not just editing `.env.selfhost`.** The per-role database
passwords are only ever applied by `docker/db-init/zz-set-role-passwords.sh`,
which -- like all `docker-entrypoint-initdb.d` scripts -- only runs the very
first time a fresh `pgdata` volume is initialized. Regenerating `.env.selfhost`
(or hand-editing it) and running `up` again does **not** re-apply the new
passwords to the existing roles, since the volume already exists; the services
would then present new passwords against roles still holding the old ones and
fail to connect. To actually rotate, or to pick up this change on a volume
created before it existed: `docker compose --env-file .env.selfhost down -v`
(destroys data), delete and regenerate `.env.selfhost`, then `up` again fresh.
