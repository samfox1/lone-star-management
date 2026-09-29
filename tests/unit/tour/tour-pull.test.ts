/**
 * A pulled show lands once, follows its source, and never overwrites what the manager changed;
 * new shows slot into a hand-ordered list by date.
 *
 * Code:     src/lib/tour-pull.ts (planTourPull, slotNewRows, PULLED_COLUMNS)
 * Feature:  Connect with Eventbrite: shows pull into Tour as drafts (Sam, 2026-09-28: "never
 *           duplicated on re-pull", "never overwriting a manager's edits")
 * Tier:     STRICT (AGENTS.md "Test depth"): data that can be lost. A wrong plan overwrites a
 *           manager's fix or doubles a show on the live site.
 * Covers:   • the same event is one row, however often it is pulled, and even twice in one pull
 *           • a hand-added show, or a row another source owns, is never written
 *           • a three-way merge, column by column: each row remembers what the pull last wrote,
 *             so a column the manager never touched follows Eventbrite, and one they changed or
 *             emptied keeps their value on this and every later pull
 *           • only the pulled columns are ever written; coordinates compare as numbers
 *           • new shows go after the last show dated on or before them in a dragged list, and
 *             an undragged list is left to sort itself by date
 * Not here: carrying the plan out against the table (eventbrite-sync.test.ts); reading events
 *           from Eventbrite (eventbrite-events.test.ts).
 * Fixtures: plain objects: an incoming show, and a row exactly as the last pull left it.
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
  // A new event is one insert, and pulling it again changes nothing: no duplicate show.
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

  // The same event twice in one pull is still one insert (the later copy wins).
  it('CRITICAL: the same id twice in one pull is one insert (last wins)', () => {
    const plan = planTourPull([], [show('101', { venue: 'Old' }), show('101', { venue: 'New' })])
    expect(plan.inserts).toHaveLength(1)
    expect(plan.inserts[0].values.venue).toBe('New')
  })

  // A hand-added show at the same venue has no Eventbrite id, so it is never mistaken for the event.
  it('a row with no id of this source is never matched (a hand-added show at the same venue)', () => {
    const manual: ExistingTourRow = { id: 'm1', source: 'manual', eventbrite_id: null, pulled: {}, ...show('x').values }
    const plan = planTourPull([manual], [show('101')])
    expect(plan.inserts.map((s) => s.externalId)).toEqual(['101'])
  })

  // A row another source owns is skipped, even if it carries the same id.
  it('a row another source owns is skipped, never written', () => {
    const theirs: ExistingTourRow = { ...pulledRow('101', 'r1'), source: 'manual' }
    const plan = planTourPull([theirs], [show('101', { venue: 'Elsewhere' })])
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([])
    expect(plan.skipped).toBe(1)
  })
})

describe('planTourPull — the manager’s edits', () => {
  // A column the manager never touched follows Eventbrite (the venue moved: it moves), and only
  // the changed columns are written.
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

  // A column the manager changed keeps their value whatever Eventbrite now says; untouched
  // columns of the same row still move.
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

  // The edit survives every later pull, not only the next one.
  it('an edited column keeps its edit on every later pull, too', () => {
    const row = { ...pulledRow('101', 'r1'), venue: 'Mohawk (outdoor stage)' }
    const first = planTourPull([row], [show('101', { venue: 'Stubb’s' })])
    // Whatever the first pull stored as "last pulled", the second pull still sees an edit.
    const after = { ...row, pulled: first.updates[0]?.pulled ?? row.pulled }
    const second = planTourPull([after], [show('101', { venue: 'Emo’s' })])
    for (const u of second.updates) expect(u.patch).not.toHaveProperty('venue')
  })

  // An edited row with nothing new from Eventbrite is left alone; when Eventbrite does change the
  // edited column, only the memory of what it said is updated, and the row counts as skipped.
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

  // A column the pull has no memory of writing counts as the manager's, and is not overwritten.
  it('a column with no memory of a pull (never written by it) counts as the manager’s', () => {
    const row: ExistingTourRow = { ...pulledRow('101', 'r1'), pulled: {} }
    const plan = planTourPull([row], [show('101', { venue: 'Stubb’s' })])
    for (const u of plan.updates) expect(u.patch).toEqual({})
  })

  // A column the manager emptied is an edit too: Eventbrite does not refill it.
  it('a cleared column (the manager emptied it) is an edit too', () => {
    const row = { ...pulledRow('101', 'r1'), city: null }
    const plan = planTourPull([row], [show('101', { city: 'Round Rock' })])
    for (const u of plan.updates) expect(u.patch).not.toHaveProperty('city')
  })

  // A coordinate read back from the database is the same number, so it is not a change.
  it('numbers compare as numbers (a coordinate read back from Postgres is the same coordinate)', () => {
    const row = { ...pulledRow('101', 'r1'), latitude: 30.27 }
    const plan = planTourPull([row], [show('101')])
    expect(plan.updates).toEqual([])
  })

  // It writes only the eight columns it pulls, never anything else on the row.
  it('writes only the columns it owns', () => {
    expect([...PULLED_COLUMNS].sort()).toEqual(['city', 'country', 'date', 'latitude', 'longitude', 'state', 'ticket_url', 'venue'])
    const plan = planTourPull([pulledRow('101', 'r1')], [show('101', { venue: 'Stubb’s' })])
    for (const u of plan.updates) for (const k of Object.keys(u.patch)) expect(PULLED_COLUMNS).toContain(k)
  })
})

describe('slotNewRows — where new shows land', () => {
  // A tour list the manager never dragged sorts itself by date, so there is no order to write.
  it('CRITICAL: a never-dragged list is left to order itself by date (null: nothing to write)', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', sort_order: null },
      { id: 'b', date: '2026-12-01', sort_order: null },
    ]
    expect(slotNewRows(rows, [{ id: 'n', date: '2026-11-01' }])).toBeNull()
  })

  // In a hand-ordered list each new show goes after the last show dated on or before it,
  // as the tour page's own Add does.
  it('CRITICAL: in a dragged list each new show goes after the last show dated on or before it', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', sort_order: 0 },
      { id: 'b', date: '2026-12-01', sort_order: 1 },
      { id: 'c', date: null, sort_order: 2 },
    ]
    expect(slotNewRows(rows, [{ id: 'n2', date: '2026-12-15' }, { id: 'n1', date: '2026-11-01' }])).toEqual(['a', 'n1', 'b', 'n2', 'c'])
  })

  // No new shows means no order to write.
  it('no new rows, nothing to do', () => {
    expect(slotNewRows([{ id: 'a', date: '2026-10-01', sort_order: 0 }], [])).toBeNull()
  })

  // A new show with no date goes at the end, whatever order the new shows arrived in.
  it('an undated new show goes at the end, after the dated ones, whatever order they came in', () => {
    const rows = [
      { id: 'a', date: '2026-10-01', sort_order: 0 },
      { id: 'b', date: '2026-12-01', sort_order: 1 },
    ]
    expect(slotNewRows(rows, [{ id: 'tba', date: null }, { id: 'n', date: '2026-11-01' }])).toEqual(['a', 'n', 'b', 'tba'])
    expect(slotNewRows(rows, [{ id: 'n', date: '2026-11-01' }, { id: 'tba', date: null }])).toEqual(['a', 'n', 'b', 'tba'])
  })
})
