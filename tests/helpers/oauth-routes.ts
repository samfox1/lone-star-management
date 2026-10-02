/**
 * The shared stand-ins for the "Connect with …" route tests (Eventbrite, YouTube, Shopify): a
 * signed-in manager who does or does not own the artist, the env the routes read, and the small
 * readers every one of those files used to keep its own copy of.
 *
 * Code:     support file (not a test): feeds src/app/api/{eventbrite,youtube,shopify}/*\/route.ts
 *           through tests/unit/manager-tools/connections/eventbrite-oauth-routes.test.ts,
 *           youtube-oauth-routes.test.ts and tests/unit/shopify/shopify-oauth-routes.test.ts
 * Feature:  Connections page: the sign-in trips (Connect with Eventbrite, YouTube, Shopify)
 * Tier:     STRICT (AGENTS.md "Test depth"): the suites built on it pin who may connect what to
 *           which artist, and that a token never leaks.
 * What it provides:
 *           • owner / ownerServer(extra): the request-bound Supabase client the routes check
 *             ownership through (`callerOwns`), for vi.mock('@/lib/supabase/server'); a test flips
 *             `owner.user` (signed out) or `owner.owns` (not this artist's manager), and
 *             `owner.tables` lists every table a route read
 *           • routeTestSetup(env): before each test, that env and a signed-in owner, with console
 *             captured; after it, the env as it was and every stubbed global undone. Returns
 *             `logged()`: every console line, as one string, for "the token is never logged"
 *           • json, location, setCookie: a JSON answer, and a redirect's target and cookie
 * Not here: each provider's own stub (its token, API answers) stays in its test file.
 * Fixtures: the manager is user-1 and the artist row answers `{ id, name: 'Skeen' }`.
 */
import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'

export const OWNER_ID = 'user-1'

/** Who is signed in, and whether they manage the artist. routeTestSetup resets it per test. */
export const owner = { user: { id: OWNER_ID } as { id: string } | null, owns: true, tables: [] as string[] }

/**
 * vi.mock('@/lib/supabase/server', async () => (await import('@tests/helpers/oauth-routes')).ownerServer()):
 * sign-in and the ownership read. `extra` adds what one route also needs (Eventbrite's rpc).
 */
export function ownerServer(extra: Record<string, unknown> = {}) {
  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: owner.user } }) },
      from: (table: string) => {
        owner.tables.push(table)
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({ maybeSingle: async () => ({ data: table === 'artists' && owner.owns ? { id, name: 'Skeen' } : null }) }),
          }),
        }
      },
      ...extra,
    }),
  }
}

/** Set `env` and a signed-in owner before each test; restore both after. */
export function routeTestSetup(env: Record<string, string>) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
  let logs: MockInstance[] = []
  beforeEach(() => {
    Object.assign(process.env, env)
    owner.user = { id: OWNER_ID }
    owner.owns = true
    owner.tables = []
    logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const s of logs) s.mockRestore()
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  return { logged: () => JSON.stringify(logs.flatMap((s) => s.mock.calls)) }
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
export const location = (res: Response) => res.headers.get('location') ?? ''
export const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''
