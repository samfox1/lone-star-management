/**
 * The Connections tool's server actions, mocked ONCE for the editor's component suites.
 *
 * The editor's Socials opens the Connections tool's own Connect modal (Add button → Connect
 * an account, 2026-09-28), so every suite that renders the inspector now imports
 * `connections/actions`. Unmocked, that module pulls in `integrations.ts`, which reads the
 * dashboard's save actions at load — and those are mocked in these suites, so the file
 * fails before a single test runs. Use it beside editor-actions:
 *
 *   vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => import('@tests/helpers/connections-actions'))
 *
 * The functions are the SAME objects `vi.mocked(...)` hands back in a test.
 */
import { vi } from 'vitest'

export const connectOneAction = vi.fn(async () => ({ ok: true }))
export const disconnectConnectionAction = vi.fn(async () => ({}))
export const pullConnectionAction = vi.fn(async () => ({ ok: true }))
export const syncProfileAction = vi.fn(async () => ({ ok: true }))
