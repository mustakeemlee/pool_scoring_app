// src/scripts/syncSharedRating.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncSharedRating } from '../../scripts/sync-shared-rating.mjs';

const SOURCE_DIR = join(__dirname, '..', 'rating');
const TARGET_DIR = join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'rating');

describe('syncSharedRating', () => {
  beforeAll(() => {
    syncSharedRating();
  });

  it('produces a synced file for every non-test source file', () => {
    const sourceFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const targetFiles = readdirSync(TARGET_DIR).filter((f) => f.endsWith('.ts'));
    expect(targetFiles.sort()).toEqual(sourceFiles.sort());
  });

  it('every synced file is identical to its source except .js->.ts import extensions', () => {
    const sourceFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const file of sourceFiles) {
      const sourceContent = readFileSync(join(SOURCE_DIR, file), 'utf-8');
      const targetContent = readFileSync(join(TARGET_DIR, file), 'utf-8');
      const expectedTargetContent = sourceContent.replace(/from '(\.\/[^']+)\.js'/g, "from '$1.ts'");
      expect(targetContent).toBe(expectedTargetContent);
    }
  });
});
