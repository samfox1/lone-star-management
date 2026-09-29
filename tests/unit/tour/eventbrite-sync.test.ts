// The Eventbrite pull's WRITES: drafts off the site, one row per event, the manager's edits kept,
//   new shows slotted by date — through a fake of the one table it may touch.
/**
 * `syncEventbriteTourDates` (src/lib/sync.ts) carries out `planTourPull`'s plan. The plan's
 * rules are pinned in tour-pull.test.ts; this pins what only the writer can get wrong:
 *
 *   - a new show is inserted OFF the site (`on_site: false`), `source: 'eventbrite'`, with its
 *     event id and the memory of what was pulled — a draft in the library, never published:
 *     the writer touches `tour_dates` (and `reorder_rows`) and nothing else, so no revision
 *     is ever written;
 *   - a second pull of the same events adds nothing (the table still has one row per event);
 *   - an update is filtered to rows Eventbrite owns, and never touches a column it does not;
 *   - a race that inserted the same event first is not a failure; RLS refusing is fatal.
 *
 * The integration twin (tests/integration/sync/sync.eventbrite.test.ts) runs the same pull
 * on the hosted database once the migration is pushed.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncEventbriteTourDates } from '@/lib/sync'
import type { IncomingShow } from '@/lib/tour-pull'

const ARTIST = 'artist-1'

type Row = Record<string, unknown> & { id: string }

/** A tour_dates table for one artist, and a log of everything that was asked of it. */
function fakeDb(seed: Row[] = [], opts: { insertError?: { code: string; message: string } } = {}) {
  const rows: Row[] = seed.map((r) => ({ ...r }))
  const touched: string[] = []
  const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = []
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  let n = 0
  const client = {
    from(table: string) {
      touched.push(table)
      return {
        select: () => ({
          eq: async (_c: string, v: unknown) => ({ data: rows.filter((r) => r.artist_id === v).map((r) => ({ ...r })), error: null }),
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (opts.insertError) return { data: null, error: opts.insertError }
              const created = { id: `new-${++n}`, sort_order: null, ...row } as Row
              rows.push(created)
              return { data: { id: created.id, date: created.date }, error: null }
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: [string, unknown][] = []
          const q = {
            eq(col: string, v: unknown) {
              filters.push([col, v])
              return q
            },
            then(resolve: (v: { error: null }) => void) {
              updates.push({ patch, filters })
              for (const r of rows) if (filters.every(([c, v]) => r[c] === v)) Object.assign(r, patch)
              resolve({ error: null })
            },
          }
          return q
        },
      }
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args })
      if (fn === 'reorder_rows') (args.p_ids as string[]).forEach((id, i) => Object.assign(rows.find((r) => r.id === id)!, { sort_order: i }))
      return { data: null, error: null }
    },
  }
  return { db: client as unknown as SupabaseClient, rows, touched, updates, rpcs }
}

const show = (id: string, over: Partial<IncomingShow['values']> = {}): IncomingShow => ({
  externalId: id,
  values: {
    date: '2026-11-05',
    venue: 'Mohawk',
    city: 'Austin',
    state: 'TX',
    country: 'United States',
    ticket_url: `https://www.eventbrite.com/e/skeen-${id}`,
    latitude: 30.27,
    longitude: -97.74,
    ...over,
  },
})

describe('syncEventbriteTourDates', () => {
  it('CRITICAL: new shows land as drafts OFF the site, owned by Eventbrite, remembering what was pulled — and nothing is published', async () => {
    const { db, rows, touched } = fakeDb()
    const result = await syncEventbriteTourDates(db, ARTIST, [show('101'), show('102', { date: '2026-12-01' })])
    expect(result).toMatchObject({ added: 2, updated: 0, failed: 0 })
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r).toMatchObject({ artist_id: ARTIST, source: 'eventbrite', on_site: false })
      expect(r.pulled).toEqual(show(r.eventbrite_id as string, r.eventbrite_id === '102' ? { date: '2026-12-01' } : {}).values)
    }
    expect(rows[0]).toMatchObject({ eventbrite_id: '101', ticket_url: 'https://www.eventbrite.com/e/skeen-101', venue: 'Mohawk' })
    // Only the working table: no revision, no publish.
    expect(new Set(touched)).toEqual(new Set(['tour_dates']))
  })

  it('CRITICAL: the same events again add nothing — one row per event, however often it is pulled', async () => {
    const { db, rows } = fakeDb()
    await syncEventbriteTourDates(db, ARTIST, [show('101'), show('102')])
    const again = await syncEventbriteTourDates(db, ARTIST, [show('101'), show('102')])
    expect(again).toMatchObject({ added: 0, updated: 0, failed: 0 })
    expect(rows).toHaveLength(2)
  })

  it('CRITICAL: a re-pull keeps the manager’s edits and moves only what they did not touch', async () => {
    const { db, rows, updates } = fakeDb()
    await syncEventbriteTourDates(db, ARTIST, [show('101')])
    // The manager fixes the venue name and ticks it onto the site.
    Object.assign(rows[0], { venue: 'Mohawk (outdoor stage)', on_site: true })
    const result = await syncEventbriteTourDates(db, ARTIST, [show('101', { venue: 'Stubb’s', city: 'Round Rock' })])
    expect(result).toMatchObject({ added: 0, updated: 1 })
    expect(rows[0]).toMatchObject({ venue: 'Mohawk (outdoor stage)', city: 'Round Rock', on_site: true })
    // Filtered to Eventbrite's own row, and never a column outside the pulled set.
    const u = updates.at(-1)!
    expect(u.filters).toEqual([['id', rows[0].id], ['source', 'eventbrite']])
    expect(Object.keys(u.patch).sort()).toEqual(['city', 'pulled'])
  })

  it('CRITICAL: a hand-added show carrying the same id is never written', async () => {
    const { db, rows, updates } = fakeDb([{ id: 'm1', artist_id: ARTIST, source: 'manual', eventbrite_id: '101', pulled: {}, venue: 'Mine' }])
    const result = await syncEventbriteTourDates(db, ARTIST, [show('101', { venue: 'Theirs' })])
    expect(result).toMatchObject({ added: 0, updated: 0, skipped: 1 })
    expect(updates).toEqual([])
    expect(rows[0].venue).toBe('Mine')
  })

  it('CRITICAL: in a dragged list new shows are slotted by date; an undragged list is left alone', async () => {
    const dragged = fakeDb([
      { id: 'a', artist_id: ARTIST, source: 'manual', eventbrite_id: null, date: '2026-10-01', sort_order: 0 },
      { id: 'b', artist_id: ARTIST, source: 'manual', eventbrite_id: null, date: '2026-12-01', sort_order: 1 },
    ])
    await syncEventbriteTourDates(dragged.db, ARTIST, [show('101', { date: '2026-11-05' })])
    expect(dragged.rpcs).toEqual([{ fn: 'reorder_rows', args: { p_table: 'tour_dates', p_artist: ARTIST, p_ids: ['a', 'new-1', 'b'] } }])

    const plain = fakeDb([{ id: 'a', artist_id: ARTIST, source: 'manual', eventbrite_id: null, date: '2026-10-01', sort_order: null }])
    await syncEventbriteTourDates(plain.db, ARTIST, [show('101')])
    expect(plain.rpcs).toEqual([])
  })

  it('a race that inserted the event first is not a failure; any other insert error is', async () => {
    const race = fakeDb([], { insertError: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    expect(await syncEventbriteTourDates(race.db, ARTIST, [show('101')])).toMatchObject({ added: 0, failed: 0, skipped: 1 })
    const broken = fakeDb([], { insertError: { code: '22001', message: 'value too long' } })
    expect(await syncEventbriteTourDates(broken.db, ARTIST, [show('101')])).toMatchObject({ added: 0, failed: 1, errors: [{ externalId: '101', op: 'insert', message: 'value too long' }] })
  })

  it('CRITICAL: RLS refusing a write is fatal, never a partial success', async () => {
    const denied = fakeDb([], { insertError: { code: '42501', message: 'new row violates row-level security policy' } })
    await expect(syncEventbriteTourDates(denied.db, ARTIST, [show('101')])).rejects.toThrow(/row-level security/)
  })
})
