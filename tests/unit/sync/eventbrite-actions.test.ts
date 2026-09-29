// The Eventbrite source's two server actions: pull the shows with the token read back from Vault,
//   and Remove, which forgets that token.
/**
 * `syncEventbriteAction` / `disconnectEventbriteAction`
 * (src/app/artists/[id]/(dashboard)/tour/eventbrite-actions.ts).
 *
 *   - the pull reads the token ONLY through `eventbrite_credentials` (the Vault door), hands
 *     it to the client and nowhere else, and reports through `syncOutcome` like every pull;
 *   - no stored sign-in → one sentence saying how to get one, and Eventbrite is not called;
 *   - a refused sign-in reads as "connect again", and no message carries the token;
 *   - Remove calls `disconnect_eventbrite` (which deletes the Vault secret) only when there is
 *     a stored sign-in — a pasted link alone has none, and must still be removable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'EB-TOKEN-read-from-vault-only'
const ARTIST = 'a1'

const w = vi.hoisted(() => ({
  creds: [] as { organization_id: string; organizer_id: string; token: string }[],
  credsError: null as { code: string; message: string } | null,
  integration: null as { id: string } | null,
  disconnectError: null as { code: string; message: string } | null,
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      w.rpc.push({ fn, args })
      if (fn === 'eventbrite_credentials') return { data: w.creds, error: w.credsError }
      if (fn === 'disconnect_eventbrite') return { data: null, error: w.disconnectError }
      return { data: null, error: null }
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: w.integration, error: null }) }) }) }) }),
  })),
}))

const client = vi.hoisted(() => ({ listUpcomingShows: vi.fn() }))
vi.mock('@/lib/eventbrite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/eventbrite')>()),
  createEventbriteClient: vi.fn(() => client),
}))
vi.mock('@/lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sync')>()),
  syncEventbriteTourDates: vi.fn(),
}))

import { syncEventbriteTourDates } from '@/lib/sync'
import { EventbriteApiError } from '@/lib/eventbrite'
import { disconnectEventbriteAction, syncEventbriteAction } from '@/app/artists/[id]/(dashboard)/tour/eventbrite-actions'

const SHOWS = [{ externalId: '101', values: { date: '2026-11-05', venue: 'Mohawk', city: 'Austin', state: 'TX', country: 'United States', ticket_url: 'https://www.eventbrite.com/e/1', latitude: null, longitude: null } }]

beforeEach(() => {
  w.creds = [{ organization_id: '111', organizer_id: '222', token: TOKEN }]
  w.credsError = null
  w.integration = { id: 'i1' }
  w.disconnectError = null
  w.rpc = []
  client.listUpcomingShows.mockResolvedValue(SHOWS)
  vi.mocked(syncEventbriteTourDates).mockResolvedValue({ added: 1, updated: 0, skipped: 0, merged: 0, failed: 0, errors: [], notes: [] })
})

describe('syncEventbriteAction', () => {
  it('CRITICAL: reads the token from Vault, lists this organizer’s shows, writes them, and says what it did', async () => {
    const res = await syncEventbriteAction(ARTIST)
    expect(w.rpc).toEqual([{ fn: 'eventbrite_credentials', args: { p_artist_id: ARTIST } }])
    expect(client.listUpcomingShows).toHaveBeenCalledWith(TOKEN, '111', '222')
    expect(vi.mocked(syncEventbriteTourDates).mock.calls[0].slice(1)).toEqual([ARTIST, SHOWS])
    // The write never sees the token.
    expect(JSON.stringify(vi.mocked(syncEventbriteTourDates).mock.calls[0].slice(1))).not.toContain(TOKEN)
    expect(res).toEqual({ ok: true, message: '1 added', notes: [] })
  })

  it('CRITICAL: no stored sign-in → says how to get one; Eventbrite is not called', async () => {
    w.creds = []
    const res = await syncEventbriteAction(ARTIST)
    expect(res.ok).toBe(false)
    expect('error' in res && res.error).toMatch(/Connect with Eventbrite/)
    expect(client.listUpcomingShows).not.toHaveBeenCalled()
    expect(syncEventbriteTourDates).not.toHaveBeenCalled()
  })

  it('the Vault door refusing is a plain failure, not a crash', async () => {
    w.credsError = { code: '42501', message: 'not authorized' }
    const res = await syncEventbriteAction(ARTIST)
    expect(res.ok).toBe(false)
    expect(client.listUpcomingShows).not.toHaveBeenCalled()
  })

  it('CRITICAL: a refused sign-in reads as "connect again", and no message carries the token', async () => {
    client.listUpcomingShows.mockRejectedValueOnce(new EventbriteApiError('auth', 'Eventbrite no longer accepts this sign-in. Connect with Eventbrite again.'))
    const res = await syncEventbriteAction(ARTIST)
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Connect with Eventbrite again/) })
    expect(JSON.stringify(res)).not.toContain(TOKEN)
    // Some other library error: its NAME, never its message (which could echo a header).
    client.listUpcomingShows.mockRejectedValueOnce(new Error(`socket hang up Bearer ${TOKEN}`))
    const other = await syncEventbriteAction(ARTIST)
    expect(other.ok).toBe(false)
    expect(JSON.stringify(other)).not.toContain(TOKEN)
  })

  it('a partial failure is not ok (syncOutcome)', async () => {
    vi.mocked(syncEventbriteTourDates).mockResolvedValueOnce({ added: 1, updated: 0, skipped: 0, merged: 0, failed: 1, errors: [{ externalId: '102', op: 'insert', message: 'value too long' }], notes: [] })
    const res = await syncEventbriteAction(ARTIST)
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/1 tour date failed to save/) })
  })
})

describe('disconnectEventbriteAction', () => {
  it('CRITICAL: forgets the stored sign-in (the Vault secret) when there is one', async () => {
    expect(await disconnectEventbriteAction(ARTIST)).toEqual({})
    expect(w.rpc).toEqual([{ fn: 'disconnect_eventbrite', args: { p_artist_id: ARTIST } }])
  })

  it('CRITICAL: a pasted link with no sign-in behind it removes cleanly, without calling the Vault door', async () => {
    w.integration = null
    expect(await disconnectEventbriteAction(ARTIST)).toEqual({})
    expect(w.rpc).toEqual([])
  })

  it('a refused forget is reported, not swallowed', async () => {
    w.disconnectError = { code: '42501', message: 'not authorized' }
    expect((await disconnectEventbriteAction(ARTIST)).error).toMatch(/Eventbrite/)
  })
})
