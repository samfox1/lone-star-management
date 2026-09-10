// Reading a pasted streaming URL and filling in what the platform already knows.
/**
 * song-links — URL→union-column mapping and service metadata resolution for the
 * add-song flow (the manager never types what the platform already knows).
 * Deterministic: injected fetch, no network.
 */
import { describe, expect, it } from 'vitest'
import { parseStreamingLinks, resolveStreamingSong } from '@/lib/song-links'

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
