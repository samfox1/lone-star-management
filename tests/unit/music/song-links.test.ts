// Reading a pasted streaming URL and filling in what the platform already knows.
/**
 * song-links — URL→union-column mapping and service metadata resolution for the
 * add-song flow (the manager never types what the platform already knows).
 * Deterministic: injected fetch, no network.
 */
import { describe, expect, it } from 'vitest'
import { linkPlatform, parseStreamingLinks, resolveStreamingSong, wrongPlatformError } from '@/lib/song-links'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('parseStreamingLinks', () => {
  it('parses ids from Spotify/Deezer and stores Apple/SoundCloud URLs', () => {
    expect(
      parseStreamingLinks({
        spotify: 'https://open.spotify.com/track/AbC123?si=x',
        apple: 'https://music.apple.com/us/album/song/1?i=2',
        soundcloud: 'https://soundcloud.com/artist/song',
        deezer: 'https://www.deezer.com/en/track/9876',
      }),
    ).toEqual({
      stream_url: 'https://open.spotify.com/track/AbC123?si=x',
      spotify_id: 'AbC123',
      apple_url: 'https://music.apple.com/us/album/song/1?i=2',
      apple_id: '2',
      soundcloud_url: 'https://soundcloud.com/artist/song',
      provider_url: 'https://www.deezer.com/en/track/9876',
      deezer_id: '9876',
    })
  })
  it('drops empty rows', () => {
    expect(parseStreamingLinks({ spotify: '  ' })).toEqual({})
  })
})

describe('resolveStreamingSong', () => {
  it('prefers Deezer: title + cover + contributors (main artist excluded)', async () => {
    const fetchImpl = (async () =>
      json({
        title: 'Night Drive',
        album: { cover_medium: 'https://cdn/dz.jpg' },
        contributors: [{ name: 'Main Act' }, { name: 'Guest One' }, { name: 'Guest Two' }],
      })) as typeof fetch
    await expect(
      resolveStreamingSong({ deezer: 'https://www.deezer.com/track/42' }, fetchImpl),
    ).resolves.toEqual({ title: 'Night Drive', cover_url: 'https://cdn/dz.jpg', contributors: ['Guest One', 'Guest Two'] })
  })

  it('falls back to the Spotify oEmbed for title + cover', async () => {
    const fetchImpl = (async () => json({ title: 'Linked Song', thumbnail_url: 'https://cdn/sp.jpg' })) as typeof fetch
    await expect(
      resolveStreamingSong({ spotify: 'https://open.spotify.com/track/ZZ9' }, fetchImpl),
    ).resolves.toEqual({ title: 'Linked Song', cover_url: 'https://cdn/sp.jpg', contributors: [] })
  })

  it('resolves Apple via the iTunes lookup (artwork upscaled)', async () => {
    const fetchImpl = (async () =>
      json({ results: [{ trackName: 'Apple Song', artworkUrl100: 'https://cdn/a/100x100bb.jpg' }] })) as typeof fetch
    await expect(
      resolveStreamingSong({ apple: 'https://music.apple.com/us/album/x/1?i=777' }, fetchImpl),
    ).resolves.toEqual({ title: 'Apple Song', cover_url: 'https://cdn/a/600x600bb.jpg', contributors: [] })
  })

  it('resolves SoundCloud via oEmbed, trimming the “by Author” suffix', async () => {
    const fetchImpl = (async () => json({ title: 'Demo Cut by Some Artist', thumbnail_url: null })) as typeof fetch
    await expect(
      resolveStreamingSong({ soundcloud: 'https://soundcloud.com/a/demo-cut' }, fetchImpl),
    ).resolves.toMatchObject({ title: 'Demo Cut' })
  })

  it('throws a friendly error when nothing resolves', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as typeof fetch
    await expect(resolveStreamingSong({ spotify: 'https://open.spotify.com/track/x' }, fetchImpl)).rejects.toThrow(
      /check them and try again/,
    )
  })
})

/* ── which platform a pasted link belongs to (reviewer, 2026-09-28) ─────────────────────
 * The song modal's Spotify row saves `stream_url`, and ANY stream_url counts as platform
 * presence, which forces Released. A SoundCloud link pasted there therefore marked the
 * song Released — but SoundCloud is where demos and live sets live, and a SoundCloud song
 * "can be released and unreleased … depends on the song" (Sam). Each row holds its own
 * platform's link; a link that is recognisably ANOTHER platform's is refused. */
describe('linkPlatform', () => {
  it.each([
    ['https://open.spotify.com/track/abc', 'spotify'],
    ['https://spotify.link/xyz', 'spotify'],
    ['spotify:track:abc', 'spotify'],
    ['https://music.apple.com/us/album/x/1?i=2', 'apple'],
    ['https://geo.music.apple.com/x', 'apple'],
    ['https://itunes.apple.com/us/album/x', 'apple'],
    ['https://soundcloud.com/skeen/demo', 'soundcloud'],
    ['https://on.soundcloud.com/abc', 'soundcloud'],
    ['https://m.soundcloud.com/skeen/demo', 'soundcloud'],
    ['soundcloud.com/skeen/demo', 'soundcloud'], // pasted without a scheme
    ['soundcloud.com/skeen/demo?ref=https://x.io', 'soundcloud'], // no scheme, a URL later on
    ['  spotify:track:abc', 'spotify'], // pasted with a leading space
    ['HTTPS://SOUNDCLOUD.COM/SKEEN', 'soundcloud'],
    ['https://www.deezer.com/track/1', 'deezer'],
    ['https://deezer.page.link/abc', 'deezer'],
    // the platforms' own share short-links
    ['https://spotify.app.link/abc', 'spotify'],
    ['https://apple.co/abc', 'apple'],
    ['https://snd.sc/abc', 'soundcloud'],
    ['https://dzr.page.link/abc', 'deezer'],
  ] as const)('%s → %s', (url, platform) => {
    expect(linkPlatform(url)).toBe(platform)
  })

  it.each([
    'https://example.com/song',
    'https://notsoundcloud.com/x', // a lookalike is not the platform
    'https://soundcloud.com.evil.io/x',
    'https://example.com/?next=spotify:track:1', // "spotify:" only counts as the scheme
    'not a url at all',
    '',
  ])('%s → null', (url) => {
    expect(linkPlatform(url)).toBeNull()
  })
})

describe('wrongPlatformError', () => {
  it("CRITICAL: a SoundCloud link in the Spotify row is refused, naming where it goes", () => {
    expect(wrongPlatformError('spotify', 'https://soundcloud.com/skeen/demo')).toMatch(/SoundCloud/)
  })

  it('CRITICAL: every platform refuses every OTHER platform\'s link, and accepts its own', () => {
    const sample = {
      spotify: 'https://open.spotify.com/track/abc',
      apple: 'https://music.apple.com/us/song/x/1',
      soundcloud: 'https://soundcloud.com/skeen/demo',
      deezer: 'https://www.deezer.com/track/1',
    } as const
    const keys = Object.keys(sample) as (keyof typeof sample)[]
    for (const row of keys) {
      for (const link of keys) {
        const err = wrongPlatformError(row, sample[link])
        if (row === link) expect(err, `${row} row refused its own link`).toBeNull()
        else expect(err, `${row} row accepted a ${link} link`).not.toBeNull()
      }
    }
  })

  it('an unrecognised host, and an empty value (clearing the row), are not refused', () => {
    expect(wrongPlatformError('spotify', 'https://example.com/listen')).toBeNull()
    expect(wrongPlatformError('spotify', '')).toBeNull()
  })
})
