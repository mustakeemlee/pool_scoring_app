import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Exclude nested worktrees (.claude/worktrees/**) in addition to vitest's
    // own defaults -- without this, a leftover worktree checkout's copy of
    // these same test files gets collected too, causing duplicate runs that
    // collide on shared resources (fixed test-database names, live Edge
    // Function state).
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**', '**/.claude/**'],
    // src/api's tests now hit a real deployed Supabase Cloud Edge Function
    // over the network instead of a local one -- measured round trips to it
    // range from ~1.1s up to ~4.3s even for a trivial fast-fail (401) request
    // with no DB work, so vitest's 5000ms default per-test timeout is too
    // tight for tests that make several sequential/concurrent calls. Raised
    // globally (harmless for the fast local src/rating/src/db suites, which
    // finish well under this regardless).
    testTimeout: 30000,
  },
});
