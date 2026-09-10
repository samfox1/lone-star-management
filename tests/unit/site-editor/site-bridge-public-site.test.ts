// Fetching published content — the read every connected site uses.
/**
 * fetchPublicSite — the published-content read the bridge now owns, so every connected
 * site gets "publishing reaches my deployed page" instead of hand-rolling it (which is
 * exactly how skeen ended up wired and the two throwaways did not).
 *
 * No network: `fetch` is stubbed, because what is being pinned is the REQUEST SHAPE and
 * the three answers a site can get back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicSite, isConfigured } from '../../../packages/site-bridge/src/public-site'

const CONFIG = { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon-key-123', slug: 'skeen' }

afterEach(() => vi.unstubAllGlobals())

/** A stub that records the call and answers with `body` at `status`. */
function stubFetch(body: string, status = 200) {
  const spy = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => body }))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('fetchPublicSite', () => {
  it('CRITICAL: calls get_public_site for the slug, with the anon key on both headers', () => {
    // PostgREST needs `apikey` AND `Authorization`; sending one and not the other is a
    // 401 that reads as "nothing published".
    const spy = stubFetch('{"artist":{"slug":"skeen"}}')
    return fetchPublicSite(CONFIG).then(() => {
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/get_public_site')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ p_slug: 'skeen' })
      const headers = init.headers as Record<string, string>
      expect(headers.apikey).toBe('anon-key-123')
      expect(headers.Authorization).toBe('Bearer anon-key-123')
    })
  })

  it('CRITICAL: an UNCONFIGURED site renders empty rather than throwing on a fan’s page', async () => {
    // A site whose env vars are not set yet must not 500 for visitors.
    const spy = stubFetch('{}')
    expect(await fetchPublicSite(undefined)).toBeNull()
    expect(await fetchPublicSite({ supabaseUrl: 'https://x', slug: 'skeen' })).toBeNull() // no key
    expect(await fetchPublicSite({ anonKey: 'k', slug: 'skeen' })).toBeNull() // no url
    expect(spy, 'no request should even be attempted').not.toHaveBeenCalled()
    expect(isConfigured(CONFIG)).toBe(true)
  })

  it('an artist who has never published returns null, not a crash', async () => {
    // get_public_site answers with an EMPTY BODY, which JSON.parse would throw on.
    stubFetch('')
    expect(await fetchPublicSite(CONFIG)).toBeNull()
  })

  it('CRITICAL: a FAILED request throws — a rotated key must not look like an empty site', async () => {
    // The two states are indistinguishable on the page, so the difference has to be loud.
    // Under ISR the last good page keeps serving while this surfaces in the log.
    stubFetch('nope', 401)
    await expect(fetchPublicSite(CONFIG)).rejects.toThrow('401')
  })

  it('passes caller fetch options through, so a site can ask for ISR', async () => {
    const spy = stubFetch('{"artist":{"slug":"skeen"}}')
    await fetchPublicSite(CONFIG, { next: { revalidate: 60 } } as RequestInit)
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }]
    expect(init.next).toEqual({ revalidate: 60 })
  })

  it('returns the payload the site renders', async () => {
    stubFetch('{"artist":{"slug":"skeen","name":"Skeen"},"tracks":[{"id":"t1"}]}')
    const site = await fetchPublicSite(CONFIG)
    expect(site?.artist?.name).toBe('Skeen')
    expect(site?.tracks).toHaveLength(1)
  })
})
