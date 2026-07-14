// scripts/sync-shared-rating.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(__dirname, '..', 'src', 'rating');
const TARGET_DIR = join(__dirname, '..', 'supabase', 'functions', '_shared', 'rating');

export function syncSharedRating() {
  mkdirSync(TARGET_DIR, { recursive: true });

  const sourceFiles = readdirSync(SOURCE_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );

  for (const file of sourceFiles) {
    const content = readFileSync(join(SOURCE_DIR, file), 'utf-8');
    // Deno requires an exact-match relative import extension; rewrite the
    // Node/NodeNext-style ".js" specifiers to ".ts". This is the ONLY
    // transformation applied — everything else is byte-identical.
    const denoContent = content.replace(/from '(\.\/[^']+)\.js'/g, "from '$1.ts'");
    writeFileSync(join(TARGET_DIR, file), denoContent, 'utf-8');
  }

  return sourceFiles;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const synced = syncSharedRating();
  console.log(`Synced ${synced.length} files to ${TARGET_DIR}`);
}
