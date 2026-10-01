/**
 * The Apple Music & Amazon bio email: what we ask AllMusic / Xperi to write from, and the
 * `mailto:` link that opens it in the manager's mail app.
 *
 * Code:     src/lib/manager-tools/seo/bio-pack.ts (buildBioPack, mailtoHref, ccAddress, emailText)
 * Feature:  SEO / GEO page · Profiles tab · "Apple Music & Amazon bio" (Sam, 2026-09-30,
 *           prototypes/profiles_bio_pack_20260930.html)
 * Tier:     STRICT (AGENTS.md "Test depth"): it builds a URL from user-supplied text and an
 *           outbound message to a company we don't control. A header smuggled into the mailto
 *           (a second recipient, a Bcc) or a link to someone else's page would go out under the
 *           manager's name.
 * Covers:   • the mailto can't be broken out of: every value stays inside its own parameter,
 *             CRLF line breaks, only the two Xperi addresses
 *           • CC: one valid address appears once as cc=; an injection attempt adds nothing
 *           • Apple links move to the US store; non-https, off-host and role-bound links drop
 *           • the body never says he / she / his / her / they for the artist, for any input
 *           • releases newest first, unreleased left out, capped at ten
 *           • the checks fire (short bio, no Amazon, no Apple, no photo, no CC) and go quiet
 * Not here: the card on the page (tests/components/manager-tools/seo/profiles-tab.test.tsx).
 * Fixtures: Skeen's real `get_public_site` links / identity_links / artist and
 *           `get_public_releases` rows as the door returned them on 2026-09-30, trimmed to the
 *           fields the pack reads; hostile values are planted on top of them.
 */
import { describe, expect, it } from 'vitest'
import { BIO_PACK_TO, buildBioPack, ccAddress, emailText, mailtoHref, type BioPackInput } from '@/lib/manager-tools/seo/bio-pack'

/* ── fixtures: the door's own shapes (get_public_site 2026-09-30, Skeen) ── */

const SKEEN_ARTIST = {
  id: 'c6c2ea6e-4135-4ebb-afbe-8c9e21785f57',
  name: 'Skeen',
  slug: 'skeen',
  bio: "My name is Skeen\n\nI am a Chicago DJ, producer, and filmmaker.\n\nI'm documenting what it looks like to build a career in dance music from the ground up.\n\nI spend my days in the studio or somewhere with my USB, three cameras, and a ridiculous idea.\n\nHopefully I'll see you in your city soon!",
  genre: 'House, Tech House',
  location: 'Chicago',
  schema_type: 'MusicGroup' as const,
  spotify_artist_id: '26KxuQlgIw8VP8YX2IkMWR',
}

const SKEEN_LINKS = [
  { id: 'cd31ab46', url: 'ross.guignon@everesttm.com', role: 'booking', label: 'Booking email', sort_order: 0 },
  { id: 'ef3831f0', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', role: null, label: 'Spotify', sort_order: 0 },
  { id: '59c33199', url: 'https://open.spotify.com/playlist/0MLdp3LsWM0uO2oryTniXi?si=w980RNcdQUenHYKQSbDacw', role: 'usb', label: 'USB button', sort_order: 0 },
  { id: 'e128cc53', url: 'https://x.com/Skeenmusic', role: null, label: 'X', sort_order: 0 },
  { id: '5f2e5e7b', url: 'https://www.instagram.com/skeeeeeeen/', role: null, label: 'Instagram', sort_order: 1 },
  { id: 'ab6eb9e0', url: 'https://soundcloud.com/user-818426052', role: null, label: 'SoundCloud', sort_order: 2 },
  { id: '7fa81c94', url: 'https://www.youtube.com/@Sskeen', role: null, label: 'YouTube', sort_order: 3 },
  { id: '10dd694c', url: 'https://music.apple.com/no/artist/skeen/1754431714', role: null, label: 'Apple Music', sort_order: 4 },
  { id: '0572ae28', url: 'https://tiktok.com/@skeen200', role: null, label: 'TikTok', sort_order: 5 },
  { id: 'dbcdf3ed', url: 'mailto:bookings@skeen.example', role: null, label: 'Bookings', sort_order: 6 },
]

const SKEEN_IDENTITY = [
  { url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR', label: 'Spotify' },
  { url: 'https://x.com/Skeenmusic', label: 'X' },
  { url: 'https://www.instagram.com/skeeeeeeen/', label: 'Instagram' },
  { url: 'https://soundcloud.com/user-818426052', label: 'SoundCloud' },
  { url: 'https://www.youtube.com/@Sskeen', label: 'YouTube' },
  { url: 'https://music.apple.com/no/artist/skeen/1754431714', label: 'Apple Music' },
  { url: 'https://tiktok.com/@skeen200', label: 'TikTok' },
]

/** get_public_releases, Skeen, 2026-09-30 (the door's order). `released` is FALSE on every one:
 *  it is only the manual flag. They are Released because they came from Spotify (source,
 *  spotify_id, a Spotify link), the app's rule (`releaseIsReleased`). */
const SKEEN_RELEASES = [
  { id: 'e4ab73a3', slug: 'you-were-there', title: 'You Were There', release_date: '2026-02-14', release_type: 'single', released: false, source: 'spotify', spotify_id: '6liwYYWqZgPxO2TgqM2tno', links: [{ url: 'https://open.spotify.com/album/6liwYYWqZgPxO2TgqM2tno', label: 'Spotify' }], cover_url: null, sort_order: 0 },
  { id: '24880956', slug: 'what-i-want', title: 'What I Want', release_date: '2026-01-16', release_type: 'single', released: false, source: 'spotify', spotify_id: '64bMqOdWXy6B40vHPRnXCB', links: [{ url: 'https://open.spotify.com/album/64bMqOdWXy6B40vHPRnXCB', label: 'Spotify' }], cover_url: null, sort_order: 0 },
  { id: 'c1021edb', slug: 'heatwaves-horizons', title: 'Heatwaves & Horizons', release_date: '2025-05-09', release_type: 'album', released: false, source: 'spotify', spotify_id: '7HWRt5Dzpw2ICmfVwm77vQ', links: [{ url: 'https://open.spotify.com/album/7HWRt5Dzpw2ICmfVwm77vQ', label: 'Spotify' }], cover_url: null, sort_order: 0 },
  { id: '248b7ad8', slug: 'home-again', title: 'Home Again', release_date: '2025-04-18', release_type: 'single', released: false, source: 'spotify', spotify_id: '5pphF0h24UaftHJ7KM1glB', links: [{ url: 'https://open.spotify.com/album/5pphF0h24UaftHJ7KM1glB', label: 'Spotify' }], cover_url: null, sort_order: 0 },
  { id: '328b6684', slug: 'summer-sun', title: 'Summer Sun', release_date: '2025-03-21', release_type: 'single', released: false, source: 'spotify', spotify_id: '0mKvn9rooMXNjja54EtsV2', links: [{ url: 'https://open.spotify.com/album/0mKvn9rooMXNjja54EtsV2', label: 'Spotify' }], cover_url: null, sort_order: 0 },
  { id: '3d38c29b', slug: 'lola-skeen-remix', title: '#lola! [skeen remix]', release_date: '2024-09-10', release_type: 'remix', released: false, source: 'spotify', spotify_id: '5eBN1IObG89WGetWDKCD0m', links: [{ url: 'https://open.spotify.com/album/5eBN1IObG89WGetWDKCD0m', label: 'Spotify' }], cover_url: null, sort_order: 0 },
  { id: 'e86b3d30', slug: 'outwest', title: 'OutWest', release_date: '2024-01-26', release_type: 'ep', released: false, source: 'spotify', spotify_id: '04DF06Mhc5wKQkvppfEkMu', links: [{ url: 'https://open.spotify.com/album/04DF06Mhc5wKQkvppfEkMu', label: 'Spotify' }], cover_url: null, sort_order: 0 },
]

const PHOTO = { url: 'https://example.supabase.co/storage/v1/object/public/media/c6c2/gallery/cd13.jpg', type: 'JPEG', width: 1600, height: 1600 }

const skeen = (over: Partial<BioPackInput> = {}): BioPackInput => ({
  artist: SKEEN_ARTIST,
  site_content: {},
  site_url: 'https://www.skeenmusic.com',
  links: SKEEN_LINKS,
  identity_links: SKEEN_IDENTITY,
  releases: SKEEN_RELEASES,
  photo: PHOTO,
  manager_name: 'Sam Fox',
  ...over,
})

/** The value on a "Label   value" row of THE ARTIST block, or undefined. */
const row = (body: string, label: string) => body.split('\n').find((l) => l.startsWith(`${label}  `))?.slice(label.length).trim()

/** The lines of the RELEASES block. */
const releaseLines = (body: string) => {
  const lines = body.split('\n')
  const start = lines.indexOf('RELEASES')
  if (start < 0) return []
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (!l.trim()) break
    out.push(l)
  }
  return out
}

/* ── the mailto link ── */

describe('mailtoHref', () => {
  // A subject or body that tries to add a header or a recipient stays inside its own value.
  it('CRITICAL: nothing in the subject or body can add a header or a recipient', () => {
    const hostile = {
      ...buildBioPack(skeen()),
      subject: 'Bio?&cc=evil@x.com&bcc=evil@x.com\r\nBcc: evil@x.com #frag 100%+',
      body: 'Line one\nLine two&cc=evil@x.com?bcc=evil@x.com\r\nBcc: evil@x.com\rend %0D%0A # +',
    }
    const href = mailtoHref(hostile)
    // One `?`, one `&`: exactly two parameters, and no raw line break or fragment anywhere.
    expect(href.match(/\?/g)).toHaveLength(1)
    expect(href.match(/&/g)).toHaveLength(1)
    expect(href).not.toMatch(/[\r\n#\s]/)
    const u = new URL(href)
    expect(u.protocol).toBe('mailto:')
    expect(u.pathname).toBe(BIO_PACK_TO.join(','))
    const params = new URLSearchParams(u.search)
    expect([...params.keys()]).toEqual(['subject', 'body'])
    // The subject is one line; the body comes back exactly, every line break as CRLF.
    expect(params.get('subject')).toBe('Bio?&cc=evil@x.com&bcc=evil@x.com Bcc: evil@x.com #frag 100%+')
    expect(params.get('body')).toBe('Line one\r\nLine two&cc=evil@x.com?bcc=evil@x.com\r\nBcc: evil@x.com\r\nend %0D%0A # +')
    expect(href).toContain('Line%20one%0D%0ALine%20two')
  })

  // Only the two Xperi addresses: a `to` that was tampered with never adds a recipient.
  it('CRITICAL: only the two Xperi addresses, and a tampered recipient is dropped', () => {
    const pack = buildBioPack(skeen())
    expect(pack.to).toEqual(['apple.coverage.support@xperi.com', 'content.music@tivo.com'])
    const href = mailtoHref({ ...pack, to: [...pack.to, 'x@y.com?cc=evil@x.com', 'a@b.com,c@d.com'] })
    expect(new URL(href).pathname).toBe('apple.coverage.support@xperi.com,content.music@tivo.com')
    expect(new URLSearchParams(new URL(href).search).has('cc')).toBe(false)
  })

  // CC to the artist: one valid address, once, as cc=, encoded like the rest.
  it('CRITICAL: a valid CC appears once as cc=; an injection attempt adds nothing', () => {
    const pack = buildBioPack(skeen())
    const withCc = mailtoHref(pack, { cc: ' skeen+press@gmail.com ' })
    expect(withCc.match(/[?&]cc=/g)).toHaveLength(1)
    const params = new URLSearchParams(new URL(withCc).search)
    expect([...params.keys()]).toEqual(['cc', 'subject', 'body'])
    expect(params.get('cc')).toBe('skeen+press@gmail.com')
    expect(withCc).toContain('cc=skeen%2Bpress%40gmail.com')

    const plain = mailtoHref(pack)
    for (const bad of ['a@b.com%0Abcc:x@y.com', 'a@b.com,c@d.com', 'a@b.com\r\nbcc: x@y.com', 'a@b.com;c@d.com', 'a b@c.com', 'a@b', '@b.com', 'a@b.com?bcc=x@y.com', `${'a'.repeat(65)}@b.com`, `a@${`${'b'.repeat(60)}.`.repeat(5)}com`, '']) {
      expect(ccAddress(bad), JSON.stringify(bad)).toBeNull()
      expect(mailtoHref(pack, { cc: bad }), JSON.stringify(bad)).toBe(plain)
    }
    // The copied email carries the Cc line only for a valid address.
    expect(emailText(pack, { cc: 'skeen@gmail.com' })).toContain('\nCc: skeen@gmail.com\n')
    expect(emailText(pack, { cc: 'a@b.com,c@d.com' })).not.toContain('Cc:')
  })
})

/* ── the links ── */

describe('the links', () => {
  // Apple links move to the US store; the rest are only https links on the platform's own host.
  it('CRITICAL: Apple Music moves to the US store; non-https, off-host and role-bound links are dropped', () => {
    const body = buildBioPack(skeen()).body
    expect(row(body, 'Apple Music')).toBe('https://music.apple.com/us/artist/skeen/1754431714')
    expect(row(body, 'Spotify')).toBe('https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR')
    expect(row(body, 'Instagram')).toBe('https://www.instagram.com/skeeeeeeen/')
    expect(row(body, 'YouTube')).toBe('https://www.youtube.com/@Sskeen')
    expect(row(body, 'SoundCloud')).toBe('https://soundcloud.com/user-818426052')
    expect(row(body, 'Official site')).toBe('https://www.skeenmusic.com')
    // The USB playlist (a role-bound button) and the booking addresses are never listed.
    expect(body).not.toContain('playlist')
    expect(body).not.toContain('mailto:')
    expect(body).not.toContain('everesttm')

    // A link with no store, or a query, still lands on the US store.
    const noStore = buildBioPack(skeen({ links: [{ label: 'Apple Music', url: 'https://music.apple.com/artist/skeen/1754431714?l=nb', role: null }], identity_links: [] })).body
    expect(row(noStore, 'Apple Music')).toBe('https://music.apple.com/us/artist/skeen/1754431714')

    // Each of these is dropped: http, a look-alike host, a host that only ends in the name,
    // a label that lies about its url, a script url, a role-bound row, a non-artist page.
    const hostile = [
      { label: 'Apple Music', url: 'http://music.apple.com/us/artist/skeen/1754431714', role: null },
      { label: 'Apple Music', url: 'https://music.apple.com.evil.net/us/artist/skeen/1754431714', role: null },
      { label: 'Apple Music', url: 'https://evilmusic.apple.com.example/us/artist/skeen/1', role: null },
      { label: 'Spotify', url: 'https://evil.example/artist/26KxuQlgIw8VP8YX2IkMWR', role: null },
      { label: 'Instagram', url: 'javascript:alert(1)//instagram.com/skeen', role: null },
      { label: 'SoundCloud', url: 'https://soundcloud.com/user-818426052', role: 'usb' },
      { label: 'YouTube', url: 'https://www.youtube.com/watch?v=abc', role: null },
      { label: 'Amazon Music', url: 'https://amazon.com/dp/B000000000', role: null },
    ]
    const dropped = buildBioPack(skeen({ links: hostile, identity_links: [], site_url: 'http://www.skeenmusic.com', artist: { ...SKEEN_ARTIST, spotify_artist_id: null } })).body
    for (const label of ['Apple Music', 'Spotify', 'Instagram', 'SoundCloud', 'YouTube', 'Amazon Music', 'Official site']) expect(row(dropped, label), label).toBeUndefined()
    expect(dropped).not.toMatch(/evil|javascript|http:\/\//)
  })
})

/* ── the words ── */

/** Our template's pronouns: the body must name the artist, never refer to them by one. */
const PRONOUN = /\b(he|she|his|her|hers|him|they|them|their)\b/i

describe('the email', () => {
  // The body names the artist every time, for any mix of what is and isn't known.
  it('CRITICAL: no he / she / his / her / they for the artist, for any input', () => {
    const plainBio = 'Skeen makes house music in Chicago.'
    const variants: Partial<BioPackInput>[] = [
      {},
      { photo: null, manager_name: null },
      { artist: { ...SKEEN_ARTIST, bio: plainBio, genre: null, location: null } },
      { artist: { ...SKEEN_ARTIST, bio: '', genre: 'Techno', location: null }, releases: [] },
      { artist: { ...SKEEN_ARTIST, bio: plainBio, genre: null, location: 'Berlin' }, site_content: { fact_region: 'Berlin', fact_country: 'Germany' }, links: [], identity_links: [] },
      { artist: { ...SKEEN_ARTIST, name: 'Juniper', bio: plainBio, schema_type: 'Person' } },
    ]
    for (const v of variants) {
      const input = skeen(v)
      // Skeen's own words are theirs to word; the template around them is ours.
      const body = buildBioPack(input).body.replace(input.artist.bio ?? '', '')
      expect(body, JSON.stringify(v)).not.toMatch(PRONOUN)
      expect(body).toContain(input.artist.name)
    }
  })

  // Subject: name, city, genre; the parts that are missing are left out.
  it('subject names the artist, the city and the genre, leaving out what is missing', () => {
    expect(buildBioPack(skeen()).subject).toBe('Biography: Skeen, Chicago house artist')
    expect(buildBioPack(skeen({ artist: { ...SKEEN_ARTIST, location: null } })).subject).toBe('Biography: Skeen, house artist')
    expect(buildBioPack(skeen({ artist: { ...SKEEN_ARTIST, genre: '' } })).subject).toBe('Biography: Skeen, Chicago artist')
    expect(buildBioPack(skeen({ artist: { ...SKEEN_ARTIST, genre: null, location: null } })).subject).toBe('Biography: Skeen')
    // Where it's based reads from the Facts tab's region and country too.
    const body = buildBioPack(skeen({ site_content: { fact_region: 'Illinois', fact_country: 'usa' } })).body
    expect(row(body, 'Based in')).toBe('Chicago, Illinois, United States')
    expect(row(body, 'Genres')).toBe('House, Tech House')
    expect(body).toContain("IN THE ARTIST'S WORDS\n" + SKEEN_ARTIST.bio)
    expect(body).toMatch(/Thank you,\nSam Fox$/)
  })

  // Releases: newest first, unreleased left out, ten at most.
  it('CRITICAL: releases are newest first, unreleased are left out, ten at most', () => {
    expect(releaseLines(buildBioPack(skeen()).body).map((l) => l.split(/\s{2,}/))).toEqual([
      ['You Were There', 'single', '2026'],
      ['What I Want', 'single', '2026'],
      ['Heatwaves & Horizons', 'album', '2025'],
      ['Home Again', 'single', '2025'],
      ['Summer Sun', 'single', '2025'],
      ['#lola! [skeen remix]', 'remix', '2024'],
      ['OutWest', 'EP', '2024'],
    ])
    // Fourteen, shuffled: one unreleased (a manual upload, no platform link, the flag off), one
    // with no date; the ten newest released ones show.
    const many = Array.from({ length: 12 }, (_, i) => ({ ...SKEEN_RELEASES[0], id: `r${i}`, title: `Song ${i}`, release_date: `20${10 + i}-06-01` }))
    const shuffled = [many[3], many[11], many[0], many[7], { ...many[0], id: 'u', title: 'Not Out Yet', release_date: '2030-01-01', source: 'manual', spotify_id: null, links: [], released: false }, many[5], many[1], many[9], many[2], many[10], { ...many[0], id: 'n', title: 'No Date', release_date: null }, many[4], many[8], many[6]]
    const lines = releaseLines(buildBioPack(skeen({ releases: shuffled })).body)
    expect(lines.map((l) => l.split(/\s{2,}/)[0])).toEqual(['Song 11', 'Song 10', 'Song 9', 'Song 8', 'Song 7', 'Song 6', 'Song 5', 'Song 4', 'Song 3', 'Song 2'])
  })

  // The checks: each fires on its own gap and is quiet once the gap is filled.
  it('CRITICAL: the checks fire for a short bio, no Amazon, no Apple, no photo and no CC, and go quiet', () => {
    const ids = (input: BioPackInput, cc?: string) => buildBioPack(input, { cc }).checks.map((c) => c.id)
    const pack = buildBioPack(skeen())
    expect(pack.checks.find((c) => c.id === 'bio')?.text).toBe('Bio is 55 words. They write their own from it, so more facts help.')
    expect(ids(skeen())).toEqual(['bio', 'amazon', 'cc'])
    expect(ids(skeen({ links: [], identity_links: [], photo: null }), 'skeen@gmail.com')).toEqual(['bio', 'amazon', 'apple', 'photo'])
    expect(ids(skeen({ artist: { ...SKEEN_ARTIST, bio: '' } }))).toContain('bio')
    const amazon = { label: 'Amazon Music', url: 'https://music.amazon.com/artists/B0D2W1L9QX/skeen', role: null }
    const full = skeen({ artist: { ...SKEEN_ARTIST, bio: Array.from({ length: 150 }, () => 'word').join(' ') }, links: [...SKEEN_LINKS, amazon] })
    expect(ids(full, 'skeen@gmail.com')).toEqual([])
    expect(row(buildBioPack(full).body, 'Amazon Music')).toBe('https://music.amazon.com/artists/B0D2W1L9QX/skeen')
    // The CC check names the artist, and an invalid address doesn't quiet it.
    expect(buildBioPack(skeen(), { cc: 'a@b.com,c@d.com' }).checks.find((c) => c.id === 'cc')?.text).toBe('Add Skeen’s email so Skeen gets a copy.')
  })
})
