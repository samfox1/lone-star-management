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
  },
})
