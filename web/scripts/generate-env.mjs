// web/scripts/generate-env.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRootEnv } from '../../scripts/loadEnv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');

const env = loadRootEnv();
const content = `VITE_SUPABASE_URL=${env.SUPABASE_URL}\nVITE_SUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY}\n`;
writeFileSync(path.join(webDir, '.env.local'), content);
console.log('Wrote web/.env.local');
