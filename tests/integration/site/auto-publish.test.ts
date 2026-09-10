// Tour dates and merch go straight to the site: every write also publishes, a new date
//   slots by date, a new product goes on top. Runs against the real database.
/**
 * PRESENCE_PLAN.md S2/S3 (Sam, 2026-09-10): "tour dates and merch can just go right to
 * the site … they are always going to be added to a list." So there is no Publish step
 * for either: adding, editing, toggling and reordering each snapshot the type, and the
 * public door — which serves snapshot rows gated on the live flag — shows the change at
 * once. This suite drives the SERVER ACTIONS (the same mocks releases.publish uses), so
 * the auto-publish hook is what gets exercised, not just the library function.
 *
 * Every row planted is deleted by id (AGENTS.md rule 6). Revisions for those ids too.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => asA }))

const mine: { table: string; id: string }[] = []
const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}
const revisionsFor = async (id: string) => {
  const { count } = await svc.from('revisions').select('id', { count: 'exact', head: true }).eq('entity_id', id)
  return count ?? 0
}
const publicMerchTitles = async () => {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as { merch?: { id: string; title: string }[] } | null)?.merch ?? []).filter((m) => mine.some((x) => x.id === m.id)).map((m) => m.title)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  for (const { table, id } of mine.splice(0)) {
    await svc.from('revisions').delete().eq('entity_id', id)
    await svc.from(table).delete().eq('id', id)
  }
})

async function newest(table: string, title: string): Promise<{ id: string; on_site: boolean; sort_order: number | null }> {
  const { data } = await svc.from(table).select('id, on_site, sort_order').eq('artist_id', artistA).eq('title', title).order('created_at', { ascending: false }).limit(1).single()
  mine.push({ table, id: data!.id as string })
  return data as never
}

describe('merch goes straight to the site', () => {
  it('CRITICAL: adding a product lands it ON site, and PUBLISHED, with no Publish step', async () => {
    const { addContentAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await addContentAction('merch', artistA, fd({ title: 'AP Tee', price: '20' }))).toEqual({})
    const row = await newest('merch', 'AP Tee')
    expect(row.on_site, 'a hand-added product must be on the site').toBe(true)
    expect(await revisionsFor(row.id), 'the add did not publish').toBe(1)
    expect(await publicMerchTitles()).toContain('AP Tee')
  })

  it('CRITICAL: toggling a product off takes it off the public site at once', async () => {
    const { addContentAction, setOnSiteAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await addContentAction('merch', artistA, fd({ title: 'AP Hat' }))
    const row = await newest('merch', 'AP Hat')
    await setOnSiteAction('merch', row.id, artistA, false)
    expect(await publicMerchTitles()).not.toContain('AP Hat')
  })

  it('CRITICAL: a new product goes on TOP of a dragged list', async () => {
    // Manual mode: the manager dragged, so rows carry sort_order. The new one must come
    // first, not last — "merch should just get added to the front/top of the list".
    const { addContentAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await addContentAction('merch', artistA, fd({ title: 'AP One' }))
    const one = await newest('merch', 'AP One')
    await svc.from('merch').update({ sort_order: 5 }).eq('id', one.id)
    await addContentAction('merch', artistA, fd({ title: 'AP Two' }))
    const two = await newest('merch', 'AP Two')
    expect(two.sort_order).toBe(4)
    const titles = await publicMerchTitles()
    expect(titles.indexOf('AP Two')).toBeLessThan(titles.indexOf('AP One'))
  })

  it('an undragged list shows the newest first at the door without any numbering', async () => {
    const { addContentAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    await addContentAction('merch', artistA, fd({ title: 'AP First' }))
    await newest('merch', 'AP First')
    await addContentAction('merch', artistA, fd({ title: 'AP Second' }))
    const second = await newest('merch', 'AP Second')
    expect(second.sort_order).toBeNull()
    const titles = await publicMerchTitles()
    expect(titles.indexOf('AP Second')).toBeLessThan(titles.indexOf('AP First'))
  })
})

describe('tour dates go straight to the site, slotted by date', () => {
  const publicDates = async () => {
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    return ((data as { tour_dates?: { id: string; venue: string }[] } | null)?.tour_dates ?? []).filter((t) => mine.some((x) => x.id === t.id)).map((t) => t.venue)
  }

  it('CRITICAL: adding a date lands it ON site and PUBLISHED, with no Publish step', async () => {
    const { addContentAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    expect(await addContentAction('tour_date', artistA, fd({ date: '2030-05-05', venue: 'AP Venue' }))).toEqual({})
    const { data } = await svc.from('tour_dates').select('id, on_site').eq('artist_id', artistA).eq('venue', 'AP Venue').single()
    mine.push({ table: 'tour_dates', id: data!.id as string })
    expect(data!.on_site).toBe(true)
    expect(await revisionsFor(data!.id as string)).toBe(1)
    expect(await publicDates()).toContain('AP Venue')
  })

  it('CRITICAL: in a dragged list, a new date is slotted between its neighbours', async () => {
    const { addContentAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    // Manual mode with three dated rows in October/November.
    for (const [venue, date, so] of [['AP A', '2030-10-01', 0], ['AP B', '2030-10-15', 1], ['AP C', '2030-11-01', 2]] as const) {
      await addContentAction('tour_date', artistA, fd({ date, venue }))
      const { data } = await svc.from('tour_dates').select('id').eq('artist_id', artistA).eq('venue', venue).single()
      mine.push({ table: 'tour_dates', id: data!.id as string })
      await svc.from('tour_dates').update({ sort_order: so }).eq('id', data!.id)
    }
    await addContentAction('tour_date', artistA, fd({ date: '2030-10-20', venue: 'AP Mid' }))
    const { data } = await svc.from('tour_dates').select('id').eq('artist_id', artistA).eq('venue', 'AP Mid').single()
    mine.push({ table: 'tour_dates', id: data!.id as string })
    const { data: rows } = await svc.from('tour_dates').select('venue, sort_order').in('id', mine.filter((m) => m.table === 'tour_dates').map((m) => m.id)).order('sort_order')
    expect(rows!.map((r) => r.venue)).toEqual(['AP A', 'AP B', 'AP Mid', 'AP C'])
  })

  it('the earliest date goes first', async () => {
    const { addContentAction } = await import('@/app/artists/[id]/(dashboard)/actions')
    for (const [venue, date, so] of [['AP A', '2030-10-01', 0], ['AP B', '2030-10-15', 1]] as const) {
      await addContentAction('tour_date', artistA, fd({ date, venue }))
      const { data } = await svc.from('tour_dates').select('id').eq('artist_id', artistA).eq('venue', venue).single()
      mine.push({ table: 'tour_dates', id: data!.id as string })
      await svc.from('tour_dates').update({ sort_order: so }).eq('id', data!.id)
    }
    await addContentAction('tour_date', artistA, fd({ date: '2030-09-01', venue: 'AP Early' }))
    const { data } = await svc.from('tour_dates').select('id').eq('artist_id', artistA).eq('venue', 'AP Early').single()
    mine.push({ table: 'tour_dates', id: data!.id as string })
    const { data: rows } = await svc.from('tour_dates').select('venue, sort_order').in('id', mine.filter((m) => m.table === 'tour_dates').map((m) => m.id)).order('sort_order')
    expect(rows!.map((r) => r.venue)).toEqual(['AP Early', 'AP A', 'AP B'])
  })
})
