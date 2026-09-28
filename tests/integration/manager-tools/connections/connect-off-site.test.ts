// A new connection's link lands OFF the site; the editor is where it becomes a button. Runs against the real database.
/**
 * Sam, 2026-09-28: "I just added the X connection for Skeen, and I went to the site editor
 * to socials, and the twitter link was already there. That shouldn't be the case." A
 * connection is an account; the button on the site is made in the editor, from it.
 *
 * `links.on_site` defaults TRUE in the table (20260708150000) and `createContent` leaves it
 * alone, so the Connect action has to ask for off-site on the row it creates — and ONLY on
 * that row: a Retry that finds the link already there must not flip a button the manager
 * has since put on the site.
 *
 * Drives the SERVER ACTION with the same two mocks list-presence uses (next/cache, and the
 * cookie client swapped for a signed-in manager). The artist is a throwaway, created and
 * dropped here (AGENTS.md rule 6); row STATE is read back with the service client (rule 3).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let asA: SupabaseClient
let artist: ThrowawayArtist
const svc = serviceClient()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => asA }))

const connections = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions')
const dashboard = () => import('@/app/artists/[id]/(dashboard)/actions')

async function linksLabelled(label: string) {
  const { data, error } = await svc.from('links').select('id, url, on_site').eq('artist_id', artist.id).eq('label', label)
  if (error) throw new Error(error.message)
  return data as { id: string; url: string; on_site: boolean }[]
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artist = await createThrowawayArtist(svc, 'connect off-site', asA)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artist)
})

describe('connectOneAction — the link it makes is not a button yet', () => {
  it('CRITICAL: connecting X by its handle saves the profile OFF the site', async () => {
    const { connectOneAction } = await connections()
    expect(await connectOneAction(artist.id, 'x', { handle: 'skeenmusic' })).toEqual({ ok: true })
    const rows = await linksLabelled('X')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ url: 'https://x.com/skeenmusic', on_site: false })
  })

  it('CRITICAL: a Retry finds the link and leaves its on-site flag alone', async () => {
    // The manager has since made it a button in the editor.
    const [row] = await linksLabelled('X')
    await svc.from('links').update({ on_site: true }).eq('id', row.id)
    const { connectOneAction } = await connections()
    expect((await connectOneAction(artist.id, 'x', { handle: 'skeenmusic' })).ok).toBe(true)
    const after = await linksLabelled('X')
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: row.id, on_site: true })
  })

  it('every other door that adds a link still adds it ON the site — the off-site is Connect’s, not the table’s', async () => {
    // The control for the first test: without it, a default flipped to false in the
    // table (or in createContent) would pass that test too, and quietly change every
    // caller that never asked.
    const { addContentAction } = await dashboard()
    const fd = new FormData()
    fd.set('label', 'Instagram')
    fd.set('url', 'https://instagram.com/skeenmusic')
    expect((await addContentAction('link', artist.id, fd)).error).toBeUndefined()
    const rows = await linksLabelled('Instagram')
    expect(rows).toHaveLength(1)
    expect(rows[0].on_site).toBe(true)
  })
})
