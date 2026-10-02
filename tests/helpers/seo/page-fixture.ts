/**
 * A healthy artist site (its html) and the evidence a run would gather from it. Each SEO test
 * starts from this and breaks ONE thing, so a red test names the rule that broke.
 *
 * Code:     support file (not a test): feeds src/lib/seo-tests/who.ts, shared.ts, facts.ts,
 *           found.ts and the SEO page's component tests
 * Feature:  every SEO test in the four Test-tab groups
 * Tier:     STRICT (AGENTS.md "Test depth"): the tests built on it are strict. Every value is
 *           written by hand as a real site sends it, never copied from the code under test.
 *           (Not a *.test.ts file: vitest only collects those, so this is imported, never run.)
 * What it provides:
 *           • homeHtml / aboutHtml: a healthy home page and About page (title, description,
 *             share tags, two photos, an Apple Music button, the music section, the fact card)
 *           • healthyGraph / artistNode / graphBlock / ldScript: the fact card, piece by piece
 *           • known: what Tapir published for the artist; evidence: one run's whole evidence
 *           • page: one fetched page (a status, an error, a page cut at the read cap)
 *           • rowOf / expectPlainWords: read one "Show the details" row; check a result keeps
 *             the plain-words contract (types.ts)
 * Not here: bot visits, robots.txt and sitemaps have their own fakes (tests/unit/seo-tests/_found-fixtures.ts,
 *           fake-site.ts); hostile and malformed html lives in tests/unit/safe-fetching/_parser-corpus.ts.
 * Fixtures: all made up: the artist "Skeen" at www.example-artist.com, today 2026-09-28.
 *           Nothing is fetched.
 */
import { expect } from 'vitest'
import type { SeoEvidence, SeoKnown, SeoPageFetch, SeoTestResult } from '@/lib/seo-tests/types'

export const ORIGIN = 'https://www.example-artist.com'
const TODAY = '2026-09-28'

/** A healthy bio: over 100 words, naming the genre (house), the city (Chicago) and highlights
 *  from Music and Tour (OutWest, Smartbar), in distinct sentences, with an apostrophe and an
 *  ampersand in it. The first sentence names none of the three facts, so a page showing only
 *  part of it can be told apart. */
export const LONG_BIO = [
  'Skeen started out filming friends at parties and never really stopped.',
  'Today he is a Chicago DJ and producer who plays house music & tech house long into the night.',
  'His debut EP OutWest came out in 2024 and still gets played in clubs across the Midwest.',
  'He has headlined Smartbar, opened for ZHU at Navy Pier and toured the country with Jigitz.',
  'Every set is filmed for his video diary about building a career in dance music from the ground up.',
  'When he isn\'t on stage he is in the studio with his USB, three cameras and a ridiculous idea.',
  'He answers every message from fans and still books his own shows, one city at a time.',
  'Hopefully he will see you in your city soon, somewhere loud, late and full of friends.',
].join(' ')

export const PROFILES = [
  'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR',
  'https://www.instagram.com/skeeeeeeen/',
  'https://soundcloud.com/user-818426052',
  'https://music.apple.com/us/artist/skeen/1754431714',
]

export type Graph = Record<string, unknown>[]

export function artistNode(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '@type': 'MusicGroup',
    '@id': `${ORIGIN}/#artist`,
    name: 'Skeen',
    url: `${ORIGIN}/`,
    description: LONG_BIO,
    genre: ['House', 'Tech House'],
    foundingLocation: {
      '@type': 'Place',
      name: 'Chicago, IL',
      address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL', addressCountry: 'US' },
    },
    sameAs: [...PROFILES],
    ...over,
  }
}

export function healthyGraph(): Graph {
  return [
    artistNode(),
    { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: 'Skeen', publisher: { '@id': `${ORIGIN}/#artist` } },
    {
      '@type': 'MusicEvent',
      name: 'Skeen at Smartbar, Chicago',
      startDate: '2026-10-15',
      location: { '@type': 'Place', name: 'Smartbar', address: { '@type': 'PostalAddress', addressLocality: 'Chicago' } },
      performer: [{ '@id': `${ORIGIN}/#artist` }, { '@type': 'MusicGroup', name: 'Support Act' }],
    },
    { '@type': 'MusicAlbum', '@id': `${ORIGIN}/#release-1`, name: 'You Were There', byArtist: { '@id': `${ORIGIN}/#artist` }, datePublished: '2026-02-14' },
    { '@type': 'MusicAlbum', '@id': `${ORIGIN}/#release-2`, name: 'Heatwaves & Horizons', byArtist: { '@id': `${ORIGIN}/#artist` }, datePublished: '2025-05-09', track: [{ '@type': 'MusicRecording', name: 'Heatwaves', byArtist: { '@id': `${ORIGIN}/#artist` } }] },
    { '@type': 'MusicAlbum', '@id': `${ORIGIN}/#release-3`, name: 'OutWest', byArtist: { '@id': `${ORIGIN}/#artist` }, datePublished: '2024-01-26' },
  ]
}

/** The block the bridge writes: `<` escaped so a caption can't close the script. */
export const ldScript = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
export const graphBlock = (graph: Graph) => ldScript({ '@context': 'https://schema.org', '@graph': graph })

export type HomeOpts = {
  title?: string | null
  description?: string | null
  og?: Record<string, string | null>
  head?: string
  body?: string
  ld?: string[]
  /** The music section, as words (a healthy page shows the releases its fact card lists).
   *  Defaults to the three healthy releases; '' for none. */
  music?: string
}

const MUSIC_SECTION = '<section><h2>Music</h2><ul><li>You Were There</li><li>Heatwaves &amp; Horizons</li><li>OutWest</li></ul></section>'

export const OG_IMAGE = 'https://cdn.example-artist.com/og/social-card.png'

export function homeHtml(o: HomeOpts = {}): string {
  const title = o.title === undefined ? 'Skeen · Chicago house DJ and producer' : o.title
  const description = o.description === undefined ? 'Meet Skeen, a Chicago DJ, producer and filmmaker, building a career in dance music from the ground up.' : o.description
  const og: Record<string, string | null> = {
    'og:title': title,
    'og:description': description,
    'og:url': ORIGIN,
    'og:image': OG_IMAGE,
    'twitter:card': 'summary_large_image',
    ...o.og,
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const metas = Object.entries(og)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => (k.startsWith('twitter:') ? `<meta name="${k}" content="${esc(v as string)}"/>` : `<meta property="${k}" content="${esc(v as string)}"/>`))
    .join('')
  const ld = o.ld ?? [graphBlock(healthyGraph())]
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>',
    title === null ? '' : `<title>${esc(title)}</title>`,
    description === null ? '' : `<meta name="description" content="${esc(description)}"/>`,
    metas,
    `<link rel="canonical" href="${ORIGIN}"/>`,
    o.head ?? '',
    '</head><body><h1>Skeen</h1>',
    '<img src="/hero.jpg" alt="Skeen on stage at the Salt Shed"/>',
    '<img aria-hidden="true" alt="" src="/marquee.jpg"/>',
    '<a href="https://music.apple.com/us/artist/skeen/1754431714">Apple Music</a>',
    o.body ?? '',
    o.music ?? MUSIC_SECTION,
    ...ld,
    '</body></html>',
  ].join('')
}

export function aboutHtml(bio: string = LONG_BIO, extra = ''): string {
  const paragraphs = bio
    .split(/(?<=\.) /)
    .map((s) => `<p>${s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')}</p>`)
    .join('\n')
  return `<!DOCTYPE html><html><head><title>About · Skeen</title></head><body><h1>About</h1>${paragraphs}<img src="/about.jpg" alt="Skeen, Concord Music Hall"/>${extra}</body></html>`
}

export function page(path: string, html: string | null, status: number | null = 200, more: Partial<SeoPageFetch> = {}): SeoPageFetch {
  return { path, finalUrl: status === null ? null : `${ORIGIN}${path}`, status, headers: html ? { 'content-type': 'text/html; charset=utf-8' } : {}, html, ...more }
}

export function known(over: Partial<SeoKnown> = {}, pub: Partial<NonNullable<SeoKnown['published']>> = {}): SeoKnown {
  return {
    artistName: 'Skeen',
    siteUrl: ORIGIN,
    today: TODAY,
    published: {
      bio: LONG_BIO,
      genre: 'House, Tech House',
      location: 'Chicago, IL',
      seoTitle: 'Skeen · Chicago house DJ and producer',
      seoDescription: null,
      ogImage: OG_IMAGE,
      links: [
        { label: 'Spotify', url: PROFILES[0], onSite: true },
        { label: 'Instagram', url: 'https://instagram.com/skeeeeeeen?igsh=abc123', onSite: true },
        { label: 'SoundCloud', url: PROFILES[2], onSite: false },
        { label: 'Apple Music', url: PROFILES[3], onSite: false },
        { label: 'Booking', url: 'mailto:book@example.com', onSite: true },
      ],
      tourDates: [
        { date: '2026-10-15', venue: 'Smartbar', city: 'Chicago', isPast: false },
        { date: '2026-08-15', venue: 'Navy Pier', city: 'Chicago', isPast: true },
      ],
      releases: [
        { title: 'You Were There', releasedOn: '2026-02-14' },
        { title: 'Heatwaves & Horizons', releasedOn: '2025-05-09' },
        { title: 'OutWest', releasedOn: '2024-01-26' },
      ],
      photos: [],
      publishedAt: '2026-09-28T12:00:00Z',
      region: 'IL',
      country: 'United States',
      countryCode: 'US',
      artistType: 'MusicGroup',
      // The same profile as PROFILES[0]: the bridge adds it from the id, and it is one profile.
      spotifyArtistId: '26KxuQlgIw8VP8YX2IkMWR',
      ...pub,
    },
    ...over,
  }
}

export type EvidenceOpts = {
  home?: string | null
  about?: string | null
  pages?: SeoPageFetch[]
  known?: SeoKnown
  shareImage?: SeoEvidence['shareImage']
  musicbrainz?: SeoEvidence['musicbrainz']
}

export function evidence(o: EvidenceOpts = {}): SeoEvidence {
  const home = o.home === undefined ? homeHtml() : o.home
  const about = o.about === undefined ? aboutHtml() : o.about
  const plain = o.pages ?? [page('/', home, home === null ? null : 200), ...(about === null ? [] : [page('/about', about)])]
  return {
    origin: ORIGIN,
    gatheredAt: `${TODAY}T20:00:00Z`,
    paths: plain.map((p) => p.path),
    plain,
    byBot: {},
    robots: { status: 200, body: 'User-agent: *\nAllow: /' },
    sitemap: null,
    shareImage: o.shareImage === undefined ? { url: OG_IMAGE, status: 200, contentType: 'image/png', width: 1200, height: 630, bytes: 32_000, format: 'png' } : o.shareImage,
    musicbrainz: o.musicbrainz ?? { looked: true, artistUrl: null, matchedOn: null },
    known: o.known ?? known(),
  }
}

/** The value of the first "Show the details" row with this label (a string is an exact label). */
export function rowOf(r: SeoTestResult, label: string | RegExp): string | undefined {
  return r.evidence.find((e) => (typeof label === 'string' ? e.label === label : label.test(e.label)))?.value
}

/** Code names for the tags: a manager never reads these in a result. */
const JARGON = /json-ld|\bmeta\b|og:|canonical|schema|@type|sameAs/i

/** One result keeps the contract's plain words (types.ts): a short value (28 characters at
 *  most), no tag names in its sentence or to-do, a fail's sentence starting lower-case (the
 *  page puts "Not yet:" in front of it; a name like "MusicBrainz" keeps its capital), and no
 *  html in "Show the details". */
export function expectPlainWords(r: SeoTestResult): void {
  expect(r.value.length).toBeLessThanOrEqual(28)
  expect(r.sentence).not.toMatch(JARGON)
  if (r.status === 'fail') expect(r.sentence).toMatch(/^(?:[a-z0-9]|MusicBrainz|Apple|Google)/)
  if (r.todo) expect(r.todo).not.toMatch(JARGON)
  for (const e of r.evidence) expect(e.value).not.toMatch(/<[a-z!/]/i)
}
