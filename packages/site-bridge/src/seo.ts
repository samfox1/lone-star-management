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

/**
 * The artist's name, TRIMMED — the one spelling every SEO surface uses.
 *
 * A normaliser rather than a `.trim()` at each call site, because the per-consumer
 * version is what went wrong: the 0.34.1 no-name fix trimmed it inside `autoFaqAnswer`
 * and left `probePrompts` reading the raw value, so a name with a trailing space
 * rendered "Who is Skeen , the musician?" directly above "Skeen's official website is
 * …" — one artist, two spellings, on the page whose whole job is to be quoted verbatim
 * (2026-09-03 review). Nothing trims `artists.name` on the way in, so this is the
 * boundary.
 *
 * Empty means NO NAME, and callers treat that as "say nothing" rather than interpolating
 * a hole into a sentence.
 */
function artistName(a: { name?: string | null } | null | undefined): string {
  return (a?.name ?? '').trim()
}

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
  /**
   * The images the page actually SHOWS, and how: return the rendered `<img src>` (the
   * same URL, so Google can pair the node with the picture) and the alt it carries, or
   * null to leave that media row out. Omit and no image entries are emitted — the bridge
   * cannot know which rows a site places. Pass the same function that renders your alts.
   */
  listImage?: (m: WireMedia) => { url: string; alt?: string | null } | null
  /** Turns an uploaded video's `storage_path` into its public URL (VideoObject.contentUrl). */
  videoUrl?: (path: string) => string
  /** A poster image URL for an uploaded video, when the site has one. Without a thumbnail
   *  an uploaded video is left out (Google requires thumbnailUrl). */
  videoPoster?: (v: SiteVideo) => string | null | undefined
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
  // The manager's flag wins over the calendar: a show marked past (done, cancelled) is
  // never advertised, whatever its date says — the page lists it under Past too.
  if (show.is_past === true) return false
  if (today) return show.date.slice(0, 10) >= today
  return true
}

/** Is this a PROFILE page on its platform, not a playlist, a track, a video or a set?
 *  `sameAs` asserts identity; a playlist link asserts nothing about who the artist is. */
export function isProfileUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const host = u.hostname.replace(/^www\./, '')
  const segs = u.pathname.split('/').filter(Boolean)
  if (host.endsWith('spotify.com')) return segs[0] === 'artist' || segs[0] === 'user'
  if (host.endsWith('soundcloud.com')) return segs.length === 1
  if (host.endsWith('youtube.com')) return segs.length === 1 ? segs[0].startsWith('@') : ['channel', 'c', 'user'].includes(segs[0] ?? '')
  if (host.endsWith('music.apple.com')) return segs.includes('artist')
  if (host.endsWith('bandcamp.com')) return segs.length === 0
  return segs.length <= 1
}

/** Social PROFILE URLs only (a platform the bridge knows, profile-shaped), https,
 *  de-duplicated. */
export function sameAsFrom(payload: Pick<PublicSitePayload, 'links' | 'artist'>): string[] {
  const out = new Set<string>()
  for (const l of payload.links ?? []) {
    const url = safeHttpUrl(l.url)
    if (url && platformFromUrl(url) && isProfileUrl(url)) out.add(url)
  }
  const spotify = payload.artist?.spotify_artist_id
  if (spotify && /^[A-Za-z0-9]+$/.test(spotify)) out.add(`https://open.spotify.com/artist/${spotify}`)
  return [...out]
}

function artistNode(payload: PublicSitePayload, opts: JsonLdOptions, seo: SiteSeo): Node {
  const a = payload.artist
  // The WHOLE bio, whitespace-collapsed — the fact sheet has no 160-char limit, and the
  // description is the text AI engines quote. The meta description only when there is no bio.
  const bio = (a.bio ?? '').replace(/\s+/g, ' ').trim()
  const description = bio || seo.description
  const genre = (a.genre ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
  const location = (a.location ?? '').trim()
  const sameAs = sameAsFrom(payload)
  const person = a.schema_type === 'Person'
  // `foundingLocation`, `logo` and `genre` are Organization/MusicGroup properties; a
  // Person has `homeLocation` and `image`, and no genre. Same facts, the properties
  // schema.org defines for that type — anything else fails the validator.
  const place = location ? { '@type': 'Place', name: location } : null
  return {
    '@type': person ? 'Person' : 'MusicGroup',
    '@id': `${opts.origin}/#artist`,
    name: artistName(a),
    url: `${opts.origin}/`,
    ...(description ? { description } : {}),
    ...(opts.imageUrl ? (person ? { image: opts.imageUrl } : { image: opts.imageUrl, logo: opts.imageUrl }) : {}),
    ...(genre.length && !person ? { genre: genre.length === 1 ? genre[0] : genre } : {}),
    ...(place ? (person ? { homeLocation: place } : { foundingLocation: place }) : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(opts.aboutUrl ? { mainEntityOfPage: opts.aboutUrl } : {}),
  }
}

function eventNode(show: SiteTourDate, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  // Google requires `location` with an ADDRESS on an Event. A show with no city has no
  // address to state (a venue name alone is not one), so it is left out rather than
  // shipped as an error.
  if (!show.city) return null
  const artist = { '@id': `${opts.origin}/#artist` }
  const where = [show.venue, show.city].filter(Boolean).join(', ')
  const ticket = safeHttpUrl(show.ticket_url)
  return {
    '@type': 'MusicEvent',
    name: where ? `${artistName(payload.artist)} at ${where}` : artistName(payload.artist),
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
    // No numTracks: the wire carries on-site songs only, so a count would be a fact about
    // the page, not the record.
    ...(tracks.length ? { track: tracks.map((t) => recordingNode(t, id, opts)) } : {}),
  }
}

function imageNode(m: WireMedia, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  if (!opts.listImage || m.kind === 'none') return null
  if (m.purpose !== 'gallery_image') return null
  const shown = opts.listImage(m)
  if (!shown) return null
  const url = safeHttpUrl(shown.url)
  if (!url) return null
  const text = (shown.alt ?? '').trim() || (m.alt ?? '').trim() || recommendAlt({ artist: artistName(payload.artist), caption: m.label, kind: m.kind })
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
    creditText: artistName(payload.artist),
  }
}

/** YouTube's stable thumbnail for a watch/embed URL, or null for any other provider. */
function youtubeThumb(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/)
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null
}

/**
 * One VideoObject per on-site VIDEO (SoundCloud is an audio player, not a video, and is
 * left out). Google requires name, thumbnailUrl, uploadDate and description, so a node is
 * emitted only when all four are known: the thumbnail from YouTube (or the site's
 * `videoPoster` hook for uploads), the date from when the manager added it. Nothing is
 * invented; a video that cannot be stated fully is not stated.
 */
function videoNode(v: SiteVideo, payload: PublicSitePayload, opts: JsonLdOptions): Node | null {
  if (v.provider === 'soundcloud') return null
  const embed = v.provider === 'youtube' ? safeHttpUrl(v.embed_url) : null
  const content = v.provider === 'uploaded' && v.storage_path && opts.videoUrl ? safeHttpUrl(opts.videoUrl(v.storage_path)) : null
  if (!embed && !content) return null
  const thumb = embed ? youtubeThumb(embed) : safeHttpUrl(opts.videoPoster?.(v))
  // The platform's publish date, never the day the manager added the link (that was the
  // 2026-08-26 mistake): unknown = not stated.
  //
  // An UPLOAD has no other platform — this site is where it was published — so for a
  // self-hosted file `created_at` IS the publish date, not a stand-in for one. Only the
  // YouTube sync ever writes `published_at`, so without this an uploaded video could
  // never be stated at all, however complete the rest of it was (review 2026-09-03, M3).
  const uploadDate = v.published_at ?? (v.provider === 'uploaded' ? (v.created_at ?? null) : null)
  if (!thumb || !uploadDate || !v.title) return null
  return {
    '@type': 'VideoObject',
    name: v.title,
    description: `${v.title} by ${artistName(payload.artist)}`,
    thumbnailUrl: thumb,
    uploadDate,
    ...(embed ? { embedUrl: embed } : {}),
    ...(content ? { contentUrl: content } : {}),
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
      name: artistName(payload.artist),
      publisher: { '@id': `${opts.origin}/#artist` },
      inLanguage: 'en',
    },
  ]
  for (const show of payload.tour_dates ?? []) {
    if (!isUpcoming(show, opts.today)) continue
    const node = eventNode(show, payload, opts)
    if (node) graph.push(node)
  }
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
      // Strictly before today: on the day itself the page still lists the show as
      // upcoming (isUpcoming is `>= today`), so nothing has changed yet.
      if (s.date && s.date.slice(0, 10) < today) candidates.push(s.date.slice(0, 10))
    }
  }
  const stamps = candidates.map((c) => Date.parse(c)).filter((n) => Number.isFinite(n))
  return stamps.length ? new Date(Math.max(...stamps)) : undefined
}

export function sitemapEntries(
  payload: Pick<PublicSitePayload, 'published_at' | 'tour_dates'>,
  opts: { origin: string; pages?: readonly string[]; today?: string },
): SitemapEntry[] {
  // `pages` is what a site chooses to list beyond the homepage — /about when the bio
  // lives there, /faqsheet when any question is answered. Listed, but never linked from
  // the site's own navigation: that is the whole point of the sheet.
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
  // No Disallow for /edit: a disallowed URL is never FETCHED, so Google never sees the
  // meta noindex on it and can still index it URL-only ("indexed, though blocked"). The
  // page's own `noindex, nofollow` is the whole mechanism; robots.txt just names the map.
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [] }],
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
 *
 * `edit: null` means "this site has no /edit page" — a pass, nothing to be indexed.
 * `editError` is the other reason it might be missing: the caller TRIED and could not
 * read it (a 429, a 500, a dropped connection). A check that cannot tell "fine" from
 * "could not look" must not report fine, so the unknown is stated as a finding.
 */
export function auditSeo(input: { home: string; edit?: string | null; editError?: string | null }): SeoFinding[] {
  const out: SeoFinding[] = []
  const { home, edit, editError } = input
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
  if (editError) out.push({ rule: 'robots', problem: `could not check whether /edit is noindex (${editError})` })
  else if (edit != null && !/<meta\s+name="robots"[^>]*noindex/i.test(edit)) out.push({ rule: 'robots', problem: '/edit is not noindex' })
  return out
}

/* ----------------------------------------------------------------------------------
 * audit — is the fact sheet one Google's Rich Results test would accept?
 * -------------------------------------------------------------------------------- */

/** The fields Google marks REQUIRED per type (developers.google.com/search/docs). A
 *  node missing one is reported as an error there, not merely "no rich result". */
export const JSON_LD_REQUIRED: Record<string, readonly string[]> = {
  MusicGroup: ['name', 'url'],
  Person: ['name', 'url'],
  WebSite: ['name', 'url'],
  MusicEvent: ['name', 'startDate', 'location'],
  MusicAlbum: ['name', 'byArtist'],
  MusicRecording: ['name', 'byArtist'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate', 'description'],
  ImageObject: ['contentUrl'],
  VisualArtwork: ['image', 'creator'],
}

/** `kinds`: MusicAlbum nodes by albumReleaseType (album / ep / single / other) — a
 *  release is a MusicAlbum in schema.org whatever its size, so the count alone misleads. */
export type JsonLdSummary = { counts: Record<string, number>; kinds: Record<string, number>; findings: SeoFinding[] }

/** Parse an ld+json string (or take the object) and check every `@graph` node. */
export function auditJsonLd(input: string | unknown): JsonLdSummary {
  let graph: unknown
  try {
    graph = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    return { counts: {}, kinds: {}, findings: [{ rule: 'json-ld', problem: 'ld+json does not parse' }] }
  }
  const nodes = (graph as { '@graph'?: unknown })?.['@graph']
  if (!Array.isArray(nodes)) return { counts: {}, kinds: {}, findings: [{ rule: 'json-ld', problem: 'no @graph array' }] }
  const counts: Record<string, number> = {}
  const kinds: Record<string, number> = {}
  const findings: SeoFinding[] = []
  const check = (node: Record<string, unknown>, where: string) => {
    const type = String(node['@type'] ?? '')
    counts[type] = (counts[type] ?? 0) + 1
    for (const field of JSON_LD_REQUIRED[type] ?? []) {
      const v = node[field]
      if (v === undefined || v === null || v === '') findings.push({ rule: type, problem: `${where} is missing ${field}` })
    }
    if (type === 'MusicEvent' && node.location && !(node.location as Record<string, unknown>).address) {
      findings.push({ rule: type, problem: `${where} location has no address` })
    }
    if (type === 'MusicAlbum') {
      const kind = String(node.albumReleaseType ?? '').replace(/^.*\//, '').replace(/Release$/, '').toLowerCase() || 'other'
      kinds[kind] = (kinds[kind] ?? 0) + 1
    }
    if (type === 'MusicAlbum' && Array.isArray(node.track)) {
      for (const [i, t] of (node.track as Record<string, unknown>[]).entries()) check(t, `${where} track ${i + 1}`)
    }
  }
  for (const [i, n] of (nodes as Record<string, unknown>[]).entries()) check(n, `${String(n['@type'] ?? 'node')} #${i + 1}`)
  return { counts, kinds, findings }
}

/**
 * The findability rules, ONE registry: the site's build test, the live check and the
 * SEO / GEO page all derive their lists from it, so a rule added here appears everywhere
 * (and one nobody listed can never be silently dropped).
 */
export const SEO_RULES: readonly { rule: string; label: string }[] = [
  { rule: 'description', label: 'Meta description (60+ chars)' },
  { rule: 'canonical', label: 'Canonical URL' },
  { rule: 'h1', label: 'Exactly one H1' },
  { rule: 'headings', label: 'A heading in every section' },
  { rule: 'alt', label: 'Alt text on every content image' },
  { rule: 'src', label: 'Image URLs are direct (no /_next/image)' },
  { rule: 'json-ld', label: 'Fact sheet (JSON-LD) present and parses' },
  { rule: 'robots', label: 'Homepage indexable; /edit noindex' },
  { rule: 'facts', label: 'Fact sheet has every field Google requires' },
  { rule: 'facts-geo', label: 'Fact sheet states genre and location' },
  { rule: 'bio-visible', label: 'The bio is visible text on a page' },
  { rule: 'other', label: 'Other' },
]

/** GEO: the artist node states the facts AI answers are asked for. */
export function auditGeoFacts(graph: unknown): SeoFinding[] {
  const nodes = (graph as { '@graph'?: Record<string, unknown>[] })?.['@graph']
  if (!Array.isArray(nodes)) return []
  const artist = nodes.find((n) => n['@type'] === 'MusicGroup' || n['@type'] === 'Person')
  if (!artist) return [{ rule: 'facts-geo', problem: 'no artist node (MusicGroup / Person)' }]
  const out: SeoFinding[] = []
  if (artist['@type'] === 'MusicGroup' && !artist.genre) out.push({ rule: 'facts-geo', problem: 'artist has no genre — set it on the SEO / GEO page and publish' })
  if (!artist.foundingLocation && !artist.homeLocation) out.push({ rule: 'facts-geo', problem: 'artist has no location — set "Based in" on the SEO / GEO page and publish' })
  return out
}

/* ----------------------------------------------------------------------------------
 * The FAQ sheet — the artist's own answers to the five probe questions
 * -------------------------------------------------------------------------------- */

/** PROBE_PROMPTS v1 — FROZEN. Name and artist TYPE only; never a fact the site should
 *  teach (leaking "Chicago" into the question hands the engine the answer). Change the
 *  wording only with a new version, or months stop comparing. */
export const PROBE_VERSION = 'v1'
export function probePrompts(rawName: string, schemaType?: string | null): string[] {
  // TRIMMED HERE, not by the caller. The caller-side trim left the editor's SEO ledger
  // (tools/seo/sections/ai.tsx, which calls this directly) showing "Who is Skeen , the
  // musician?" while the published sheet said "Skeen" — the manager writing the answers
  // and the page quoting them spelling the artist differently (2026-09-04 review).
  const name = (rawName ?? '').trim()
  const role = schemaType === 'Person' ? 'the artist' : 'the musician'
  return [
    `Who is ${name}, ${role}?`,
    `What kind of music does ${name} make, and where are they based?`,
    `When is ${name} playing next?`,
    `What has ${name} released recently?`,
    `${name} official website`,
  ]
}

export type FaqEntry = { question: string; answer: string }

function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export type FaqSource = {
  artist: Pick<PublicSitePayload['artist'], 'name'> & Partial<Pick<PublicSitePayload['artist'], 'bio' | 'genre' | 'location' | 'schema_type'>>
  site_content?: PublicSitePayload['site_content'] | null
  tour_dates?: PublicSitePayload['tour_dates'] | null
  releases?: readonly SiteRelease[] | null
  origin?: string
  today?: string
}

/**
 * The AUTOMATIC answer to prompt N (1-based), from published data only — nothing is
 * invented; '' when the data is not there. The manager's own answer always wins.
 */
export function autoFaqAnswer(n: number, src: FaqSource): string {
  const a = src.artist
  // TRIMMED, and that is the guard rather than cosmetics: `'  '` is truthy, so an
  // untrimmed read let a whitespace-only artist satisfy the name check on Q5 below and
  // produce "  's official website is …".
  const name = artistName(a)
  const genre = (a.genre ?? '').trim()
  const where = (a.location ?? '').trim()
  const bio = (a.bio ?? '').replace(/\s+/g, ' ').trim()
  const role = a.schema_type === 'Person' ? 'artist' : 'musician'
  // NO NAME, NO ANSWER — at the TOP, because every branch below interpolates it. The
  // previous guard sat on n===5 alone, under a comment claiming that was the only branch
  // reachable without an artist. It was not: Q1–Q4 produced " is a House, Techno
  // musician, based in Chicago." and friends.
  //
  // This matters even though `faqEntries` would not reach them, because this function is
  // EXPORTED and the editor's SEO ledger calls it directly for the answers it displays —
  // and `sections/ai.tsx` seeds its textarea with `row.answer || row.auto`, so a manager
  // who opens such a row SAVES the hole as a written answer. Written answers win forever,
  // outliving the missing name that caused them (2026-09-04 review).
  if (!name) return ''
  if (n === 1) {
    if (bio) return bio
    const bits = [genre ? `${genre} ${role}` : role, where ? `based in ${where}` : ''].filter(Boolean).join(', ')
    return genre || where ? `${name} is a ${bits}.` : ''
  }
  if (n === 2) {
    if (!genre && !where) return ''
    return [genre ? `${name} makes ${genre}.` : '', where ? `${name} is based in ${where}.` : ''].filter(Boolean).join(' ')
  }
  if (n === 3) {
    const next = (src.tour_dates ?? [])
      .filter((s) => s.date && s.is_past !== true && (!src.today || s.date.slice(0, 10) >= src.today))
      .sort((x, y) => (x.date! < y.date! ? -1 : 1))[0]
    if (!next) return ''
    const place = [next.venue, next.city].filter(Boolean).join(', ')
    return `${name} plays ${place ? `${place} on ` : ''}${fmtDate(next.date!)}.`
  }
  if (n === 4) {
    const recent = [...(src.releases ?? [])].filter((r) => r.release_date).sort((x, y) => (x.release_date! > y.release_date! ? -1 : 1)).slice(0, 3)
    if (!recent.length) return ''
    return `${name}'s latest releases: ${recent.map((r) => `${r.title} (${fmtDate(r.release_date!)})`).join(', ')}.`
  }
  if (n === 5) return src.origin ? `${name}'s official website is ${src.origin.replace(/^https?:\/\//, '')}.` : ''
  return ''
}

/** The sheet's questions and answers, in order: the manager's `faq_answer_N` when
 *  written, else the automatic answer, else the question is left out. Then any EXTRA
 *  questions the manager added (`faq_extra_N_q` / `_a`) — theirs, on the sheet, outside
 *  the measurement. Empty = no sheet. */
/** An ANSWER is prose the manager wrote in a textarea, so its paragraph breaks are part
 *  of what they wrote. Horizontal runs still collapse and a pileup of blank lines caps at
 *  one, matching `normalizeSeoValue` on the way IN — the two have to agree, or a value
 *  saved intact is mangled on the way out (2026-09-03 review, M8). A QUESTION is one line
 *  by nature and becomes a JSON-LD Question's `name`, so it keeps collapsing entirely. */
function faqProse(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function faqEntries(src: FaqSource): FaqEntry[] {
  // NO NAME, NO SHEET. Every prompt and every automatic answer interpolates the artist's
  // name, so without one the sheet reads "Who is , the musician?" answered by "'s
  // official website is skeenmusic.com." — and this page exists to be QUOTED by an
  // assistant, which makes a sentence with a hole in it worse than no page.
  //
  // Only Q5's guard used to be reachable (it tested `origin`, not the name), so a payload
  // with no artist still produced one truthy answer and listed /faqsheet in the sitemap.
  // Caught by skeen's own sitemap test the day 0.34.0 was installed (2026-09-03).
  //
  // The manager's EXTRA questions are exempt below: those are whole sentences they wrote
  // themselves, and none of them depends on the name.
  // ONE name for the questions and the answers alike — see artistName.
  const name = artistName(src.artist)
  const prompts = name ? probePrompts(name, src.artist.schema_type) : []
  const c = src.site_content ?? {}
  const out: FaqEntry[] = []
  prompts.forEach((question, i) => {
    const answer = faqProse(c[`faq_answer_${i + 1}`] ?? '') || autoFaqAnswer(i + 1, src)
    if (answer) out.push({ question, answer })
  })
  for (let n = 1; n <= 5; n++) {
    const q = (c[`faq_extra_${n}_q`] ?? '').replace(/\s+/g, ' ').trim()
    const a = faqProse(c[`faq_extra_${n}_a`] ?? '')
    if (q && a) out.push({ question: q, answer: a })
  }
  return out
}

/** FAQPage markup for the /faqsheet route: the artist as the page's subject, one
 *  Question/Answer pair per answered prompt. Null when nothing is answered. */
export function faqPageJsonLd(payload: FaqSource, opts: { origin: string; path?: string }) {
  // The manager's EXTRA questions are exempt from the no-name rule — whole sentences they
  // wrote, none depending on the name. That exemption is right, and it is also what let a
  // nameless artist reach this node with a non-empty `entries`, shipping the title as
  // " — questions and answers". The exemption stays; the TITLE still needs a name.
  if (!artistName(payload.artist)) return null
  const entries = faqEntries({ ...payload, origin: payload.origin ?? opts.origin })
  if (!entries.length) return null
  const path = opts.path ?? '/faqsheet'
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': `${opts.origin}${path}#faq`,
        url: `${opts.origin}${path}`,
        name: `${artistName(payload.artist)} — questions and answers`,
        about: { '@id': `${opts.origin}/#artist` },
        mainEntity: entries.map((e) => ({
          '@type': 'Question',
          name: e.question,
          acceptedAnswer: { '@type': 'Answer', text: e.answer },
        })),
      },
    ],
  }
}
