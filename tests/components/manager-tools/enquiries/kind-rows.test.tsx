// @vitest-environment jsdom
// Settings › Email's rows: click an address to edit or remove it; one + adds a type, then an email.
/**
 * KindRows (Sam, 2026-10-02). LIGHT tier for the look (it is still moving), but every save here
 * decides who receives enquiries, so each test asserts the ACTION and the exact list it got:
 *
 *   - a row shows its kind's OWN addresses and nothing else, every one clickable (Sam: "i should
 *     be able to edit/delete every email there"; no greyed, read-only address);
 *   - every save sends the WHOLE list (a partial one silently drops whoever it left out);
 *   - a refused address is never sent and stays where it was typed;
 *   - a row's + adds to THAT kind, and nothing is written before ✓;
 *   - no kind is created from this page (Sam: "remove the ability to add new email types").
 *
 * That a kind then reaches ONLY its own list is pinned against the database in
 * tests/integration/enquiries/enquiry-recipients.test.ts and enquiry-door.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { KindRows } from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/kind-rows'
import {
  deleteEnquiryKindAction,
  renameEnquiryKindAction,
  setEnquiryRecipientsAction,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions'
import type { EnquiryKindRow } from '@/lib/enquiries/kinds'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

// Mocked so the KIND of each toast can be asserted (a refusal once wore the success tick).
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions', () => ({
  addEnquiryKindAction: vi.fn(),
  deleteEnquiryKindAction: vi.fn(async () => ({})),
  renameEnquiryKindAction: vi.fn(async () => ({})),
  setEnquiryRecipientsAction: vi.fn(),
}))

const setList = vi.mocked(setEnquiryRecipientsAction)
const deleteKind = vi.mocked(deleteEnquiryKindAction)
const renameKind = vi.mocked(renameEnquiryKindAction)

const kind = (over: Partial<EnquiryKindRow> = {}): EnquiryKindRow => ({
  id: 'k-booking',
  slug: 'booking',
  label: 'Booking',
  sortOrder: 0,
  recipients: [],
  ...over,
})
const demo = (recipients: EnquiryKindRow['recipients'] = []) => kind({ id: 'k-demo', slug: 'demo', label: 'Demo', sortOrder: 1, recipients })
const contact = () => kind({ id: 'k-other', slug: 'other', label: 'Contact', sortOrder: 2 })

function renderRows(kinds: EnquiryKindRow[]) {
  return render(<KindRows artistId="a1" kinds={kinds} />)
}
const row = (slug: string) => document.querySelector<HTMLElement>(`[data-kind="${slug}"]`)!

/** Click an address (or name) open, so its field and glyphs appear. */
function open(slug: string, text: string) {
  fireEvent.click(within(row(slug)).getByRole('button', { name: text }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Echo the list back with server ids, the way the RPC returns rows as stored.
  setList.mockImplementation(async (_a, _k, list) => ({ rows: list.map((r, i) => ({ id: `srv-${i}`, ...r })) }))
})
afterEach(cleanup)

describe('the rows', () => {
  it('CRITICAL: each row lists its OWN addresses, every one clickable, and nothing else', () => {
    renderRows([
      kind({ recipients: [{ id: 'r1', email: 'agent@x.com', label: null }] }),
      demo([{ id: 'r2', email: 'ar@x.com', label: null }]),
      contact(),
    ])

    expect(within(row('booking')).getByRole('button', { name: 'agent@x.com' })).toBeTruthy()
    expect(within(row('demo')).getByRole('button', { name: 'ar@x.com' })).toBeTruthy()
    // A kind's list never shows on another kind's row.
    expect(within(row('demo')).queryByText('agent@x.com')).toBeNull()
    expect(within(row('other')).queryByText(/@/)).toBeNull()
  })

  it('says what each built-in kind is FOR, never its slug; an invented kind says nothing', () => {
    renderRows([kind(), demo(), contact(), kind({ id: 'k-press', slug: 'press', label: 'Press', sortOrder: 3 })])

    expect(within(row('booking')).getByText('For shows, festivals and private events')).toBeTruthy()
    expect(within(row('other')).getByText('For everything else')).toBeTruthy()
    // "booking" under Booking was the line Sam called useless.
    expect(within(row('booking')).queryByText('booking')).toBeNull()
    expect(row('press').textContent).toBe('Press')
  })
})

describe('click an address', () => {
  it('shows its field, Save and Remove; Escape puts it back and saves nothing', () => {
    renderRows([demo([{ id: 'r1', email: 'ar@x.com', label: null }])])
    expect(within(row('demo')).queryByRole('button', { name: 'Remove ar@x.com' })).toBeNull()

    open('demo', 'ar@x.com')
    const field = within(row('demo')).getByRole('textbox', { name: 'Email' })
    expect(field).toHaveValue('ar@x.com')
    expect(within(row('demo')).getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(within(row('demo')).getByRole('button', { name: 'Remove ar@x.com' })).toBeTruthy()

    fireEvent.change(field, { target: { value: 'typo' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(within(row('demo')).queryByRole('textbox')).toBeNull()
    expect(within(row('demo')).getByRole('button', { name: 'ar@x.com' })).toBeTruthy()
    expect(setList).not.toHaveBeenCalled()
  })

  it('Enter saves the WHOLE list with that one address changed', async () => {
    renderRows([demo([{ id: 'r1', email: 'a@x.com', label: 'A&R' }, { id: 'r2', email: 'b@x.com', label: null }])])

    open('demo', 'a@x.com')
    const field = within(row('demo')).getByRole('textbox', { name: 'Email' })
    fireEvent.change(field, { target: { value: 'a2@x.com' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(setList).toHaveBeenCalledWith('a1', 'k-demo', [
      { email: 'a2@x.com', label: 'A&R' },
      { id: 'r2', email: 'b@x.com', label: null },
    ])
  })

  it('a refused address is not sent, says why, and stays in the field', async () => {
    renderRows([demo([{ id: 'r1', email: 'a@x.com', label: null }, { id: 'r2', email: 'b@x.com', label: null }])])

    open('demo', 'a@x.com')
    const field = within(row('demo')).getByRole('textbox', { name: 'Email' })
    fireEvent.change(field, { target: { value: 'B@X.COM' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(setList).not.toHaveBeenCalled()
    expect(vi.mocked(toast)).toHaveBeenCalledWith('That address is already on the list.', 'error')
    expect(within(row('demo')).getByRole('textbox', { name: 'Email' })).toHaveValue('B@X.COM')
  })

  it('Remove sends the list without it, and asks nothing for an ordinary address', async () => {
    renderRows([demo([{ id: 'r1', email: 'a@x.com', label: null }, { id: 'r2', email: 'b@x.com', label: 'Mgr' }])])

    open('demo', 'a@x.com')
    await act(async () => {
      fireEvent.click(within(row('demo')).getByRole('button', { name: 'Remove a@x.com' }))
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setList).toHaveBeenCalledWith('a1', 'k-demo', [{ id: 'r2', email: 'b@x.com', label: 'Mgr' }])
  })

  it('removing a kind’s LAST address asks first, then sends the empty list', async () => {
    renderRows([demo([{ id: 'r1', email: 'only@x.com', label: null }])])

    open('demo', 'only@x.com')
    fireEvent.click(within(row('demo')).getByRole('button', { name: 'Remove only@x.com' }))
    const question = await screen.findByRole('dialog')
    expect(setList).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(question).getByRole('button', { name: 'Confirm' }))
    })
    expect(setList).toHaveBeenCalledWith('a1', 'k-demo', [])
  })

  it('puts the list back when the save is refused', async () => {
    setList.mockResolvedValueOnce({ error: 'A list holds at most 10 people.' })
    renderRows([demo([{ id: 'r1', email: 'a@x.com', label: null }, { id: 'r2', email: 'b@x.com', label: null }])])

    open('demo', 'a@x.com')
    await act(async () => {
      fireEvent.click(within(row('demo')).getByRole('button', { name: 'Remove a@x.com' }))
    })

    expect(within(row('demo')).getByRole('button', { name: 'a@x.com' })).toBeTruthy()
    expect(vi.mocked(toast)).toHaveBeenCalledWith('A list holds at most 10 people.', 'error')
  })

  it('lets only ONE save per kind be in flight — a remove and an add at once send once', async () => {
    // Each save sends the WHOLE list, so a second one racing the first would drop what the
    // first changed. AGENTS.md rule 5: both in ONE act() batch, so the latch (a ref) is tested.
    let release!: () => void
    setList.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ rows: [] }))))
    renderRows([demo([{ id: 'r1', email: 'a@x.com', label: null }, { id: 'r2', email: 'b@x.com', label: null }])])
    fireEvent.click(within(row('demo')).getByRole('button', { name: 'Add email to Demo' }))
    fireEvent.change(screen.getByLabelText('New email for Demo'), { target: { value: 'new@x.com' } })
    open('demo', 'a@x.com')

    await act(async () => {
      fireEvent.click(within(row('demo')).getByRole('button', { name: 'Remove a@x.com' }))
      fireEvent.keyDown(screen.getByLabelText('New email for Demo'), { key: 'Enter' })
    })

    expect(setList).toHaveBeenCalledTimes(1)
    // The add that could not start keeps its address to try again.
    expect(screen.getByLabelText('New email for Demo')).toHaveValue('new@x.com')
    await act(async () => release())
  })
})

describe('a kind’s name', () => {
  it('click it to rename: Enter sends the new name', async () => {
    renderRows([demo()])
    open('demo', 'Demo')
    const field = within(row('demo')).getByRole('textbox', { name: 'Kind name' })
    fireEvent.change(field, { target: { value: 'Demos' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(renameKind).toHaveBeenCalledWith('a1', 'k-demo', 'Demos')
  })

  it('a kind can be deleted (after asking), except Contact, the fallback', async () => {
    renderRows([kind(), contact(), kind({ id: 'k-press', slug: 'press', label: 'Press', sortOrder: 3 })])
    // Each checked while ITS field is open (opening the next closes it: a click away).
    open('other', 'Contact')
    expect(within(row('other')).getByRole('textbox', { name: 'Kind name' })).toBeTruthy()
    expect(within(row('other')).queryByRole('button', { name: /^Delete/ })).toBeNull()
    open('booking', 'Booking')
    expect(within(row('booking')).getByRole('button', { name: 'Delete Booking' })).toBeTruthy()

    open('press', 'Press')
    fireEvent.click(within(row('press')).getByRole('button', { name: 'Delete Press' }))
    const question = await screen.findByRole('dialog', { name: /Delete “Press”/ })
    expect(deleteKind).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(question).getByRole('button', { name: 'Confirm' }))
    })
    expect(deleteKind).toHaveBeenCalledWith('a1', 'k-press')
    await waitFor(() => expect(row('press')).toBeNull())
  })
})

describe('the row’s +', () => {
  it('every row has one, and there is no way to add a kind here', () => {
    renderRows([kind(), demo(), contact()])
    for (const label of ['Booking', 'Demo', 'Contact']) expect(within(row(label === 'Contact' ? 'other' : label.toLowerCase())).getByRole('button', { name: `Add email to ${label}` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /kind/i })).toBeNull()
  })

  it('a row’s + adds the address to THAT kind’s whole list', async () => {
    renderRows([kind({ recipients: [{ id: 'r0', email: 'agent@x.com', label: null }] }), demo([{ id: 'r1', email: 'a@x.com', label: null }])])

    fireEvent.click(within(row('demo')).getByRole('button', { name: 'Add email to Demo' }))
    const field = screen.getByLabelText('New email for Demo')
    fireEvent.change(field, { target: { value: 'new@x.com' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(setList).toHaveBeenCalledTimes(1)
    expect(setList).toHaveBeenCalledWith('a1', 'k-demo', [
      { id: 'r1', email: 'a@x.com', label: null },
      { email: 'new@x.com', label: null },
    ])
    expect(within(row('demo')).getByRole('button', { name: 'new@x.com' })).toBeTruthy()
  })

  it('a refused address is not sent and stays typed; Escape then writes nothing', async () => {
    renderRows([demo([{ id: 'r1', email: 'a@x.com', label: null }])])

    fireEvent.click(within(row('demo')).getByRole('button', { name: 'Add email to Demo' }))
    const field = screen.getByLabelText('New email for Demo')
    fireEvent.change(field, { target: { value: 'A@X.COM' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(vi.mocked(toast)).toHaveBeenCalledWith('That address is already on the list.', 'error')
    expect(screen.getByLabelText('New email for Demo')).toHaveValue('A@X.COM')

    fireEvent.keyDown(screen.getByLabelText('New email for Demo'), { key: 'Escape' })
    expect(screen.queryByLabelText('New email for Demo')).toBeNull()
    expect(setList).not.toHaveBeenCalled()
  })
})
