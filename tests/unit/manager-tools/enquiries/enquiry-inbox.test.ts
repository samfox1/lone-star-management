// What an enquiry row says before you open it: its snippet, and the filters over the list.
/**
 * The inbox's pure rules — what a row says before you open it.
 *
 * Kept out of the component because these are the decisions worth arguing about, and a
 * render test is a bad place to argue. The component is then just a dense table: a
 * scannable archive with no row open by default.
 */
import { describe, expect, it } from 'vitest'
import { artistsIn, filterByArtist, filterRows, kindFilter, kindOptions, searchRows, snippet, type InboxRow } from '@/lib/enquiries/inbox'

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'e1',
  purpose: 'booking',
  purposeLabel: 'Booking',
  name: 'Jamie Rowe',
  email: 'jamie@example.com',
  message: 'Can you play the Aug 14 show at Mohawk?',
  read_at: null,
  created_at: '2026-08-04T10:00:00Z',
  demo_url: null,
  attachmentCount: 0,
  artistId: 'a1',
  artistName: 'Lone Pine',
  status: 'sent',
  ...over,
})

describe('snippet', () => {
  it('collapses newlines so a multi-line message stays one row', () => {
    // A raw message with line breaks would blow the row height apart and make the list
    // stop being scannable, which is the whole point of it.
    expect(snippet('Hello\n\nthere\nfriend', 80)).toBe('Hello there friend')
  })

  it('collapses runs of whitespace', () => {
    expect(snippet('too    many     spaces', 80)).toBe('too many spaces')
  })

  it('truncates at the limit and marks it', () => {
    const out = snippet('a'.repeat(200), 40)
    expect(out.length).toBeLessThanOrEqual(41) // 40 + the ellipsis character
    expect(out.endsWith('…')).toBe(true)
  })

  it('does not truncate something already short', () => {
    expect(snippet('short', 40)).toBe('short')
    expect(snippet('short', 40).endsWith('…')).toBe(false)
  })

  it('CRITICAL: cuts on a word boundary rather than mid-word', () => {
    // "Can you play the Aug…" reads; "Can you play the Au…" looks like a bug.
    expect(snippet('Can you play the August show at Mohawk', 22)).toBe('Can you play the…')
  })

  it('handles an empty or whitespace-only message', () => {
    expect(snippet('', 40)).toBe('')
    expect(snippet('   \n  ', 40)).toBe('')
  })
})

describe('filterRows', () => {
  const unread = row({ id: 'u', read_at: null })
  const read = row({ id: 'r', read_at: '2026-08-04T11:00:00Z' })
  const demo = row({ id: 'd', purpose: 'demo', read_at: '2026-08-04T11:00:00Z' })

  it('shows everything under "all"', () => {
    expect(filterRows([unread, read], 'all').map((r) => r.id)).toEqual(['u', 'r'])
  })

  it('shows only unread under "unread"', () => {
    expect(filterRows([unread, read], 'unread').map((r) => r.id)).toEqual(['u'])
  })

  // A KIND filter, not a hard-coded "demos". Kinds are the artist's to invent since
  // 2026-09-21, so the filter names a slug from their list rather than one the code knew.
  it('shows only that kind under a kind filter', () => {
    expect(filterRows([unread, read, demo], kindFilter('demo')).map((r) => r.id)).toEqual(['d'])
  })

  it('filters an artist-invented kind the same way', () => {
    const press = row({ id: 'p', purpose: 'press', purposeLabel: 'Press' })
    expect(filterRows([unread, press, demo], kindFilter('press')).map((r) => r.id)).toEqual(['p'])
  })

  it('matches the WHOLE slug, not a prefix of it', () => {
    const tape = row({ id: 't', purpose: 'demo-tape' })
    expect(filterRows([demo, tape], kindFilter('demo')).map((r) => r.id)).toEqual(['d'])
  })

  it('a kind filter ignores read state — it is a kind, not a status', () => {
    const unreadDemo = row({ id: 'ud', purpose: 'demo' })
    expect(filterRows([demo, unreadDemo], kindFilter('demo')).map((r) => r.id)).toEqual(['d', 'ud'])
  })

  it('preserves order — the caller already sorted newest first', () => {
    const older = row({ id: 'old', created_at: '2026-01-01T00:00:00Z' })
    expect(filterRows([unread, older], 'all').map((r) => r.id)).toEqual(['u', 'old'])
  })
})

describe('kindOptions — the kind filters on offer', () => {
  const kinds = [
    { slug: 'booking', label: 'Booking' },
    { slug: 'demo', label: 'Demo' },
    { slug: 'other', label: 'Contact' },
  ]

  it("offers the artist's own kinds, in the artist's order", () => {
    // Every kind, even one with no enquiries yet: the filters say what CAN land here.
    expect(kindOptions(kinds, [])).toEqual(kinds)
  })

  it('does not offer a kind twice when rows carry it', () => {
    const rows = [row({ purpose: 'demo', purposeLabel: 'Demo' }), row({ id: 'e2', purpose: 'booking' })]
    expect(kindOptions(kinds, rows).map((k) => k.slug)).toEqual(['booking', 'demo', 'other'])
  })

  it('keeps a DELETED kind reachable while rows still carry it, labelled as the row says', () => {
    // The kind was deleted after these arrived. Its messages are still in the table, so a
    // filter for them stays; dropping it would leave them reachable only through All.
    const rows = [row({ purpose: 'weddings', purposeLabel: 'Weddings' })]
    expect(kindOptions(kinds, rows)).toEqual([...kinds, { slug: 'weddings', label: 'Weddings' }])
  })

  it('orders the extra kinds by label, so the filter bar does not reshuffle as mail arrives', () => {
    const rows = [
      row({ id: '1', purpose: 'sync', purposeLabel: 'Sync' }),
      row({ id: '2', purpose: 'press', purposeLabel: 'Press' }),
      row({ id: '3', purpose: 'sync', purposeLabel: 'Sync' }),
    ]
    expect(kindOptions([], rows)).toEqual([
      { slug: 'press', label: 'Press' },
      { slug: 'sync', label: 'Sync' },
    ])
  })

  it('with no kind list (the roster inbox), offers each kind the rows carry, once', () => {
    // Two artists both have `booking`; one filter covers both.
    const rows = [
      row({ id: '1', artistId: 'a1', purpose: 'booking', purposeLabel: 'Booking' }),
      row({ id: '2', artistId: 'a2', purpose: 'booking', purposeLabel: 'Booking' }),
    ]
    expect(kindOptions([], rows)).toEqual([{ slug: 'booking', label: 'Booking' }])
  })

  it('offers nothing for an empty roster inbox', () => {
    expect(kindOptions([], [])).toEqual([])
  })
})

describe('artistsIn', () => {
  it('lists each artist once, alphabetically', () => {
    const rows = [
      row({ id: '1', artistId: 'z', artistName: 'Zed' }),
      row({ id: '2', artistId: 'a', artistName: 'Ada' }),
      row({ id: '3', artistId: 'z', artistName: 'Zed' }),
    ]
    expect(artistsIn(rows)).toEqual([
      { id: 'a', name: 'Ada' },
      { id: 'z', name: 'Zed' },
    ])
  })

  it('CRITICAL: is built from the ROWS, so it never offers an artist with nothing to show', () => {
    // Offering the whole roster would put options in the list that can only ever return
    // an empty table, which reads as a bug the first time somebody picks one.
    expect(artistsIn([row({ artistId: 'only', artistName: 'Only One' })])).toHaveLength(1)
  })

  it('handles an empty table', () => {
    expect(artistsIn([])).toEqual([])
  })
})

describe('filterByArtist', () => {
  const a = row({ id: 'a', artistId: 'a1' })
  const b = row({ id: 'b', artistId: 'a2' })

  it('"all" filters nothing', () => {
    expect(filterByArtist([a, b], 'all')).toHaveLength(2)
  })

  it('narrows to one artist', () => {
    expect(filterByArtist([a, b], 'a2').map((r) => r.id)).toEqual(['b'])
  })
})

describe('searchRows — the toolbar search (Sam, 2026-10-05: Enquiries on the Subscribers layout)', () => {
  const rows = [
    row({ id: 'a', name: 'Jamie Rowe', email: 'jamie@example.com', message: 'Can you play Mohawk?', purposeLabel: 'Booking' }),
    row({ id: 'b', name: 'Nia Patel', email: 'nia@label.co', message: 'Demo attached.', purposeLabel: 'Demo' }),
    row({ id: 'c', name: 'Press Desk', email: 'desk@paper.com', message: 'Interview request', purposeLabel: 'Sync licensing' }),
  ]
  const ids = (q: string) => searchRows(rows, q).map((r) => r.id)

  it('an empty or blank query keeps every row, in order', () => {
    expect(ids('')).toEqual(['a', 'b', 'c'])
    expect(ids('   ')).toEqual(['a', 'b', 'c'])
  })

  it('matches the sender, the address, the message and the kind, ignoring case and outer spaces', () => {
    expect(ids('  PATEL ')).toEqual(['b'])
    expect(ids('label.co')).toEqual(['b'])
    expect(ids('mohawk')).toEqual(['a'])
    expect(ids('sync')).toEqual(['c'])
  })

  it('is plain text, not a pattern: "." is a dot', () => {
    expect(ids('.')).toEqual(['a', 'b', 'c'])
    expect(ids('a.t')).toEqual([])
  })

  it('a query nothing contains keeps nothing', () => {
    expect(ids('zzz')).toEqual([])
  })
})
