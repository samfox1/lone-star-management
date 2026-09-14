// The Connections server actions: one paste, two jobs; remove means both; sync reads the PROFILE link.
/**
 * The component tests name these rules but assert on mocks of these very actions, so
 * the rules lived nowhere. Same shape as tests/unit/media/font-actions.test.ts: the
 * Supabase client and the neighbouring action modules are mocked, the module under
 * test is real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addContentAction, deleteContentAction, saveSourceIdAction } from '@/app/artists/[id]/(dashboard)/actions'
import { INTEGRATIONS } from '@/app/artists/[id]/(dashboard)/integrations'
import type { LinkRowLike } from '@/lib/connections'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  addContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/integrations', () => ({
  INTEGRATIONS: [
    { key: 'spotify', label: 'Spotify', pull: vi.fn(async () => ({ ok: true, message: '24 songs found' })) },
    { key: 'apple', label: 'Apple Music', pull: vi.fn(async () => ({ ok: false, error: 'Apple Music didn’t answer.' })) },
  ],
}))
vi.mock('@/app/artists/[id]/(dashboard)/merch/actions', () => ({
  connectShopifyAction: vi.fn(), disconnectShopifyAction: vi.fn(async () => ({})), probeShopifyAction: vi.fn(), syncShopifyAction: vi.fn(),
}))
vi.mock('@/app/artists/[id]/(dashboard)/sync-section-action', () => ({ syncSectionAction: vi.fn(async () => ({ results: [] })) }))

/** What the `links` table answers. Tests set it per case. */
let links: LinkRowLike[] = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: links, error: null }) }) }),
  })),
}))

const actions = () => import('@/app/artists/[id]/(dashboard)/connections/actions')
const spotifyPull = () => vi.mocked((INTEGRATIONS as unknown as { key: string; pull: () => unknown }[]).find((i) => i.key === 'spotify')!.pull)

beforeEach(() => {
  links = []
  vi.clearAllMocks()
})

describe('connectOneAction — one paste, two jobs', () => {
  it('CRITICAL: a Spotify ARTIST link saves the profile, then the id, then pulls', async () => {
    const { connectOneAction } = await actions()
    const res = await connectOneAction('a1', 'spotify', { url: 'https://open.spotify.com/artist/26K' })
    expect(res).toEqual({ ok: true, message: '24 songs found' })
    expect(addContentAction).toHaveBeenCalledTimes(1)
    expect(saveSourceIdAction).toHaveBeenCalledWith('a1', 'spotify_artist_id', '26K')
    expect(spotifyPull()).toHaveBeenCalledWith('a1')
    // In that order: a saved id that pulls nothing is not a connection.
    const [add, save, pull] = [vi.mocked(addContentAction), vi.mocked(saveSourceIdAction), spotifyPull()].map((m) => m.mock.invocationCallOrder[0])
    expect(add).toBeLessThan(save)
    expect(save).toBeLessThan(pull)
  })

  it('a PLAYLIST link saves the profile and says nothing about a catalog', async () => {
    const { connectOneAction } = await actions()
    expect(await connectOneAction('a1', 'spotify', { url: 'https://open.spotify.com/playlist/0' })).toEqual({ ok: true })
    expect(addContentAction).toHaveBeenCalledTimes(1)
    expect(saveSourceIdAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: is idempotent — a Retry after the link saved but the pull failed reuses the link instead of being refused', async () => {
    links = [{ id: 'l-sp', label: 'Spotify', url: 'https://open.spotify.com/artist/26K', role: null }]
    const { connectOneAction } = await actions()
    const res = await connectOneAction('a1', 'spotify', { url: 'https://open.spotify.com/artist/26K' })
    expect(res.ok).toBe(true)
    expect(addContentAction).not.toHaveBeenCalled()
    expect(saveSourceIdAction).toHaveBeenCalledWith('a1', 'spotify_artist_id', '26K')
  })

  it('CRITICAL: a role-bound row labelled Spotify (the USB playlist) is NOT the profile, so the link is still added', async () => {
    links = [{ id: 'l-usb', label: 'Spotify', url: 'https://open.spotify.com/playlist/0', role: 'usb' }]
    const { connectOneAction } = await actions()
    await connectOneAction('a1', 'spotify', { url: 'https://open.spotify.com/artist/26K' })
    expect(addContentAction).toHaveBeenCalledTimes(1)
  })

  it('a failed pull is the answer, in one sentence', async () => {
    const { connectOneAction } = await actions()
    const res = await connectOneAction('a1', 'apple music', { url: 'https://music.apple.com/us/artist/skeen/1' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/didn’t answer/)
  })

  it('refuses an unknown connection and a bad input before touching anything', async () => {
    const { connectOneAction } = await actions()
    expect((await connectOneAction('a1', 'nope', { url: 'x' })).ok).toBe(false)
    expect((await connectOneAction('a1', 'spotify', { url: '' })).ok).toBe(false)
    expect(addContentAction).not.toHaveBeenCalled()
  })
})

describe('disconnectConnectionAction — remove means the link AND the source', () => {
  it('CRITICAL: deletes the link, then clears the id', async () => {
    const { disconnectConnectionAction } = await actions()
    expect(await disconnectConnectionAction('a1', 'spotify', 'l-sp')).toEqual({})
    expect(deleteContentAction).toHaveBeenCalledWith('link', 'l-sp', 'a1')
    expect(saveSourceIdAction).toHaveBeenCalledWith('a1', 'spotify_artist_id', '')
  })

  it('CRITICAL: a failed delete stops before the source is cleared — half a removal is worse than none', async () => {
    vi.mocked(deleteContentAction).mockResolvedValueOnce({ error: 'No.' })
    const { disconnectConnectionAction } = await actions()
    expect(await disconnectConnectionAction('a1', 'spotify', 'l-sp')).toEqual({ error: 'No.' })
    expect(saveSourceIdAction).not.toHaveBeenCalled()
  })

  it('a source with no link clears the id alone', async () => {
    const { disconnectConnectionAction } = await actions()
    await disconnectConnectionAction('a1', 'spotify', null)
    expect(deleteContentAction).not.toHaveBeenCalled()
    expect(saveSourceIdAction).toHaveBeenCalledWith('a1', 'spotify_artist_id', '')
  })
})

describe('syncProfileAction — the id comes out of the PROFILE link', () => {
  it('CRITICAL: reads the profile link past a role-bound row with the same label', async () => {
    links = [
      { id: 'l-usb', label: 'Spotify', url: 'https://open.spotify.com/playlist/0', role: 'usb' },
      { id: 'l-sp', label: 'Spotify', url: 'https://open.spotify.com/artist/26K', role: null },
    ]
    const { syncProfileAction } = await actions()
    expect(await syncProfileAction('a1', 'spotify')).toEqual({ ok: true, message: '24 songs found' })
    expect(saveSourceIdAction).toHaveBeenCalledWith('a1', 'spotify_artist_id', '26K')
  })

  it('a link with no id in it says so and saves nothing', async () => {
    links = [{ id: 'l-sp', label: 'Spotify', url: 'https://open.spotify.com/playlist/0', role: null }]
    const { syncProfileAction } = await actions()
    const res = await syncProfileAction('a1', 'spotify')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no artist id/)
    expect(saveSourceIdAction).not.toHaveBeenCalled()
  })
})
