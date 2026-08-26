/**
 * SEO / GEO builders (SEO_GEO_PLAN B4). Pure functions over the public payload: no DOM,
 * no HTML, no clock. A site calls them from `generateMetadata`, `sitemap.ts`,
 * `robots.ts` and an inline `<script type="application/ld+json">`; the bridge never
 * decides how any of it is rendered.
 *
 * The one rule underneath every builder: nothing is invented. Every string comes from
 * the published payload (the artist's facts, the manager's SEO overrides, the shows
 * and songs); an unset field is left out of the graph, never filled with a guess.
 */
import type { PublicSitePayload, SiteRelease, SiteTourDate, SiteTrack, SiteVideo, WireMedia } from './payload'
import { platformFromUrl } from './social'
import { recommendAlt } from './alt'

export type SiteSeo = {
  /** <title> and og:title. */
  title: string
  /** meta description, og:description, twitter:description. Always non-empty. */
  description: string
  /** Absolute https URL for the social preview card, or null when none is publishable. */
  ogImage: string | null
}

export const MAX_DESCRIPTION = 160

/** http(s) URLs only: a `javascript:` or `data:` value in a meta tag is a sink. */
export function safeHttpUrl(raw: unknown): string | null {
  // `unknown` on purpose: values arrive from JSON (a release's links jsonb, a manager's
  // site_content); anything that is not a string is not a URL, not a crash.
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!/^https?:\/\//i.test(s)) return null
  try {
    return new URL(s).toString()
  } catch {
    return null
  }
}

function toDescription(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : flat
}

type SeoSource = Pick<PublicSitePayload, 'artist' | 'site_content'>

/** Title/description/image with the precedence every site and template share:
 *  manager override → the artist's own data → a dull, honest default. */
export function resolveSeo(payload: SeoSource): SiteSeo {
  const c = payload.site_content ?? {}
  const name = (payload.artist?.name ?? '').trim()
  const title = (c.seo_title ?? '').trim() || name
  const override = (c.seo_description ?? '').trim()
  const bio = (payload.artist?.bio ?? '').trim()
  const description = override ? toDescription(override) : bio ? toDescription(bio) : `${name} — official site`
  const ogImage = safeHttpUrl(c.og_image) ?? safeHttpUrl(payload.artist?.hero_image_url) ?? null
  return { title, description, ogImage }
}

/* ----------------------------------------------------------------------------------
 * JSON-LD
 * -------------------------------------------------------------------------------- */

export type { SiteRelease } from './payload'

export type JsonLdOptions = {
  /** `https://www.example.com` — no trailing slash. */
  origin: string
  /** Releases for MusicAlbum entries; omit and no albums are emitted. */
  releases?: readonly SiteRelease[] | null
  /** The artist's logo/photo URL for `image`/`logo`. */
  imageUrl?: string | null
  /** Turns a media `path` into its public URL. Omit and no image entries are emitted. */
  mediaUrl?: (path: string) => string
  /** Turns an uploaded video's `storage_path` into its public URL (VideoObject.contentUrl). */
  videoUrl?: (path: string) => string
  /** ISO date (YYYY-MM-DD). Shows on or after it are upcoming; omit to trust `is_past`. */
  today?: string
  /** The /about page URL when the bio lives there, so the graph can point at it. */
  aboutUrl?: string | null
}

type Node = Record<string, unknown>

const RELEASE_TYPE: Record<string, string> = {
  single: 'SingleRelease',
  ep: 'EPRelease',
  album: 'AlbumRelease',
}

function isUpcoming(show: SiteTourDate, today?: string): boolean {
  if (!show.date) return false
  if (today) return show.date.slice(0, 10) >= today
  return show.is_past !== true
}

/** Social profile URLs only (a platform the bridge knows), https, de-duplicated. */
export function sameAsFrom(payload: Pick<PublicSitePayload, 'links' | 'artist'>): string[] {
  const out = new Set<string>()
  for (const l of payload.links ?? []) {
    const url = safeHttpUrl(l.url)
    if (url && platformFromUrl(url)) out.add(url)
  }
  const spotify = payload.artist?.spotify_artist_id
  if (spotify && /^[A-Za-z0-9]+$/.test(spotify)) out.add(`https://open.spotify.com/artist/${spotify}`)
  return [...out]
}

function artistNode(payload: PublicSitePayload, opts: JsonLdOptions, seo: SiteSeo): Node {
  const a = payload.artist
  const genre = (a.genre ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  const location = (a.location ?? '').trim()
  const sameAs = sameAsFrom(payload)
  const person = a.schema_type === 'Person'
  // `foundingLocation` is an Organization property (MusicGroup is one); a Person has
  // `homeLocation`. Same fact, the property schema.org defines for that type.
  const place = location ? { '@type': 'Place', name: location } : null
  return {
    '@type': person ? 'Person' : 'MusicGroup',
    '@id': `${opts.origin}/#artist`,
    name: a.name,
    url: `${opts.origin}/`,
    ...(seo.description ? { description: seo.description } : {}),
    ...(opts.imageUrl ? { image: opts.imageUrl, logo: opts.imageUrl } : {}),
    ...(genre.length ? { genre: genre.length === 1 ? genre[0] : genre } : {}),
    ...(place ? (person ? { homeLocation: place } : { foundingLocation: place }) : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(opts.aboutUrl ? { mainEntityOfPage: opts.aboutUrl } : {}),
  }
}

function eventNode(show: SiteTourDate, payload: PublicSitePayload, opts: JsonLdOptions): Node {
  const artist = { '@id': `${opts.origin}/#artist` }
  const where = [show.venue, show.city].filter(Boolean).join(', ')
  const ticket = safeHttpUrl(show.ticket_url)
  return {
    '@type': 'MusicEvent',
    name: where ? `${payload.artist.name} at ${where}` : payload.artist.name,
    startDate: show.date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(show.venue || show.city
      ? {
          location: {
            '@type': 'Place',
            ...(show.venue ? { name: show.venue } : {}),
            ...(show.city || show.state || show.country
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    ...(show.city ? { addressLocality: show.city } : {}),
                    ...(show.state ? { addressRegion: show.state } : {}),
                    ...(show.country ? { addressCountry: show.country } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    performer: [artist, ...(show.support ?? []).filter(Boolean).map((name) => ({ '@type': 'MusicGroup', name }))],
    ...(ticket ? { offers: { '@type': 'Offer', url: ticket, availability: 'https://schema.org/InStock' } } : {}),
  }
}

function recordingNode(t: SiteTrack, albumId: string | null, opts: JsonLdOptions): Node {
  const url = safeHttpUrl(t.stream_url) ?? safeHttpUrl(t.provider_url)
  return {
    '@type': 'MusicRecording',
    name: t.title,
    byArtist: { '@id': `${opts.origin}/#artist` },
    ...(albumId ? { inAlbum: { '@id': albumId } } : {}),
    ...(url ? { url } : {}),
  }
}

function albumNode(r: SiteRelease, payload: PublicSitePayload, opts: JsonLdOptions): Node {
  const id = `${opts.origin}/#release-${r.id}`
  const cover = safeHttpUrl(r.cover_url)
  const sameAs = new Set<string>()
  const linkValues = Array.isArray(r.links) ? r.links.map((l) => l?.url) : Object.values(r.links ?? {})
  for (const v of linkValues) {
    const u = safeHttpUrl(v)
    if (u) sameAs.add(u)
  }
  if (r.spotify_id && /^[A-Za-z0-9]+$/.test(r.spotify_id)) sameAs.add(`https://open.spotify.com/album/${r.spotify_id}`)
  const tracks = (payload.tracks ?? []).filter((t) => t.release_id === r.id)
  const type = RELEASE_TYPE[(r.release_type ?? '').toLowerCase()]
  return {
    '@type': 'MusicAlbum',
    '@id': id,
    name: r.title,
    byArtist: { '@id': `${opts.origin}/#artist` },
    ...(r.release_date ? { datePublished: r.release_date } : {}),
    ...(cover ? { image: cover } : {}),
    ...(type ? { albumReleaseType: `https://schema.org/${type}` } : {}),
    ...(sameAs.size ? { sameAs: [...sameAs] } : {}),
    ...(tracks.length ? { numTracks: tracks.length, track: tracks.map((t) => recordingNode(t, id, opts)) } : {}),
  }
}

function imageNode(m: WireMedia, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  if (!opts.mediaUrl || m.kind === 'none') return null
  if (m.purpose !== 'gallery_image') return null
  const url = safeHttpUrl(opts.mediaUrl(m.path))
  if (!url) return null
  const text = (m.alt ?? '').trim() || recommendAlt({ artist: payload.artist.name, caption: m.label, kind: m.kind })
  if (m.kind === 'artwork') {
    return {
      '@type': 'VisualArtwork',
      ...(text ? { name: text } : {}),
      image: url,
      creator: { '@id': `${opts.origin}/#artist` },
    }
  }
  return {
    '@type': 'ImageObject',
    contentUrl: url,
    ...(text ? { caption: text } : {}),
    creditText: payload.artist.name,
  }
}

/** YouTube's stable thumbnail for a watch/embed URL, or null for any other provider. */
function youtubeThumb(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/** One VideoObject per on-site video: an embed (YouTube/SoundCloud) or an upload. Only
 *  what is known is stated — no uploadDate is invented, so Google may not show a rich
 *  result, but the fact sheet never lies. */
function videoNode(v: SiteVideo, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  const embed = safeHttpUrl(v.embed_url)
  const content = v.provider === 'uploaded' && v.storage_path && opts.videoUrl ? safeHttpUrl(opts.videoUrl(v.storage_path)) : null
  if (!embed && !content) return null
  const thumb = embed ? youtubeThumb(embed) : null
  return {
    '@type': 'VideoObject',
    name: v.title,
    ...(embed ? { embedUrl: embed } : {}),
    ...(content ? { contentUrl: content } : {}),
    ...(thumb ? { thumbnailUrl: thumb } : {}),
    creator: { '@id': `${opts.origin}/#artist` },
  }
}

/** The whole fact sheet as one `@graph`: artist, website, upcoming events, albums with
 *  their songs, and the photos/artworks the manager listed. */
export function jsonLdGraph(payload: PublicSitePayload, opts: JsonLdOptions): { '@context': string; '@graph': Node[] } {
  const seo = resolveSeo(payload)
  const graph: Node[] = [
    artistNode(payload, opts, seo),
    {
      '@type': 'WebSite',
      '@id': `${opts.origin}/#website`,
      url: `${opts.origin}/`,
      name: payload.artist.name,
      publisher: { '@id': `${opts.origin}/#artist` },
      inLanguage: 'en',
    },
  ]
  for (const show of payload.tour_dates ?? []) if (isUpcoming(show, opts.today)) graph.push(eventNode(show, payload, opts))
  for (const r of opts.releases ?? []) graph.push(albumNode(r, payload, opts))
  for (const v of payload.videos ?? []) {
    const node = videoNode(v, payload, opts)
    if (node) graph.push(node)
  }
  for (const m of payload.media ?? []) {
    const node = imageNode(m, payload, opts)
    if (node) graph.push(node)
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}

/** Serialise for an inline `<script>`: `<` escaped so a caption can never close the tag. */
export function jsonLdScript(graph: unknown): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c')
}

/* ----------------------------------------------------------------------------------
 * sitemap + robots
 * -------------------------------------------------------------------------------- */

export type SitemapEntry = {
  url: string
  lastModified?: Date
  changeFrequency: 'weekly'
  priority: number
}

/**
 * When the page last changed: the newest publish, or the newest show that has since
 * passed (Upcoming → Past moves the page with no publish). No clock: a site that passes
 * the same payload and `today` gets the same lastmod, which is the whole point.
 */
export function lastModifiedFrom(payload: Pick<PublicSitePayload, 'published_at' | 'tour_dates'>, today?: string): Date | undefined {
  const candidates: string[] = []
  if (payload.published_at) candidates.push(payload.published_at)
  if (today) {
    for (const s of payload.tour_dates ?? []) {
      if (s.date && s.date.slice(0, 10) <= today) candidates.push(s.date.slice(0, 10))
    }
  }
  const stamps = candidates.map((c) => Date.parse(c)).filter((n) => Number.isFinite(n))
  return stamps.length ? new Date(Math.max(...stamps)) : undefined
}

export function sitemapEntries(
  payload: Pick<PublicSitePayload, 'published_at' | 'tour_dates'>,
  opts: { origin: string; pages?: readonly string[]; today?: string },
): SitemapEntry[] {
  const lastModified = lastModifiedFrom(payload, opts.today)
  const stamp = lastModified ? { lastModified } : {}
  return [
    { url: `${opts.origin}/`, ...stamp, changeFrequency: 'weekly', priority: 1 },
    ...(opts.pages ?? []).map((p) => ({ url: `${opts.origin}${p.startsWith('/') ? p : `/${p}`}`, ...stamp, changeFrequency: 'weekly' as const, priority: 0.8 })),
  ]
}

export function robotsRules(origin: string): {
  rules: { userAgent: string; allow: string; disallow: string[] }[]
  sitemap: string
  host: string
} {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/edit'] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  }
}

/* ----------------------------------------------------------------------------------
 * about placement
 * -------------------------------------------------------------------------------- */

export const ABOUT_PLACEMENTS = ['home', 'page', 'hidden'] as const
export type AboutPlacement = (typeof ABOUT_PLACEMENTS)[number]
/** What a site declares about its bio (manifest.about): where it CAN go, and where it
 *  goes when the manager has not chosen — the site's call, never the editor's. */
export type ManifestAbout = { placements: readonly ('home' | 'page')[]; default: AboutPlacement }

/** Where the bio renders: the manager's choice if the site supports it, else the site's
 *  declared default, else hidden. `hidden` still feeds meta + JSON-LD (resolveSeo). */
export function aboutPlacement(payload: Pick<PublicSitePayload, 'site_content'>, about: ManifestAbout | null | undefined): AboutPlacement {
  const chosen = (payload.site_content?.about_placement ?? '') as AboutPlacement | ''
  const allowed = new Set<AboutPlacement>(['hidden', ...(about?.placements ?? [])])
  if (chosen && allowed.has(chosen)) return chosen
  return about?.default && allowed.has(about.default) ? about.default : 'hidden'
}

/* ----------------------------------------------------------------------------------
 * audit — does the BUILT html carry what a crawler needs? (CONNECTING §7 rule 6)
 * -------------------------------------------------------------------------------- */

export type SeoFinding = { rule: string; problem: string }

/**
 * Run over the prerendered html strings of `/` and (optionally) `/edit`. Regex on
 * purpose: build tests run in node with no DOM, and every check here is a tag-level
 * fact, not a layout question. Returns [] when the page is findable.
 */
export function auditSeo(input: { home: string; edit?: string | null }): SeoFinding[] {
  const out: SeoFinding[] = []
  const { home, edit } = input
  const desc = home.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? ''
  if (desc.length <= 60) out.push({ rule: 'description', problem: `meta description is ${desc.length} chars; needs more than 60` })
  if (!/<link[^>]*rel="canonical"/i.test(home)) out.push({ rule: 'canonical', problem: 'no canonical link' })
  const h1 = (home.match(/<h1[\s>]/gi) ?? []).length
  if (h1 !== 1) out.push({ rule: 'h1', problem: `${h1} h1 elements; needs exactly one` })
  for (const m of home.matchAll(/<section[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi)) {
    if (!/<h[12][\s>]/i.test(m[2])) out.push({ rule: 'headings', problem: `section #${m[1]} has no h1/h2` })
  }
  for (const m of home.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    if (/\balt=""/.test(tag) && !/aria-hidden/.test(tag)) out.push({ rule: 'alt', problem: `content image with empty alt: ${tag.slice(0, 80)}` })
    if (!/\balt=/.test(tag)) out.push({ rule: 'alt', problem: `image with no alt attribute: ${tag.slice(0, 80)}` })
    if (/\bsrc="\/_next\/image/.test(tag)) out.push({ rule: 'src', problem: `image src goes through /_next/image (filename lost): ${tag.slice(0, 80)}` })
  }
  const ld = home.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (!ld) out.push({ rule: 'json-ld', problem: 'no application/ld+json script' })
  else {
    try {
      JSON.parse(ld[1])
    } catch {
      out.push({ rule: 'json-ld', problem: 'ld+json does not parse' })
    }
  }
  if (/<meta\s+name="robots"[^>]*noindex/i.test(home)) out.push({ rule: 'robots', problem: 'the homepage is noindex' })
  if (edit != null && !/<meta\s+name="robots"[^>]*noindex/i.test(edit)) out.push({ rule: 'robots', problem: '/edit is not noindex' })
  return out
}
