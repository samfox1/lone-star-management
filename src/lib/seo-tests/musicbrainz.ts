/**
 * "Which artist on MusicBrainz links to this site, or to these profiles?"
 *
 * MusicBrainz's public web service looks a URL up by its exact spelling:
 *   GET https://musicbrainz.org/ws/2/url?resource=<url>[&resource=<url>…]&inc=artist-rels&fmt=json
 * (musicbrainz.org/doc/MusicBrainz_API: `resource` may repeat up to 100 times; one link
 * answers with the url itself, several with `{ urls: [...] }` and unknown ones skipped; a 404
 * means none is known). So ONE request asks about every spelling of the site and of the three
 * strongest profiles, each spelled the way MusicBrainz's own editor stores it
 * (musicbrainz-server URLCleanup.js, read 2026-09-28).
 *
 * Their rules, kept: a meaningful User-Agent with contact (TAPIR_CHECK_UA), at most one
 * request a second from this process (a gate shared by every lookup), and one retry after a
 * 503 / 429, waiting as asked (capped). Two server instances still share one IP without
 * sharing this gate: the retry is what covers that.
 *
 * A MusicBrainz artist link the manager already connected is OPENED (/ws/2/artist/<id>) instead:
 * 404 = MusicBrainz has no artist there; otherwise its name is reported for the test to compare.
 * Could not ask (network, busy, an answer we can't read) = `looked: false`: the test says
 * "couldn't check", never "MusicBrainz doesn't know you". Never throws.
 */
import { isIdentityProfileUrl } from '@samfox1/site-bridge/seo'
import { isPublicSiteUrl } from '@/lib/custom-site'
import { musicbrainz } from '@/lib/manager-tools/connections/services/musicbrainz'
import { guardedFetch, TAPIR_CHECK_UA } from '@/lib/guarded-fetch'
import { fold, isObj } from './html'
import type { SeoEvidence, SeoKnown } from './types'

type Answer = SeoEvidence['musicbrainz']
type Opts = { fetcher?: typeof fetch; signal?: AbortSignal; now?: () => number; sleep?: (ms: number) => Promise<void> }

const API = 'https://musicbrainz.org/ws/2/url'
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Profiles asked about besides the site: the ones MusicBrainz editors link most, by rank. */
const MAX_PROFILES = 3
const GAP_MS = 1100
const RETRY_CAP_MS = 5000
const TIMEOUT_MS = 8000

/* ── one request a second ──────────────────────────────────────────────────────────── */

let nextAt = 0
/** Tests only: forget the last request's time. */
export function resetMusicBrainzGate(): void {
  nextAt = 0
}
/** Wait for this process's next free second. The slot is taken BEFORE the wait, so two
 *  lookups started together get two different seconds. */
async function gate(now: () => number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const t = now()
  const slot = Math.max(t, nextAt)
  nextAt = slot + GAP_MS
  if (slot > t) await sleep(slot - t)
}

/* ── how MusicBrainz spells a link ─────────────────────────────────────────────────── */

type Clean = { host: RegExp; steps: [RegExp, string][] }
/** Per platform, MusicBrainz's own clean-up (URLCleanup.js `clean`), in its order. */
const CLEANUPS: Clean[] = [
  { host: /(^|\.)spotify\.com$/, steps: [[/^(?:https?:\/\/)?(?:play|open)\.spotify\.com\/(?:intl-[a-z]+\/)?([a-z]+)\/([a-zA-Z0-9_-]+)(?:[/?#].*)?$/, 'https://open.spotify.com/$1/$2']] },
  {
    host: /(^|\.)music\.apple\.com$/,
    steps: [
      [/^https?:\/\/(?:(?:beta|geo)\.)?(classical\.)?music\.apple\.com\//, 'https://$1music.apple.com/'],
      [/^(https:\/\/(?:classical\.)?music\.apple\.com)\/([a-z-]{3,})\//, '$1/us/$2/'],
      [/^(https:\/\/(?:classical\.)?music\.apple\.com\/[a-z]{2})\/(artist|album|author|label|music-video|song)\/(?:[^?#/]+\/)?(?:id)?([0-9]+)(?:\?.*)?$/, '$1/$2/$3'],
    ],
  },
  { host: /(^|\.)instagram\.com$/, steps: [[/^(?:https?:\/\/)?(?:[^/]+\.)?instagram\.com\/([^/?#]+).*$/, 'https://www.instagram.com/$1/']] },
  { host: /(^|\.)soundcloud\.com$/, steps: [[/^(?:https?:\/\/)?(?:www\.)?soundcloud\.com\/([^/?#]+(?:\/(?:sets|tracks)\/[^/?#]+)?).*$/, 'https://soundcloud.com/$1']] },
  { host: /(^|\.)tiktok\.com$/, steps: [[/^(?:https?:\/\/)(?:www\.)?tiktok\.com\/@([\w.]+(?:\/video\/\d+)?)(?:[/?#].*)?$/, 'https://www.tiktok.com/@$1']] },
  {
    host: /(^|\.)(twitter|x)\.com$/,
    steps: [
      [/^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:twitter|x)\.com(?:\/#!)?\//, 'https://twitter.com/'],
      [/^(https:\/\/twitter\.com\/[^/?#]+).*$/, '$1'],
    ],
  },
  {
    host: /(^|\.)youtube\.com$/,
    steps: [
      [/^(https?:\/\/)?([^/]+\.)?youtube\.com(?:\/#)?/, 'https://www.youtube.com'],
      [/^https:\/\/www\.youtube\.com\/c\//, 'https://www.youtube.com/'],
      [/\/(channel|user)\/([^/?#]+).*$/, '/$1/$2'],
      [/^https:\/\/www\.youtube\.com\/([a-zA-Z0-9_-]+)\/(?:about|channels|community|featured|playlists|videos)(?:[/?&#].*)?$/, 'https://www.youtube.com/$1'],
      [/^https:\/\/www\.youtube\.com\/(@[a-zA-Z0-9_%.-]+).*$/, 'https://www.youtube.com/$1'],
    ],
  },
  {
    host: /(^|\.)bandcamp\.com$/,
    steps: [
      [/^(?:https?:\/\/)?([^/]+\.)?bandcamp\.com(?:\/([^?#]*))?.*$/, 'https://$1bandcamp.com/$2'],
      [/^https:\/\/([^/]+)\.bandcamp\.com\/(?:((?:album|track)\/[^/]+))?.*$/, 'https://$1.bandcamp.com/$2'],
    ],
  },
  { host: /(^|\.)deezer\.com$/, steps: [[/^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(\w+)\/(\d+).*$/, 'https://www.deezer.com/$1/$2']] },
  {
    host: /(^|\.)tidal\.com$/,
    steps: [
      // `[^/.]` (one label at a time), not `[^/]`: the nested quantifier split a long host every way
      // before failing, exponential in its labels (security review 2026-09-29).
      [/^(?:https?:\/\/)?(?:(?:[^/.]+\.)*(?:desktop|listen|stage|www)\.)?tidal\.com\/(?:#!\/)?([\w/]+).*$/, 'https://tidal.com/$1'],
      [/^https:\/\/tidal\.com\/(?:[a-z]{2}\/)?(?:browse\/|store\/)?(?:[a-z]+\/\d+\/)?([a-z]+)\/(\d+)(?:\/[\w]*)?$/, 'https://tidal.com/$1/$2'],
    ],
  },
]

/**
 * The spellings to ask MusicBrainz about for one link, most likely first. A profile: its
 * MusicBrainz-cleaned form, then as given. The site (`site: true`): https and http, with and
 * without `www.`, with and without the trailing slash, because a homepage is stored as typed.
 */
export function musicBrainzForms(url: string, opts: { site?: boolean } = {}): string[] {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return []
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return []
  const out: string[] = []
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s)
  }
  if (opts.site) {
    const host = u.hostname.toLowerCase()
    const bare = host.replace(/^www\./, '')
    for (const h of [host, host === bare ? `www.${bare}` : bare]) for (const scheme of ['https', 'http']) for (const slash of ['/', '']) add(`${scheme}://${h}${slash}`)
    return out
  }
  const given = u.toString()
  const rule = CLEANUPS.find((c) => c.host.test(u.hostname.toLowerCase()))
  if (rule) add(rule.steps.reduce((s, [re, to]) => s.replace(re, to), given))
  add(given)
  return out
}

/** How strongly a profile says who an artist is, to MusicBrainz editors: lower asks first. */
function rank(url: string): number {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return 99
  }
  const order: [RegExp, number][] = [
    [/^open\.spotify\.com$/, 1], [/^music\.apple\.com$/, 2], [/\.bandcamp\.com$/, 3], [/^soundcloud\.com$/, 4],
    [/(^|\.)youtube\.com$/, 5], [/^deezer\.com$/, 6], [/(^|\.)tidal\.com$/, 7], [/^discogs\.com$/, 8],
    [/^instagram\.com$/, 9], [/^tiktok\.com$/, 10], [/^(x|twitter)\.com$/, 11], [/facebook\.com$/, 12],
  ]
  return order.find(([re]) => re.test(host))?.[1] ?? 20
}

const isProfile = (u: string) => {
  try {
    return isIdentityProfileUrl(u)
  } catch {
    return false
  }
}

/* ── the answer ─────────────────────────────────────────────────────────────────────── */

type Found = { id: string; name: string; resource: string }

/** Every artist the answer links, in the order we asked (the site first). Null = an answer
 *  that isn't MusicBrainz's shape. */
function artistsIn(json: unknown, askedOrder: string[]): Found[] | null {
  if (!isObj(json)) return null
  const entries = Array.isArray(json.urls) ? json.urls : typeof json.resource === 'string' || Array.isArray(json.relations) ? [json] : null
  if (!entries) return null
  const pos = (r: string) => {
    const i = askedOrder.indexOf(r)
    return i < 0 ? askedOrder.length : i
  }
  const found: Found[] = []
  for (const entry of entries) {
    if (!isObj(entry) || typeof entry.resource !== 'string') continue
    for (const rel of Array.isArray(entry.relations) ? entry.relations : []) {
      if (!isObj(rel) || rel['target-type'] !== 'artist' || !isObj(rel.artist)) continue
      const id = typeof rel.artist.id === 'string' ? rel.artist.id : ''
      if (!MBID.test(id)) continue
      found.push({ id: id.toLowerCase(), name: typeof rel.artist.name === 'string' ? rel.artist.name : '', resource: entry.resource })
    }
  }
  return found.sort((a, b) => pos(a.resource) - pos(b.resource))
}

/** One request to MusicBrainz's web service, by its rules: the shared one-a-second gate, our
 *  User-Agent, one retry after a 503 / 429. `status` null = no answer (see `error`). */
async function ask(url: string, opts: Opts, now: () => number, sleep: (ms: number) => Promise<void>): Promise<{ status: number | null; json?: unknown; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (opts.signal?.aborted) return { status: null, error: 'the test ran out of time before asking' }
    await gate(now, sleep)
    const r = await guardedFetch(url, { fetcher: opts.fetcher, userAgent: TAPIR_CHECK_UA, timeoutMs: TIMEOUT_MS, maxBytes: 512 * 1024, allow: (next) => next.startsWith('https://musicbrainz.org/ws/2/') })
    if (r.status === 503 || r.status === 429) {
      if (attempt === 1) return { status: null, error: r.status === 503 ? 'MusicBrainz was busy (503)' : 'MusicBrainz asked us to slow down (429)' }
      const after = Number.parseInt(r.headers['retry-after'] ?? '', 10)
      await sleep(Math.min(RETRY_CAP_MS, Math.max(GAP_MS, Number.isFinite(after) ? after * 1000 : GAP_MS)))
      continue
    }
    if (r.status === null) return { status: null, error: `couldn’t reach MusicBrainz (${r.error ?? 'no answer'})` }
    if (r.status !== 200) return { status: r.status }
    try {
      return { status: 200, json: JSON.parse(r.text ?? '') }
    } catch {
      return { status: null, error: 'MusicBrainz sent an answer we couldn’t read' }
    }
  }
  return { status: null, error: 'MusicBrainz was busy' }
}

/**
 * MusicBrainz's answer for this artist. See the header for what is asked and when it counts
 * as asked.
 */
export async function lookupMusicBrainz(known: SeoKnown, opts: Opts = {}): Promise<Answer> {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  // MusicBrainz lists people who make music: a visual artist's `mb` test does not apply, so
  // nothing is asked (MusicBrainz's 1-a-second budget is shared by every lookup).
  if (known.published?.artistType === 'Person') return { looked: false, artistUrl: null, matchedOn: null, error: 'a visual artist isn’t looked up on MusicBrainz' }
  const links = known.published?.links ?? []
  for (const l of links) {
    const id = musicbrainz.social?.idFromUrl?.(String(l.url ?? '').trim())
    if (!id || !MBID.test(id)) continue
    // The manager's own link, OPENED (verify-content.md M2): a well-formed id MusicBrainz doesn't
    // have is "no page there", and the name it has is reported for the test to compare.
    const mbid = id.toLowerCase()
    const r = await ask(`https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json`, opts, now, sleep)
    const matchedOn = 'your MusicBrainz link in Connections'
    if (r.status === 404) return { looked: true, artistUrl: null, matchedOn, artistName: null, fromConnections: true }
    if (r.status === 200 && isObj(r.json) && typeof r.json.id === 'string' && MBID.test(r.json.id)) {
      return { looked: true, artistUrl: `https://musicbrainz.org/artist/${r.json.id.toLowerCase()}`, matchedOn, artistName: typeof r.json.name === 'string' ? r.json.name : null, fromConnections: true }
    }
    return { looked: false, artistUrl: null, matchedOn: null, error: r.error ?? (r.status === 200 ? 'MusicBrainz sent an answer we couldn’t read' : `MusicBrainz answered with error ${r.status}`) }
  }
  const site = known.siteUrl && isPublicSiteUrl(known.siteUrl) ? musicBrainzForms(known.siteUrl, { site: true }) : []
  const profiles = links
    .map((l) => String(l.url ?? '').trim())
    .filter(isProfile)
    .sort((a, b) => rank(a) - rank(b))
  const chosen: string[] = []
  for (const p of profiles) {
    const first = musicBrainzForms(p)[0]
    if (first && !chosen.some((c) => musicBrainzForms(c)[0] === first)) chosen.push(p)
    if (chosen.length === MAX_PROFILES) break
  }
  const asked = [...new Set([...site, ...chosen.flatMap((p) => musicBrainzForms(p))])].slice(0, 100)
  const shown = [...site.slice(0, 1), ...chosen.map((p) => musicBrainzForms(p)[0])]
  if (!asked.length) return { looked: false, artistUrl: null, matchedOn: null, error: 'there was no site or profile link to look up' }
  const url = `${API}?${asked.map((r) => `resource=${encodeURIComponent(r)}`).join('&')}&inc=artist-rels&fmt=json`
  const notAsked = (error: string): Answer => ({ looked: false, artistUrl: null, matchedOn: null, error, asked: shown })
  const r = await ask(url, opts, now, sleep)
  if (r.status === null) return notAsked(r.error ?? 'MusicBrainz didn’t answer')
  if (r.status === 404) return { looked: true, artistUrl: null, matchedOn: null, artistName: null, asked: shown }
  if (r.status !== 200) return notAsked(`MusicBrainz answered with error ${r.status}`)
  const found = artistsIn(r.json, asked)
  if (!found) return notAsked('MusicBrainz sent an answer we couldn’t read')
  // The artist with THIS artist's name when there is one; else the first, and the `mb` test
  // compares the name and says when it's someone else's (verify-content.md M1).
  const name = fold(known.artistName)
  const best = found.find((f) => name && fold(f.name) === name) ?? found[0]
  if (!best) return { looked: true, artistUrl: null, matchedOn: null, artistName: null, asked: shown }
  return { looked: true, artistUrl: `https://musicbrainz.org/artist/${best.id}`, matchedOn: best.resource, artistName: best.name || null, asked: shown }
}
