/**
 * appleMusicClient — reads public catalog data with an Apple Music DEVELOPER
 * token (no user token needed for catalog). The token is an ES256 JWT signed
 * with the MusicKit .p8 private key; we sign with node:crypto using
 * `dsaEncoding: 'ieee-p1363'` so the signature is already in JOSE (R||S) form.
 * Apple is a metadata + embed/link source (no hosted/downloadable audio).
 *
 * A factory with injectable fetch/sleep; `developerToken` can be injected to skip
 * signing in tests.
 */
import { sign } from 'node:crypto'
import { httpGetJson } from '@/lib/http'

const API_BASE = 'https://api.music.apple.com'

/** The shape the tracks sync consumes (one Apple Music song). */
export type AppleTrackInput = {
  apple_id: string
  title: string
  cover_url: string | null
  provider_url: string | null
}

type AppleSong = {
  id: string
  attributes?: { name?: string; url?: string; artwork?: { url?: string } }
}
type ApplePage = { data?: AppleSong[]; next?: string | null }

type Options = {
  teamId?: string
  keyId?: string
  privateKey?: string
  /** Inject a pre-made token to skip signing (tests). */
  developerToken?: string
  storefront?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  maxPages?: number
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

export function createAppleMusicClient(opts: Options = {}) {
  const teamId = opts.teamId ?? process.env.APPLE_TEAM_ID
  const keyId = opts.keyId ?? process.env.APPLE_KEY_ID
  const privateKey = opts.privateKey ?? process.env.APPLE_PRIVATE_KEY
  const storefront = opts.storefront ?? process.env.APPLE_STOREFRONT ?? 'us'
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxRetries = opts.maxRetries ?? 3
  const maxPages = opts.maxPages ?? 10

  const injected = 'developerToken' in opts ? opts.developerToken : undefined

  async function getDeveloperToken(): Promise<string> {
    if (injected) return injected
    if (!teamId || !keyId || !privateKey) {
      throw new Error('Apple Music credentials not configured (APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY).')
    }
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
    const payload = { iss: teamId, iat: now, exp: now + 60 * 60 * 12 } // 12h
    const signingInput = `${b64url(header)}.${b64url(payload)}`
    const signature = sign('sha256', Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url')
    return `${signingInput}.${signature}`
  }

  function apiGet(pathOrUrl: string): Promise<ApplePage> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : API_BASE + pathOrUrl
    return httpGetJson<ApplePage>(url, {
      fetchImpl: doFetch,
      sleep,
      maxRetries,
      provider: 'Apple Music',
      headers: async () => ({ Authorization: `Bearer ${await getDeveloperToken()}` }),
    })
  }

  function map(s: AppleSong): AppleTrackInput {
    const art = s.attributes?.artwork?.url
    return {
      apple_id: s.id,
      title: s.attributes?.name ?? '',
      cover_url: art ? art.replace('{w}', '300').replace('{h}', '300') : null,
      provider_url: s.attributes?.url ?? null,
    }
  }

  /** The artist's top songs as a flat list (link-out only). */
  async function getArtistTracks(artistId: string): Promise<AppleTrackInput[]> {
    const out: AppleTrackInput[] = []
    let url: string | null = `/v1/catalog/${encodeURIComponent(storefront)}/artists/${encodeURIComponent(artistId)}/view/top-songs?limit=25`
    let pages = 0
    const seen = new Set<string>()
    while (url && pages < maxPages && !seen.has(url)) {
      seen.add(url)
      pages++
      const page: ApplePage = await apiGet(url)
      for (const s of page.data ?? []) out.push(map(s))
      url = page.next ?? null
    }
    return out
  }

  return { getDeveloperToken, getArtistTracks }
}

export type AppleMusicClient = ReturnType<typeof createAppleMusicClient>
