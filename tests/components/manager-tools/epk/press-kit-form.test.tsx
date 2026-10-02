// @vitest-environment jsdom
// The press kit's typed half saves itself (Batch 3): an edit reaches the existing action, whole and aligned.
/**
 * PressKitForm: Pitch and Quotes in Brand's ledger, with NO Save button (Sam, 2026-10-02,
 * prototypes/batch3_20261002.html). Every edit saves itself half a second later through the
 * same action the old Save button posted.
 *
 * LIGHT on the look (it is still settling); what is pinned is the main path and the CONTRACT
 * WITH THE SERVER: the action receives the whole kit, and the three quote lists stay aligned
 * (`readPressQuotesFromForm` zips them by index), so a removed row takes its source and link
 * with it. The FormData's shape itself is pinned in tests/unit/manager-tools/epk/epk.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PressKitForm } from '@/app/artists/[id]/(dashboard)/(manager-tools)/epk/press-kit-form'
import { savePressKitAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/epk/actions'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/epk/actions', () => ({
  savePressKitAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const mockedSave = vi.mocked(savePressKitAction)

const QUOTES = [
  { quote: 'A blistering live act.', source: 'NME', url: 'https://nme.com/x' },
  { quote: 'Unmissable.', source: 'Pitchfork', url: null },
]

/** Past the 500ms pause, and every save it started settled. */
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(600)))

/** The FormData the most recent save sent. */
function sent(): FormData {
  const call = mockedSave.mock.calls.at(-1)
  if (!call) throw new Error('the action was never called')
  return call[1] as FormData
}

beforeEach(() => {
  vi.useFakeTimers()
  mockedSave.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('PressKitForm saves itself', () => {
  it('an edit to the pitch saves the whole kit once, after the pause, with no Save button', async () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={QUOTES} />)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'One-line pitch' }), { target: { value: 'Austin four-piece.' } })
    expect(mockedSave).not.toHaveBeenCalled()
    await settle()

    expect(mockedSave).toHaveBeenCalledTimes(1)
    expect(mockedSave.mock.calls[0][0]).toBe('a1')
    const fd = sent()
    expect(fd.get('press_pitch')).toBe('Austin four-piece.')
    // The quotes ride along unchanged: the action writes both columns from one form.
    expect(fd.getAll('quote')).toEqual(['A blistering live act.', 'Unmissable.'])
    expect(fd.getAll('source')).toEqual(['NME', 'Pitchfork'])
    expect(fd.getAll('quote_url')).toEqual(['https://nme.com/x', ''])
  })

  it('CRITICAL: removing the first quote takes its source and link with it', async () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={QUOTES} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await settle()

    const fd = sent()
    expect(fd.getAll('quote')).toEqual(['Unmissable.'])
    expect(fd.getAll('source')).toEqual(['Pitchfork'])
    expect(fd.getAll('quote_url')).toEqual([''])
  })

  it('Add quote opens a row at "Who said it", and what is typed there saves with its own quote', async () => {
    render(<PressKitForm artistId="a1" pitch="" quotes={QUOTES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))
    const who = screen.getAllByRole('textbox', { name: 'Who said it' })[2]
    expect(who).toHaveFocus()

    fireEvent.change(who, { target: { value: 'Mixmag' } })
    fireEvent.change(screen.getAllByRole('textbox', { name: 'The quote' })[2], { target: { value: 'A warmer room.' } })
    await settle()

    expect(mockedSave).toHaveBeenCalledTimes(1)
    const fd = sent()
    expect(fd.getAll('quote')).toEqual(['A blistering live act.', 'Unmissable.', 'A warmer room.'])
    expect(fd.getAll('source')).toEqual(['NME', 'Pitchfork', 'Mixmag'])
    expect(fd.getAll('quote_url')).toEqual(['https://nme.com/x', '', ''])
  })
})
