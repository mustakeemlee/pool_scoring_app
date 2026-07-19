// scripts/migrate-selfhost.mjs
//
// Applies supabase/migrations/*.sql to the RUNNING self-hosted stack's
// database IN PLACE -- no `down -v`, no data loss. Tracks what has been
// applied in public.selfhost_migrations.
//
// Usage:
//   node scripts/migrate-selfhost.mjs                     # apply pending
//   node scripts/migrate-selfhost.mjs --baseline-through <filename>
//       One-time bootstrap for a database that was created by the initdb
//       mount BEFORE this script existed: marks every migration up to and
//       including <filename> as already applied (without running it), then
//       applies the rest.
//
// Also (re)sets the supabase_storage_admin password from STORAGE_DB_PASSWORD
// on every run, so a stack created before the storage service was added
// picks up the new credential without a rebuild.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ENV_FILE = '.env.selfhost';
const MIGRATIONS_DIR = path.join('supabase', 'migrations');

function fail(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

if (!existsSync(ENV_FILE)) fail(`${ENV_FILE} not found. Run this from the repo root.`);

const env = {};
for (const line of readFileSync(ENV_FILE, 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

function compose(...args) {
  return execFileSync('docker', ['compose', '--env-file', ENV_FILE, ...args], { encoding: 'utf-8' });
}

const dbId = compose('ps', '-q', 'db').trim();
if (!dbId) fail('The db service is not running. Start it first: docker compose --env-file .env.selfhost up -d db');

function psql(sql, { viaStdin = false } = {}) {
  const base = ['exec', '-i', dbId, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-qtA'];
  if (viaStdin) {
    return execFileSync('docker', [...base, '--single-transaction', '-f', '-'],
      { encoding: 'utf-8', input: sql, stdio: ['pipe', 'pipe', 'inherit'] });
  }
  return execFileSync('docker', [...base, '-c', sql], { encoding: 'utf-8' });
}

// Keep the storage role's password in sync (no-op if unset).
if (env.STORAGE_DB_PASSWORD) {
  psql(`ALTER ROLE supabase_storage_admin WITH LOGIN PASSWORD '${env.STORAGE_DB_PASSWORD}'`);
  console.log('supabase_storage_admin password synced from .env.selfhost');
}

psql(`create table if not exists public.selfhost_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
)`);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const appliedRows = psql('select filename from public.selfhost_migrations order by filename');
const applied = new Set(appliedRows.split('\n').map((s) => s.trim()).filter(Boolean));

// Baseline handling for databases initialised by the initdb mount.
const baselineIdx = process.argv.indexOf('--baseline-through');
if (baselineIdx !== -1) {
  const through = process.argv[baselineIdx + 1];
  if (!through || !files.includes(through)) fail(`--baseline-through needs one of:\n  ${files.join('\n  ')}`);
  for (const f of files) {
    if (f > through) break;
    if (!applied.has(f)) {
      psql(`insert into public.selfhost_migrations (filename) values ('${f}') on conflict do nothing`);
      applied.add(f);
      console.log(`baselined (marked applied, not run): ${f}`);
    }
  }
}

if (applied.size === 0) {
  const hasSchema = psql(`select to_regclass('public.players') is not null`).trim() === 't';
  if (hasSchema) {
    fail(
      'This database already has the app schema (created by the initdb mount), but no migration ' +
      'history. Run once with a baseline so already-applied migrations are not re-run, e.g.:\n\n' +
      '  node scripts/migrate-selfhost.mjs --baseline-through <last migration present when the stack was first created>\n\n' +
      'Available files:\n  ' + files.join('\n  '),
    );
  }
}

let ran = 0;
for (const f of files) {
  if (applied.has(f)) continue;
  const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
  process.stdout.write(`applying ${f} ... `);
  psql(sql, { viaStdin: true });
  psql(`insert into public.selfhost_migrations (filename) values ('${f}')`);
  console.log('ok');
  ran++;
}

console.log(ran === 0 ? 'Already up to date.' : `Applied ${ran} migration(s).`);
