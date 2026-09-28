// A connection's link, CHANGED later, is checked on the server the way Connect checks it.
/**
 * THE LINK-ROW GUARD, server side (2026-09-28).
 *
 * Connect refuses a link-kind connection's wrong link (`profileLink`: only a link the site
 * reads as THAT platform; WhatsApp only a channel). But a link row is also CHANGED later,
 * through `updateContentAction('link')`: the Connections edit window and the editor's link
 * rows both save that way, and until now nothing there looked at the url. So a WhatsApp
 * connection could be edited to `wa.me/<phone>` and publish the artist's phone number.
 *
 * The write is a spy, so "refused" means the write was NEVER attempted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createContent, updateContent } from '@/lib/content'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** The row the guard reads (its label and role), per test. */
let row: { label: string | null; role: string | null } | null = null
const reads = vi.fn()
const fake = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  from: (table: string) => ({
    select: (cols: string) => ({
      // The add door awaits the artist's labels straight off `.eq()`.
      eq: () => ({
        then: (ok: (v: unknown) => unknown) => ok({ data: [], error: null }),
        maybeSingle: async () => {
          reads(table, cols)
          return { data: row, error: null }
        },
        single: async () => ({ data: row, error: null }),
      }),
    }),
  }),
}
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => fake) }))
vi.mock('@/lib/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content')>()),
  updateContent: vi.fn(async () => ({})),
  createContent: vi.fn(async () => ({ id: 'l2' })),
}))

const mockedUpdate = vi.mocked(updateContent)
const mockedCreate = vi.mocked(createContent)
const load = () => import('@/app/artists/[id]/(dashboard)/actions')

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  mockedUpdate.mockClear()
  mockedCreate.mockClear()
  reads.mockClear()
  row = null
})

describe('updateContentAction — a link-kind connection’s row takes only its own platform', () => {
  it('CRITICAL: a WhatsApp row refuses every link that carries a phone number, and writes nothing', async () => {
    const { updateContentAction } = await load()
    row = { label: 'WhatsApp', role: null }
    for (const url of ['https://wa.me/15551234567', 'https://api.whatsapp.com/send?phone=15551234567', 'https://chat.whatsapp.com/AbCdEf123']) {
      const res = await updateContentAction('link', 'l1', 'a1', form({ url }))
      expect(res.error, url).toBe('That isn’t a WhatsApp channel link.')
    }
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('CRITICAL: a WhatsApp channel saves, without anything riding after the id', async () => {
    const { updateContentAction } = await load()
    row = { label: 'WhatsApp', role: null }
    const res = await updateContentAction('link', 'l1', 'a1', form({ url: 'https://whatsapp.com/channel/0029VaSkeen?phone=15551234567' }))
    expect(res.error).toBeUndefined()
    expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), 'link', 'l1', { url: 'https://whatsapp.com/channel/0029VaSkeen' })
  })

  it('CRITICAL: a Spotify row refuses another platform’s link and a link no platform owns', async () => {
    const { updateContentAction } = await load()
    row = { label: 'Spotify', role: null }
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: 'https://tiktok.com/@skeen' }))).error).toBe('That’s a TikTok link, not Spotify.')
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: 'https://juniperhale.com' }))).error).toBe('That isn’t a Spotify link.')
    expect(mockedUpdate).not.toHaveBeenCalled()
    // Its own link saves, made https.
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: 'http://open.spotify.com/artist/26K' }))).error).toBeUndefined()
    expect(mockedUpdate).toHaveBeenCalledWith(expect.anything(), 'link', 'l1', { url: 'https://open.spotify.com/artist/26K' })
  })

  it('the label the form carries (the editor sends it) is the one checked', async () => {
    const { updateContentAction } = await load()
    row = { label: 'Spotify', role: null }
    const res = await updateContentAction('link', 'l1', 'a1', form({ label: 'WhatsApp', url: 'https://wa.me/15551234567' }))
    expect(res.error).toBe('That isn’t a WhatsApp channel link.')
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('what is not a link-kind connection passes untouched: a contact, a role-bound button, a handle platform', async () => {
    const { updateContentAction } = await load()
    row = { label: 'Booking', role: null }
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: 'mailto:book@skeen.com' }))).error).toBeUndefined()
    row = { label: 'Spotify', role: 'usb' }
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: 'https://example.com/usb' }))).error).toBeUndefined()
    row = { label: 'Instagram', role: null }
    expect((await updateContentAction('link', 'l1', 'a1', form({ url: 'https://instagram.com/skeen' }))).error).toBeUndefined()
    expect(mockedUpdate).toHaveBeenCalledTimes(3)
    expect(mockedUpdate).toHaveBeenLastCalledWith(expect.anything(), 'link', 'l1', { url: 'https://instagram.com/skeen' })
  })

  it('CRITICAL: the add door refuses the same links (a WhatsApp phone link never lands)', async () => {
    const { addContentAction } = await load()
    const res = await addContentAction('link', 'a1', form({ label: 'WhatsApp', url: 'https://wa.me/15551234567' }))
    expect(res.error).toBe('That isn’t a WhatsApp channel link.')
    expect(mockedCreate).not.toHaveBeenCalled()
    expect((await addContentAction('link', 'a1', form({ label: 'WhatsApp', url: 'https://whatsapp.com/channel/0029VaSkeen#x' }))).error).toBeUndefined()
    expect(mockedCreate).toHaveBeenCalledWith(expect.anything(), 'link', 'a1', { label: 'WhatsApp', url: 'https://whatsapp.com/channel/0029VaSkeen' }, {})
  })

  it('an update with no url (a reorder) reads nothing and saves', async () => {
    const { updateContentAction } = await load()
    expect((await updateContentAction('link', 'l1', 'a1', form({ sort_order: '2' }))).error).toBeUndefined()
    expect(reads).not.toHaveBeenCalled()
    expect(mockedUpdate).toHaveBeenCalledTimes(1)
  })
})
