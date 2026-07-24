// web/scripts/generate-env.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRootEnv } from '../../scripts/loadEnv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');

// Local/Docker builds read the gitignored root .env. Hosted build platforms
// (Vercel, etc.) have no such file on disk -- they inject dashboard-configured
// variables straight into process.env instead. Fall back to those so the same
// build script works in both places without a platform-specific override.
let supabaseUrl;
let supabaseAnonKey;
try {
  const env = loadRootEnv();
  supabaseUrl = env.SUPABASE_URL;
  supabaseAnonKey = env.SUPABASE_ANON_KEY;
} catch (rootEnvError) {
  supabaseUrl = process.env.VITE_SUPABASE_URL;
  supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      `Could not load Supabase config from the root .env (${rootEnvError.message}), and ` +
        'VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are not set in the environment either. ' +
        'On a hosted build platform, set those two as project environment variables.',
    );
  }
}

const content = `VITE_SUPABASE_URL=${supabaseUrl}\nVITE_SUPABASE_ANON_KEY=${supabaseAnonKey}\n`;
writeFileSync(path.join(webDir, '.env.local'), content);
console.log('Wrote web/.env.local');
