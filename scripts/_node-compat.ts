/**
 * Node-version shim for the service-role scripts. Import FIRST, for side effects:
 *
 *   import './_node-compat'
 *
 * Node < 22 has no global `WebSocket`. `@supabase/realtime-js` requires one when a
 * SupabaseClient is CONSTRUCTED — even for a script that never opens a realtime
 * connection — so `createClient()` throws outright on Node 20:
 *
 *   at new SupabaseClient (@supabase/supabase-js/src/SupabaseClient.ts:366)
 *
 * The test suite has always had this (vitest.setup.ts polyfills it the same way),
 * which is why the DB tests pass on Node 20 while every script broke. Harmless on
 * Node 22+, where a native WebSocket already exists — we only fill a missing global.
 *
 * Delete this once the repo pins Node >= 22 (there's no `engines` field today, so
 * nothing stops a Node 20 shell).
 */
import { WebSocket } from 'ws'

if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
}
