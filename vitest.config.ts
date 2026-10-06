import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // TWO PROJECTS, split on the tests/ folder rule (AGENTS.md "Where a test goes"). Both
    // inherit everything else here (`extends: true`). Until 2026-10-05 the whole suite ran one
    // file at a time for the sake of the integration files alone; the DB-free files share
    // nothing, and paid ~2 minutes a run waiting on each other's imports and jsdom setup.
    // `include` is per project, never here: `extends` ADDS arrays, so a root include would put
    // every unit file into the integration project as well, and run it twice.
    projects: [
      {
        extends: true,
        test: {
          name: 'db-free',
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', 'tests/integration/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.{ts,tsx}'],
          // Integration tests share ONE real database and the two seeded artists.
          // Running these files one at a time keeps their fixtures from interleaving
          // (e.g. a publish snapshotting another file's leftover working rows). Vitest runs a
          // one-at-a-time project as its own group, after the parallel one finishes.
          // This only orders ONE process. Across processes (two runs at once) the same rule is
          // kept by the machine-wide lock in vitest.setup.ts → tests/helpers/db-lock.ts.
          fileParallelism: false,
        },
      },
    ],
    // Most of this suite crosses the internet to a HOSTED Postgres — a single
    // `publishAll` is ~30 round-trips. Vitest's 5s default is a unit-test budget: it
    // silently assumed <165ms per round-trip and passed only while latency happened to
    // be low. At 270ms (measured 2026-07-15) publish-heavy tests timed out with nothing
    // wrong. 20s tolerates ~650ms/round-trip and still fails fast on a real hang.
    // This is NOT for slow ASSERTIONS — if a test needs this much, it's talking to the
    // database, and that's the cost of testing against the real thing (no .env.test).
    testTimeout: 20_000,
    hookTimeout: 20_000, // beforeAll seeds fixtures over the same wire
    // Mock state resets between tests as a FLOOR, not per-file bookkeeping. Hand-
    // maintained clear lists are what leaked call history across tests in 3edb68a: a
    // mock added later is simply forgotten, and the stale history makes an assertion
    // pass (or fail) for a reason that has nothing to do with the test.
    clearMocks: true, // call history + instances
    restoreMocks: true, // spies handed back to their real implementations
  },
})
