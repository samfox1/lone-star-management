/**
 * "What does the artist's YouTube channel say about them?" (OUTSIDE_PROFILES_PLAN.md, build step
 * 2). The channel is the one the YouTube link in Connections names, as Tapir PUBLISHED it (the
 * door's links, SeoKnown.published.links); its description is read with the YouTube Data API v3:
 *
 *   GET https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings
 *       &id=<UC…> | &forHandle=@<handle> | &forUsername=<name>   &key=<Tapir's key>
 *
 * (developers.google.com/youtube/v3/docs/channels/list: one of id / forHandle / forUsername; an
 * unknown channel is a 200 with no `items`; each call costs 1 unit of the daily quota.) The `who`
 * test `youtube` (who.ts) then looks for the site and the artist's city or genre in it.
 *
 * WHICH LINK: only a channel address counts: youtube.com (www. / m.) with `/@handle`,
 * `/channel/UC…`, `/c/<name>` or `/user/<name>`. A video, a playlist, youtu.be or YouTube Music is
 * not the channel, so an artist whose only YouTube link is a video has none (`link: null`).
 *
 * THE KEY is Tapir's YOUTUBE_API_KEY (the same one lib/youtube.ts's video import uses), passed in
 * EXPLICITLY (`apiKey`): read once by `youtubeKey`, which refuses to run under vitest, so a test
 * that forgot to inject one can never call YouTube with the real key. The key is only ever in the
 * request address; that address is never put in what comes back (errors are plain words).
 *
 * Could not ask (no key, the daily limit, no answer, an answer we can't read, out of time) is
 * `looked: false`: the test says "couldn't check", never "your channel doesn't say". Never throws.
 */
import { isSameSite } from '@/lib/manager-tools/seo/profiles/outside'
import { guardedFetch, TAPIR_CHECK_UA } from '@/lib/guarded-fetch'
import { isObj } from './html'
import type { SeoEvidence, SeoKnown } from './types'

type Answer = NonNullable<SeoEvidence['youtube']>
type Opts = { apiKey: string | null; fetcher?: typeof fetch; signal?: AbortSignal }

const API = 'https://www.googleapis.com/youtube/v3/channels'
const TIMEOUT_MS = 8000
/** One channel's answer is a few KB; a description is at most 1,000 characters (YouTube's cap). */
const MAX_BYTES = 256 * 1024
/** Read at most this much of a description, whatever YouTube sends. */
export const MAX_DESCRIPTION = 5000

/* ── the key ─────────────────────────────────────────────────────────────────────────── */

/**
 * Tapir's YouTube key, from the value the caller read (`process.env.YOUTUBE_API_KEY`, passed in by
 * engine.ts): null when it isn't set. Takes the value explicitly, never a default read of the
 * environment, and refuses under vitest (tests load .env.local, so the real key is there).
 */
export function youtubeKey(value: string | undefined): string | null {
  if (process.env.VITEST) throw new Error('youtubeKey is not for tests: inject the key')
  const v = value?.trim()
  return v ? v : null
}

/* ── which channel ───────────────────────────────────────────────────────────────────── */

/** What a channel link names, in the terms channels.list asks by. `custom` is a /c/ name. */
export type YouTubeChannelRef = { kind: 'id' | 'handle' | 'custom' | 'username'; value: string }

const CHANNEL_ID = /^UC[\w-]{22}$/
/** A handle: 3 to 30 letters, digits, `_`, `-` or `.` (YouTube allows letters of any script). */
const HANDLE = /^[\p{L}\p{M}\p{N}._-]{3,30}$/u
/** A /c/ or /user/ name. */
const NAME = /^[\p{L}\p{M}\p{N}._-]{1,100}$/u
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])

const decode = (s: string): string | null => {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/** The channel a link names, or null when it isn't a YouTube channel link (see the header). */
export function youtubeChannelRef(url: string): YouTubeChannelRef | null {
  let u: URL
  try {
    u = new URL(String(url ?? '').trim())
  } catch {
    return null
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port || !HOSTS.has(u.hostname.toLowerCase())) return null
  const [first = '', second = ''] = u.pathname.split('/').filter(Boolean)
  if (first.startsWith('@')) {
    const handle = decode(first.slice(1))
    return handle && HANDLE.test(handle) ? { kind: 'handle', value: handle } : null
  }
  if (first === 'channel') return CHANNEL_ID.test(second) ? { kind: 'id', value: second } : null
  if (first === 'c' || first === 'user') {
    const name = decode(second)
    return name && NAME.test(name) ? { kind: first === 'c' ? 'custom' : 'username', value: name } : null
  }
  return null
}

/** The channels.list selectors for a channel, in the order to try them. A /c/ name: as a handle
 *  first (YouTube turned most custom names into handles), then as a legacy username. */
export function channelSelectors(ref: YouTubeChannelRef): string[] {
  const handle = `forHandle=${encodeURIComponent(`@${ref.value}`)}`
  const username = `forUsername=${encodeURIComponent(ref.value)}`
  switch (ref.kind) {
    case 'id':
      return [`id=${encodeURIComponent(ref.value)}`]
    case 'handle':
      return [handle]
    case 'custom':
      return [handle, username]
    case 'username':
      return [username]
  }
}

/** The first YouTube CHANNEL link Tapir published, with what it names. */
function channelLink(known: SeoKnown): { url: string; ref: YouTubeChannelRef } | null {
  for (const l of known.published?.links ?? []) {
    const url = String(l?.url ?? '').trim()
    const ref = youtubeChannelRef(url)
    if (ref) return { url, ref }
  }
  return null
}

/* ── the site, in free text ──────────────────────────────────────────────────────────── */

/** What may sit around an address in running text, never inside the host. */
const SPLIT = /[\s<>"'`()[\]{}|,;*]+/u

/**
 * The site, as written in `text`, or null. Any spelling of the same site counts (isSameSite:
 * scheme, `www.`, a page on it, any case): "skeenmusic.com", "Website: www.skeenmusic.com/shows."
 * An email address at the site's domain, another subdomain or another site is not the site.
 * Split into words first, then each word is read as an address, so no pattern backtracks over
 * the whole text.
 */
export function siteMentionIn(text: string, siteUrl: string): string | null {
  for (const word of String(text ?? '').slice(0, MAX_DESCRIPTION).split(SPLIT)) {
    // "Website:skeenmusic.com": a colon not starting "://" ends a label.
    for (const part of word.split(/:(?!\/\/)/)) {
      const token = part.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[.!?…:]+$/u, '')
      if (!token.includes('.') || token.length > 300) continue
      // The host part (before any path): an "@" there is an email address or a login, not the site.
      const host = token.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]
      if (host.includes('@')) continue
      if (isSameSite(token, siteUrl)) return token
    }
  }
  return null
}

/* ── asking YouTube ──────────────────────────────────────────────────────────────────── */

/** Plain words for an error answer. YouTube's own `message` is never repeated (it is theirs, and
 *  some echo the request). */
function whyRefused(status: number, json: unknown): string {
  const err = isObj(json) && isObj(json.error) ? json.error : null
  const reasons = [
    ...(Array.isArray(err?.errors) ? err.errors : []),
    ...(Array.isArray(err?.details) ? err.details : []),
  ].flatMap((e) => (isObj(e) && typeof e.reason === 'string' ? [e.reason] : []))
  if (reasons.some((r) => /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(r))) return 'Digital Tapir’s daily limit for YouTube ran out'
  if (reasons.some((r) => /keyInvalid|API_KEY_INVALID|keyExpired|API_KEY_SERVICE_BLOCKED/i.test(r))) return 'YouTube didn’t accept Digital Tapir’s key'
  return `YouTube answered with error ${status}`
}

type Channel = NonNullable<Answer['channel']>

/** The answer's channel: null when there is none; undefined when it isn't a channels.list answer. */
function channelIn(json: unknown): Channel | null | undefined {
  if (!isObj(json) || json.kind !== 'youtube#channelListResponse') return undefined
  if (json.items === undefined) return null
  if (!Array.isArray(json.items)) return undefined
  const item = json.items[0]
  if (item === undefined) return null
  if (!isObj(item) || typeof item.id !== 'string' || !CHANNEL_ID.test(item.id) || !isObj(item.snippet)) return undefined
  const snippet = item.snippet
  const branding = isObj(item.brandingSettings) && isObj(item.brandingSettings.channel) ? item.brandingSettings.channel : null
  // The description the channel page shows: the snippet's, else brandingSettings' copy of it.
  const description = typeof snippet.description === 'string' ? snippet.description : typeof branding?.description === 'string' ? branding.description : ''
  return {
    id: item.id,
    title: typeof snippet.title === 'string' ? snippet.title.slice(0, 200) : '',
    handle: typeof snippet.customUrl === 'string' && snippet.customUrl ? snippet.customUrl.slice(0, 100) : null,
    description: description.slice(0, MAX_DESCRIPTION),
  }
}

/** One channels.list request. `error` = couldn't ask (plain words, never the address). */
async function ask(selector: string, opts: Opts & { apiKey: string }): Promise<{ channel: Channel | null } | { error: string }> {
  if (opts.signal?.aborted) return { error: 'the test ran out of time before asking' }
  const url = `${API}?part=snippet,brandingSettings&${selector}&key=${encodeURIComponent(opts.apiKey)}`
  const r = await guardedFetch(url, { fetcher: opts.fetcher, userAgent: TAPIR_CHECK_UA, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, allow: (next) => next.startsWith(`${API}?`) })
  if (r.status === null) return { error: `couldn’t reach YouTube (${r.error ?? 'no answer'})` }
  let json: unknown
  try {
    json = JSON.parse(r.text ?? '')
  } catch {
    json = undefined
  }
  if (r.status !== 200) return { error: whyRefused(r.status, json) }
  const channel = channelIn(json)
  return channel === undefined ? { error: 'YouTube sent an answer we couldn’t read' } : { channel }
}

/**
 * YouTube's answer about the artist's channel. See the header for which link, which key, and when
 * it counts as asked.
 */
export async function lookupYouTube(known: SeoKnown, opts: Opts): Promise<Answer> {
  const link = channelLink(known)
  if (!link) return { link: null, looked: false, channel: null }
  const notAsked = (error: string): Answer => ({ link: link.url, looked: false, channel: null, error })
  if (!opts.apiKey) return notAsked('Digital Tapir’s YouTube key isn’t set up')
  try {
    for (const selector of channelSelectors(link.ref)) {
      const r = await ask(selector, { ...opts, apiKey: opts.apiKey })
      if ('error' in r) return notAsked(r.error)
      if (r.channel) return { link: link.url, looked: true, channel: r.channel }
    }
    return { link: link.url, looked: true, channel: null }
  } catch {
    return notAsked('the YouTube check broke')
  }
}
