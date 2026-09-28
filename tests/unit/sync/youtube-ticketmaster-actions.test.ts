// YouTube and Ticketmaster's pull actions must not discard a partial failure.
/**
 * `syncYouTubeAction` / `syncTicketmasterAction` (dashboard/actions.ts) used to call
 * their `lib/sync.ts` sync function, get back a `SyncResult` with `failed`/`errors`,
 * and THROW IT AWAY — always answering `{ ok: true }`. A pull where some rows collided
 * on a unique index therefore looked exactly like a clean one (docs review,
 * 2026-09-28; `syncBandsintownAction` already routed through `syncOutcome` and was
 * the one source that got this right).
 *
 * Both actions now build their result via `syncOutcome` (lib/sync.ts), same as
 * Bandsintown/Spotify/Apple/Deezer. `syncOutcome` itself is unit-tested in
 * sync-outcome.test.ts; this file is the WIRING witness — that the action actually
 * hands the sync's real result to it instead of swallowing it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncYouTubeVideos, syncTicketmasterTourDates } from '@/lib/sync'
import type { SyncResult } from '@/lib/sync'

const ARTIST = 'a1'

/** What the RLS-scoped `artists` read returns. */
let artistRow: Record<string, unknown> | null = null

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: artistRow, error: null }),
        }),
      }),
    }),
  })),
}))

const youtubeClient = vi.hoisted(() => ({
  getChannelVideos: vi.fn(),
  viewCounts: vi.fn(),
}))
vi.mock('@/lib/youtube', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/youtube')>()),
  createYouTubeClient: vi.fn(() => youtubeClient),
}))

const ticketmasterClient = vi.hoisted(() => ({
  getArtistEvents: vi.fn(),
}))
vi.mock('@/lib/ticketmaster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ticketmaster')>()),
  createTicketmasterClient: vi.fn(() => ticketmasterClient),
}))

// The sync FUNCTIONS are mocked (what actually touches the DB); `syncOutcome` is the
// real implementation, so this proves the action wires its return value through it.
vi.mock('@/lib/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sync')>()
  return { ...actual, syncYouTubeVideos: vi.fn(), syncTicketmasterTourDates: vi.fn() }
})

const mockedSyncYouTube = vi.mocked(syncYouTubeVideos)
const mockedSyncTicketmaster = vi.mocked(syncTicketmasterTourDates)

const load = () => import('@/app/artists/[id]/(dashboard)/actions')

const result = (over: Partial<SyncResult> = {}): SyncResult => ({
  added: 0,
  updated: 0,
  skipped: 0,
  merged: 0,
  failed: 0,
  errors: [],
  notes: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  youtubeClient.viewCounts.mockResolvedValue(new Map())
  youtubeClient.getChannelVideos.mockResolvedValue([
    { youtube_id: 'v1', title: 'A', provider: 'youtube', embed_url: 'https://youtube.com/embed/v1', is_short: false },
  ])
  ticketmasterClient.getArtistEvents.mockResolvedValue([
    { ticketmaster_id: 't1', date: '2026-10-01', venue: 'The Venue', city: 'Austin', country: 'US', ticket_url: null, latitude: null, longitude: null },
  ])
})

describe('syncYouTubeAction', () => {
  beforeEach(() => {
    artistRow = { youtube_channel_id: 'UC12345' }
  })

  it('CRITICAL: a partial failure is not ok, and names what failed', async () => {
    mockedSyncYouTube.mockResolvedValue(
      result({
        added: 2,
        failed: 1,
        errors: [{ externalId: 'v2', op: 'insert', message: 'duplicate key value violates videos_youtube_id_uniq' }],
      }),
    )
    const { syncYouTubeAction } = await load()
    const res = await syncYouTubeAction(ARTIST)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('1 video failed')
    expect(res.error).toContain('videos_youtube_id_uniq')
  })

  it('a clean pull reports ok:true with its counts', async () => {
    mockedSyncYouTube.mockResolvedValue(result({ added: 3, updated: 1 }))
    const { syncYouTubeAction } = await load()
    const res = await syncYouTubeAction(ARTIST)
    expect(res).toMatchObject({ ok: true })
    expect(res.message).toContain('3 added')
    expect(res.message).toContain('1 updated')
  })

  it('no channel linked is unaffected by the fix', async () => {
    artistRow = { youtube_channel_id: null }
    const { syncYouTubeAction } = await load()
    expect(await syncYouTubeAction(ARTIST)).toEqual({ ok: false, error: 'No YouTube channel linked yet.' })
    expect(mockedSyncYouTube).not.toHaveBeenCalled()
  })
})

describe('syncTicketmasterAction', () => {
  beforeEach(() => {
    artistRow = { ticketmaster_attraction_id: 'K123' }
  })

  it('CRITICAL: a partial failure is not ok, and names what failed', async () => {
    mockedSyncTicketmaster.mockResolvedValue(
      result({
        added: 4,
        failed: 2,
        errors: [{ externalId: 't2', op: 'insert', message: 'duplicate key value violates tour_dates_ticketmaster_id_uniq' }],
      }),
    )
    const { syncTicketmasterAction } = await load()
    const res = await syncTicketmasterAction(ARTIST)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('2 tour dates failed')
    expect(res.error).toContain('tour_dates_ticketmaster_id_uniq')
  })

  it('a clean pull reports ok:true with its counts', async () => {
    mockedSyncTicketmaster.mockResolvedValue(result({ added: 5 }))
    const { syncTicketmasterAction } = await load()
    const res = await syncTicketmasterAction(ARTIST)
    expect(res).toMatchObject({ ok: true })
    expect(res.message).toContain('5 added')
  })

  it('no attraction linked is unaffected by the fix', async () => {
    artistRow = { ticketmaster_attraction_id: null }
    const { syncTicketmasterAction } = await load()
    expect(await syncTicketmasterAction(ARTIST)).toEqual({ ok: false, error: 'No Ticketmaster attraction linked yet.' })
    expect(mockedSyncTicketmaster).not.toHaveBeenCalled()
  })
})
