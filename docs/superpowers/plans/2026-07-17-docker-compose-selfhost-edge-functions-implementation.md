# Self-Hosted Docker Compose Stack, Sub-phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-host the four Edge Functions (enter-match, correct-match, close-week, start-season) so the self-hosted docker-compose stack's admin write path works end-to-end, completing what Sub-phase A deferred.

**Architecture:** Four new `edge-runtime` containers, one per function, each serving that function's existing `index.ts` unchanged via `edge-runtime start --main-service`. Kong gains four new routes forwarding `/functions/v1/<name>/*` to the matching container. The self-hosted seed script is upgraded to call these real endpoints instead of inserting rows directly.

**Tech Stack:** `public.ecr.aws/supabase/edge-runtime:v1.74.2` (already in local use by the project's CLI stack), Docker Compose, Kong.

**Design provenance:** the exact container invocation (`start --main-service /functions/<name> --port 9000`), the Kong route shape, and the full request/response chain (Kong → edge-runtime → GoTrue → PostgREST → Postgres) were prototyped and verified live in a disposable stack before being written here — including a real `enter-match` call producing correct Elo-adjusted ratings (1500 → 1531.25/1468.75 for a 5-2 win) and a real 401 rejection for an unauthenticated request, with zero changes to any existing function file. A real, pre-existing bug was also found and fixed during this prototyping: `docker/db-init/zz-set-role-passwords.sh` had picked up CRLF line endings in the working tree (`core.autocrlf=true` on Windows), breaking its shebang on a fresh volume bring-up — fixed via a new `.gitattributes` (already committed to master, unrelated to this plan's tasks — nothing further to do about it here).

## Global Constraints

- **One `edge-runtime` container per function** (4 total) — no shared router, no changes to any existing function or `_shared/` file.
- **Whole `supabase/functions/` directory mounted read-only** into every container, entrypoint pointed at that container's own `<name>/index.ts`, so existing `../_shared/...` relative imports resolve unchanged.
- **Reuse Sub-phase A's secrets** — `SUPABASE_URL=http://kong:8000`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from the existing `.env.selfhost`. No new secrets.
- **No edge-runtime-level JWT gate flag exists on this binary** (confirmed via `edge-runtime start --help` — that concept lives in the Supabase CLI's own orchestration layer, not the runtime itself). Each function's own `requireAdmin()` check is the real, sufficient security gate — confirmed via a live 401 test — so nothing further is needed to satisfy the spec's "reject unauthenticated/non-admin requests" intent.
- **Seed script upgraded to use the real functions** — `scripts/seed-selfhost.mjs` stops direct-inserting `player_season_ratings`/`matches`, calls `enter-match` then `close-week` over HTTP instead, mirroring `scripts/seed.mjs`'s existing pattern against the CLI stack.
- **No new automated test suite** — verification is docker/curl commands with expected output, run and confirmed at each task.
- **No changes to any Edge Function's own logic, `scripts/seed.mjs`, `supabase/config.toml`, or the CLI workflow.**

---

## Task 1: Self-hosted Edge Runtime containers and Kong routing

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker/kong.yml`

**Interfaces:**
- Consumes: `db`/`auth`/`rest`/`kong` services and `.env.selfhost`'s `ANON_KEY`/`SERVICE_ROLE_KEY` from Sub-phase A.
- Produces: `http://localhost:8000/functions/v1/<enter-match|correct-match|close-week|start-season>` all reachable and correctly enforcing admin auth.

- [ ] **Step 1: Add the four edge-runtime services to `docker-compose.yml`**

Add after the `frontend` service:

```yaml
  fn-enter-match:
    image: public.ecr.aws/supabase/edge-runtime:v1.74.2
    command: ["start", "--main-service", "/functions/enter-match", "--port", "9000"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      SUPABASE_URL: http://kong:8000
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
    volumes:
      - ./supabase/functions:/functions:ro

  fn-correct-match:
    image: public.ecr.aws/supabase/edge-runtime:v1.74.2
    command: ["start", "--main-service", "/functions/correct-match", "--port", "9000"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      SUPABASE_URL: http://kong:8000
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
    volumes:
      - ./supabase/functions:/functions:ro

  fn-close-week:
    image: public.ecr.aws/supabase/edge-runtime:v1.74.2
    command: ["start", "--main-service", "/functions/close-week", "--port", "9000"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      SUPABASE_URL: http://kong:8000
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
    volumes:
      - ./supabase/functions:/functions:ro

  fn-start-season:
    image: public.ecr.aws/supabase/edge-runtime:v1.74.2
    command: ["start", "--main-service", "/functions/start-season", "--port", "9000"]
    depends_on:
      db:
        condition: service_healthy
    environment:
      SUPABASE_URL: http://kong:8000
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
    volumes:
      - ./supabase/functions:/functions:ro
```

No host ports published — internal-only, reached via Kong, matching `auth`/`rest`'s pattern from Sub-phase A.

- [ ] **Step 2: Add the four Kong routes**

Add to `docker/kong.yml`, after the `rest-v1` service block:

```yaml
  - name: functions-v1-enter-match
    url: http://fn-enter-match:9000/
    routes:
      - name: functions-v1-enter-match-all
        strip_path: true
        paths:
          - /functions/v1/enter-match
    plugins:
      - name: cors
  - name: functions-v1-correct-match
    url: http://fn-correct-match:9000/
    routes:
      - name: functions-v1-correct-match-all
        strip_path: true
        paths:
          - /functions/v1/correct-match
    plugins:
      - name: cors
  - name: functions-v1-close-week
    url: http://fn-close-week:9000/
    routes:
      - name: functions-v1-close-week-all
        strip_path: true
        paths:
          - /functions/v1/close-week
    plugins:
      - name: cors
  - name: functions-v1-start-season
    url: http://fn-start-season:9000/
    routes:
      - name: functions-v1-start-season-all
        strip_path: true
        paths:
          - /functions/v1/start-season
    plugins:
      - name: cors
```

- [ ] **Step 3: Bring up the full stack fresh and verify all four containers are running**

Run: `docker compose --env-file .env.selfhost down -v` (clean slate), then `docker compose --env-file .env.selfhost up -d --build`
Run: `docker compose --env-file .env.selfhost ps`
Expected: `db` and `kong` show `(healthy)`; `auth`, `rest`, `fn-enter-match`, `fn-correct-match`, `fn-close-week`, `fn-start-season` all show `Up` (no crash-looping — if any of the four function containers is missing from this list or shows `Exited`, check its logs with `docker compose --env-file .env.selfhost logs <service>` before continuing).

- [ ] **Step 4: Verify all four functions reject unauthenticated requests**

Run each (replace `<anon-key>` with `ANON_KEY` from `.env.selfhost`):
```
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/enter-match -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d '{}'
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/correct-match -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d '{}'
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/close-week -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d '{}'
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/start-season -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d '{}'
```
Expected: all four return `{"error":"Unauthorized"}` and `HTTP_STATUS:401` — this proves each container is correctly wired through Kong *and* that `requireAdmin()` (the real security gate — see Global Constraints) is enforced with no edge-runtime-level configuration needed.

- [ ] **Step 5: Set up an authenticated admin session and test data**

Run (replace `<service-role-key>`):
```
curl -s -X POST http://localhost:8000/auth/v1/admin/users \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" -H "Content-Type: application/json" \
  -d '{"email":"task1-verify@example.com","password":"task1-verify-pw-123!","email_confirm":true}'
```
Expected: a JSON user object with an `id` field, HTTP 200. Save that `id` as `<user-id>`.

Run (replace `<service-role-key>` and `<user-id>`):
```
curl -s -X POST http://localhost:8000/rest/v1/admin_users \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"id":"<user-id>","display_name":"Task 1 Verify","role":"admin"}'
```
Expected: a JSON array with one row, HTTP 201.

Run (replace `<anon-key>`):
```
curl -s -X POST "http://localhost:8000/auth/v1/token?grant_type=password" \
  -H "apikey: <anon-key>" -H "Content-Type: application/json" \
  -d '{"email":"task1-verify@example.com","password":"task1-verify-pw-123!"}'
```
Expected: a JSON object with `access_token`, HTTP 200. Save it as `<token>`.

Run (replace `<service-role-key>`):
```
curl -s -X POST http://localhost:8000/rest/v1/seasons \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"name":"Task 1 Verify Season","start_date":"2026-01-01","status":"active"}'
```
Expected: a JSON array with one row containing an `id`, HTTP 201. Save it as `<season-id>`.

Run (replace `<service-role-key>`):
```
curl -s -X POST http://localhost:8000/rest/v1/players \
  -H "apikey: <service-role-key>" -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '[{"full_name":"Task1 PlayerA"},{"full_name":"Task1 PlayerB"}]'
```
Expected: a JSON array with two rows, each with an `id`. Save them as `<player-a-id>` and `<player-b-id>`.

- [ ] **Step 6: Verify `enter-match` end-to-end (full success path)**

Run (replace `<token>`, `<season-id>`, `<player-a-id>`, `<player-b-id>`):
```
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/enter-match \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"season_id":"<season-id>","match_date":"2026-01-08","player_a_id":"<player-a-id>","player_b_id":"<player-b-id>","frames_a":5,"frames_b":2}'
```
Expected: `{"match_id":"<some-uuid>"}`, `HTTP_STATUS:201`. Save the match_id as `<match-id>`.

Verify the rating math actually ran (replace `<anon-key>`):
```
curl -s "http://localhost:8000/rest/v1/player_season_ratings?select=player_id,rating,matches_played,grade" -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>"
```
Expected: two rows, one with `rating` around `1531.25` (`matches_played: 1`, the winner) and one around `1468.75` (the loser) — confirms the containerized function ran the real Elo instant-nudge calculation correctly, not just accepted the request.

- [ ] **Step 7: Spot-check `correct-match`**

Run (replace `<token>` and `<match-id>` from Step 6):
```
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X PATCH http://localhost:8000/functions/v1/correct-match \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"match_id":"<match-id>","frames_a":5,"frames_b":3}'
```
Expected: `{"corrected_match_id":"<some-uuid>"}`, `HTTP_STATUS:200`. A non-2xx response here means the container/routing has a problem — the underlying correction logic itself is already covered by `src/api/correctMatch.test.ts` against the CLI stack, so this step is purely about proving the self-hosted wiring, not re-verifying the business logic.

- [ ] **Step 8: Spot-check `close-week`**

Run (replace `<token>` and `<season-id>`):
```
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/close-week \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"season_id":"<season-id>","week_ending":"2026-01-08"}'
```
Expected: `{"closed_matches":<n>,"players_reconciled":<n>}` with `players_reconciled` equal to `2` (the two test players from Step 5), `HTTP_STATUS:200` — confirms the container can complete a full Glicko-2 batch reconciliation run.

- [ ] **Step 9: Spot-check `start-season`**

Run (replace `<token>`):
```
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST http://localhost:8000/functions/v1/start-season \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"new_season_name":"Task 1 Verify Season 2","start_date":"2026-02-01"}'
```
Expected: `{"season_id":"<some-uuid>"}`, `HTTP_STATUS:201` (no `previous_season_id` supplied, so no carryover — the simplest success path).

- [ ] **Step 10: Tear down**

Run: `docker compose --env-file .env.selfhost down -v`

- [ ] **Step 11: Commit**

```bash
git add docker-compose.yml docker/kong.yml
git commit -m "feat: self-host the four Edge Functions, one container per function"
```

---

## Task 2: Seed script upgrade and runbook wording

**Files:**
- Modify: `scripts/seed-selfhost.mjs`
- Modify: `docker/README.md`

**Interfaces:**
- Consumes: the four function endpoints from Task 1 (`http://localhost:8000/functions/v1/{enter-match,close-week}`), `.env.selfhost`'s `ANON_KEY`/`SERVICE_ROLE_KEY`.
- Produces: seed data now genuinely produced by the real rating pipeline; no new exports.

- [ ] **Step 1: Rewrite `scripts/seed-selfhost.mjs`**

Replace the whole file with:

```js
// scripts/seed-selfhost.mjs
//
// Seeds the self-hosted docker-compose stack with realistic demo data.
// Now that Sub-phase B self-hosts the four Edge Functions, this calls the
// real enter-match/close-week endpoints through Kong -- mirroring exactly
// how scripts/seed.mjs already seeds the CLI stack -- instead of
// direct-inserting player_season_ratings/matches rows.
//
// Usage: node scripts/seed-selfhost.mjs
// Requires: docker compose --env-file .env.selfhost up -d (see docker/README.md)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadSelfhostEnv() {
  const content = readFileSync('.env.selfhost', 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const API_URL = process.env.SELFHOST_API_URL ?? 'http://localhost:8000';
const env = loadSelfhostEnv();

const FIRST_NAMES = ['Alex', 'Jordan', 'Sam', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie'];

async function main() {
  const serviceClient = createClient(API_URL, env.SERVICE_ROLE_KEY);

  const email = `selfhost-seed-admin-${Date.now()}@example.com`;
  const password = 'selfhost-seed-password-123!';
  const { data: userData, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createUserError || !userData?.user) {
    throw new Error(`Failed to create seed admin user: ${createUserError?.message ?? 'no user returned'}`);
  }

  const { error: adminInsertError } = await serviceClient
    .from('admin_users')
    .insert({ id: userData.user.id, display_name: 'Selfhost Seed Admin', role: 'admin' });
  if (adminInsertError) {
    throw new Error(`Failed to insert admin_users row: ${adminInsertError.message}`);
  }

  const anonClient = createClient(API_URL, env.ANON_KEY);
  const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !sessionData?.session) {
    throw new Error(`Failed to sign in seed admin: ${signInError?.message ?? 'no session returned'}`);
  }
  const accessToken = sessionData.session.access_token;

  const { data: season, error: seasonError } = await serviceClient
    .from('seasons')
    .insert({ name: 'Selfhost Seed Season', start_date: '2026-01-01', status: 'active' })
    .select('id')
    .single();
  if (seasonError || !season) {
    throw new Error(`Failed to create seed season: ${seasonError?.message ?? 'no season returned'}`);
  }

  const { data: players, error: playersError } = await serviceClient
    .from('players')
    .insert(FIRST_NAMES.map((name) => ({ full_name: `${name} Selfhost` })))
    .select('id');
  if (playersError || !players) {
    throw new Error(`Failed to create seed players: ${playersError?.message ?? 'no players returned'}`);
  }

  async function enterMatch(playerA, playerB, framesA, framesB, matchDate) {
    const response = await fetch(`${API_URL}/functions/v1/enter-match`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        season_id: season.id,
        match_date: matchDate,
        player_a_id: playerA,
        player_b_id: playerB,
        frames_a: framesA,
        frames_b: framesB,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `enter-match failed (${response.status}) for ${playerA} vs ${playerB} on ${matchDate}: ${body}`,
      );
    }
  }

  async function closeWeek(weekEnding) {
    const response = await fetch(`${API_URL}/functions/v1/close-week`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ season_id: season.id, week_ending: weekEnding }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`close-week failed (${response.status}) for week ${weekEnding}: ${body}`);
    }
  }

  const weeks = ['2026-01-08', '2026-01-15', '2026-01-22'];
  for (const weekEnding of weeks) {
    for (let i = 0; i < players.length - 1; i += 2) {
      const framesA = Math.floor(Math.random() * 3) + 3; // 3-5
      const framesB = Math.floor(Math.random() * framesA); // 0..framesA-1, so A always wins
      const [a, b] = Math.random() > 0.5 ? [players[i].id, players[i + 1].id] : [players[i + 1].id, players[i].id];
      await enterMatch(a, b, framesA, framesB, weekEnding);
    }
    await closeWeek(weekEnding);
  }

  console.log(`Seeded season ${season.id} with ${players.length} players across ${weeks.length} closed weeks.`);
  console.log(`Admin login: ${email} / ${password}`);
}

main().catch((error) => {
  console.error('Selfhost seed script failed:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Update `docker/README.md`'s setup instructions**

In `docker/README.md`, replace this text:

```
3. Seed it with realistic demo data:
   ```
   node scripts/seed-selfhost.mjs
   ```
4. Open http://localhost:8080 -- you should see the seeded players on the
   leaderboard, grade distribution, and match history pages.
```

with:

```
3. Seed it with realistic demo data -- this now calls the real `enter-match`
   and `close-week` functions through Kong, so a successful run also proves
   the admin write path works end-to-end (not just the public read path):
   ```
   node scripts/seed-selfhost.mjs
   ```
4. Open http://localhost:8080 -- you should see the seeded players on the
   leaderboard, grade distribution, and match history pages.
```

Also update the top-of-file scope note. Replace:

```
Edge Functions (the four admin write actions -- enter-match, correct-match,
close-week, start-season) are not part of this stack yet; that's Sub-phase B.
Only the public read-only pages and admin login work here.
```

with:

```
The four admin write actions (enter-match, correct-match, close-week,
start-season) are self-hosted here too, one `edge-runtime` container per
function -- the whole app, public pages and the admin workflow, works
end-to-end on this stack.
```

- [ ] **Step 3: Run the rewritten seed script against a fresh stack**

Run: `docker compose --env-file .env.selfhost down -v && docker compose --env-file .env.selfhost up -d --build`

Wait for all services to be `Up`/`healthy` (`docker compose --env-file .env.selfhost ps`), then:

Run: `node scripts/seed-selfhost.mjs`
Expected: prints `Seeded season <uuid> with 8 players across 3 closed weeks.` and an admin login line, exit code 0. Any non-zero exit means either the container wiring from Task 1 or the rewritten script has a problem — investigate before proceeding.

- [ ] **Step 4: Verify the resulting leaderboard data**

Run (replace `<anon-key>`):
```
curl -s "http://localhost:8000/rest/v1/leaderboard_view?select=full_name,rating,rank&order=rank.asc" -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>"
```
Expected: 8 rows (all seeded players qualify — 3 matches each, satisfying `matches_played >= 3`), ranked by rating, with varied (non-1500-default) rating values — confirming the real Elo/Glicko-2 pipeline produced this data, not placeholder inserts.

- [ ] **Step 5: Tear down**

Run: `docker compose --env-file .env.selfhost down -v`

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-selfhost.mjs docker/README.md
git commit -m "feat: seed the self-hosted stack via the real enter-match/close-week endpoints"
```
