/**
 * PHASE 4 — appleMusicClient, test-first. The developer token is an ES256 JWT
 * signed with the MusicKit .p8 key; we sign with node:crypto (ieee-p1363 = JOSE
 * format). Tests generate a throwaway EC key to verify the signature, and inject
 * a token to exercise the catalog mapping/pagination/429 without real creds.
 */
import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createAppleMusicClient } from '@/lib/apple'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }
function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

const song = (id: string, name: string) => ({
  id,
  type: 'songs',
  attributes: {
    name,
    url: `https://music.apple.com/us/song/${id}`,
    artwork: { url: 'https://is1.mzstatic.com/image/{w}x{h}.jpg', width: 3000, height: 3000 },
  },
})

describe('developer token (ES256 JWT)', () => {
  it('signs a verifiable ES256 JWT from the .p8 key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

    const client = createAppleMusicClient({
      teamId: 'TEAM123',
      keyId: 'KEY123',
      privateKey: pem,
      fetchImpl: (async () => res({ body: { data: [] } })) as unknown as typeof fetch,
    })
    const token = await client.getDeveloperToken()

    const [h, p, s] = token.split('.')
    const header = JSON.parse(Buffer.from(h, 'base64url').toString())
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' })
    expect(payload).toMatchObject({ iss: 'TEAM123' })
    expect(payload.exp).toBeGreaterThan(payload.iat)

    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    )
    expect(ok).toBe(true)
  })

  it('throws when credentials are not configured', async () => {
    const client = createAppleMusicClient({ developerToken: undefined })
    await expect(client.getArtistTracks('1')).rejects.toThrow(/Apple/i)
  })
})

describe('getArtistTracks', () => {
  function client(fetchImpl: typeof fetch) {
    return createAppleMusicClient({ developerToken: 'dev-tok', storefront: 'us', fetchImpl, sleep: () => Promise.resolve() })
  }

  it('maps top songs to the sync shape (link-out, sized artwork)', async () => {
    const fetchImpl = vi.fn(async () => res({ body: { data: [song('s1', 'Drive')] } }) as unknown as Response)
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out).toEqual([
      {
        apple_id: 's1',
        title: 'Drive',
        cover_url: 'https://is1.mzstatic.com/image/300x300.jpg',
        provider_url: 'https://music.apple.com/us/song/s1',
      },
    ])
  })

  it('follows `next` pagination and concatenates', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      (url.includes('offset=25')
        ? res({ body: { data: [song('s2', 'Two')] } })
        : res({ body: { data: [song('s1', 'One')], next: '/v1/catalog/us/artists/42/view/top-songs?offset=25' } })) as unknown as Response,
    )
    const out = await client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')
    expect(out.map((t) => t.apple_id)).toEqual(['s1', 's2'])
  })

  it('retries on 429 with Retry-After backoff', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return (calls === 1
        ? res({ status: 429, headers: { 'retry-after': '2' }, body: {} })
        : res({ body: { data: [song('s1', 'One')] } })) as unknown as Response
    })
    const c = createAppleMusicClient({ developerToken: 'dev-tok', fetchImpl: fetchImpl as unknown as typeof fetch, sleep })
    const out = await c.getArtistTracks('42')
    expect(out).toHaveLength(1)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('throws a shaped error on HTTP failure', async () => {
    const fetchImpl = vi.fn(async () => res({ status: 500, body: {} }) as unknown as Response)
    await expect(client(fetchImpl as unknown as typeof fetch).getArtistTracks('42')).rejects.toThrow(/500/)
  })
})
