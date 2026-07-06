import '@testing-library/jest-dom/vitest'
import { config } from 'dotenv'
import { WebSocket } from 'ws'

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
