// @vitest-environment jsdom
// The per-kind recipient lists: what each kind reaches, and who is added on top.
/**
 * KindRows — the routing half of the Enquiries page (2026-09-22).
 *
 * WHAT MATTERS HERE, and why each of these would fail silently in production:
 *
 *   - The list ADDS to the resolved booking address. The row and the card both have to
 *     show that address, or a manager who adds their tour manager will reasonably believe
 *     they have REPLACED the booking address and that nobody else is getting it.
 *   - `other` cannot be deleted (a database trigger refuses it — it is the fallback every
 *     unrecognised purpose lands on). Offering a Delete button that always fails is worse
 *     than offering none, and the "is it offered" decision lives only here.
 *   - A chip edit sends the WHOLE list. A partial write would drop whoever the client
 *     happened not to mention, and nothing downstream would notice.
 *   - A refused save must put the chips back. An optimistic list that survives a rejection
 *     tells the manager someone is copied in when the database says otherwise — the exact
 *     shape of "tests that pass while the guard does nothing" this repo keeps finding.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { KindRows } from '@/app/artists/[id]/(dashboard)/enquiries/kind-rows'
import {
  addEnquiryKindAction,
  deleteEnquiryKindAction,
  setEnquiryRecipientsAction,
} from '@/app/artists/[id]/(dashboard)/enquiries/actions'
import { LABEL_MAX, type EnquiryKindRow } from '@/lib/enquiries/kinds'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

// Seen live 2026-09-23: every refusal here wore the green success tick, because
// `toast()` defaults to 'success'. Mocked so the KIND of each toast can be asserted.
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

vi.mock('@/app/artists/[id]/(dashboard)/enquiries/actions', () => ({
  addEnquiryKindAction: vi.fn(async () => ({ kind: null })),
  deleteEnquiryKindAction: vi.fn(async () => ({})),
  renameEnquiryKindAction: vi.fn(async () => ({})),
  // Echoes the list back with server ids, the way the RPC returns rows as stored.
  setEnquiryRecipientsAction: vi.fn(async (_a: string, _k: string, list: { email: string; label: string | null }[]) => ({
    rows: list.map((r, i) => ({ id: `srv-${i}`, ...r })),
  })),
}))

const setRecipients = vi.mocked(setEnquiryRecipientsAction)
const addKind = vi.mocked(addEnquiryKindAction)
const deleteKind = vi.mocked(deleteEnquiryKindAction)

const PRIMARY = 'booking@skeen.com'

const kind = (over: Partial<EnquiryKindRow> = {}): EnquiryKindRow => ({
  id: 'k-booking',
  slug: 'booking',
  label: 'Booking',
  sortOrder: 0,
  recipients: [],
  ...over,
})

function renderRows(kinds: EnquiryKindRow[], primary: string | null = PRIMARY) {
  return render(<KindRows artistId="a1" kinds={kinds} primary={primary} />)
}

/** Open a kind's card by clicking its row. */
function openCard(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  setRecipients.mockImplementation(async (_a, _k, list) => ({
    rows: list.map((r, i) => ({ id: `srv-${i}`, ...r })),
  }))
})
afterEach(cleanup)

describe('the rows', () => {
  it('shows the address each kind would actually reach', () => {
    // The whole point of the read-only primary: without it, adding a manager reads as
    // REPLACING the booking address rather than adding to it.
    renderRows([kind(), kind({ id: 'k-demo', slug: 'demo', label: 'Demo' })])

    expect(screen.getAllByText(PRIMARY)).toHaveLength(2)
  })

  it('says so when there is no booking address, on every kind', () => {
    renderRows([kind(), kind({ id: 'k-demo', slug: 'demo', label: 'Demo' })], null)

    expect(screen.getAllByText(/No booking address set/)).toHaveLength(2)
    expect(screen.queryByText(PRIMARY)).toBeNull()
  })

  it('counts the people added on top, and stays silent at zero', () => {
    renderRows([
      kind({ recipients: [{ id: 'r1', email: 'a@x.com', label: 'Skeen' }, { id: 'r2', email: 'b@x.com', label: null }] }),
      kind({ id: 'k-demo', slug: 'demo', label: 'Demo' }),
    ])

    expect(screen.getByText('+2')).toBeTruthy()
    // A kind with an empty list shows no count at all — "+0" is noise on a row that is
    // already saying where it goes.
    expect(screen.queryByText('+0')).toBeNull()
  })
})

describe('the card', () => {
  it('shows the SLUG, which is the word the site has to post', () => {
    // The slug is immutable and invisible everywhere else. If the manager ever has to make
    // their site agree with a kind, this is the only place that tells them what to send.
    renderRows([kind()])
    openCard('Booking')

    // Rendered by the header, not by any row — the row shows the label.
    expect(within(screen.getByRole('dialog')).getByText('booking')).toBeTruthy()
  })

  it('offers no Delete for the fallback kind', () => {
    // A trigger refuses to delete 'other'; a button that always fails is worse than none.
    renderRows([kind({ id: 'k-other', slug: 'other', label: 'Contact' })])
    const card = openCard('Contact')

    expect(within(card).queryByRole('button', { name: /^Delete/ })).toBeNull()
  })

  it('offers Delete for a kind the artist invented', () => {
    // The other half of the rule. Without this, "no Delete button" would pass even if the
    // button had been removed from every kind.
    renderRows([kind({ id: 'k-press', slug: 'press', label: 'Press' })])
    const card = openCard('Press')

    expect(within(card).getByRole('button', { name: /^Delete/ })).toBeTruthy()
    expect(deleteKind).not.toHaveBeenCalled()
  })
})

describe('the chips', () => {
  it('sends the WHOLE list when someone is added', async () => {
    // Not a delta. The action replaces the list, so a partial payload silently drops
    // whoever the client did not mention.
    renderRows([kind({ recipients: [{ id: 'r1', email: 'skeen@x.com', label: 'Skeen' }] })])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(card).getByLabelText('Email address'), {
      target: { value: 'mgr@x.com' },
    })
    fireEvent.change(within(card).getByLabelText('Who this is'), { target: { value: 'Manager' } })
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(setRecipients).toHaveBeenCalledWith('a1', 'k-booking', [
      { email: 'skeen@x.com', label: 'Skeen' },
      { email: 'mgr@x.com', label: 'Manager' },
    ])
  })

  it('sends the list WITHOUT the one removed', async () => {
    renderRows([
      kind({
        recipients: [
          { id: 'r1', email: 'skeen@x.com', label: 'Skeen' },
          { id: 'r2', email: 'mgr@x.com', label: 'Manager' },
        ],
      }),
    ])
    const card = openCard('Booking')

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Remove Skeen' }))
    })

    expect(setRecipients).toHaveBeenCalledWith('a1', 'k-booking', [
      { email: 'mgr@x.com', label: 'Manager' },
    ])
  })

  it('shows the address when there is no label, so a chip is never blank', async () => {
    renderRows([kind({ recipients: [{ id: 'r1', email: 'nameless@x.com', label: null }] })])
    const card = openCard('Booking')

    expect(within(card).getByText('nameless@x.com')).toBeTruthy()
  })

  it('puts the chips BACK when the save is refused', async () => {
    // The guard this whole file exists for. An optimistic list that survives a rejection
    // tells the manager someone is copied in when the database says they are not — and the
    // cap, the address CHECK and the per-kind uniqueness all reject from the server.
    setRecipients.mockResolvedValue({ error: 'enquiry recipient cap reached' })
    renderRows([kind({ recipients: [{ id: 'r1', email: 'skeen@x.com', label: 'Skeen' }] })])
    const card = openCard('Booking')

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Remove Skeen' }))
    })

    expect(within(screen.getByRole('dialog')).getByText('Skeen')).toBeTruthy()
  })

  it('ignores an empty address instead of sending a blank chip', async () => {
    renderRows([kind()])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(setRecipients).not.toHaveBeenCalled()
  })
})

describe('adding a kind', () => {
  it('sends the typed label, not a slug', async () => {
    // The manager types a NAME. The slug is derived server-side because it is immutable —
    // the one thing they must not be invited to get wrong is the part they cannot change.
    addKind.mockResolvedValue({
      kind: { id: 'k-press', slug: 'press', label: 'Press', sortOrder: 3, recipients: [] },
    })
    renderRows([kind()])

    fireEvent.click(screen.getByRole('button', { name: /Add kind/ }))
    fireEvent.change(screen.getByLabelText('Kind name'), { target: { value: 'Press' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Kind name'), { key: 'Enter' })
    })

    expect(addKind).toHaveBeenCalledWith('a1', 'Press')
    expect(screen.getByRole('button', { name: /Press/ })).toBeTruthy()
  })

  it('does not submit an empty name', async () => {
    renderRows([kind()])

    fireEvent.click(screen.getByRole('button', { name: /Add kind/ }))
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Kind name'), { key: 'Enter' })
    })

    expect(addKind).not.toHaveBeenCalled()
  })
})

describe('the chips — guards added after the 2026-09-22 review', () => {
  it('shows the list the SERVER returned, not the one it sent', async () => {
    // The action returns rows as stored (ids, order). If the UI kept its optimistic copy,
    // client-minted ids would outlive the save and a later remove would name a row the
    // database never had.
    setRecipients.mockResolvedValueOnce({
      rows: [{ id: 'srv-0', email: 'skeen@x.com', label: 'Skeen (as stored)' }],
    })
    renderRows([kind()])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(card).getByLabelText('Email address'), { target: { value: 'skeen@x.com' } })
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(within(screen.getByRole('dialog')).getByText('Skeen (as stored)')).toBeTruthy()
  })

  it('refuses a bad address BEFORE calling the action', async () => {
    // `bob` used to reach the server, fail the CHECK after the delete, and wipe the list.
    renderRows([kind({ recipients: [{ id: 'r1', email: 'skeen@x.com', label: 'Skeen' }] })])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(card).getByLabelText('Email address'), { target: { value: 'bob' } })
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(setRecipients).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByText('Skeen')).toBeTruthy()
    // A refusal is an ERROR toast, not a green tick with a complaint in it.
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.stringMatching(/email address/i), 'error')
  })

  it('refuses a duplicate address in another case, without a round trip', async () => {
    renderRows([kind({ recipients: [{ id: 'r1', email: 'skeen@x.com', label: 'Skeen' }] })])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(card).getByLabelText('Email address'), { target: { value: 'SKEEN@X.COM' } })
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(setRecipients).not.toHaveBeenCalled()
  })

  it('refuses an eleventh person without a round trip', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, email: `p${i}@x.com`, label: null }))
    renderRows([kind({ recipients: ten })])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(card).getByLabelText('Email address'), { target: { value: 'eleventh@x.com' } })
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(setRecipients).not.toHaveBeenCalled()
  })

  it('lets only ONE save be in flight — two fast removes send once', async () => {
    // AGENTS.md rule 5: the latch is a ref, and both clicks go in ONE act() batch — after a
    // single fireEvent React has already re-rendered, and a second click would be testing
    // the re-render, not the latch. Two saves interleaving is how an address got lost.
    let release!: () => void
    setRecipients.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ rows: [] })
      }),
    )
    renderRows([
      kind({
        recipients: [
          { id: 'r1', email: 'a@x.com', label: 'A' },
          { id: 'r2', email: 'b@x.com', label: 'B' },
        ],
      }),
    ])
    const card = openCard('Booking')

    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Remove A' }))
      fireEvent.click(within(card).getByRole('button', { name: 'Remove B' }))
    })

    expect(setRecipients).toHaveBeenCalledTimes(1)
    await act(async () => release())
  })
})

describe('gaps the 2026-09-23 review named', () => {
  it('adds a kind ONCE when Enter lands twice before the first save returns', async () => {
    // AGENTS.md rule 5: both keypresses in ONE act() batch. Without a latch the second
    // call either mints a duplicate `press-2` or loses the 23505 race and toasts.
    let release!: () => void
    addKind.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ kind: { id: 'k-press', slug: 'press', label: 'Press', sortOrder: 3, recipients: [] } })
      }),
    )
    renderRows([kind()])

    fireEvent.click(screen.getByRole('button', { name: /Add kind/ }))
    fireEvent.change(screen.getByLabelText('Kind name'), { target: { value: 'Press' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Kind name'), { key: 'Enter' })
      fireEvent.keyDown(screen.getByLabelText('Kind name'), { key: 'Enter' })
    })

    expect(addKind).toHaveBeenCalledTimes(1)
    await act(async () => release())
  })

  it('keeps a typed address when a save is still in flight, instead of wiping it', async () => {
    // commit() used to clear the inputs even when send() refused to start, so the address
    // the manager typed vanished without being saved.
    let release!: () => void
    setRecipients.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ rows: [] })
      }),
    )
    renderRows([kind({ recipients: [{ id: 'r1', email: 'a@x.com', label: 'A' }] })])
    const card = openCard('Booking')

    fireEvent.click(within(card).getByRole('button', { name: 'Add someone' }))
    fireEvent.change(within(card).getByLabelText('Email address'), { target: { value: 'new@x.com' } })
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Remove A' }))
      fireEvent.keyDown(within(card).getByLabelText('Email address'), { key: 'Enter' })
    })

    expect(setRecipients).toHaveBeenCalledTimes(1)
    expect((within(card).getByLabelText('Email address') as HTMLInputElement).value).toBe('new@x.com')
    await act(async () => release())
  })

  it('shows a long name cut the way the server stores it', async () => {
    // The action saves label.slice(0, LABEL_MAX); the card used to show the full text
    // until a reload, so the screen and the email subjects disagreed.
    renderRows([kind()])
    const card = openCard('Booking')
    const long = 'x'.repeat(LABEL_MAX + 10)

    fireEvent.click(within(card).getByRole('button', { name: 'Booking' }))
    fireEvent.change(within(card).getByLabelText('Name'), { target: { value: long } })
    await act(async () => {
      fireEvent.keyDown(within(card).getByLabelText('Name'), { key: 'Enter' })
    })

    expect(within(card).queryAllByText(long)).toHaveLength(0)
    expect(within(card).getAllByText('x'.repeat(LABEL_MAX)).length).toBeGreaterThan(0)
  })
})
