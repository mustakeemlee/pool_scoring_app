# Audit Fixes: Docker-Compose Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every Critical/Important/Minor finding from the 2026-07-16 production-readiness audit that touches the self-hosted docker-compose stack (`docker-compose.yml`, `docker/*`, `scripts/generate-selfhost-secrets.mjs`, `scripts/seed-selfhost.mjs`, `web/Dockerfile`).

**Architecture:** No structural changes to the stack's shape (same 9 services) — these are hardening fixes: real data persistence, correct health-checking, restart policies, per-role secret isolation, narrower network exposure, scoped CORS, and a couple of script/documentation accuracy fixes. This is infra, not application code — every change in Task 1 must be verified by actually bringing the stack up and observing real behavior, matching how this stack was originally built (this project has a established practice of prototyping infra changes against the real images before trusting them, because subtle config mistakes here are easy to make and easy to miss by reading YAML alone).

**Tech Stack:** Docker Compose (existing services/images, unchanged versions), no new dependencies.

## Global Constraints

- Do NOT change any image version/tag already pinned in `docker-compose.yml` (postgres, gotrue, postgrest, kong, edge-runtime) — those are deliberate, already-verified pins from earlier phases.
- Do NOT add TLS, a reverse proxy, or change the hosting story — explicitly out of scope, unchanged from prior phases.
- Every change must be verified against the REAL running stack (`docker compose --env-file .env.selfhost up -d --build`), not just read from the YAML — this stack has a documented history of subtle config bugs (role passwords, function ownership, base64 URL-safety) that were only caught by live verification.
- `docker/README.md` must stay accurate to whatever the stack actually does after these changes — every claim in it is a correctness requirement, not just documentation.

---

### Task 1: Compose-file hardening — persistence, healthchecks, restart policies, secrets, network exposure, CORS

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker/kong.yml`
- Modify: `docker/db-init/zz-set-role-passwords.sh`
- Modify: `scripts/generate-selfhost-secrets.mjs`
- Modify: `docker/README.md`

**Interfaces:**
- Produces: two new secrets in `.env.selfhost` — `AUTH_DB_PASSWORD` (used by GoTrue's `supabase_auth_admin` role) and `AUTHENTICATOR_DB_PASSWORD` (used by PostgREST's `authenticator` role) — alongside the existing `JWT_SECRET`/`POSTGRES_PASSWORD`/`ANON_KEY`/`SERVICE_ROLE_KEY`. `POSTGRES_PASSWORD` remains the superuser (`supabase_admin`) password only, no longer reused by any other role.

- [ ] **Step 1: Fix the Critical — no persistent Postgres volume**

  `docker-compose.yml`'s `db` service currently has no volume for `/var/lib/postgresql/data`, so all data lives on the container's writable layer and is lost on `docker compose down`, contradicting the README's own (currently false) claim that plain `down` preserves data. Add a named volume:

  ```yaml
  services:
    db:
      # ...existing config...
      volumes:
        - pgdata:/var/lib/postgresql/data
        - ./supabase/migrations:/docker-entrypoint-initdb.d/migrations:ro
        - ./docker/db-init/zz-set-role-passwords.sh:/docker-entrypoint-initdb.d/zz-set-role-passwords.sh:ro

  volumes:
    pgdata:
  ```
  (Add the top-level `volumes:` key at the same indentation level as `services:`, once, at the end of the file.)

- [ ] **Step 2: Fix the reproducible first-boot healthcheck failure and the wrong-database probe**

  The `db` healthcheck has no `start_period`, so on a genuinely fresh volume (initdb + migrations + role setup + restart) it can exceed the 10×5s retry budget and fail the whole `up`. It also probes `pg_isready -U supabase_admin` with no `-d`, which defaults to a database named after the user (`supabase_admin`) — not the real database (`postgres`) — so it's accidentally checking a database that doesn't exist (still passes, since `pg_isready` only checks the server accepts connections, but it's not checking what it looks like it's checking, and spams a `FATAL: database "supabase_admin" does not exist` log line every interval). Fix both:

  ```yaml
  healthcheck:
    test: ["CMD", "pg_isready", "-U", "supabase_admin", "-d", "postgres"]
    interval: 5s
    timeout: 5s
    retries: 10
    start_period: 60s
  ```

- [ ] **Step 3: Add restart policies to every service**

  No service has a restart policy, so a transient crash leaves it down permanently. Add `restart: unless-stopped` to all 9 services (`db`, `auth`, `rest`, `kong`, `frontend`, `fn-enter-match`, `fn-correct-match`, `fn-close-week`, `fn-start-season`).

- [ ] **Step 4: Give the most-exposed database roles their own passwords instead of sharing the superuser's**

  Currently `docker/db-init/zz-set-role-passwords.sh` sets `authenticator`, `supabase_auth_admin`, and `supabase_storage_admin` all to `$POSTGRES_PASSWORD` — the same password as the `supabase_admin` superuser. `authenticator` is what PostgREST authenticates as, and it's the role parsing every anon-supplied request; if its credentials ever leaked (env exposure, a future port publish, an SSRF in the REST layer), that would currently hand over full superuser access, not just PostgREST-level access. `supabase_storage_admin` is set pointlessly — there's no storage service in this stack.

  1. In `scripts/generate-selfhost-secrets.mjs`, generate two more secrets alongside the existing ones:
     ```js
     const authDbPassword = base64url(randomBytes(24));
     const authenticatorDbPassword = base64url(randomBytes(24));
     ```
     Add them to the written `.env.selfhost` content:
     ```
     AUTH_DB_PASSWORD=${authDbPassword}
     AUTHENTICATOR_DB_PASSWORD=${authenticatorDbPassword}
     ```
     Also add the two new (empty) keys to `.env.selfhost.example` with the same documentation comment style already there.

  2. In `docker-compose.yml`:
     - `db` service's `environment:` block needs both new vars passed through (the init script running inside this container reads them from its own environment):
       ```yaml
       environment:
         POSTGRES_USER: supabase_admin
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
         POSTGRES_DB: postgres
         JWT_SECRET: ${JWT_SECRET}
         AUTH_DB_PASSWORD: ${AUTH_DB_PASSWORD}
         AUTHENTICATOR_DB_PASSWORD: ${AUTHENTICATOR_DB_PASSWORD}
       ```
     - `auth` service's `GOTRUE_DB_DATABASE_URL` changes from `${POSTGRES_PASSWORD}` to `${AUTH_DB_PASSWORD}`:
       ```yaml
       GOTRUE_DB_DATABASE_URL: postgresql://supabase_auth_admin:${AUTH_DB_PASSWORD}@db:5432/postgres
       ```
     - `rest` service's `PGRST_DB_URI` changes from `${POSTGRES_PASSWORD}` to `${AUTHENTICATOR_DB_PASSWORD}`:
       ```yaml
       PGRST_DB_URI: postgresql://authenticator:${AUTHENTICATOR_DB_PASSWORD}@db:5432/postgres
       ```

  3. In `docker/db-init/zz-set-role-passwords.sh`, use the two distinct passwords and drop the pointless `supabase_storage_admin` line entirely:
     ```sh
     #!/bin/sh
     set -e
     psql -v ON_ERROR_STOP=1 --no-password --no-psqlrc -U supabase_admin -d "$POSTGRES_DB" <<-EOSQL
       ALTER ROLE authenticator WITH PASSWORD '$AUTHENTICATOR_DB_PASSWORD';
       ALTER ROLE supabase_auth_admin WITH PASSWORD '$AUTH_DB_PASSWORD';
       DO \$\$
       DECLARE
         r record;
       BEGIN
         FOR r IN
           SELECT p.oid::regprocedure AS sig
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'auth'
         LOOP
           EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', r.sig);
         END LOOP;
       END
       \$\$;
     EOSQL
     ```
     (This file must stay LF-only per the repo's `.gitattributes` — don't let your editor/tooling introduce CRLF.)

- [ ] **Step 5: Bind the two published ports to localhost instead of every interface**

  `kong` (`8000:8000`) and `frontend` (`8080:80`) currently bind Docker's default `0.0.0.0`, making them reachable from any device on the same network — more exposure than a single-trusted-machine dev stack needs by default. Bind explicitly to loopback:
  ```yaml
  kong:
    # ...
    ports:
      - "127.0.0.1:8000:8000"

  frontend:
    # ...
    ports:
      - "127.0.0.1:8080:80"
  ```

- [ ] **Step 6: Disable open self-registration**

  `GOTRUE_DISABLE_SIGNUP: "false"` on the `auth` service lets anyone reach `/auth/v1/signup` and create a confirmed account, unnecessary for an admin-only tool (the seed script and any real usage create admins via the service-role `auth.admin.createUser` API, which doesn't go through public signup). Change to:
  ```yaml
  GOTRUE_DISABLE_SIGNUP: "true"
  ```

- [ ] **Step 7: Add log rotation to every service**

  No service has logging limits, so container logs (already noisier than necessary per Step 2's healthcheck fix, but general growth over any long-running instance too) can grow unbounded. Add to all 9 services:
  ```yaml
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
  ```

- [ ] **Step 8: Scope Kong's CORS plugin to the real frontend origin instead of the default wildcard**

  Every route block in `docker/kong.yml` has a bare `- name: cors` plugin entry, which defaults to `Access-Control-Allow-Origin: *`. Since auth here is Bearer-token (not cookie-based), this isn't currently exploitable, but it's unnecessarily permissive and worth scoping now that Step 5 fixes the port bindings this should match. Add `config.origins` to every one of the 9 `cors` plugin entries in the file:
  ```yaml
  plugins:
    - name: cors
      config:
        origins:
          - http://localhost:8080
          - http://127.0.0.1:8080
  ```
  (Apply this to all 9 service blocks in `docker/kong.yml` — `auth-v1-open`, `auth-v1-open-callback`, `auth-v1-open-authorize`, `auth-v1`, `rest-v1`, and the four `functions-v1-*` blocks.)

- [ ] **Step 9: Bring the stack up for real and verify every change**

  ```bash
  # If .env.selfhost already exists from a prior run, delete it first (it's
  # gitignored dev-only data) so the new AUTH_DB_PASSWORD/AUTHENTICATOR_DB_PASSWORD
  # keys actually get generated.
  rm -f .env.selfhost
  node scripts/generate-selfhost-secrets.mjs
  docker compose --env-file .env.selfhost up -d --build
  ```
  Verify, with real commands and real output (not by reading the YAML):
  - `docker compose --env-file .env.selfhost ps` — all 9 services `Up`, `db` and `kong` show `healthy` once `start_period` elapses.
  - `docker volume ls | grep pgdata` — the named volume exists.
  - `docker compose --env-file .env.selfhost down` (no `-v`) then `docker compose --env-file .env.selfhost up -d` again, then check the seeded/existing data is still present (or, if nothing's seeded yet, run `node scripts/seed-selfhost.mjs`, `down` without `-v`, `up` again, and confirm the seeded season/players are still queryable via `curl` against `/rest/v1/seasons`) — this is the concrete proof the persistence fix works.
  - `curl -s http://localhost:8000/rest/v1/` (and confirm the equivalent request to a LAN-facing address like your machine's actual local network IP, e.g. `192.168.x.x:8000`, now fails to connect — proving the loopback binding took effect). Do not actually expose this test outside your own machine.
  - Confirm `authenticator` and `supabase_auth_admin` now have different passwords from `supabase_admin` and from each other (e.g. `docker compose --env-file .env.selfhost exec db psql -U supabase_admin -d postgres -c "select rolname from pg_roles where rolname in ('authenticator','supabase_auth_admin','supabase_admin');"` to confirm the roles exist, then confirm the REST/auth services actually connect successfully with their new passwords — if `rest`/`auth` fail to start or log auth errors, the password wiring is wrong).
  - `curl -s -X POST http://localhost:8000/auth/v1/signup -H "apikey: $(grep ANON_KEY .env.selfhost | cut -d= -f2)" -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"testpassword123"}'` — confirm this now fails/is rejected (signup disabled), rather than succeeding.
  - `curl -s -I -X OPTIONS http://localhost:8000/rest/v1/seasons -H "Origin: http://evil.example.com" -H "Access-Control-Request-Method: GET"` — confirm the CORS preflight response no longer reflects `evil.example.com` as an allowed origin.

- [ ] **Step 10: Correct `docker/README.md` to match reality**

  - Tearing-down section: replace the current false claim ("`-v` also removes the Postgres data volume -- the next `up` starts from a fresh database") — now that a real named volume exists, `down` alone preserves data across restarts, and only `down -v` removes the `pgdata` volume. State this correctly.
  - Manual verification checklist: correct the claim that all 9 services show `healthy` — only `db` and `kong` have healthchecks; the rest will only ever show `Up`. Reword the checklist line accordingly.
  - Ports section: note the two published ports now bind to `127.0.0.1` only (not reachable from other devices on the network by default), and how to open them up (edit the `ports:` mapping to drop the `127.0.0.1:` prefix) if LAN access is genuinely wanted — frame this as a deliberate default, not an unexplained restriction.
  - Security note section: correct the claim (if the spec or README anywhere states or implies the edge-runtime enforces its own JWT verification as a defense-in-depth layer beyond each function's `requireAdmin()` check) — grep `docker/README.md` for any such claim and, if found, replace it with an accurate statement: authorization in this stack is enforced solely by each Edge Function's own `requireAdmin()` check (verified via live testing to correctly reject missing/invalid/non-admin tokens on every request), since the edge-runtime binary has no straightforward CLI-level JWT verification flag independent of Supabase's own CLI-managed orchestration. Note this as a good candidate for a real defense-in-depth layer (e.g. a Kong `jwt` plugin) if this stack ever moves toward real hosting — but implementing that now is out of scope for this pass; don't attempt it as part of this task.
  - Add one line noting the two new required secrets (`AUTH_DB_PASSWORD`, `AUTHENTICATOR_DB_PASSWORD`) to whatever sentence currently lists what `.env.selfhost` holds.

- [ ] **Step 11: Tear down and commit**

  ```bash
  docker compose --env-file .env.selfhost down -v
  ```
  ```bash
  git add docker-compose.yml docker/kong.yml docker/db-init/zz-set-role-passwords.sh scripts/generate-selfhost-secrets.mjs .env.selfhost.example docker/README.md
  git commit -m "fix: persistent Postgres volume, healthcheck/restart hardening, per-role secrets, narrower network exposure"
  ```

---

### Task 2: `seed-selfhost.mjs` robustness — clean failure on missing config, wait for readiness

**Files:**
- Modify: `scripts/seed-selfhost.mjs`

- [ ] **Step 1: Move env loading inside `main()`'s error handling**

  `loadSelfhostEnv()` currently runs at module top level, before `main().catch(...)` is attached, so a missing `.env.selfhost` throws a raw, unhandled stack trace instead of the script's own clean "Selfhost seed script failed: ..." message. Move the call inside `main()`:

  ```js
  async function main() {
    const env = loadSelfhostEnv();
    const serviceClient = createClient(API_URL, env.SERVICE_ROLE_KEY);
    // ...rest of the function unchanged, using `env` from this local scope
    // instead of the old module-level `const env = ...`...
  }
  ```
  Remove the old top-level `const env = loadSelfhostEnv();` line (keep `const API_URL = ...` at module scope — it doesn't depend on the file and has its own fallback already).

- [ ] **Step 2: Add a readiness-poll before the first real request**

  Nothing currently gates the seed script running immediately after `docker compose up -d`, before the edge-runtime/Kong stack has actually finished booting — the first `enter-match` call can hit a transient 502. Add a short poll loop at the start of `main()`, after loading env, before creating any auth users:

  ```js
  async function waitForStackReady(apiUrl, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${apiUrl}/rest/v1/`, { method: 'GET' });
        if (response.status < 500) return;
        lastError = new Error(`Stack not ready yet (status ${response.status})`);
      } catch (err) {
        lastError = err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Stack did not become ready within ${timeoutMs}ms: ${lastError?.message ?? 'unknown error'}. ` +
        'Check `docker compose --env-file .env.selfhost ps` for unhealthy services.',
    );
  }
  ```
  Call it at the top of `main()`: `await waitForStackReady(API_URL);` before the `createClient(...)` call.

- [ ] **Step 3: Verify against the real stack**

  ```bash
  docker compose --env-file .env.selfhost up -d --build
  node scripts/seed-selfhost.mjs
  ```
  Expected: succeeds, same output shape as before (season id + admin credentials). Then test the failure path:
  ```bash
  mv .env.selfhost .env.selfhost.bak
  node scripts/seed-selfhost.mjs
  ```
  Expected: a clean `Selfhost seed script failed: ENOENT ...` (or similar) message from the `main().catch(...)` handler, not a raw unhandled-exception stack trace pointing at module-load time. Restore the file afterward: `mv .env.selfhost.bak .env.selfhost`.

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/seed-selfhost.mjs
  git commit -m "fix: seed-selfhost.mjs fails cleanly on missing config and waits for the stack to be ready"
  ```

---

### Task 3: Pin the frontend image's base images to specific versions

**Files:**
- Modify: `web/Dockerfile`

- [ ] **Step 1: Determine real, currently-available specific tags**

  `FROM node:20-alpine` and `FROM nginx:alpine` both float within their respective minor/major lines, unlike every image pinned in `docker-compose.yml` (which use exact versions). Don't guess a version number — check what's actually available and what's already cached/in use:
  ```bash
  docker image inspect node:20-alpine --format '{{.RepoDigests}}' 2>/dev/null || docker pull node:20-alpine
  docker image inspect node:20-alpine --format '{{.RepoDigests}}'
  docker pull nginx:alpine
  docker image inspect nginx:alpine --format '{{.RepoDigests}}'
  ```
  Use the resulting digests or the specific version tags Docker Hub reports for the images you just pulled (e.g. `node:20.18.1-alpine3.20`, `nginx:1.27-alpine` — confirm the ACTUAL current tags rather than copying these example numbers verbatim, since they will be stale by the time you read this).

- [ ] **Step 2: Update the Dockerfile**

  ```dockerfile
  FROM node:<verified-specific-tag> AS build
  ...
  FROM nginx:<verified-specific-tag>
  ```

- [ ] **Step 3: Verify the build still works**

  ```bash
  docker compose --env-file .env.selfhost build frontend
  docker compose --env-file .env.selfhost up -d frontend
  curl -s -I http://localhost:8080/
  ```
  Expected: build succeeds, frontend serves `200 OK`. (Requires `.env.selfhost` to exist — run `node scripts/generate-selfhost-secrets.mjs` first if it doesn't, or reuse one from a prior task's verification. Requires the rest of the stack up too, since the container needs `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` build args wired via `docker-compose.yml`'s existing config.)

- [ ] **Step 4: Commit**

  ```bash
  git add web/Dockerfile
  git commit -m "fix: pin frontend image base images to specific verified versions"
  ```

---

## Execution notes for the controller

- Task 1 is the only one that touches `docker-compose.yml`/`docker/kong.yml`/the db-init script — dispatch it alone first (or in parallel with Tasks 2/3, which touch entirely disjoint files and don't depend on Task 1's changes to implement, though Task 3's verification step needs a running stack which could come from either task's own bring-up).
- After all three tasks are reviewed and merged into this branch, run the whole-branch review before finishing, per the subagent-driven-development skill — pay particular attention to whether Task 1's new secret names are consistently used everywhere they're referenced (compose file, db-init script, README), and whether the stack still comes up cleanly end-to-end with all three tasks' changes applied together.
