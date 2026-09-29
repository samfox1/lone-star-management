/**
 * The payloads the fact sheet is pinned against across bridge versions (0.43.0, the facts).
 *
 * `tests/fixtures/seo-jsonld-0.42.json` holds what bridge 0.42.0 (git 07eb77c, before the
 * facts existed) emitted for each case below, byte for byte. It was written ONCE by running
 * these cases through the untouched 0.42.0 `jsonLdGraph` and must never be regenerated from
 * a later bridge: its whole value is that it came from the old code. A case added later has
 * no 0.42 output and does not belong in that file.
 *
 * None of these payloads carries a `fact_*` key, so a 0.43+ bridge must reproduce every one
 * exactly (tests/unit/site-editor/site-bridge-seo-facts.test.ts).
 */
import type { PublicSitePayload, WireMedia } from '@samfox1/site-bridge/payload'
import type { JsonLdOptions } from '@samfox1/site-bridge/seo'

export const CASE_ORIGIN = 'https://www.example.com'

function base(over: Partial<PublicSitePayload> = {}): PublicSitePayload {
  return {
    artist: {
      id: 'a1',
      slug: 'skeen',
      name: 'Skeen',
      bio: 'Chicago DJ, producer and filmmaker.\nSecond paragraph.',
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      template: 'custom',
      spotify_artist_id: 'abc123',
      genre: 'House, Techno',
      location: 'Chicago',
    },
    published_at: '2026-08-20T12:00:00.000Z',
    tracks: [
      { id: 't1', title: 'Night Drive', cover_url: null, stream_url: 'https://open.spotify.com/track/1', provider_url: null, apple_url: null, has_audio: false, featured_artists: [], album_name: 'Night Drive EP', release_id: 'r1', sort_order: 1, source: null, spotify_id: null, apple_id: null, deezer_id: null, soundcloud_url: null, released: true },
    ],
    tour_dates: [
      { id: 's1', date: '2026-09-10', venue: 'Smartbar', city: 'Chicago', state: 'IL', country: 'US', ticket_url: 'https://tix.example.com/1', support: ['Jigitz'] },
      { id: 's2', date: '2026-08-01', venue: 'Past Venue', city: 'Detroit', country: 'US', ticket_url: null },
    ],
    merch: [],
    links: [
      { id: 'l1', label: 'Instagram', url: 'https://instagram.com/skeen', sort_order: 1 },
      { id: 'l3', label: 'Evil', url: 'javascript:alert(1)', sort_order: 3 },
    ],
    identity_links: [{ url: 'https://musicbrainz.org/artist/0383dadf-2a4e-4d10-a46a-e9e041da8eb3', label: 'MusicBrainz' }],
    videos: [
      { id: 'v1', title: 'Night Drive (live)', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/abc123XYZ', storage_path: null, sort_order: 1, created_at: '2026-07-01T00:00:00.000Z', published_at: '2026-05-01T00:00:00.000Z' },
    ],
    media: [
      { id: 'm1', purpose: 'gallery_image', path: 'a1/gallery/skeen-oslo.jpg', kind: 'photo', alt: 'Skeen, Oslo' },
      { id: 'm4', purpose: 'logo_primary', path: 'a1/brand/logo.png' },
    ],
    // Every OTHER site_content key a real site carries: none of them is a fact, and none may
    // change the artist node.
    site_content: { seo_title: 'SKEEN', seo_description: 'Chicago house DJ.', faq_answer_1: 'Skeen is a DJ.', about_placement: 'page', indexnow_key: 'k'.repeat(32) },
    styles: {},
    fonts: [],
    font_slots: {},
    ...over,
  } satisfies PublicSitePayload
}

const artist = base().artist

const fullOpts: JsonLdOptions = {
  origin: CASE_ORIGIN,
  today: '2026-08-26',
  imageUrl: 'https://cdn.example.com/photo.jpg',
  aboutUrl: `${CASE_ORIGIN}/about`,
  mediaUrl: (p: string) => `https://cdn.example.com/media/${p}`,
  listImage: (m: WireMedia) => ({ url: `https://cdn.example.com/render/${m.path}`, alt: m.alt ?? null }),
  releases: [{ id: 'r1', title: 'Night Drive EP', cover_url: 'https://cdn.example.com/cover.jpg', release_date: '2026-06-01', release_type: 'ep', links: [{ label: 'Apple', url: 'https://music.apple.com/x' }], spotify_id: 'alb1' }],
}

export type JsonLdCase = { name: string; payload: PublicSitePayload; opts: JsonLdOptions }

/** Each case isolates one branch of the artist node as 0.42.0 wrote it. */
export const JSON_LD_CASES: readonly JsonLdCase[] = [
  { name: 'musicgroup, everything the 0.42 wire carries', payload: base(), opts: fullOpts },
  { name: 'person with a location', payload: base({ artist: { ...artist, schema_type: 'Person' } }), opts: fullOpts },
  { name: 'musicgroup, no location, one genre, no bio', payload: base({ artist: { ...artist, location: null, genre: 'House', bio: null } }), opts: { origin: CASE_ORIGIN } },
  { name: 'a location typed with its state', payload: base({ artist: { ...artist, location: '  Chicago, IL  ' } }), opts: { origin: CASE_ORIGIN } },
  { name: 'no site_content at all', payload: base({ site_content: {} }), opts: { origin: CASE_ORIGIN } },
  {
    name: 'hostile facts',
    payload: base({ artist: { ...artist, name: 'Skeen "</script><script>alert(1)</script>', location: '</script><img src=x onerror=alert(1)>', genre: '"; alert(1); "', bio: '\u202Eevil\u0000' } }),
    opts: { origin: CASE_ORIGIN },
  },
  { name: 'nameless artist', payload: base({ artist: { ...artist, name: '   ' } }), opts: fullOpts },
]
