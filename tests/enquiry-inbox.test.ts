/**
 * The inbox's pure rules — what a row says before you open it, and what is open by default.
 *
 * Kept out of the component because these are the decisions worth arguing about, and a
 * render test is a bad place to argue. The component is then just the split pane.
 */
import { describe, expect, it } from 'vitest'
import { filterRows, initialSelection, snippet, type InboxRow } from '@/lib/enquiry-inbox'

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'e1',
  purpose: 'booking',
  name: 'Jamie Rowe',
  email: 'jamie@example.com',
  message: 'Can you play the Aug 14 show at Mohawk?',
  read_at: null,
  created_at: '2026-08-04T10:00:00Z',
  demo_url: null,
  attachmentCount: 0,
  artistId: 'a1',
  artistName: 'Lone Pine',
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

  it('shows only demos under "demos"', () => {
    // Its own filter because demos are the ones with audio to listen to, which is a
    // different job from answering a booking — and the one a manager batches.
    expect(filterRows([unread, read, demo], 'demos').map((r) => r.id)).toEqual(['d'])
  })

  it('demos filter ignores read state — it is a kind, not a status', () => {
    const unreadDemo = row({ id: 'ud', purpose: 'demo' })
    expect(filterRows([demo, unreadDemo], 'demos').map((r) => r.id)).toEqual(['d', 'ud'])
  })

  it('preserves order — the caller already sorted newest first', () => {
    const older = row({ id: 'old', created_at: '2026-01-01T00:00:00Z' })
    expect(filterRows([unread, older], 'all').map((r) => r.id)).toEqual(['u', 'old'])
  })
})

describe('initialSelection', () => {
  it('CRITICAL: opens the newest UNREAD, not simply the newest', () => {
    // The reason you opened the inbox is the thing you have not read. Landing on a
    // message you already dealt with makes you do the work of finding it yourself.
    const rows = [
      row({ id: 'newest-read', read_at: '2026-08-04T11:00:00Z', created_at: '2026-08-04T10:00:00Z' }),
      row({ id: 'older-unread', read_at: null, created_at: '2026-08-03T10:00:00Z' }),
    ]
    expect(initialSelection(rows)).toBe('older-unread')
  })

  it('falls back to the newest when everything is read', () => {
    const rows = [
      row({ id: 'a', read_at: '2026-08-04T11:00:00Z' }),
      row({ id: 'b', read_at: '2026-08-04T11:00:00Z' }),
    ]
    expect(initialSelection(rows)).toBe('a')
  })

  it('selects nothing when the inbox is empty', () => {
    expect(initialSelection([])).toBeNull()
  })
})
