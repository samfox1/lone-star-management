import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * The DB-FREE slice of the suite, for mutation testing (see stryker.config.json).
 *
 * Stryker runs the tests once per mutant — hundreds of times. The main suite crosses
 * the internet to hosted Postgres on most files, so running THAT per mutant would take
 * days and hammer a live database. This config includes only files that touch no DB, so
 * a full mutation run is minutes.
 *
 * The cost of that trade is stated plainly: mutations to code reachable ONLY through a
 * live-DB test will show as survivors here even when a real test covers them. That is
 * why `stryker.config.json` mutates a curated list of pure modules rather than all of
 * `src/` — a survivor in this report should mean a real gap, not a config artefact.
 *
 * KEEPING IT HONEST: the include list below is a NEGATIVE filter (everything except the
 * DB suites), so a new DB-free test file is picked up automatically. A new DB-backed
 * file must be excluded, or the run gets slow and starts writing to the live project.
 * The guard is `tests/mutation-config.test.ts`, which fails if any included file imports
 * the Supabase test helpers.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // Every suite that talks to the hosted project. Mirrored by the guard test.
    /**
     * ONE RULE, not a list (2026-09-10). `tests/` is organised by KIND at its top level,
     * so "talks to the hosted project" is now a FOLDER rather than sixty hand-kept paths.
     *
     * What that fixes: the old list was maintained by hand, and a new DB-backed file
     * that nobody remembered to add simply ran in the mutation slice — thousands of
     * times, against the live project. `tests/unit/harness/mutation-config.test.ts` is
     * still the guard, and it now checks the folder rule itself: a file under
     * integration/ that touches no DB, or a file OUTSIDE it that does, both fail.
     */
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true,
  },
})
