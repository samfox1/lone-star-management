import '@testing-library/jest-dom/vitest'
import { config } from 'dotenv'
import { aroundAll } from 'vitest'
import { WebSocket } from 'ws'
import { acquireDbLock, isIntegrationFile } from '@tests/helpers/db-lock'

// Node < 22 has no global WebSocket, which @supabase/realtime-js requires at
// SupabaseClient construction (even though these tests never open a realtime
// connection). Polyfill it from `ws` so every client builds. Harmless on Node 22+
// where a native WebSocket already exists — we just overwrite with an equivalent.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
}

// Tests read Supabase credentials from .env.test (preferred) or .env.local.
config({ path: '.env.test' })
config({ path: '.env.local' })

// Integration files take turns with EVERY vitest process on this machine, not only with
// the other files of this run: they share one hosted database, and two runs at once
// (the full suite beside a builder's folder) raced each other's fixtures and global rows.
// Why and how: tests/helpers/db-lock.ts. The wrapper covers the file's own beforeAll and
// afterAll, so a file's teardown finishes before the next file anywhere begins. The
// timeout is for the WAIT (it only runs before the file starts); the file's own hooks and
// tests keep the 20s budgets from vitest.config.ts. The `{}` is required: vitest parses
// that argument as a fixtures pattern and fails EVERY file if it is a plain name.
aroundAll(async (runSuite, {}, suite) => {
  if (!isIntegrationFile(suite.file?.filepath)) return runSuite()
  const release = await acquireDbLock(suite.file.filepath)
  try {
    await runSuite()
  } finally {
    release()
  }
}, 9 * 60_000)
