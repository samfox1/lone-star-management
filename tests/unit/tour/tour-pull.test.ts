// A pulled show lands once, follows its source, and never overwrites what the manager changed.
/**
 * `planTourPull` (src/lib/tour-pull.ts) decides what an Eventbrite pull WRITES, before any
 * write happens (Sam, 2026-09-28: shows arrive as drafts, "never duplicated on re-pull",
 * "never overwriting a manager's edits").
 *
 * The rule is a three-way merge, column by column. Each pulled row remembers what the
 * source last wrote (`pulled`). On the next pull a column changes only while the row still
 * holds that value, so:
 *
 *   - a column the manager never touched follows Eventbrite (the venue moved: it moves);
 *   - a column the manager changed keeps the manager's value, whatever Eventbrite says;
 *   - the same event twice is one row (matched by its stable id), never a second insert;
 *   - a row another source owns (a hand-added show that happens to carry the id) is left.
 *
 * `slotNewRows` puts new shows where the tour page's own Add puts one (PRESENCE_PLAN S3):
 * nothing when the list was never dragged, otherwise after the last show dated on or
 * before it.
 */
import { describe, expect, it } from 'vitest'
import { PULLED_COLUMNS, planTourPull, slotNewRows, type ExistingTourRow, type IncomingShow } from '@/lib/tour-pull'

const show = (id: string, over: Partial<IncomingShow['values']> = {}): IncomingShow => ({
  externalId: id,
  values: {
    date: '2026-11-05',
    venue: 'Mohawk',
    city: 'Austin',
    state: 'TX',
    country: 'United States',
    ticket_url: `https://www.eventbrite.com/e/skeen-tickets-${id}`,
    latitude: 30.27,
    longitude: -97.74,
    ...over,
  },
})

/** A row exactly as the pull left it last time: every column equal to what it wrote. */
const pulledRow = (id: string, rowId: string, over: Partial<IncomingShow['values']> = {}): ExistingTourRow => {
  const values = show(id, over).values
  return { id: rowId, source: 'eventbrite', eventbrite_id: id, pulled: { ...values }, ...values }
}

describe('planTourPull — what lands', () => {
  it('CRITICAL: a new event is one insert; the same event again is not a second one', () => {
    const first = planTourPull([], [show('101')])
    expect(first.inserts.map((s) => s.externalId)).toEqual(['101'])
    expect(first.updates).toEqual([])

    const again = planTourPull([pulledRow('101', 'r1')], [show('101')])
    expect(again.inserts).toEqual([])
    expect(again.updates).toEqual([])
    expect(again.unchanged).toBe(1)
    expect(again.skipped).toBe(0)
  })

  it('CRITICAL: the same id twice in one pull is one insert (last wins)', () => {
    const plan = planTourPull([], [show('101', { venue: 'Old' }), show('101', { venue: 'New' })])
    expect(plan.inserts).toHaveLength(1)
    expect(plan.inserts[0].values.venue).toBe('New')
  })

  it('a row with no id of this source is never matched (a hand-added show at the same venue)', () => {
    const manual: ExistingTourRow = { id: 'm1', source: 'manual', eventbrite_id: null, pulled: {}, ...show('x').values }
    const plan = planTourPull([manual], [show('101')])
    expect(plan.inserts.map((s) => s.externalId)).toEqual(['101'])
  })

  it('a row another source owns is skipped, never written', () => {
    const theirs: ExistingTourRow = { ...pulledRow('101', 'r1'), source: 'manual' }
    const plan = planTourPull([theirs], [show('101', { venue: 'Elsewhere' })])
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([])
    expect(plan.skipped).toBe(1)
  })
})

describe('planTourPull — the manager’s edits', () => {
  it('CRITICAL: a column the manager never touched follows Eventbrite', () => {
    const plan = planTourPull([pulledRow('101', 'r1')], [show('101', { venue: 'Stubb’s', date: '2026-11-06' })])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]).toMatchObject({ id: 'r1', patch: { venue: 'Stubb’s', date: '2026-11-06' } })
    // Only what changed is written.
    expect(Object.keys(plan.updates[0].patch).sort()).toEqual(['date', 'venue'])
    expect(plan.updates[0].pulled).toEqual(show('101', { venue: 'Stubb’s', date: '2026-11-06' }).values)
    // Nothing was held back, so nothing reads as "left alone".
    expect(plan.skipped).toBe(0)
    expect(plan.unchanged).toBe(0)
  })

  it('CRITICAL: a column the manager changed keeps the manager’s value, whatever Eventbrite now says', () => {
    const row = { ...pulledRow('101', 'r1'), venue: 'Mohawk (outdoor stage)', ticket_url: 'https://tickets.example.com/skeen' }
    const plan = planTourPull([row], [show('101', { venue: 'Stubb’s', city: 'Round Rock', ticket_url: 'https://www.eventbrite.com/e/moved-101' })])
    expect(plan.updates).toHaveLength(1)
    const { patch } = plan.updates[0]
    // The city was untouched, so it moves; the venue and the ticket link were edited, so they stay.
    expect(patch).toEqual({ city: 'Round Rock' })
    expect(patch).not.toHaveProperty('venue')
    expect(patch).not.toHaveProperty('ticket_url')
    // It changed something the manager sees, so it is an update, not a "left alone".
    expect(plan.skipped).toBe(0)
  })

  it('an edited column keeps its edit on every later pull, too', () => {
    const row = { ...pulledRow('101', 'r1'), venue: 'Mohawk (outdoor stage)' }
    const first = planTourPull([row], [show('101', { venue: 'Stubb’s' })])
    // Whatever the first pull stored as "last pulled", the second pull still sees an edit.
    const after = { ...row, pulled: first.updates[0]?.pulled ?? row.pulled }
    const second = planTourPull([after], [show('101', { venue: 'Emo’s' })])
    for (const u of second.updates) expect(u.patch).not.toHaveProperty('venue')
  })

  it('an edit that Eventbrite has nothing new for is left alone, and counted as such', () => {
    const row = { ...pulledRow('101', 'r1'), venue: 'Mohawk (outdoor stage)' }
    const same = planTourPull([row], [show('101')])
    expect(same.updates).toEqual([])
    expect(same.unchanged).toBe(1)
    expect(same.skipped).toBe(0)
    const diverged = planTourPull([row], [show('101', { venue: 'Stubb’s' })])
    // Nothing the manager can see changes: only the memory of what Eventbrite said.
    expect(diverged.updates).toHaveLength(1)
    expect(diverged.updates[0].patch).toEqual({})
    expect(diverged.skipped).toBe(1)
  })

  it('a column with no memory of a pull (never written by it) counts as the manager’s', () => {
    const row: ExistingTourRow = { ...pulledRow('101', 'r1'), pulled: {} }
    const plan = planTourPull([row], [show('101', { venue: 'Stubb’s' })])
    for (const u of plan.updates) expect(u.patch).toEqual({})
  })

  it('a cleared column (the manager emptied it) is an edit too', () => {
    const row = { ...pulledRow('101', 'r1'), city: null }
    const plan = planTourPull([row], [show('101', { city: 'Round Rock' })])
    for (const u of plan.updates) expect(u.patch).not.toHaveProperty('city')
  })

  it('numbers compare as numbers (a coordinate read back from Postgres is the same coordinate)', () => {
    const row = { ...pulledRow('101', 'r1'), latitude: 30.27 }
    const plan = planTourPull([row], [show('101')])
    expect(plan.updates).toEqual([])
  })

  it('writes only the columns it owns', () => {
    expect([...PULLED_COLUMNS].sort()).toEqual(['city', 'country', 'date', 'latitude', 'longitude', 'state', 'ticket_url', 'venue'])
    const plan = planTourPull([pulledRow('101', 'r1')], [show('101', { venue: 'Stubb’s' })])
    for (const u of plan.updates) for (const k of Object.keys(u.patch)) expect(PULLED_COLUMNS).toContain(k)
  })
})

describe('slotNewRows — where new shows land', () => {
  it('CRITICAL: a never-dragged list is left to order itself by date (null: nothing to write)', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', sort_order: null },
      { id: 'b', date: '2026-12-01', sort_order: null },
    ]
    expect(slotNewRows(rows, [{ id: 'n', date: '2026-11-01' }])).toBeNull()
  })

  it('CRITICAL: in a dragged list each new show goes after the last show dated on or before it', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', sort_order: 0 },
      { id: 'b', date: '2026-12-01', sort_order: 1 },
      { id: 'c', date: null, sort_order: 2 },
    ]
    expect(slotNewRows(rows, [{ id: 'n2', date: '2026-12-15' }, { id: 'n1', date: '2026-11-01' }])).toEqual(['a', 'n1', 'b', 'n2', 'c'])
  })

  it('no new rows, nothing to do', () => {
    expect(slotNewRows([{ id: 'a', date: '2026-10-01', sort_order: 0 }], [])).toBeNull()
  })

  it('an undated new show goes at the end, after the dated ones, whatever order they came in', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', sort_order: 0 },
      { id: 'b', date: '2026-12-01', sort_order: 1 },
    ]
    expect(slotNewRows(rows, [{ id: 'tba', date: null }, { id: 'n', date: '2026-11-01' }])).toEqual(['a', 'n', 'b', 'tba'])
    expect(slotNewRows(rows, [{ id: 'n', date: '2026-11-01' }, { id: 'tba', date: null }])).toEqual(['a', 'n', 'b', 'tba'])
  })
})
