// web/scripts/generate-env.mjs
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const webDir = path.resolve(__dirname, '..');

const output = execSync('npx supabase status -o env', { encoding: 'utf-8', cwd: repoRoot });
const env = {};
for (const line of output.split('\n')) {
  const match = line.match(/^(\w+)="?(.*?)"?$/);
  if (match) env[match[1]] = match[2];
}

if (!env.API_URL || !env.ANON_KEY) {
  console.error('Could not read API_URL/ANON_KEY from `supabase status -o env`. Is `supabase start` running?');
  process.exit(1);
}

const content = `VITE_SUPABASE_URL=${env.API_URL}\nVITE_SUPABASE_ANON_KEY=${env.ANON_KEY}\n`;
writeFileSync(path.join(webDir, '.env.local'), content);
console.log('Wrote web/.env.local');
