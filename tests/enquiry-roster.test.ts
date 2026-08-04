/**
 * Ordering for the cross-artist enquiries overview.
 *
 * The brief says "sort unread first, then most recent", and the purpose is "who needs
 * attention today". Those two sentences disagree on one case, so the choice is pinned
 * here rather than left to whoever reads the SQL next:
 *
 *   Artist A: 5 unread, newest a month old.
 *   Artist B: 1 unread, newest an hour ago.
 *
 * Sorting by unread COUNT puts A on top. Sorting by "has unread, then recency" puts B on
 * top. B is right for a triage screen — a fresh message is the thing that needs answering
 * today, and a big old pile is a backlog, not an alert. So `unread` is a BOOLEAN key here,
 * not a magnitude.
 */
import { describe, expect, it } from 'vitest'
import { sortByAttention, type EnquiryRosterRow } from '@/lib/enquiries'

const row = (over: Partial<EnquiryRosterRow>): EnquiryRosterRow => ({
  id: 'x',
  name: 'Artist',
  total: 0,
  unread: 0,
  latestAt: null,
  ...over,
})

const names = (rows: EnquiryRosterRow[]) => sortByAttention(rows).map((r) => r.name)

describe('sortByAttention', () => {
  it('puts any artist with unread above one with none', () => {
    const read = row({ name: 'Read', total: 9, unread: 0, latestAt: '2026-08-04T10:00:00Z' })
    const unread = row({ name: 'Unread', total: 1, unread: 1, latestAt: '2026-01-01T10:00:00Z' })
    expect(names([read, unread])).toEqual(['Unread', 'Read'])
  })

  it('CRITICAL: among unread, the most RECENT wins — not the biggest pile', () => {
    // The disagreement in the brief. A triage screen answers "what came in", so one fresh
    // message outranks five stale ones.
    const pile = row({ name: 'Pile', total: 5, unread: 5, latestAt: '2026-07-01T10:00:00Z' })
    const fresh = row({ name: 'Fresh', total: 1, unread: 1, latestAt: '2026-08-04T10:00:00Z' })
    expect(names([pile, fresh])).toEqual(['Fresh', 'Pile'])
  })

  it('among artists with nothing unread, the most recent still comes first', () => {
    const old = row({ name: 'Old', total: 2, latestAt: '2026-01-01T10:00:00Z' })
    const recent = row({ name: 'Recent', total: 2, latestAt: '2026-08-01T10:00:00Z' })
    expect(names([old, recent])).toEqual(['Recent', 'Old'])
  })

  it('artists with no enquiries at all sink to the bottom', () => {
    const none = row({ name: 'None' })
    const some = row({ name: 'Some', total: 1, latestAt: '2026-01-01T10:00:00Z' })
    expect(names([none, some])).toEqual(['Some', 'None'])
  })

  it('falls back to name so the order is stable when nothing distinguishes them', () => {
    // Without this, two quiet artists swap places between renders for no reason.
    expect(names([row({ name: 'Zed' }), row({ name: 'Ada' })])).toEqual(['Ada', 'Zed'])
  })

  it('does not mutate the input', () => {
    const rows = [row({ name: 'B', unread: 0 }), row({ name: 'A', unread: 1 })]
    sortByAttention(rows)
    expect(rows.map((r) => r.name)).toEqual(['B', 'A'])
  })

  it('handles an empty roster', () => {
    expect(sortByAttention([])).toEqual([])
  })

  it('orders a realistic mixed roster the way a manager would triage it', () => {
    const rows = [
      row({ name: 'Quiet', total: 0 }),
      row({ name: 'Handled', total: 12, unread: 0, latestAt: '2026-08-03T09:00:00Z' }),
      row({ name: 'Backlog', total: 30, unread: 30, latestAt: '2026-06-01T09:00:00Z' }),
      row({ name: 'New', total: 2, unread: 1, latestAt: '2026-08-04T09:00:00Z' }),
    ]
    expect(names(rows)).toEqual(['New', 'Backlog', 'Handled', 'Quiet'])
  })
})
