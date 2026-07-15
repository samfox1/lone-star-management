import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // Integration tests share ONE real database and the two seeded artists.
    // Running test files sequentially keeps their fixtures from interleaving
    // (e.g. a publish snapshotting another file's leftover working rows).
    fileParallelism: false,
    // Most of this suite crosses the internet to a HOSTED Postgres — a single
    // `publishAll` is ~30 round-trips. Vitest's 5s default is a unit-test budget: it
    // silently assumed <165ms per round-trip and passed only while latency happened to
    // be low. At 270ms (measured 2026-07-15) publish-heavy tests timed out with nothing
    // wrong. 20s tolerates ~650ms/round-trip and still fails fast on a real hang.
    // This is NOT for slow ASSERTIONS — if a test needs this much, it's talking to the
    // database, and that's the cost of testing against the real thing (no .env.test).
    testTimeout: 20_000,
    hookTimeout: 20_000, // beforeAll seeds fixtures over the same wire
  },
})
