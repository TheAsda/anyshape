import { defineConfig } from 'vitest/config';

// Memory checks (NF4): need a real GC, so they run in a forked process with
// --expose-gc. Run manually with `npm run test:memory`; too timing-sensitive for CI.
export default defineConfig({
  test: {
    include: ['src/bench/**/*.memory.ts'],
    pool: 'forks',
    execArgv: ['--expose-gc'],
    environment: 'node',
    testTimeout: 30_000,
    // Prints the recorded heap figures even when a test is filtered with -t.
    disableConsoleIntercept: true,
  },
});
