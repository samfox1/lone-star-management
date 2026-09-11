// Tour dates and merch: a toggle is a draft, Publish shows it; a new date slots by date
//   and a new product goes on top. Runs against the real database.
/**
 * PRESENCE_PLAN.md S2/S3 as revised (Sam, 2026-09-11): "I do still want the publish button
 * on the merch and tour pages. The user toggles, hits publish, and it updates on the live
 * site." So these two kinds behave exactly like music: the working row is the draft, the
 * public door reads presence from the published copy, and `publishEntityAction` is the
 * commit. This suite drives the SERVER ACTIONS with the same mocks releases.publish uses.
 *
 * Every row planted is deleted by id, revisions included (AGENTS.md rule 6).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, SEED_PASSWORD, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

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
const actions = () => import('@/app/artists/[id]/(dashboard)/actions')
const revisionsFor = async (id: string) => {
  const { count } = await svc.from('revisions').select('id', { count: 'exact', head: true }).eq('entity_id', id)
  return count ?? 0
}
const publicList = async (key: 'merch' | 'tour_dates', label: 'title' | 'venue') => {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  const rows = ((data as Record<string, { id: string; [k: string]: unknown }[]> | null)?.[key] ?? [])
  return rows.filter((r) => mine.some((x) => x.id === r.id)).map((r) => r[label] as string)
}
async function newest(table: string, col: string, value: string): Promise<{ id: string; on_site: boolean; sort_order: number | null }> {
  const { data } = await svc.from(table).select('id, on_site, sort_order').eq('artist_id', artistA).eq(col, value).order('created_at', { ascending: false }).limit(1).single()
  mine.push({ table, id: data!.id as string })
  return data as never
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

describe('merch — toggle, then Publish', () => {
  it('CRITICAL: adding a product lands it on-site IN THE DRAFT and nowhere public until Publish', async () => {
    const { addContentAction, publishEntityAction } = await actions()
    expect(await addContentAction('merch', artistA, fd({ title: 'LP Tee', price: '20' }))).toEqual({})
    const row = await newest('merch', 'title', 'LP Tee')
    expect(row.on_site).toBe(true)
    expect(await revisionsFor(row.id), 'the add published on its own').toBe(0)
    expect(await publicList('merch', 'title')).not.toContain('LP Tee')
    expect(await publishEntityAction('merch', artistA, SEED_PASSWORD)).toEqual({ ok: true })
    expect(await publicList('merch', 'title')).toContain('LP Tee')
  })

  it('CRITICAL: toggling a published product off is a draft — still public until the next Publish', async () => {
    const { addContentAction, setOnSiteAction, publishEntityAction } = await actions()
    await addContentAction('merch', artistA, fd({ title: 'LP Hat' }))
    const row = await newest('merch', 'title', 'LP Hat')
    await publishEntityAction('merch', artistA, SEED_PASSWORD)
    expect(await publicList('merch', 'title')).toContain('LP Hat')
    await setOnSiteAction('merch', row.id, artistA, false)
    expect(await publicList('merch', 'title'), 'a draft toggle reached the site').toContain('LP Hat')
    await publishEntityAction('merch', artistA, SEED_PASSWORD)
    expect(await publicList('merch', 'title')).not.toContain('LP Hat')
  })

  it('CRITICAL: a new product goes on TOP of a dragged list, once published', async () => {
    const { addContentAction, publishEntityAction } = await actions()
    await addContentAction('merch', artistA, fd({ title: 'LP One' }))
    const one = await newest('merch', 'title', 'LP One')
    await svc.from('merch').update({ sort_order: 5 }).eq('id', one.id)
    await addContentAction('merch', artistA, fd({ title: 'LP Two' }))
    const two = await newest('merch', 'title', 'LP Two')
    expect(two.sort_order).toBe(4)
    await publishEntityAction('merch', artistA, SEED_PASSWORD)
    const titles = await publicList('merch', 'title')
    expect(titles.indexOf('LP Two')).toBeLessThan(titles.indexOf('LP One'))
  })

  it('an undragged list shows the newest first at the door with no number assigned', async () => {
    const { addContentAction, publishEntityAction } = await actions()
    await addContentAction('merch', artistA, fd({ title: 'LP First' }))
    await newest('merch', 'title', 'LP First')
    await addContentAction('merch', artistA, fd({ title: 'LP Second' }))
    const second = await newest('merch', 'title', 'LP Second')
    expect(second.sort_order).toBeNull()
    await publishEntityAction('merch', artistA, SEED_PASSWORD)
    const titles = await publicList('merch', 'title')
    expect(titles.indexOf('LP Second')).toBeLessThan(titles.indexOf('LP First'))
  })
})

describe('tour dates — toggle, then Publish, slotted by date', () => {
  it('CRITICAL: adding a date lands it on-site in the draft and public only after Publish', async () => {
    const { addContentAction, publishEntityAction } = await actions()
    expect(await addContentAction('tour_date', artistA, fd({ date: '2030-05-05', venue: 'LP Venue' }))).toEqual({})
    const row = await newest('tour_dates', 'venue', 'LP Venue')
    expect(row.on_site).toBe(true)
    expect(await revisionsFor(row.id)).toBe(0)
    expect(await publicList('tour_dates', 'venue')).not.toContain('LP Venue')
    await publishEntityAction('tour_date', artistA, SEED_PASSWORD)
    expect(await publicList('tour_dates', 'venue')).toContain('LP Venue')
  })

  it('CRITICAL: in a dragged list, a new date is slotted between its neighbours', async () => {
    const { addContentAction } = await actions()
    for (const [venue, date, so] of [['LP A', '2030-10-01', 0], ['LP B', '2030-10-15', 1], ['LP C', '2030-11-01', 2]] as const) {
      await addContentAction('tour_date', artistA, fd({ date, venue }))
      const r = await newest('tour_dates', 'venue', venue)
      await svc.from('tour_dates').update({ sort_order: so }).eq('id', r.id)
    }
    await addContentAction('tour_date', artistA, fd({ date: '2030-10-20', venue: 'LP Mid' }))
    await newest('tour_dates', 'venue', 'LP Mid')
    const { data: rows } = await svc.from('tour_dates').select('venue, sort_order').in('id', mine.filter((m) => m.table === 'tour_dates').map((m) => m.id)).order('sort_order')
    expect(rows!.map((r) => r.venue)).toEqual(['LP A', 'LP B', 'LP Mid', 'LP C'])
  })

  it('the earliest date goes first', async () => {
    const { addContentAction } = await actions()
    for (const [venue, date, so] of [['LP A', '2030-10-01', 0], ['LP B', '2030-10-15', 1]] as const) {
      await addContentAction('tour_date', artistA, fd({ date, venue }))
      const r = await newest('tour_dates', 'venue', venue)
      await svc.from('tour_dates').update({ sort_order: so }).eq('id', r.id)
    }
    await addContentAction('tour_date', artistA, fd({ date: '2030-09-01', venue: 'LP Early' }))
    await newest('tour_dates', 'venue', 'LP Early')
    const { data: rows } = await svc.from('tour_dates').select('venue, sort_order').in('id', mine.filter((m) => m.table === 'tour_dates').map((m) => m.id)).order('sort_order')
    expect(rows!.map((r) => r.venue)).toEqual(['LP Early', 'LP A', 'LP B'])
  })
})
