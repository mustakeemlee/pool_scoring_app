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
  },
});
