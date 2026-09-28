// A link saved in the wrong platform's row is refused on the server, not only in the browser.
/**
 * THE ROW-PLATFORM GUARD, server side.
 *
 * Each song link row holds ITS platform's link (SONG_PLATFORMS), and each release link
 * slot likewise (STREAMING_PLATFORMS). A SoundCloud link saved as a song's `stream_url`
 * is platform presence under the old reading and a Spotify link filed in a release's
 * SoundCloud slot hides a real release — so the rows refuse a link that is recognisably
 * another platform's (lib/song-links `wrongPlatformError`). Until 2026-09-28 only the
 * song modal checked, in the browser; any other caller of the actions skipped it, and the
 * release slots never checked at all. These pin the same check in the two server actions
 * every link save goes through.
 *
 * The write is a spy, so "refused" means the write was NEVER attempted — not merely that
 * an error came back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SONG_PLATFORMS, STREAMING_PLATFORMS } from '@/app/artists/[id]/(dashboard)/music/platforms'
import { STREAMING_SERVICES, type SongPlatform } from '@/lib/song-links'
import { updateContent } from '@/lib/content'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const rpc = vi.fn(async () => ({ data: null, error: null }))
const fake = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { id: 'a1' } }),
        maybeSingle: async () => ({ data: { id: 'a1' } }),
      }),
    }),
  }),
  rpc,
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => fake) }))
vi.mock('@/lib/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content')>()),
  updateContent: vi.fn(async () => ({})),
}))

const mockedUpdate = vi.mocked(updateContent)
const load = () => import('@/app/artists/[id]/(dashboard)/actions')

/** One recognisable link per platform. A Record over the union: a new platform is a
 *  compile error here until it has a sample. */
const SAMPLE: Record<SongPlatform, string> = {
  spotify: 'https://open.spotify.com/track/abc',
  apple: 'https://music.apple.com/us/album/x/1?i=2',
  soundcloud: 'https://soundcloud.com/skeen/demo',
  deezer: 'https://www.deezer.com/track/1',
}
const PLATFORMS = Object.keys(SAMPLE) as SongPlatform[]

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  mockedUpdate.mockClear()
  rpc.mockClear()
})

describe('updateContentAction — a song link row takes only its own platform', () => {
  it("CRITICAL: a SoundCloud link in the Spotify row is refused, and nothing is written", async () => {
    const { updateContentAction } = await load()
    const res = await updateContentAction('track', 't1', 'a1', form({ stream_url: SAMPLE.soundcloud }))
    expect(res.error).toMatch(/SoundCloud/)
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  // Every row × every platform, from the registry the song modal renders.
  const cases = SONG_PLATFORMS.flatMap((row) => PLATFORMS.map((p) => [row.field, p, row.platform === p] as const))
  it.each(cases)('%s ← a %s link: saved=%s', async (field, platform, own) => {
    const { updateContentAction } = await load()
    const res = await updateContentAction('track', 't1', 'a1', form({ [field]: SAMPLE[platform] }))
    if (own) {
      expect(res.error).toBeUndefined()
      expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), 'track', 't1', { [field]: SAMPLE[platform] })
    } else {
      expect(res.error).toBeTruthy()
      expect(mockedUpdate).not.toHaveBeenCalled()
    }
  })

  it('an unknown host, a cleared row and a non-link field still save', async () => {
    const { updateContentAction } = await load()
    expect((await updateContentAction('track', 't1', 'a1', form({ stream_url: 'https://example.com/listen' }))).error).toBeUndefined()
    expect((await updateContentAction('track', 't1', 'a1', form({ stream_url: '' }))).error).toBeUndefined()
    expect((await updateContentAction('track', 't1', 'a1', form({ title: 'soundcloud.com/x' }))).error).toBeUndefined()
    expect(mockedUpdate).toHaveBeenCalledTimes(3)
  })
})

describe('setReleaseLinkAction — a release slot takes only its own platform', () => {
  it('CRITICAL: a Spotify link in the SoundCloud slot is refused before the write', async () => {
    const { setReleaseLinkAction } = await load()
    const res = await setReleaseLinkAction('r1', 'a1', 'SoundCloud', form({ url: SAMPLE.spotify }))
    expect(res.error).toMatch(/Spotify/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('CRITICAL: a SoundCloud link in the Spotify slot is refused before the write', async () => {
    const { setReleaseLinkAction } = await load()
    const res = await setReleaseLinkAction('r1', 'a1', 'Spotify', form({ url: SAMPLE.soundcloud }))
    expect(res.error).toMatch(/SoundCloud/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("a slot's own platform saves", async () => {
    const { setReleaseLinkAction } = await load()
    expect((await setReleaseLinkAction('r1', 'a1', 'SoundCloud', form({ url: SAMPLE.soundcloud }))).error).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('set_release_link', { p_release_id: 'r1', p_label: 'SoundCloud', p_url: SAMPLE.soundcloud })
  })

  it('clearing a slot is always allowed', async () => {
    const { setReleaseLinkAction } = await load()
    expect((await setReleaseLinkAction('r1', 'a1', 'Spotify', form({ url: '' }))).error).toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  // The guard finds a slot's platform by its LABEL. A slot whose label named no platform
  // would be skipped silently — so every slot the release card renders must resolve.
  it('every release slot names a known platform', () => {
    for (const slot of STREAMING_PLATFORMS) {
      expect(STREAMING_SERVICES.some((s) => s.label === slot.label), slot.label).toBe(true)
    }
  })
})
