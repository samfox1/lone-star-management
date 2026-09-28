// Resolving whatever a manager gives for a YouTube channel down to a real `UC…` id, so
// `artists.youtube_channel_id` always holds the id itself — never a URL or handle.
/**
 * resolveYouTubeChannelId — a UC id or a `/channel/UC…` link resolves locally, reusing
 * `channelSelector`'s own parsing (no second parser, no network call). An `@handle`, a
 * `youtube.com/@handle` link, and a legacy `/c/name` or `/user/name` link resolve through
 * the same YouTube Data API `channelSelector` already builds selectors for. Mocked at the
 * fetch boundary. (Kept separate from youtube.test.ts, which owns getChannelVideos/Shorts.)
 */
import { describe, expect, it } from 'vitest'
import { createYouTubeClient, resolveYouTubeChannelId } from '@/lib/youtube'

type Resp = { status?: number; headers?: Record<string, string>; body: unknown }
function res({ status = 200, headers = {}, body }: Resp) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function client(fetchImpl: typeof fetch) {
  return createYouTubeClient({ apiKey: 'k', fetchImpl, sleep: () => Promise.resolve() })
}

// Fails the test loudly if the "no network call" cases ever start fetching.
function refusingFetch(): typeof fetch {
  return (async () => {
    throw new Error('resolveYouTubeChannelId should not have called fetch for this input')
  }) as unknown as typeof fetch
}

const UC_ID = 'UC1234567890123456789012'

describe('resolveYouTubeChannelId', () => {
  it('resolves a bare UC id with no fetch', async () => {
    const out = await resolveYouTubeChannelId(UC_ID, client(refusingFetch()))
    expect(out).toEqual({ id: UC_ID })
  })

  it('resolves a /channel/UC… link with no fetch', async () => {
    const out = await resolveYouTubeChannelId(`https://youtube.com/channel/${UC_ID}`, client(refusingFetch()))
    expect(out).toEqual({ id: UC_ID })
  })

  it('resolves an @handle via the API', async () => {
    let requested = ''
    const out = await resolveYouTubeChannelId(
      '@Sskeen',
      client((async (url: string) => {
        requested = url
        return res({ body: { items: [{ id: UC_ID }] } })
      }) as unknown as typeof fetch),
    )
    expect(out).toEqual({ id: UC_ID })
    expect(requested).toContain('/channels?part=id')
    expect(requested).toContain('forHandle=%40Sskeen')
  })

  it('resolves a youtube.com/@handle link via the API', async () => {
    const out = await resolveYouTubeChannelId(
      'https://youtube.com/@Sskeen',
      client((async () => res({ body: { items: [{ id: UC_ID }] } })) as unknown as typeof fetch),
    )
    expect(out).toEqual({ id: UC_ID })
  })

  it('resolves a legacy /c/name link via the API', async () => {
    let requested = ''
    const out = await resolveYouTubeChannelId(
      'https://youtube.com/c/OldName',
      client((async (url: string) => {
        requested = url
        return res({ body: { items: [{ id: UC_ID }] } })
      }) as unknown as typeof fetch),
    )
    expect(out).toEqual({ id: UC_ID })
    expect(requested).toContain('forUsername=OldName')
  })

  it('resolves a legacy /user/name link via the API', async () => {
    const out = await resolveYouTubeChannelId(
      'https://youtube.com/user/OldName',
      client((async () => res({ body: { items: [{ id: UC_ID }] } })) as unknown as typeof fetch),
    )
    expect(out).toEqual({ id: UC_ID })
  })

  it('gives the plain error when the API finds no channel', async () => {
    const out = await resolveYouTubeChannelId(
      '@nobody',
      client((async () => res({ body: { items: [] } })) as unknown as typeof fetch),
    )
    expect(out).toEqual({ error: "Couldn't find that YouTube channel." })
  })

  it('errors on a non-YouTube link, with no fetch', async () => {
    const out = await resolveYouTubeChannelId('https://twitter.com/skeenmusic', client(refusingFetch()))
    expect('error' in out).toBe(true)
  })

  it('errors on a blank input, with no fetch', async () => {
    const out = await resolveYouTubeChannelId('   ', client(refusingFetch()))
    expect('error' in out).toBe(true)
  })
})
