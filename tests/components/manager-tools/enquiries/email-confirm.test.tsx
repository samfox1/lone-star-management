// @vitest-environment jsdom
// Settings › Email: add an address, its code is sent, the window asks for it, six digits confirm it.
/**
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/kind-rows.tsx,
 *           enquiries/confirm-window.tsx
 * Feature:  confirming an address before enquiries go to it (EMAIL_CONFIRM_PLAN.md §3, mock
 *           prototypes/email_confirm_20261005.html)
 * Tier:     LIGHT (AGENTS.md "Test depth"): a UI flow still being designed, so ONE test of the
 *           main path. The look (blue, the key, the slots' underline) is checked by screenshot.
 * Covers:   • add → the list is saved → sendEmailCodeAction(artist, address) → the window shows
 *             "Sent to <address>" with the first slot focused
 *           • the address waits (the code-window button) while the window is open
 *           • six typed digits → confirmEmailCodeAction(artist, address, code) → the window
 *             closes and the address is an ordinary, click-to-edit one
 * Not here: the slot rules and status words (tests/unit/manager-tools/enquiries/
 *           email-confirm.test.ts); the actions (email-code-actions.test.ts); the list rules
 *           with confirmation off (kind-rows.test.tsx).
 * Fixtures: every server action is mocked; the list save echoes what it was sent.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { KindRows } from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/kind-rows'
import {
  confirmEmailCodeAction,
  sendEmailCodeAction,
  setEnquiryRecipientsAction,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions', () => ({
  addEnquiryKindAction: vi.fn(),
  deleteEnquiryKindAction: vi.fn(),
  saveEnquiryKindAction: vi.fn(),
  setEnquiryRecipientsAction: vi.fn(),
  sendEmailCodeAction: vi.fn(),
  confirmEmailCodeAction: vi.fn(),
}))

const setList = vi.mocked(setEnquiryRecipientsAction)
const send = vi.mocked(sendEmailCodeAction)
const confirmCode = vi.mocked(confirmEmailCodeAction)

beforeEach(() => {
  setList.mockImplementation(async (_a, _k, list) => ({ rows: list.map((r, i) => ({ id: `srv-${i}`, ...r })) }))
  send.mockResolvedValue({ status: 'sent' })
  confirmCode.mockResolvedValue({ status: 'confirmed' })
})
afterEach(cleanup)

const row = () => document.querySelector<HTMLElement>('[data-kind="booking"]')!

describe('adding an address', () => {
  // The main path, end to end: the list saves, the code goes, the window asks, six digits confirm.
  it('sends its code, opens the window, and six digits confirm it', async () => {
    render(
      <KindRows
        artistId="a1"
        confirm={{ confirmed: ['agent@x.com'] }}
        kinds={[
          {
            id: 'k-booking',
            slug: 'booking',
            label: 'Booking',
            description: null,
            sortOrder: 0,
            recipients: [{ id: 'r1', email: 'agent@x.com', label: null }],
          },
        ]}
      />,
    )

    fireEvent.click(within(row()).getByRole('button', { name: 'Add email to Booking' }))
    const field = screen.getByLabelText('New email for Booking')
    fireEvent.change(field, { target: { value: 'jo@northbooking.com' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(setList).toHaveBeenCalledWith('a1', 'k-booking', [
      { id: 'r1', email: 'agent@x.com', label: null },
      { email: 'jo@northbooking.com', label: null },
    ])
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('a1', 'jo@northbooking.com')
    const win = screen.getByRole('dialog', { name: 'Enter the code' })
    expect(win.textContent).toContain('Sent to jo@northbooking.com')
    expect(within(win).getByRole('textbox', { name: 'Digit 1' })).toHaveFocus()
    // Waiting meanwhile: the address opens the window, it is not click-to-edit.
    expect(within(row()).getByRole('button', { name: 'jo@northbooking.com: enter the code' })).toBeTruthy()

    await act(async () => {
      '482913'.split('').forEach((d, i) => fireEvent.change(within(win).getByRole('textbox', { name: `Digit ${i + 1}` }), { target: { value: d } }))
    })

    expect(confirmCode).toHaveBeenCalledTimes(1)
    expect(confirmCode).toHaveBeenCalledWith('a1', 'jo@northbooking.com', '482913')
    expect(screen.queryByRole('dialog', { name: 'Enter the code' })).toBeNull()
    expect(within(row()).queryByRole('button', { name: 'jo@northbooking.com: enter the code' })).toBeNull()
    expect(within(row()).getByRole('button', { name: 'jo@northbooking.com' })).toBeTruthy()
  })

  // Sam, 2026-10-05: clicking a blue address sends its code, "and then the modal opens after".
  // Not while a code is still live: that would replace the one being read out.
  it('a click on a blue address sends its code and opens the window; with a live code it only opens', async () => {
    const kinds = [
      {
        id: 'k-booking',
        slug: 'booking',
        label: 'Booking',
        description: null,
        sortOrder: 0,
        recipients: [
          { id: 'r1', email: 'ross@x.com', label: null },
          { id: 'r2', email: 'skeen@x.com', label: null },
        ],
      },
    ]
    render(<KindRows artistId="a1" confirm={{ confirmed: [], liveCodes: { 'skeen@x.com': Date.now() - 60_000 } }} kinds={kinds} />)

    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'ross@x.com: enter the code' }))
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('a1', 'ross@x.com')
    expect(screen.getByRole('dialog', { name: 'Enter the code' }).textContent).toContain('Sent to ross@x.com')

    // The same address again: its code is live now, so nothing more is sent.
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'ross@x.com: enter the code' }))
    })
    expect(send).toHaveBeenCalledTimes(1)

    // skeen@ had a live code from before this visit: it opens on it, sends nothing.
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'skeen@x.com: enter the code' }))
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Enter the code' }).textContent).toContain('skeen@x.com')
  })

  // Sam, 2026-10-05: "forget it on removal". Taken off its only list, a confirmed address is
  // forgotten here as in the database: added again, it waits and its code goes.
  it('a confirmed address removed and added again asks for a new code', async () => {
    render(
      <KindRows
        artistId="a1"
        confirm={{ confirmed: ['agent@x.com', 'jo@x.com'] }}
        kinds={[
          {
            id: 'k-booking',
            slug: 'booking',
            label: 'Booking',
            description: null,
            sortOrder: 0,
            recipients: [
              { id: 'r1', email: 'agent@x.com', label: null },
              { id: 'r2', email: 'jo@x.com', label: null },
            ],
          },
        ]}
      />,
    )

    fireEvent.click(within(row()).getByRole('button', { name: 'jo@x.com' }))
    await act(async () => {
      fireEvent.click(within(row()).getByRole('button', { name: 'Remove jo@x.com' }))
    })
    expect(setList).toHaveBeenLastCalledWith('a1', 'k-booking', [{ id: 'r1', email: 'agent@x.com', label: null }])

    fireEvent.click(within(row()).getByRole('button', { name: 'Add email to Booking' }))
    const field = screen.getByLabelText('New email for Booking')
    fireEvent.change(field, { target: { value: 'jo@x.com' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(send).toHaveBeenCalledWith('a1', 'jo@x.com')
    expect(within(row()).getByRole('button', { name: 'jo@x.com: enter the code' })).toBeTruthy()
  })
})
